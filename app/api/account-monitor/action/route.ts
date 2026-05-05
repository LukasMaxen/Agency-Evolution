import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// POST /api/account-monitor/action
// Body: {
//   sender_email: string,
//   workspace_slug: string,
//   action: "remove" | "reattach" | "remove_and_warmup",
//   campaign_id?: number,   // if provided, only act on this one campaign
//   sender_id?: number,     // if provided, skip the EB lookup (caller already resolved it)
// }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sender_email, workspace_slug, action, campaign_id, sender_id: providedSenderId } = body;

    if (!sender_email || !workspace_slug || !action) {
      return NextResponse.json(
        { error: "sender_email, workspace_slug, and action are required" },
        { status: 400 }
      );
    }

    if (!["remove", "reattach", "remove_and_warmup"].includes(action)) {
      return NextResponse.json(
        { error: "action must be one of: remove, reattach, remove_and_warmup" },
        { status: 400 }
      );
    }

    // 1. Get workspace EB credentials
    const wsResult = await pool.query(
      "SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1",
      [workspace_slug]
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

    // 2. Resolve sender ID (use provided one to skip lookup if already known)
    let senderId: number = providedSenderId;
    let warmupAlreadyEnabled = false;

    if (!senderId) {
      const searchRes = await fetch(
        `${instanceUrl}/api/sender-emails?search=${encodeURIComponent(sender_email)}`,
        { headers }
      );
      if (!searchRes.ok) {
        const err = await searchRes.text();
        return NextResponse.json(
          { error: `EmailBison sender lookup failed (${searchRes.status}): ${err}` },
          { status: 502 }
        );
      }
      const searchData = await searchRes.json();
      const sender = (searchData.data ?? []).find(
        (s: any) => s.email?.toLowerCase() === sender_email.toLowerCase()
      );
      if (!sender) {
        return NextResponse.json(
          { error: `Sender '${sender_email}' not found in EmailBison` },
          { status: 404 }
        );
      }
      senderId = sender.id;
      warmupAlreadyEnabled = sender.warmup_enabled ?? false;
    }

    // 3. Build the list of campaigns to act on
    let campaigns: { id: number; name: string }[] = [];

    if (campaign_id) {
      // Single campaign — caller provided it, no need to fetch all
      campaigns = [{ id: campaign_id, name: "" }];
    } else {
      // All campaigns this sender is attached to
      const campsRes = await fetch(
        `${instanceUrl}/api/sender-emails/${senderId}/campaigns`,
        { headers }
      );
      if (!campsRes.ok) {
        const err = await campsRes.text();
        return NextResponse.json(
          { error: `Failed to fetch sender campaigns (${campsRes.status}): ${err}` },
          { status: 502 }
        );
      }
      const campsData = await campsRes.json();
      campaigns = (campsData.data ?? []).map((c: any) => ({ id: c.id, name: c.name }));
    }

    const results: { campaign_id: number; campaign_name: string; status: string; error?: string }[] = [];

    // 4. Remove or re-attach
    for (const camp of campaigns) {
      if (action === "remove" || action === "remove_and_warmup") {
        const removeRes = await fetch(
          `${instanceUrl}/api/campaigns/${camp.id}/remove-sender-emails`,
          {
            method: "DELETE",
            headers,
            body: JSON.stringify({ sender_email_ids: [senderId] }),
          }
        );
        if (removeRes.ok) {
          results.push({ campaign_id: camp.id, campaign_name: camp.name, status: "removed" });
        } else {
          const err = await removeRes.text();
          results.push({ campaign_id: camp.id, campaign_name: camp.name, status: "error", error: err });
        }
      } else if (action === "reattach") {
        const attachRes = await fetch(
          `${instanceUrl}/api/campaigns/${camp.id}/attach-sender-emails`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ sender_email_ids: [senderId] }),
          }
        );
        if (attachRes.ok) {
          results.push({ campaign_id: camp.id, campaign_name: camp.name, status: "reattached" });
        } else {
          const err = await attachRes.text();
          results.push({ campaign_id: camp.id, campaign_name: camp.name, status: "error", error: err });
        }
      }
    }

    // 5. Enable warmup if requested
    let warmupResult: string | null = null;
    if (action === "remove_and_warmup" && !warmupAlreadyEnabled) {
      const warmupRes = await fetch(`${instanceUrl}/api/warmup/sender-emails/enable`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sender_email_ids: [senderId] }),
      });
      warmupResult = warmupRes.ok ? "enabled" : `failed (${warmupRes.status})`;
    } else if (action === "remove_and_warmup" && warmupAlreadyEnabled) {
      warmupResult = "already_enabled";
    }

    const succeeded = results.filter(r => r.status !== "error").length;
    const failed    = results.filter(r => r.status === "error").length;

    return NextResponse.json({
      ok: true,
      sender_email,
      sender_id: senderId,
      action,
      campaigns_affected: campaigns.length,
      succeeded,
      failed,
      results,
      warmup: warmupResult,
    });

  } catch (err: any) {
    console.error("[account-monitor/action] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}