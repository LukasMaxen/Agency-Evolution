import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT
        cls.workspace_slug,
        w.name as workspace_name,
        cls.campaign_id,
        cls.campaign_name,
        cls.step_0,
        cls.step_1,
        cls.step_2,
        cls.step_3,
        cls.step_4,
        cls.completed,
        cls.bounced,
        cls.total_leads,
        cls.synced_at
       FROM campaign_lead_stats cls
       JOIN workspaces w ON w.slug = cls.workspace_slug
       ORDER BY w.name ASC, cls.campaign_name ASC`
    );

    // Group by workspace
    const grouped: Record<string, any> = {};
    for (const row of result.rows) {
      if (!grouped[row.workspace_slug]) {
        grouped[row.workspace_slug] = {
          workspace: row.workspace_name,
          slug: row.workspace_slug,
          campaigns: [],
        };
      }
      grouped[row.workspace_slug].campaigns.push({
        id:           row.campaign_id,
        name:         row.campaign_name,
        step0:        row.step_0,
        step1:        row.step_1,
        step2:        row.step_2,
        step3:        row.step_3,
        step4:        row.step_4,
        completed:    row.completed,
        bounced:      row.bounced,
        totalLeads:   row.total_leads,
        syncedAt:     row.synced_at,
      });
    }

    return NextResponse.json({ workspaces: Object.values(grouped) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}