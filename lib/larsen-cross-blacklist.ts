// Cross-workspace blacklist between the two Larsen workspaces (Larsen Digital - Nicklas,
// slug "larsen-digital", and Larsen Digital - Lukas, slug "acceler8rs"). Both send to the
// same buyer/seller universe, so a lead who books a call in ONE must never keep getting
// cold outreach from the OTHER. Runs from the Calendly webhook the instant a meeting is
// confirmed (24/7, in-process — same lifetime as the app itself, no separate cron needed).
//
// EmailBison blacklist API (confirmed live against send.emailagencyevolution.com,
// 2026-08-04): POST /api/blacklisted-emails { email }, Bearer = the WORKSPACE's own
// email_bison_api_key (blacklist is scoped per-workspace by the key, same as every other
// EmailBison call in this codebase). See lib/emailbison-backsync.ts for the identical
// auth pattern.

import pool from "@/lib/db";

export const OPPOSITE_WORKSPACE: Record<string, string> = {
  "larsen-digital": "acceler8rs",
  "acceler8rs": "larsen-digital",
};

/**
 * If workspaceSlug is one of the two Larsen workspaces, blacklists leadEmail in the OTHER
 * one via the EmailBison API. No-op for any other workspace. Best-effort: never throws,
 * logs and returns false on failure so a booking is never blocked by this.
 */
export async function crossBlacklistLarsen(workspaceSlug: string, leadEmail: string): Promise<boolean> {
  const targetSlug = OPPOSITE_WORKSPACE[workspaceSlug];
  const email = (leadEmail || "").trim();
  if (!targetSlug || !email) return false;

  try {
    const creds = await pool.query(
      "SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1",
      [targetSlug]
    );
    const row = creds.rows[0];
    if (!row?.email_bison_api_key || !row?.email_bison_instance_url) {
      console.warn(`[cross-blacklist] no EmailBison creds for ${targetSlug} — skipping`);
      return false;
    }

    const res = await fetch(`${row.email_bison_instance_url}/api/blacklisted-emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${row.email_bison_api_key}`,
      },
      body: JSON.stringify({ email }),
    });
    const text = await res.text();

    // EmailBison returns a validation error if the email is already blacklisted — that's
    // a success state for us (idempotent), not a failure worth alerting on.
    if (!res.ok) {
      if (res.status === 422 && /already/i.test(text)) {
        console.log(`[cross-blacklist] ${email} already blacklisted in ${targetSlug}`);
        return true;
      }
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    console.log(`[cross-blacklist] blacklisted ${email} in ${targetSlug} (booked in ${workspaceSlug})`);
    return true;
  } catch (err: any) {
    console.error(`[cross-blacklist] failed to blacklist ${email} in ${targetSlug}:`, err?.message ?? err);
    return false;
  }
}
