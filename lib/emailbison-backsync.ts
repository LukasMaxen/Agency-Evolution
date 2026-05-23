import pool from "@/lib/db";

/**
 * Marks a reply as "interested" inside EmailBison so the workspace stats
 * (/api/workspaces/v1.1/stats — what the CSM update reads from) reflect
 * the interested count we see in our own DB.
 *
 * Operates on the EmailBison reply ID, not the lead. EmailBison creates a
 * reply record for any inbound to a tracked sender even if the from-address
 * was never a campaign lead, so this works for off-campaign inbounds too.
 *
 * Idempotent: skips if interested is already TRUE in our DB, or if the row
 * is missing EmailBison metadata.
 */
export async function backsyncInterestedToEmailBison(
  replyId: string
): Promise<{ ok?: true; skipped?: string }> {
  const meta = await pool.query(
    `SELECT r.email_bison_reply_id, r.interested, w.email_bison_api_key, w.email_bison_instance_url
     FROM replies r
     LEFT JOIN workspaces w ON w.slug = r.workspace_slug
     WHERE r.id = $1`,
    [replyId]
  );
  const row = meta.rows[0];
  if (!row) return { skipped: "reply_not_found" };
  if (row.interested === true) return { skipped: "already_interested" };
  if (!row.email_bison_reply_id) return { skipped: "no_email_bison_reply_id" };
  if (!row.email_bison_api_key || !row.email_bison_instance_url) return { skipped: "no_workspace_creds" };

  const url = `${row.email_bison_instance_url}/api/replies/${row.email_bison_reply_id}/mark-as-interested`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${row.email_bison_api_key}`,
    },
    body: JSON.stringify({ skip_webhooks: false }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EmailBison mark-as-interested failed (${res.status}): ${body}`);
  }

  await pool.query("UPDATE replies SET interested = TRUE WHERE id = $1", [replyId]);
  return { ok: true };
}
