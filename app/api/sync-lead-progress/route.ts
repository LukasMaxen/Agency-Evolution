import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

async function countLeads(
  base: string,
  key: string,
  campaignId: number,
  filterParam: Record<string, string>
): Promise<number> {
  const params = new URLSearchParams(filterParam);
  const res = await fetch(
    `${base}/api/campaigns/${campaignId}/leads?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }
  );
  if (!res.ok) return 0;
  const data = await res.json();
  // EmailBison returns meta.total for paginated counts
  return data.meta?.total ?? data.data?.length ?? 0;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetSlug = searchParams.get("workspace"); // optional — sync one workspace only

  try {
    const wsResult = await pool.query(
      `SELECT id, slug, name, email_bison_api_key, email_bison_instance_url
       FROM workspaces
       WHERE email_bison_api_key IS NOT NULL
       ${targetSlug ? "AND slug = $1" : ""}
       ORDER BY name ASC`,
      targetSlug ? [targetSlug] : []
    );

    const results = [];

    for (const ws of wsResult.rows) {
      const base = ws.email_bison_instance_url;
      const key  = ws.email_bison_api_key;

      try {
        // Fetch all campaigns for this workspace
        const campRes = await fetch(`${base}/api/campaigns`, {
          headers: {
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        });

        if (!campRes.ok) {
          results.push({ workspace: ws.name, slug: ws.slug, error: `EmailBison ${campRes.status}` });
          continue;
        }

        const campData  = await campRes.json();
        const all: any[] = campData.data ?? (Array.isArray(campData) ? campData : []);
        const active    = all.filter(c => ["Active", "active", 1, 2].includes(c.status));
        const list      = active.length ? active : all;

        for (const c of list) {
          try {
            // Count leads at each step using filters — no pagination needed
            const [step0, step1, step2, step3, step4, completed, bounced] = await Promise.all([
              countLeads(base, key, c.id, {
                "filters[lead_campaign_status]": "never_contacted",
              }),
              countLeads(base, key, c.id, {
                "filters[emails_sent][criteria]": "=",
                "filters[emails_sent][value]":    "1",
                "filters[lead_campaign_status]":  "in_sequence",
              }),
              countLeads(base, key, c.id, {
                "filters[emails_sent][criteria]": "=",
                "filters[emails_sent][value]":    "2",
                "filters[lead_campaign_status]":  "in_sequence",
              }),
              countLeads(base, key, c.id, {
                "filters[emails_sent][criteria]": "=",
                "filters[emails_sent][value]":    "3",
                "filters[lead_campaign_status]":  "in_sequence",
              }),
              countLeads(base, key, c.id, {
                "filters[emails_sent][criteria]": ">=",
                "filters[emails_sent][value]":    "4",
                "filters[lead_campaign_status]":  "in_sequence",
              }),
              countLeads(base, key, c.id, {
                "filters[lead_campaign_status]": "sequence_finished",
              }),
              countLeads(base, key, c.id, {
                "filters[verification_statuses]": "bounced",
              }),
            ]);

            const totalLeads = c.total_leads ?? 0;

            // Upsert into DB
            await pool.query(
              `INSERT INTO campaign_lead_stats
                (workspace_slug, campaign_id, campaign_name, step_0, step_1, step_2, step_3, step_4, completed, bounced, total_leads, synced_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
               ON CONFLICT (workspace_slug, campaign_id)
               DO UPDATE SET
                 campaign_name = EXCLUDED.campaign_name,
                 step_0        = EXCLUDED.step_0,
                 step_1        = EXCLUDED.step_1,
                 step_2        = EXCLUDED.step_2,
                 step_3        = EXCLUDED.step_3,
                 step_4        = EXCLUDED.step_4,
                 completed     = EXCLUDED.completed,
                 bounced       = EXCLUDED.bounced,
                 total_leads   = EXCLUDED.total_leads,
                 synced_at     = NOW()`,
              [ws.slug, c.id, c.name, step0, step1, step2, step3, step4, completed, bounced, totalLeads]
            );

            results.push({ workspace: ws.name, campaign: c.name, step0, step1, step2, step3, step4, completed, bounced });
          } catch (err: any) {
            results.push({ workspace: ws.name, campaign: c.name, error: err.message });
          }
        }
      } catch (err: any) {
        results.push({ workspace: ws.name, slug: ws.slug, error: err.message });
      }
    }

    return NextResponse.json({ synced: results, syncedAt: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}