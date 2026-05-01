import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export type CampaignStatus =
  | "ramping"
  | "healthy"
  | "below_reply_rate"
  | "below_interested_rate"
  | "failed_both"
  | "approaching_70"
  | "launch_new";

export interface CampaignLifecycleRow {
  campaign_name: string;
  campaign_id: number | null;
  workspace_slug: string;
  workspace_name: string;
  emails_sent: number;
  reply_count: number;
  reply_rate: number;
  interested_count: number;
  interested_rate: number;
  total_leads: number;
  contacted: number;
  pct_contacted: number;
  synced_at: string | null;
  status: CampaignStatus;
}

function computeStatus(row: {
  emails_sent: number;
  reply_rate: number;
  interested_rate: number;
  pct_contacted: number;
}): CampaignStatus {
  if (row.emails_sent < 1000) return "ramping";
  const replyOk = row.reply_rate >= 1;
  const interestedOk = row.interested_rate >= 20;
  if (row.pct_contacted >= 70) return "launch_new";
  if (!replyOk && !interestedOk) return "failed_both";
  if (!replyOk) return "below_reply_rate";
  if (!interestedOk) return "below_interested_rate";
  if (row.pct_contacted >= 60) return "approaching_70";
  return "healthy";
}

// GET /api/campaign-lifecycle?workspace=slug   (or workspace=all for every workspace)
export async function GET(req: NextRequest) {
  try {
    const workspaceParam = new URL(req.url).searchParams.get("workspace");
    if (!workspaceParam) {
      return NextResponse.json({ error: "workspace query param required (or 'all')" }, { status: 400 });
    }

    const whereClause = workspaceParam === "all" ? "" : "WHERE es.workspace_slug = $1";
    const params = workspaceParam === "all" ? [] : [workspaceParam];

    const result = await pool.query(
      `WITH email_counts AS (
        SELECT
          workspace_slug,
          campaign_name,
          COUNT(id)::int AS emails_sent
        FROM emails_sent
        GROUP BY workspace_slug, campaign_name
      ),
      reply_counts AS (
        SELECT
          workspace_slug,
          campaign AS campaign_name,
          COUNT(id)::int AS reply_count,
          COUNT(*) FILTER (WHERE interested = TRUE)::int AS interested_count
        FROM replies
        GROUP BY workspace_slug, campaign
      )
      SELECT
        ec.workspace_slug,
        w.name AS workspace_name,
        ec.campaign_name,
        cls.campaign_id,
        ec.emails_sent,
        COALESCE(rc.reply_count, 0) AS reply_count,
        COALESCE(rc.interested_count, 0) AS interested_count,
        ROUND(
          COALESCE(rc.reply_count, 0)::numeric / NULLIF(ec.emails_sent, 0) * 100,
          2
        ) AS reply_rate,
        ROUND(
          COALESCE(rc.interested_count, 0)::numeric / NULLIF(rc.reply_count, 0) * 100,
          2
        ) AS interested_rate,
        COALESCE(cls.total_leads, 0) AS total_leads,
        GREATEST(
          COALESCE(cls.total_leads, 0) - COALESCE(cls.step_0, 0),
          0
        ) AS contacted,
        ROUND(
          GREATEST(COALESCE(cls.total_leads, 0) - COALESCE(cls.step_0, 0), 0)::numeric
          / NULLIF(cls.total_leads, 0) * 100,
          1
        ) AS pct_contacted,
        cls.synced_at
      FROM email_counts ec
      LEFT JOIN workspaces w ON w.slug = ec.workspace_slug
      LEFT JOIN reply_counts rc
        ON rc.workspace_slug = ec.workspace_slug
        AND rc.campaign_name = ec.campaign_name
      LEFT JOIN campaign_lead_stats cls
        ON cls.workspace_slug = ec.workspace_slug
        AND cls.campaign_name = ec.campaign_name
      ${whereClause}
      ORDER BY ec.workspace_slug ASC, ec.emails_sent DESC`,
      params
    );

    const rows: CampaignLifecycleRow[] = result.rows.map((row) => {
      const emailsSent = row.emails_sent ?? 0;
      const replyRate = parseFloat(row.reply_rate ?? 0);
      const interestedRate = parseFloat(row.interested_rate ?? 0);
      const pctContacted = parseFloat(row.pct_contacted ?? 0);

      return {
        campaign_name: row.campaign_name,
        campaign_id: row.campaign_id ?? null,
        workspace_slug: row.workspace_slug,
        workspace_name: row.workspace_name ?? row.workspace_slug,
        emails_sent: emailsSent,
        reply_count: row.reply_count ?? 0,
        reply_rate: replyRate,
        interested_count: row.interested_count ?? 0,
        interested_rate: interestedRate,
        total_leads: row.total_leads ?? 0,
        contacted: row.contacted ?? 0,
        pct_contacted: pctContacted,
        synced_at: row.synced_at ? row.synced_at.toISOString() : null,
        status: computeStatus({ emails_sent: emailsSent, reply_rate: replyRate, interested_rate: interestedRate, pct_contacted: pctContacted }),
      };
    });

    // Group by workspace
    const workspaceMap = new Map<string, { workspace_slug: string; workspace_name: string; campaigns: CampaignLifecycleRow[] }>();
    for (const row of rows) {
      if (!workspaceMap.has(row.workspace_slug)) {
        workspaceMap.set(row.workspace_slug, {
          workspace_slug: row.workspace_slug,
          workspace_name: row.workspace_name,
          campaigns: [],
        });
      }
      workspaceMap.get(row.workspace_slug)!.campaigns.push(row);
    }

    // Summary counts
    const allCampaigns = rows;
    const summary = {
      healthy: allCampaigns.filter((c) => c.status === "healthy").length,
      ramping: allCampaigns.filter((c) => c.status === "ramping").length,
      belowKpi: allCampaigns.filter((c) =>
        ["below_reply_rate", "below_interested_rate", "failed_both"].includes(c.status)
      ).length,
      launchNew: allCampaigns.filter((c) => c.status === "launch_new").length,
      approaching: allCampaigns.filter((c) => c.status === "approaching_70").length,
    };

    return NextResponse.json({
      workspaces: Array.from(workspaceMap.values()),
      summary,
    });
  } catch (err: any) {
    console.error("[campaign-lifecycle] GET error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
