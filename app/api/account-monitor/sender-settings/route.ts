import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// PATCH /api/account-monitor/sender-settings
// Body: {
//   sender_email:       string,
//   workspace_slug:     string,
//   daily_limit?:       number,   -- outbound sends/day (min 1)
//   warmup_daily_limit?: number,  -- warmup emails/day (0–50; EB caps at 50)
//   warmup_enabled?:    boolean,  -- enable or disable EB warmup
// }
//
// Applies changes directly to EmailBison and writes them back to the DB.
// Any subset of the three fields may be included in a single request.

const EB_WARMUP_MAX = 50;

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { sender_email, workspace_slug, daily_limit, warmup_daily_limit, warmup_enabled } = body as {
      sender_email:        string;
      workspace_slug:      string;
      daily_limit?:        number;
      warmup_daily_limit?: number;
      warmup_enabled?:     boolean;
    };

    if (!sender_email || !workspace_slug) {
      return NextResponse.json({ error: "sender_email and workspace_slug are required" }, { status: 400 });
    }
    if (daily_limit === undefined && warmup_daily_limit === undefined && warmup_enabled === undefined) {
      return NextResponse.json({ error: "At least one of daily_limit, warmup_daily_limit, warmup_enabled is required" }, { status: 400 });
    }
    if (daily_limit !== undefined && (daily_limit < 1 || !Number.isInteger(daily_limit))) {
      return NextResponse.json({ error: "daily_limit must be an integer >= 1" }, { status: 400 });
    }
    if (warmup_daily_limit !== undefined && (warmup_daily_limit < 0 || warmup_daily_limit > EB_WARMUP_MAX || !Number.isInteger(warmup_daily_limit))) {
      return NextResponse.json({ error: `warmup_daily_limit must be an integer between 0 and ${EB_WARMUP_MAX}` }, { status: 400 });
    }

    const wsRes = await pool.query(
      "SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1",
      [workspace_slug]
    );
    if (wsRes.rows.length === 0) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const { email_bison_api_key: apiKey, email_bison_instance_url: instanceUrl } = wsRes.rows[0];
    if (!apiKey || !instanceUrl) {
      return NextResponse.json({ error: "Workspace missing EmailBison credentials" }, { status: 400 });
    }

    const dbSender = await pool.query(
      `SELECT eb_sender_id FROM sender_accounts
       WHERE workspace_slug = $1 AND email = $2 LIMIT 1`,
      [workspace_slug, sender_email.toLowerCase()]
    );
    if (!dbSender.rows[0]?.eb_sender_id) {
      return NextResponse.json({ error: `Sender '${sender_email}' not found in sender_accounts` }, { status: 404 });
    }
    const senderId: number = dbSender.rows[0].eb_sender_id;

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const results: Record<string, string> = {};

    // ── daily_limit ───────────────────────────────────────────────────────
    if (daily_limit !== undefined) {
      const r = await fetch(`${instanceUrl}/api/sender-emails/${senderId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ daily_limit }),
      });
      results.daily_limit = r.ok ? "ok" : `failed (${r.status})`;
      if (r.ok) {
        await pool.query(
          `UPDATE sender_accounts SET daily_limit = $1 WHERE workspace_slug = $2 AND email = $3`,
          [daily_limit, workspace_slug, sender_email.toLowerCase()]
        );
      } else {
        const errText = await r.text().catch(() => "");
        results.daily_limit_error = errText;
      }
    }

    // ── warmup_daily_limit ────────────────────────────────────────────────
    if (warmup_daily_limit !== undefined) {
      const r = await fetch(`${instanceUrl}/api/warmup/sender-emails/update-daily-warmup-limits`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sender_email_ids: [senderId], daily_limit: warmup_daily_limit }),
      });
      results.warmup_daily_limit = r.ok ? "ok" : `failed (${r.status})`;
      if (r.ok) {
        await pool.query(
          `UPDATE sender_accounts SET warmup_daily_limit = $1 WHERE workspace_slug = $2 AND email = $3`,
          [warmup_daily_limit, workspace_slug, sender_email.toLowerCase()]
        );
      } else {
        const errText = await r.text().catch(() => "");
        results.warmup_daily_limit_error = errText;
      }
    }

    // ── warmup_enabled ────────────────────────────────────────────────────
    if (warmup_enabled !== undefined) {
      const endpoint = warmup_enabled ? "enable" : "disable";
      const r = await fetch(`${instanceUrl}/api/warmup/sender-emails/${endpoint}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sender_email_ids: [senderId] }),
      });
      results.warmup_enabled = r.ok ? "ok" : `failed (${r.status})`;
      if (r.ok) {
        await pool.query(
          `UPDATE sender_accounts SET warmup_enabled = $1 WHERE workspace_slug = $2 AND email = $3`,
          [warmup_enabled, workspace_slug, sender_email.toLowerCase()]
        );
      } else {
        const errText = await r.text().catch(() => "");
        results.warmup_enabled_error = errText;
      }
    }

    const allOk = Object.keys(results)
      .filter(k => !k.endsWith("_error"))
      .every(k => results[k] === "ok");

    return NextResponse.json({ ok: allOk, sender_email, sender_id: senderId, results });
  } catch (err: any) {
    console.error("[sender-settings] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
