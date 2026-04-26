import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sendDays = parseInt(searchParams.get("sendDays") ?? "5");

  try {
    const wsResult = await pool.query(
      "SELECT id, slug, name, email_bison_api_key, email_bison_instance_url FROM workspaces WHERE email_bison_api_key IS NOT NULL ORDER BY name ASC"
    );

    const results = await Promise.all(
      wsResult.rows.map(async (ws) => {
        try {
          const res = await fetch(`${ws.email_bison_instance_url}/api/campaigns`, {
            headers: {
              Authorization: `Bearer ${ws.email_bison_api_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          });

          if (!res.ok) {
            return { workspace: ws.name, slug: ws.slug, error: `EmailBison ${res.status}`, campaigns: [] };
          }

          const data = await res.json();
          const all: any[] = data.data ?? (Array.isArray(data) ? data : []);
          const active = all.filter(c => ["Active", "active", 1, 2].includes(c.status));
          const list = active.length ? active : all;

          const campaigns = list.map((c: any) => {
            const newLeadsPerDay = c.max_new_leads_per_day ?? 0;
            const totalLeads     = c.total_leads ?? 0;
            const contacted      = c.total_leads_contacted ?? 0;
            const remaining      = Math.max(0, totalLeads - contacted);
            const weeklyCapacity = newLeadsPerDay * sendDays;
            const shortfall      = Math.max(0, weeklyCapacity - remaining);
            const coveragePct    = weeklyCapacity > 0
              ? Math.min(100, Math.round((remaining / weeklyCapacity) * 100))
              : 0;
            const coverageDays   = newLeadsPerDay > 0
              ? Math.round((remaining / newLeadsPerDay) * 10) / 10
              : 0;

            let health: "healthy" | "low" | "critical" | "empty";
            if (remaining === 0)       health = "empty";
            else if (coveragePct < 50) health = "critical";
            else if (shortfall > 0)    health = "low";
            else                       health = "healthy";

            return {
              id: c.id,
              name: c.name,
              newLeadsPerDay,
              weeklyCapacity,
              totalLeads,
              contacted,
              remaining,
              shortfall,
              coveragePct,
              coverageDays,
              health,
            };
          });

          return { workspace: ws.name, slug: ws.slug, error: null, campaigns };
        } catch (err: any) {
          return { workspace: ws.name, slug: ws.slug, error: err.message, campaigns: [] };
        }
      })
    );

    return NextResponse.json({ workspaces: results, sendDays });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}