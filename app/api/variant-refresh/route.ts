import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export type VariantThreshold = "green" | "yellow" | "red";

export interface VariantStat {
  email_body: string;
  send_count: number;
  threshold: VariantThreshold;
  last_refresh: string | null;
  last_refresh_type: "light" | "moderate" | "emergency" | null;
  pending_refresh_id: string | null;
}

export interface CampaignVariantStats {
  campaign_name: string;
  campaign_id: number | null;
  workspace_slug: string;
  variants: VariantStat[];
}

function threshold(sendCount: number): VariantThreshold {
  if (sendCount >= 2000) return "red";
  if (sendCount >= 500) return "yellow";
  return "green";
}

// GET /api/variant-refresh?workspace=slug
// Returns variant send counts and threshold status for all campaigns in a workspace.
export async function GET(req: NextRequest) {
  try {
    const workspace = new URL(req.url).searchParams.get("workspace");
    if (!workspace) {
      return NextResponse.json({ error: "workspace query param required" }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT
        es.campaign_name,
        cls.campaign_id,
        es.workspace_slug,
        es.email_body,
        COUNT(es.id)::int AS send_count,
        (
          SELECT vrl.generated_at
          FROM variant_refresh_log vrl
          WHERE vrl.workspace_slug = es.workspace_slug
            AND vrl.campaign_name = es.campaign_name
            AND vrl.original_body = es.email_body
            AND vrl.status = 'pushed'
          ORDER BY vrl.generated_at DESC
          LIMIT 1
        ) AS last_refresh,
        (
          SELECT vrl.refresh_type
          FROM variant_refresh_log vrl
          WHERE vrl.workspace_slug = es.workspace_slug
            AND vrl.campaign_name = es.campaign_name
            AND vrl.original_body = es.email_body
            AND vrl.status = 'pushed'
          ORDER BY vrl.generated_at DESC
          LIMIT 1
        ) AS last_refresh_type,
        (
          SELECT vrl.id
          FROM variant_refresh_log vrl
          WHERE vrl.workspace_slug = es.workspace_slug
            AND vrl.campaign_name = es.campaign_name
            AND vrl.original_body = es.email_body
            AND vrl.status = 'pending'
          ORDER BY vrl.generated_at DESC
          LIMIT 1
        ) AS pending_refresh_id
      FROM emails_sent es
      LEFT JOIN campaign_lead_stats cls
        ON cls.workspace_slug = es.workspace_slug
        AND cls.campaign_name = es.campaign_name
      WHERE es.workspace_slug = $1
        AND es.email_body IS NOT NULL
        AND es.email_body != ''
      GROUP BY es.campaign_name, cls.campaign_id, es.workspace_slug, es.email_body
      ORDER BY send_count DESC`,
      [workspace]
    );

    // Group by campaign
    const campaignMap = new Map<string, CampaignVariantStats>();
    for (const row of result.rows) {
      const key = row.campaign_name;
      if (!campaignMap.has(key)) {
        campaignMap.set(key, {
          campaign_name: row.campaign_name,
          campaign_id: row.campaign_id ?? null,
          workspace_slug: row.workspace_slug,
          variants: [],
        });
      }
      campaignMap.get(key)!.variants.push({
        email_body: row.email_body,
        send_count: row.send_count,
        threshold: threshold(row.send_count),
        last_refresh: row.last_refresh ? row.last_refresh.toISOString() : null,
        last_refresh_type: row.last_refresh_type ?? null,
        pending_refresh_id: row.pending_refresh_id ?? null,
      });
    }

    const campaigns = Array.from(campaignMap.values());

    // Summary counts
    const redCount = campaigns.reduce(
      (n, c) => n + c.variants.filter((v) => v.threshold === "red").length,
      0
    );
    const yellowCount = campaigns.reduce(
      (n, c) => n + c.variants.filter((v) => v.threshold === "yellow").length,
      0
    );
    const pendingCount = campaigns.reduce(
      (n, c) => n + c.variants.filter((v) => v.pending_refresh_id !== null).length,
      0
    );

    return NextResponse.json({ campaigns, redCount, yellowCount, pendingCount });
  } catch (err: any) {
    console.error("[variant-refresh] GET error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
