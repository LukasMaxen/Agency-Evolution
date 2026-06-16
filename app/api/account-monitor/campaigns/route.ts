import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/account-monitor/campaigns?sender_email=x&workspace_slug=y
// Returns all campaigns the sender is currently attached to in EmailBison,
// enriched with reply counts from the local DB.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const senderEmail   = searchParams.get("sender_email");
  const workspaceSlug = searchParams.get("workspace_slug");

  if (!senderEmail || !workspaceSlug) {
    return NextResponse.json(
      { error: "sender_email and workspace_slug are required" },
      { status: 400 }
    );
  }

  const wsResult = await pool.query(
    "SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1",
    [workspaceSlug]
  );
  if (wsResult.rows.length === 0) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const { email_bison_api_key: apiKey, email_bison_instance_url: instanceUrl } = wsResult.rows[0];
  if (!apiKey || !instanceUrl) {
    return NextResponse.json({ error: "Workspace missing EmailBison credentials" }, { status: 400 });
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // 1. Find sender ID in EB
  const searchRes = await fetch(
    `${instanceUrl}/api/sender-emails?search=${encodeURIComponent(senderEmail)}`,
    { headers }
  );
  if (!searchRes.ok) {
    return NextResponse.json({ error: `EmailBison lookup failed (${searchRes.status})` }, { status: 502 });
  }
  const searchData = await searchRes.json();
  const sender = (searchData.data ?? []).find(
    (s: any) => s.email?.toLowerCase() === senderEmail.toLowerCase()
  );
  if (!sender) {
    return NextResponse.json({ error: `Sender '${senderEmail}' not found in EmailBison` }, { status: 404 });
  }

  // 2. Fetch campaigns from EB
  const campsRes = await fetch(
    `${instanceUrl}/api/sender-emails/${sender.id}/campaigns`,
    { headers }
  );
  if (!campsRes.ok) {
    return NextResponse.json({ error: `Failed to fetch campaigns (${campsRes.status})` }, { status: 502 });
  }
  const campsData = await campsRes.json();
  const ebCampaigns: { id: number; name: string; status: string }[] =
    (campsData.data ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      status: c.status,
    }));

  // 3. Pull reply counts per campaign for this sender from local DB
  //    Matched by sender_email + campaign name (consistent across webhook inserts).
  const replyCountResult = await pool.query<{ campaign: string; reply_count: number; interested_count: number }>(
    `SELECT
       campaign,
       COUNT(*)::int                                        AS reply_count,
       COUNT(*) FILTER (WHERE interested = TRUE)::int      AS interested_count
     FROM replies
     WHERE workspace_slug = $1
       AND sender_email   = $2
     GROUP BY campaign`,
    [workspaceSlug, senderEmail]
  );

  // Build a lookup map: campaign_name -> { reply_count, interested_count }
  const replyMap: Record<string, { reply_count: number; interested_count: number }> = {};
  for (const row of replyCountResult.rows) {
    replyMap[row.campaign] = {
      reply_count:      row.reply_count,
      interested_count: row.interested_count,
    };
  }

  // 4. Merge EB campaigns with DB reply counts
  const campaigns = ebCampaigns.map(c => ({
    id:               c.id,
    name:             c.name,
    status:           c.status,
    reply_count:      replyMap[c.name]?.reply_count      ?? 0,
    interested_count: replyMap[c.name]?.interested_count ?? 0,
  }));

  return NextResponse.json({ sender_id: sender.id, campaigns });
}