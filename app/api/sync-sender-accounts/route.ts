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
        const ebSenders: { id: number; email: string; warmup_enabled: boolean; status: string; provider_type: string | null }[] = [];
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
  ebSenders.push(
    ...rows.map((s: any) => ({
      id:             s.id,
      email:          s.email?.toLowerCase().trim(),
      warmup_enabled: s.warmup_enabled ?? false,
      status:         s.status ?? "active",
      provider_type:  s.type ?? null,
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
            `INSERT INTO sender_accounts (workspace_slug, email, eb_sender_id, warmup_enabled, status, provider_type, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (workspace_slug, email)
             DO UPDATE SET
               eb_sender_id   = EXCLUDED.eb_sender_id,
               warmup_enabled = EXCLUDED.warmup_enabled,
               status         = EXCLUDED.status,
               provider_type  = EXCLUDED.provider_type,
               synced_at      = NOW()
             RETURNING (xmax = 0) AS inserted`,
            [slug, sender.email, sender.id, sender.warmup_enabled, sender.status, sender.provider_type]
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

        results.push({ workspace: slug, added, updated, removed, total: ebSenders.length });
        console.log(`[sync-sender-accounts] ${slug}: +${added} added, ~${updated} updated, -${removed} removed`);

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