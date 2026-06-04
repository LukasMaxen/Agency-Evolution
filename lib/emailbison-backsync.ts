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

  // Check EmailBison's own state before marking. If EB already has this reply
  // as interested (e.g. it auto-detected interest and fired CONTACT_INTERESTED
  // before our LEAD_REPLIED insert landed), calling mark-as-interested again
  // would create a 2nd interested event in EB and corrupt its stats.
  const checkRes = await fetch(
    `${row.email_bison_instance_url}/api/replies/${row.email_bison_reply_id}`,
    { headers: { Authorization: `Bearer ${row.email_bison_api_key}` } }
  );
  if (checkRes.ok) {
    const checkData = await checkRes.json().catch(() => null);
    if (checkData?.data?.interested === true) {
      await pool.query("UPDATE replies SET interested = TRUE WHERE id = $1", [replyId]);
      return { skipped: "already_interested_in_eb" };
    }
  }

  const url = `${row.email_bison_instance_url}/api/replies/${row.email_bison_reply_id}/mark-as-interested`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${row.email_bison_api_key}`,
    },
    body: JSON.stringify({ skip_webhooks: false }),
  });

  // EmailBison returns HTTP 200 for both success and application-level failures.
  //
  // Success shape: the updated reply object, e.g.
  //   { data: { id, uuid, subject, interested: true, ... } }
  //   (no `success` field)
  //
  // Failure shape (lead-less reply, etc.):
  //   { data: { success: "false", message: "Replies without an attached contact ..." } }
  //
  // Only treat as refusal when we explicitly see success=false in the body.
  // Anything else with HTTP 200 is success — the response may not include `success` at all.
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* keep null */ }

  if (!res.ok) {
    throw new Error(`EmailBison mark-as-interested HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const explicitlyRefused = parsed?.data?.success === false || parsed?.data?.success === "false";
  if (explicitlyRefused) {
    const msg = parsed?.data?.message ?? text.slice(0, 200);
    // Lead-less replies are common for test/off-campaign inbounds — not a hard
    // error worth alerting on. Surface the reason in the skipped channel so
    // callers (and logs) can see exactly why.
    return { skipped: `emailbison_refused: ${msg}` };
  }

  await pool.query("UPDATE replies SET interested = TRUE WHERE id = $1", [replyId]);
  return { ok: true };
}
