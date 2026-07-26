import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// POST /api/sync-sender-accounts?workspace=slug  (or omit for all workspaces)
//
// Fetches the full sender email list from EmailBison for each workspace,
// upserts them into sender_accounts, and DELETES any row whose email
// no longer exists in EB. This keeps the app in sync automatically.
//
// Call this:
//  - On a schedule (add to instrumentation.ts, e.g. every 6 hours)
//  - After any manual add/remove in EmailBison
//  - From the Account Monitor UI "Sync" button

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetSlug = searchParams.get("workspace"); // optional — sync one workspace only

  try {
    // 1. Fetch workspaces to sync
    const wsQuery = targetSlug
      ? "SELECT slug, email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1"
      : "SELECT slug, email_bison_api_key, email_bison_instance_url FROM workspaces ORDER BY slug";

    const wsResult = await pool.query(wsQuery, targetSlug ? [targetSlug] : []);

    if (wsResult.rows.length === 0) {
      return NextResponse.json({ error: "No workspaces found" }, { status: 404 });
    }

    const results: {
      workspace: string;
      added: number;
      updated: number;
      removed: number;
      total: number;
      error?: string;
    }[] = [];

    for (const ws of wsResult.rows) {
      const { slug, email_bison_api_key: apiKey, email_bison_instance_url: instanceUrl } = ws;

      if (!apiKey || !instanceUrl) {
        results.push({ workspace: slug, added: 0, updated: 0, removed: 0, total: 0, error: "Missing EB credentials" });
        continue;
      }

      try {
        // 2. Fetch ALL sender emails from EmailBison (paginate if needed)
        const ebSenders: {
          id: number;
          email: string;
          warmup_enabled: boolean;
          status: string;
          provider_type: string | null;
          daily_limit: number | null;
          tags: string[] | null;
          eb_created_at: string | null;
        }[] = [];
        let page = 1;
        let hasMore = true;

       while (hasMore) {
  const res = await fetch(
    `${instanceUrl}/api/sender-emails?page=${page}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    throw new Error(`EmailBison API error (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const rows = data.data ?? [];
  // Skip Microsoft/Outlook AND unclassified senders. Microsoft is out
  // of scope. Unclassified (s.type missing/null) is almost always a
  // transient EB state — a sender that was just added but EB has not
  // yet attached the provider tag. Storing them anyway pollutes the
  // dashboards with hundreds of phantom senders that later get removed
  // from EB but linger in our DB because no sync re-runs in between.
  // EB provider_type values seen: google_workspace_oauth, microsoft_oauth.
  const filtered = rows.filter((s: any) => {
    const t = String(s.type ?? "").toLowerCase();
    if (!t) return false;
    return !/(microsoft|office365|outlook)/.test(t);
  });
  ebSenders.push(
    ...filtered.map((s: any) => ({
      id:             s.id,
      email:          s.email?.toLowerCase().trim(),
      warmup_enabled: s.warmup_enabled ?? false,
      status:         s.status ?? "active",
      provider_type:  s.type ?? null,
      daily_limit:    typeof s.daily_limit === "number" ? s.daily_limit : null,
      tags:           Array.isArray(s.tags) ? s.tags.map(String) : null,
      eb_created_at:  s.created_at ?? null,
    }))
  );

  const currentPage = data.meta?.current_page ?? page;
  const lastPage    = data.meta?.last_page ?? page;
  hasMore = currentPage < lastPage;
  page++;
}

        const ebEmailSet = new Set(ebSenders.map(s => s.email));

        // 3. Upsert all senders currently in EB
        let added = 0;
        let updated = 0;

        for (const sender of ebSenders) {
          const upsertResult = await pool.query(
            `INSERT INTO sender_accounts
               (workspace_slug, email, eb_sender_id, warmup_enabled, status, provider_type,
                daily_limit, tags, eb_created_at, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
             ON CONFLICT (workspace_slug, email)
             DO UPDATE SET
               eb_sender_id   = EXCLUDED.eb_sender_id,
               warmup_enabled = EXCLUDED.warmup_enabled,
               status         = EXCLUDED.status,
               provider_type  = EXCLUDED.provider_type,
               daily_limit    = COALESCE(EXCLUDED.daily_limit, sender_accounts.daily_limit),
               tags           = COALESCE(EXCLUDED.tags, sender_accounts.tags),
               eb_created_at  = COALESCE(EXCLUDED.eb_created_at, sender_accounts.eb_created_at),
               synced_at      = NOW()
             RETURNING (xmax = 0) AS inserted`,
            [
              slug, sender.email, sender.id, sender.warmup_enabled, sender.status, sender.provider_type,
              sender.daily_limit,
              sender.tags ?? null,
              sender.eb_created_at,
            ]
          );

          if (upsertResult.rows[0]?.inserted) added++;
          else updated++;
        }

        // 4. Delete any sender in the DB that no longer exists in EB
        //    These were removed from EmailBison — they should not appear in the app.
        const deleteResult = await pool.query(
          `DELETE FROM sender_accounts
           WHERE workspace_slug = $1
             AND email != ALL($2::text[])
           RETURNING email`,
          [slug, Array.from(ebEmailSet)]
        );

        const removed = deleteResult.rowCount ?? 0;

        // 4b. Refresh warmup_score per sender from /api/warmup/sender-emails.
        //     This endpoint returns warmup_score (0-100), warmup_enabled,
        //     warmup_emails_sent, warmup_replies_received per row. EB caps
        //     pagination at 15/page. Failures here are logged but do not
        //     abort the whole sync.
        try {
          let wPage = 1;
          let wHasMore = true;
          let wupdated = 0;
          while (wHasMore) {
            const wRes = await fetch(`${instanceUrl}/api/warmup/sender-emails?per_page=250&page=${wPage}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
            if (!wRes.ok) break;
            const wBody = await wRes.json();
            for (const row of (wBody?.data ?? [])) {
              if (!row?.id) continue;
              const score       = (typeof row.warmup_score === "number") ? row.warmup_score : null;
              const enabled     = row.warmup_enabled === true;
              const warmupLimit = (typeof row.warmup_daily_limit === "number") ? row.warmup_daily_limit : null;
              const res = await pool.query(
                `UPDATE sender_accounts
                   SET warmup_score        = $1,
                       warmup_enabled      = $2,
                       warmup_daily_limit  = COALESCE($3, warmup_daily_limit)
                 WHERE workspace_slug = $4 AND eb_sender_id = $5`,
                [score, enabled, warmupLimit, slug, row.id]
              );
              if (res.rowCount && res.rowCount > 0) wupdated++;
            }
            const last = wBody?.meta?.last_page ?? wPage;
            wHasMore = wPage < last;
            wPage++;
          }
          console.log(`[sync-sender-accounts] ${slug} warmup_score updated for ${wupdated} senders`);
        } catch (wupErr: any) {
          console.error(`[sync-sender-accounts] ${slug} warmup refresh failed:`, wupErr?.message);
        }

        // 5. Refresh attached_campaigns_count per sender by walking all
        //    campaigns and counting how many list each sender_email_id.
        //    Paginated 15/page; only active-type campaigns count toward the
        //    metric (paused/completed should not count, since the sender is
        //    not currently delivering through them).
        const attachedCount: Record<number, number> = {};
        try {
          let cPage = 1;
          let cHasMore = true;
          while (cHasMore) {
            const cRes = await fetch(`${instanceUrl}/api/campaigns?per_page=250&page=${cPage}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
            if (!cRes.ok) break;
            const cBody = await cRes.json();
            const camps: any[] = cBody?.data ?? [];
            for (const camp of camps) {
              const s = String(camp.status ?? "").toLowerCase();
              const isActive = s === "active" || s === "running" || s === "live" || s === "draft";
              if (!isActive) continue;
              // Walk paginated sender list for this campaign.
              let sPage = 1, sHasMore = true;
              while (sHasMore) {
                const sRes = await fetch(`${instanceUrl}/api/campaigns/${camp.id}/sender-emails?per_page=250&page=${sPage}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
                if (!sRes.ok) break;
                const sBody = await sRes.json();
                for (const s of (sBody?.data ?? [])) {
                  attachedCount[s.id] = (attachedCount[s.id] ?? 0) + 1;
                }
                const last = sBody?.meta?.last_page ?? sPage;
                sHasMore = sPage < last;
                sPage++;
              }
            }
            const cLast = cBody?.meta?.last_page ?? cPage;
            cHasMore = cPage < cLast;
            cPage++;
          }
          // Write counts. Senders not in attachedCount get 0.
          await pool.query(
            `UPDATE sender_accounts
               SET attached_campaigns_count = 0
             WHERE workspace_slug = $1`,
            [slug]
          );
          for (const [senderId, count] of Object.entries(attachedCount)) {
            await pool.query(
              `UPDATE sender_accounts
                 SET attached_campaigns_count = $1
               WHERE workspace_slug = $2 AND eb_sender_id = $3`,
              [count, slug, parseInt(senderId, 10)]
            );
          }
        } catch (attachErr: any) {
          console.error(`[sync-sender-accounts] ${slug} attached-count refresh failed:`, attachErr?.message);
        }

        results.push({ workspace: slug, added, updated, removed, total: ebSenders.length });
        console.log(`[sync-sender-accounts] ${slug}: +${added} added, ~${updated} updated, -${removed} removed, ${Object.keys(attachedCount).length} senders with active-campaign attachments`);

      } catch (wsErr: any) {
        console.error(`[sync-sender-accounts] ${slug} failed:`, wsErr.message);
        results.push({ workspace: slug, added: 0, updated: 0, removed: 0, total: 0, error: wsErr.message });
      }
    }

    const totalRemoved = results.reduce((s, r) => s + r.removed, 0);
    const totalAdded   = results.reduce((s, r) => s + r.added,   0);

    return NextResponse.json({
      ok: true,
      synced: results.filter(r => !r.error).length,
      failed: results.filter(r => r.error).length,
      totalAdded,
      totalRemoved,
      results,
    });

  } catch (err: any) {
    console.error("[sync-sender-accounts] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET — simple status: how many sender_accounts rows per workspace
export async function GET() {
  try {
    const result = await pool.query(`
      SELECT
        workspace_slug,
        COUNT(*)::int          AS total,
        MAX(synced_at)         AS last_synced
      FROM sender_accounts
      GROUP BY workspace_slug
      ORDER BY workspace_slug
    `);
    return NextResponse.json({ workspaces: result.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}