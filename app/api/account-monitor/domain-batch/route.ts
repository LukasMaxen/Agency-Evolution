import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// POST /api/account-monitor/domain-batch
//
// Atomic domain-level batch. Operates on a list of EmailBison sender_ids
// in a single workspace and supports three domain-level actions:
// pause_outbound_and_warmup, enable_warmup, attach_to_all.
//
// IMPORTANT: this route MUST NEVER call /api/campaigns/{id}/remove-sender-emails
// or any other endpoint that unattaches senders from campaigns. EB keeps the
// lead-sender pairing for follow-up steps; if a sender is unattached while
// leads are mid-sequence, those leads' follow-ups stop firing entirely.
// Operator lost prospects to this in May/June 2026; the pause-outbound flow
// throttles daily_limit to 1 instead, which keeps follow-ups alive while
// effectively stopping new sends. See feedback memory:
//   feedback-never-remove-sender-from-campaign.md

const ATTACH_STATES = new Set(["active", "running", "live", "draft", "queued", "launching", "paused"]);
const TERMINAL_STATES = new Set(["completed", "archived", "finished", "ended"]);
const PAUSE_DAILY_LIMIT = 1;
// Restored on attach_to_all so a previously paused sender is not silently
// left at 1/day after being re-added to campaigns. 20 matches EB's default
// for our workspaces (CLAUDE.md / SKILL_LeadMonitoring say 25 but live EB
// inspection of Sonaro and others shows 20 is the active default).
const RESUME_DAILY_LIMIT = 20;
// Warmup daily-volume targets. When we pause outbound we want maximum
// engagement to rebuild reputation, so push warmup to EB's ceiling (50;
// values above this return 422). When we re-attach to campaigns we drop
// warmup back so the total daily footprint (outbound + warmup) matches a
// normal sender. Endpoint:
//   PATCH /api/warmup/sender-emails/update-daily-warmup-limits
//   body: { sender_email_ids: [...], daily_limit: N }
// daily_reply_limit is intentionally left to EB to manage automatically;
// the EB docs warn against operator-controlled reply rate.
const WARMUP_PAUSE_LIMIT  = 50;
const WARMUP_RESUME_LIMIT = 30;

// Concurrency cap for per-sender / per-campaign EB+DB bursts. The previous
// Promise.all(items.map(...)) pattern fired all in parallel which, when the
// operator triggered 7 domain-batches at once, exhausted the pg pool and
// surfaced as "timeout exceeded when trying to connect". 8 keeps each
// invocation's burst small enough that the pool can serve concurrent
// dashboard reads at the same time.
const EB_CHUNK = 8;
async function pMap<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

