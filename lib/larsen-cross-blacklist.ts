// Cross-workspace blacklist between the two Larsen workspaces (Larsen Digital - Nicklas,
// slug "larsen-digital", and Larsen Digital - Lukas, slug "acceler8rs"). Both send to the
// same buyer/seller universe, so a lead who books a call in ONE must never keep getting
// cold outreach from the OTHER. Runs the instant a call becomes 'scheduled' (24/7,
// in-process — same lifetime as the app itself, no separate cron needed), from BOTH the
// Calendly webhook and manual call booking (app/api/calls/route.ts POST).
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

const LARSEN_WORKSPACES = Object.keys(OPPOSITE_WORKSPACE);

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

async function blacklistInWorkspace(workspaceSlug: string, email: string): Promise<boolean> {
  try {
    const creds = await pool.query(
      "SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1",
      [workspaceSlug]
    );
    const row = creds.rows[0];
    if (!row?.email_bison_api_key || !row?.email_bison_instance_url) {
      console.warn(`[cross-blacklist] no EmailBison creds for ${workspaceSlug} — skipping`);
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

    if (!res.ok) {
      if (res.status === 422 && /already/i.test(text)) {
        console.log(`[cross-blacklist] ${email} already blacklisted in ${workspaceSlug}`);
        return true;
      }
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    console.log(`[cross-blacklist] blacklisted ${email} in ${workspaceSlug}`);
    return true;
  } catch (err: any) {
    console.error(`[cross-blacklist] failed to blacklist ${email} in ${workspaceSlug}:`, err?.message ?? err);
    return false;
  }
}

/**
 * Full domain-level lockout, run the instant a Larsen call hits status='scheduled'
 * (Calendly webhook or manual booking — both call this). A lead can exist as MULTIPLE,
 * unlinked EmailBison contacts (old company domain vs new, different person at the same
 * company) so blacklisting only the exact booking email leaves those other identities
 * free to keep getting sequenced. Andrew Brown / myGemma (2026-09-10) is exactly this:
 * booked as andrew@mygemma.com, but andrew@wpdiamonds.com (the pre-rebrand domain) kept
 * receiving "DTC Brands | Followups" for another month because nothing linked the two.
 *
 * Finds every other lead_email sharing the booking email's domain across replies,
 * emails_sent, and calls (our own record of who's ever been contacted or replied) in
 * EITHER Larsen workspace, then blacklists the booking email AND every domain-mate in
 * BOTH larsen-digital and acceler8rs. No-op for any other workspace. Best-effort: never
 * throws, logs and continues past individual failures.
 */
export async function blacklistLarsenDomain(workspaceSlug: string, leadEmail: string): Promise<void> {
  if (!LARSEN_WORKSPACES.includes(workspaceSlug)) return;
  const email = (leadEmail || "").trim().toLowerCase();
  const domain = email.split("@")[1];
  if (!email || !domain) return;

  try {
    const domainMates = await pool.query(
      `SELECT DISTINCT lead_email FROM (
         SELECT lead_email FROM replies WHERE workspace_slug = ANY($1) AND lower(lead_email) LIKE '%@' || $2
         UNION
         SELECT lead_email FROM emails_sent WHERE workspace_slug = ANY($1) AND lower(lead_email) LIKE '%@' || $2
         UNION
         SELECT lead_email FROM calls WHERE workspace_slug = ANY($1) AND lower(lead_email) LIKE '%@' || $2
       ) x`,
      [LARSEN_WORKSPACES, domain]
    );

    const emails = new Set<string>([email, ...domainMates.rows.map(r => (r.lead_email || "").trim().toLowerCase()).filter(Boolean)]);

    for (const e of emails) {
      for (const ws of LARSEN_WORKSPACES) {
        await blacklistInWorkspace(ws, e);
      }
    }
  } catch (err: any) {
    console.error(`[cross-blacklist] domain sweep failed for ${domain}:`, err?.message ?? err);
  }
}
