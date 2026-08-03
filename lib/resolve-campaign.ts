// Best-effort resolution of the campaign a lead came from, for the meeting Slack post.
// Chain: replies.campaign (handled by the caller) -> emails_sent.campaign_name -> EmailBison
// (reply -> campaign_id -> campaign name). Every step is try/caught; returns undefined if
// nothing is found. Runs inside the fire-and-forget enrichment, so its latency never blocks
// the webhook response.

import pool from "@/lib/db";

export async function resolveCampaign(workspaceSlug: string, leadEmail: string): Promise<string | undefined> {
  const email = (leadEmail || "").trim();
  if (!email) return undefined;

  // 1. emails_sent.campaign_name (near-100% coverage across workspaces).
  try {
    const es = await pool.query(
      `SELECT campaign_name FROM emails_sent
        WHERE lead_email ILIKE $1 AND COALESCE(TRIM(campaign_name), '') <> ''
        ORDER BY sent_at DESC LIMIT 1`,
      [email],
    );
    const name = es.rows[0]?.campaign_name?.trim();
    if (name) return name;
  } catch { /* fall through */ }

  // 2. EmailBison: find the lead's reply -> campaign_id -> campaign name.
  try {
    const w = await pool.query(
      "SELECT email_bison_api_key AS ak, email_bison_instance_url AS iu FROM workspaces WHERE slug = $1",
      [workspaceSlug],
    );
    const cfg = w.rows[0];
    if (!cfg?.ak || !cfg?.iu) return undefined;
    const headers = { Authorization: `Bearer ${cfg.ak}`, Accept: "application/json" };

    const rr = await fetch(`${cfg.iu}/api/replies?per_page=10&search=${encodeURIComponent(email)}`, { headers });
    if (!rr.ok) return undefined;
    const items = (await rr.json())?.data ?? [];
    const campaignId = items.map((i: any) => i?.campaign_id).find(Boolean);
    if (!campaignId) return undefined;

    const cr = await fetch(`${cfg.iu}/api/campaigns/${campaignId}`, { headers });
    if (!cr.ok) return undefined;
    const cj = await cr.json();
    const name = (cj?.data?.name ?? cj?.name)?.trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}