type Action = "pause_outbound_and_warmup" | "enable_warmup" | "attach_to_all";
type Body = {
  workspace_slug: string;
  sender_ids:     number[];
  action:         Action;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Body;
    const { workspace_slug, sender_ids, action } = body;
    if (!workspace_slug || !Array.isArray(sender_ids) || sender_ids.length === 0 || !action) {
      return NextResponse.json({ error: "workspace_slug, sender_ids[] and action are required" }, { status: 400 });
    }
    if (!["pause_outbound_and_warmup", "enable_warmup", "attach_to_all"].includes(action)) {
      return NextResponse.json({ error: "action must be pause_outbound_and_warmup, enable_warmup, or attach_to_all" }, { status: 400 });
    }

    const wsRes = await pool.query(
      "SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1",
      [workspace_slug]
    );
    if (wsRes.rows.length === 0) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    const { email_bison_api_key: apiKey, email_bison_instance_url: instanceUrl } = wsRes.rows[0];
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" };

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
      const campaigns: { id: number; name: string }[] = (campsJson.data ?? [])
        .filter((c: any) => ATTACH_STATES.has(String(c.status ?? "").toLowerCase()))
        .map((c: any) => ({ id: c.id, name: c.name }));

      const results = await pMap(campaigns, EB_CHUNK, async c => {
        const r = await fetch(`${instanceUrl}/api/campaigns/${c.id}/attach-sender-emails`, {
          method: "POST", headers,
          body: JSON.stringify({ sender_email_ids: sender_ids }),
        });
        return { id: c.id, name: c.name, ok: r.ok, err: r.ok ? null : await r.text() };
      });

      // Restore daily sending volume. A sender that was previously paused
      // (daily_limit=1) would otherwise be re-attached but still throttled
      // at 1/day, which silently keeps the domain near-idle.
      const resumeResults = await pMap(sender_ids, EB_CHUNK, async id => {
        const r = await fetch(`${instanceUrl}/api/sender-emails/${id}`, {
          method: "PATCH", headers,
          body: JSON.stringify({ daily_limit: RESUME_DAILY_LIMIT }),
        });
        return { id, ok: r.ok, err: r.ok ? null : await r.text() };
      });
      const resumeFailed = resumeResults.filter(r => !r.ok);

      // Reset warmup volume back to its operating default. Pause-outbound
      // bumps it to the ceiling (50); leaving that high after a re-attach
      // would mean every reattached sender carries an aggressive warmup
      // load on top of full outbound, which looks unnatural to providers.
      const warmupLimitRes = await fetch(`${instanceUrl}/api/warmup/sender-emails/update-daily-warmup-limits`, {
        method: "PATCH", headers,
        body: JSON.stringify({ sender_email_ids: sender_ids, daily_limit: WARMUP_RESUME_LIMIT }),
      });

      // Mirror the restored limits into the local DB so the dashboard
      // reflects the new state immediately, not after the hourly sync.
      const resumeSucceededIds = resumeResults.filter(r => r.ok).map(r => r.id);
      if (resumeSucceededIds.length > 0) {
        await pool.query(
          `UPDATE sender_accounts SET daily_limit = $1
            WHERE workspace_slug = $2 AND eb_sender_id = ANY($3::int[])`,
          [RESUME_DAILY_LIMIT, workspace_slug, resumeSucceededIds]
        );
      }
      if (warmupLimitRes.ok) {
        await pool.query(
          `UPDATE sender_accounts SET warmup_daily_limit = $1
            WHERE workspace_slug = $2 AND eb_sender_id = ANY($3::int[])`,
          [WARMUP_RESUME_LIMIT, workspace_slug, sender_ids]
        );
      }

      // Only clear warming_since for senders whose limits were actually
      // restored; otherwise the dashboard would show a sender as "active"
      // while it's still throttled/warming at EB.
      if (resumeSucceededIds.length > 0 && warmupLimitRes.ok) {
        await pool.query(
          `UPDATE sender_accounts SET warming_since = NULL
            WHERE workspace_slug = $1 AND eb_sender_id = ANY($2::int[]) AND warming_since IS NOT NULL`,
          [workspace_slug, resumeSucceededIds]
        );
      }
      await refreshAttachedCounts(instanceUrl, headers, workspace_slug, sender_ids);

      const succeeded = results.filter(r => r.ok).length;
      const failed    = results.filter(r => !r.ok).length;
      return NextResponse.json({
        ok: failed === 0 && resumeFailed.length === 0 && warmupLimitRes.ok,
        action,
        sender_count:           sender_ids.length,
        campaigns:              campaigns.length,
        succeeded,
        failed,
        daily_limit_set:        RESUME_DAILY_LIMIT,
        warmup_daily_limit_set: WARMUP_RESUME_LIMIT,
        warmup_limit:           warmupLimitRes.ok ? "reset" : `failed (${warmupLimitRes.status})`,
        resume_failed:          resumeFailed.map(r => ({ id: r.id, err: r.err })),
        errors:                 results.filter(r => !r.ok).map(r => ({ id: r.id, name: r.name, err: r.err })),
      });
    }

    // ── pause_outbound_and_warmup ────────────────────────────────────────
    // Throttle the sender's daily volume to 1/day and turn warmup on. The
    // sender STAYS attached to its campaigns so any leads mid-follow-up
    // keep getting their next step. EB's PATCH /api/sender-emails/{id} with
    // { daily_limit: N } is the only call needed; campaigns themselves are
    // not touched.
    const throttleResults = await pMap(sender_ids, EB_CHUNK, async id => {
      const r = await fetch(`${instanceUrl}/api/sender-emails/${id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ daily_limit: PAUSE_DAILY_LIMIT }),
      });
      return { id, ok: r.ok, err: r.ok ? null : await r.text() };
    });
    const throttleFailed = throttleResults.filter(r => !r.ok);

    // Enable warmup batch. EB accepts the full sender_email_ids[] in one
    // call so this is a single request regardless of batch size.
    const warmupRes = await fetch(`${instanceUrl}/api/warmup/sender-emails/enable`, {
      method: "PATCH", headers,
      body: JSON.stringify({ sender_email_ids: sender_ids }),
    });

    // Push warmup volume to its EB ceiling. The point of pause-outbound is
    // reputation recovery; leaving warmup at the sender-default (typically
    // 20-30) would mean a slower bounce-back. The endpoint accepts the
    // full batch in a single call.
    const warmupLimitRes = await fetch(`${instanceUrl}/api/warmup/sender-emails/update-daily-warmup-limits`, {
      method: "PATCH", headers,
      body: JSON.stringify({ sender_email_ids: sender_ids, daily_limit: WARMUP_PAUSE_LIMIT }),
    });

    // Mirror the new state into our local DB. warming_since starts the
    // "warming for X days" clock; warmup_enabled mirrors EB.
    if (warmupRes.ok) {
      await pool.query(
        `UPDATE sender_accounts SET warmup_enabled = TRUE
          WHERE workspace_slug = $1 AND eb_sender_id = ANY($2::int[])`,
        [workspace_slug, sender_ids]
      );
    }
    const throttleSucceededIds = throttleResults.filter(r => r.ok).map(r => r.id);
    if (throttleSucceededIds.length > 0) {
      await pool.query(
        `UPDATE sender_accounts SET daily_limit = $1
          WHERE workspace_slug = $2 AND eb_sender_id = ANY($3::int[])`,
        [PAUSE_DAILY_LIMIT, workspace_slug, throttleSucceededIds]
      );
    }
    if (warmupLimitRes.ok) {
      await pool.query(
        `UPDATE sender_accounts SET warmup_daily_limit = $1
          WHERE workspace_slug = $2 AND eb_sender_id = ANY($3::int[])`,
        [WARMUP_PAUSE_LIMIT, workspace_slug, sender_ids]
      );
    }
    // Only stamp warming_since for senders whose outbound was actually
    // throttled; otherwise a failed EB PATCH would still flip the sender
    // to "warming only" in the UI while EB keeps sending at full volume.
    if (throttleSucceededIds.length > 0) {
      await pool.query(
        `UPDATE sender_accounts SET warming_since = NOW()
          WHERE workspace_slug = $1 AND eb_sender_id = ANY($2::int[])`,
        [workspace_slug, throttleSucceededIds]
      );
    }

    return NextResponse.json({
      ok:                     throttleFailed.length === 0 && warmupRes.ok && warmupLimitRes.ok,
      action,
      sender_count:           sender_ids.length,
      daily_limit_set:        PAUSE_DAILY_LIMIT,
      warmup_daily_limit_set: WARMUP_PAUSE_LIMIT,
      throttle_failed:        throttleFailed.map(r => ({ id: r.id, err: r.err })),
      warmup:                 warmupRes.ok ? "enabled" : `failed (${warmupRes.status})`,
      warmup_limit:           warmupLimitRes.ok ? "set" : `failed (${warmupLimitRes.status})`,
    });

  } catch (err: any) {
    console.error("[domain-batch] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Refresh the cached attached_campaigns_count from EB for each sender in
// the batch and write it back to sender_accounts. Used by attach_to_all so
// the dashboard reflects the new attach without waiting for the next sync.
async function refreshAttachedCounts(
  instanceUrl: string,
  headers: Record<string, string>,
  workspace_slug: string,
  sender_ids: number[],
): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  await pMap(sender_ids, EB_CHUNK, async id => {
    try {
      const r = await fetch(`${instanceUrl}/api/sender-emails/${id}/campaigns`, { headers });
      if (!r.ok) return;
      const body = await r.json();
      const live = (body?.data ?? []).filter((c: any) => !TERMINAL_STATES.has(String(c.status ?? "").toLowerCase())).length;
      out[id] = live;
      await pool.query(
        `UPDATE sender_accounts SET attached_campaigns_count = $1
          WHERE workspace_slug = $2 AND eb_sender_id = $3`,
        [live, workspace_slug, id]
      );
    } catch { /* non-fatal */ }
  });
  return out;
}
