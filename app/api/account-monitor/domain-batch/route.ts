import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// POST /api/account-monitor/domain-batch
//
// Atomic domain-level batch. Operates on a list of EmailBison sender_ids
// in a single workspace and supports the three domain-level Warmup-Monitor
// actions: remove_and_warmup, enable_warmup, attach_to_all.
//
// Why this exists: the per-sender route iterates pause / DELETE / resume
// for each sender independently. If one sender fails mid-batch the
// remaining senders never get touched, leaving the domain in a partial
// state (some moved to warming, some still active). The atomic version
// pauses every unique campaign once, removes ALL sender_ids per campaign
// in a single EB call, waits once, and resumes once. Then verifies every
// sender ended at attached_count = 0; any straggler gets a one-shot retry.
//
// EB only allows DELETE in "draft" or "paused" states, so anything else
// gets paused first. Completed/archived campaigns are skipped — DELETE
// rejects there and they are not sending anyway.

const TERMINAL_STATES = new Set(["completed", "archived", "finished", "ended"]);
const PAUSABLE_STATES = new Set(["draft", "paused"]);
const REMOVE_WAIT_MS  = 8000;

type Body = {
  workspace_slug: string;
  sender_ids:     number[];
  action:         "remove_and_warmup" | "enable_warmup" | "attach_to_all";
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Body;
    const { workspace_slug, sender_ids, action } = body;
    if (!workspace_slug || !Array.isArray(sender_ids) || sender_ids.length === 0 || !action) {
      return NextResponse.json({ error: "workspace_slug, sender_ids[] and action are required" }, { status: 400 });
    }
    if (!["remove_and_warmup", "enable_warmup", "attach_to_all"].includes(action)) {
      return NextResponse.json({ error: "action must be remove_and_warmup, enable_warmup, or attach_to_all" }, { status: 400 });
    }

    const wsRes = await pool.query(
      "SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1",
      [workspace_slug]
    );
    if (wsRes.rows.length === 0) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    const { email_bison_api_key: apiKey, email_bison_instance_url: instanceUrl } = wsRes.rows[0];
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" };

    const setCampaignStatus = (id: number, op: "pause" | "resume") =>
      fetch(`${instanceUrl}/api/campaigns/${id}/${op}`, { method: "PATCH", headers, body: "{}" });

    // ── enable_warmup ────────────────────────────────────────────────────
    if (action === "enable_warmup") {
      const res = await fetch(`${instanceUrl}/api/warmup/sender-emails/enable`, {
        method: "PATCH", headers,
        body: JSON.stringify({ sender_email_ids: sender_ids }),
      });
      const ok = res.ok;
      if (ok) {
        await pool.query(
          `UPDATE sender_accounts SET warmup_enabled = TRUE
            WHERE workspace_slug = $1 AND eb_sender_id = ANY($2::int[])`,
          [workspace_slug, sender_ids]
        );
      }
      return NextResponse.json({
        ok,
        action,
        sender_count: sender_ids.length,
        warmup:       ok ? "enabled" : `failed (${res.status})`,
      });
    }

    // ── attach_to_all ────────────────────────────────────────────────────
    if (action === "attach_to_all") {
      const campsRes = await fetch(`${instanceUrl}/api/campaigns?per_page=250`, { headers });
      if (!campsRes.ok) {
        return NextResponse.json({ error: `Failed to list campaigns (${campsRes.status})` }, { status: 502 });
      }
      const campsJson = await campsRes.json();
      const ATTACH_STATES = new Set(["active", "running", "live", "draft", "queued", "launching", "paused"]);
      const campaigns: { id: number; name: string }[] = (campsJson.data ?? [])
        .filter((c: any) => ATTACH_STATES.has(String(c.status ?? "").toLowerCase()))
        .map((c: any) => ({ id: c.id, name: c.name }));

      const results = await Promise.all(campaigns.map(async c => {
        const r = await fetch(`${instanceUrl}/api/campaigns/${c.id}/attach-sender-emails`, {
          method: "POST", headers,
          body: JSON.stringify({ sender_email_ids: sender_ids }),
        });
        return { id: c.id, name: c.name, ok: r.ok, err: r.ok ? null : await r.text() };
      }));

      await pool.query(
        `UPDATE sender_accounts SET warming_since = NULL
          WHERE workspace_slug = $1 AND eb_sender_id = ANY($2::int[]) AND warming_since IS NOT NULL`,
        [workspace_slug, sender_ids]
      );
      await refreshAttachedCounts(instanceUrl, headers, workspace_slug, sender_ids);

      const succeeded = results.filter(r => r.ok).length;
      const failed    = results.filter(r => !r.ok).length;
      return NextResponse.json({
        ok: failed === 0,
        action,
        sender_count: sender_ids.length,
        campaigns:    campaigns.length,
        succeeded,
        failed,
        errors:       results.filter(r => !r.ok).map(r => ({ id: r.id, name: r.name, err: r.err })),
      });
    }

    // ── remove_and_warmup (atomic) ───────────────────────────────────────
    // Build the union of campaigns across the sender batch. EB doesn't
    // expose a "campaigns for many senders" endpoint, so walk per-sender
    // in parallel and stitch the result. status is captured per campaign;
    // PAUSABLE_STATES (draft/paused) are left as-is, everything else gets
    // a pause before DELETE.
    const campaignsBySender = await Promise.all(sender_ids.map(async id => {
      const r = await fetch(`${instanceUrl}/api/sender-emails/${id}/campaigns`, { headers });
      if (!r.ok) return [] as { id: number; name: string; status: string }[];
      const j = await r.json();
      return (j.data ?? []).map((c: any) => ({ id: c.id, name: c.name, status: String(c.status ?? "").toLowerCase() }));
    }));
    const campMap = new Map<number, { id: number; name: string; status: string }>();
    for (const list of campaignsBySender) {
      for (const c of list) if (!campMap.has(c.id) && !TERMINAL_STATES.has(c.status)) campMap.set(c.id, c);
    }
    const campaigns = Array.from(campMap.values());

    // Step a: pause anything not already in a pausable state, in parallel.
    const pausedCamps: number[] = [];
    const pauseErrors: { id: number; err: string }[] = [];
    await Promise.all(campaigns.filter(c => !PAUSABLE_STATES.has(c.status)).map(async c => {
      const r = await setCampaignStatus(c.id, "pause");
      if (r.ok) pausedCamps.push(c.id);
      else pauseErrors.push({ id: c.id, err: `pause ${r.status}` });
    }));
    const pauseFailedIds = new Set(pauseErrors.map(e => e.id));

    // Step b: DELETE the batch from every campaign in parallel. EB takes
    // sender_email_ids[] so the whole sender list comes off in one call
    // per campaign.
    const removeTargets = campaigns.filter(c => !pauseFailedIds.has(c.id));
    const removeResults = await Promise.all(removeTargets.map(async c => {
      const r = await fetch(`${instanceUrl}/api/campaigns/${c.id}/remove-sender-emails`, {
        method: "DELETE", headers,
        body: JSON.stringify({ sender_email_ids: sender_ids }),
      });
      return { id: c.id, name: c.name, ok: r.ok, err: r.ok ? null : await r.text() };
    }));

    // Step c: single 8s wait for EB to drain the async deletion queue.
    if (removeResults.some(r => r.ok)) await new Promise(r => setTimeout(r, REMOVE_WAIT_MS));

    // Step d: resume the campaigns we paused.
    await Promise.all(pausedCamps.map(id => setCampaignStatus(id, "resume")));

    // Step e: enable warmup for any senders whose flag is off in DB.
    // We always hit EB rather than trusting the cached flag because the
    // operator's intent is explicit ("move to warmup").
    const warmupRes = await fetch(`${instanceUrl}/api/warmup/sender-emails/enable`, {
      method: "PATCH", headers,
      body: JSON.stringify({ sender_email_ids: sender_ids }),
    });
    if (warmupRes.ok) {
      await pool.query(
        `UPDATE sender_accounts SET warmup_enabled = TRUE
          WHERE workspace_slug = $1 AND eb_sender_id = ANY($2::int[])`,
        [workspace_slug, sender_ids]
      );
    }

    // Step f: stamp warming_since on every sender in the batch.
    await pool.query(
      `UPDATE sender_accounts SET warming_since = NOW()
        WHERE workspace_slug = $1 AND eb_sender_id = ANY($2::int[])`,
      [workspace_slug, sender_ids]
    );

    // Step g: refresh attached_campaigns_count from EB and verify every
    // sender ended at 0. Any straggler gets a one-shot retry — pause-and-
    // DELETE just its remaining campaigns. This is the safety net that
    // prevents the half-paused-domain bug.
    const finalCounts = await refreshAttachedCounts(instanceUrl, headers, workspace_slug, sender_ids);
    const stragglers = Object.entries(finalCounts).filter(([_, n]) => (n ?? 0) > 0).map(([id]) => Number(id));

    let retried: { sender_id: number; before: number | null; after: number | null }[] = [];
    if (stragglers.length > 0) {
      retried = await Promise.all(stragglers.map(async id => {
        const before = finalCounts[id] ?? null;
        // Re-list and re-remove the straggler's remaining campaigns.
        const r = await fetch(`${instanceUrl}/api/sender-emails/${id}/campaigns`, { headers });
        if (!r.ok) return { sender_id: id, before, after: before };
        const j = await r.json();
        const camps = (j.data ?? [])
          .map((c: any) => ({ id: c.id, name: c.name, status: String(c.status ?? "").toLowerCase() }))
          .filter((c: any) => !TERMINAL_STATES.has(c.status));
        const pausedThisRetry: number[] = [];
        await Promise.all(camps.filter((c: any) => !PAUSABLE_STATES.has(c.status)).map(async (c: any) => {
          const pr = await setCampaignStatus(c.id, "pause");
          if (pr.ok) pausedThisRetry.push(c.id);
        }));
        await Promise.all(camps.map((c: any) =>
          fetch(`${instanceUrl}/api/campaigns/${c.id}/remove-sender-emails`, {
            method: "DELETE", headers,
            body: JSON.stringify({ sender_email_ids: [id] }),
          })
        ));
        await new Promise(r => setTimeout(r, REMOVE_WAIT_MS));
        await Promise.all(pausedThisRetry.map(cid => setCampaignStatus(cid, "resume")));
        const after = (await refreshAttachedCounts(instanceUrl, headers, workspace_slug, [id]))[id] ?? null;
        return { sender_id: id, before, after };
      }));
    }

    const finalAfterRetry = await refreshAttachedCounts(instanceUrl, headers, workspace_slug, sender_ids);
    const allCleared = sender_ids.every(id => (finalAfterRetry[id] ?? 0) === 0);

    return NextResponse.json({
      ok: allCleared,
      action,
      sender_count:    sender_ids.length,
      campaigns:       campaigns.length,
      pause_errors:    pauseErrors,
      remove_errors:   removeResults.filter(r => !r.ok).map(r => ({ id: r.id, err: r.err })),
      stragglers:      stragglers.length,
      retried,
      final_counts:    finalAfterRetry,
      warmup:          warmupRes.ok ? "enabled" : `failed (${warmupRes.status})`,
    });

  } catch (err: any) {
    console.error("[domain-batch] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Refresh the cached attached_campaigns_count from EB for each sender in
// the batch and write it back to sender_accounts. Returns a map of
// sender_id -> live count so the caller can verify the action took.
async function refreshAttachedCounts(
  instanceUrl: string,
  headers: Record<string, string>,
  workspace_slug: string,
  sender_ids: number[],
): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  const TERMINAL = new Set(["completed", "archived", "finished", "ended"]);
  await Promise.all(sender_ids.map(async id => {
    try {
      const r = await fetch(`${instanceUrl}/api/sender-emails/${id}/campaigns`, { headers });
      if (!r.ok) return;
      const body = await r.json();
      const live = (body?.data ?? []).filter((c: any) => !TERMINAL.has(String(c.status ?? "").toLowerCase())).length;
      out[id] = live;
      await pool.query(
        `UPDATE sender_accounts SET attached_campaigns_count = $1
          WHERE workspace_slug = $2 AND eb_sender_id = $3`,
        [live, workspace_slug, id]
      );
    } catch { /* non-fatal */ }
  }));
  return out;
}
