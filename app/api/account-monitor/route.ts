import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get("days") ?? "7");
  const workspace = searchParams.get("workspace") ?? "all";

  const MIN_SENDS = 20;

  try {
    const wsFilter   = workspace !== "all" ? "AND workspace_slug = $2" : "";
    const wsFilterEs = workspace !== "all" ? "AND es.workspace_slug = $2" : "";
    const params: (number | string)[] = [days];
    if (workspace !== "all") params.push(workspace);

    const sql = `
      WITH sent_counts AS (
        SELECT
          sender_email,
          workspace_slug,
          COUNT(id)::int AS emails_sent
        FROM emails_sent
        WHERE sent_at >= NOW() - ($1 || ' days')::interval
          AND sender_email IS NOT NULL
          AND sender_email != ''
          ${wsFilter}
        GROUP BY sender_email, workspace_slug
      ),
      bounce_counts AS (
        SELECT
          es.sender_email,
          es.workspace_slug,
          COUNT(eb.id)::int AS bounces
        FROM emails_sent es
        JOIN email_bounces eb
          ON  eb.workspace_slug = es.workspace_slug
          AND eb.lead_email     = es.lead_email
          AND eb.bounced_at    >= NOW() - ($1 || ' days')::interval
        WHERE es.sent_at >= NOW() - ($1 || ' days')::interval
          AND es.sender_email IS NOT NULL
          AND es.sender_email != ''
          ${wsFilterEs}
        GROUP BY es.sender_email, es.workspace_slug
      ),
      reply_counts AS (
        SELECT
          sender_email,
          workspace_slug,
          COUNT(id)::int AS replies
        FROM replies
        WHERE received_at >= NOW() - ($1 || ' days')::interval
          AND sender_email IS NOT NULL
          AND sender_email != ''
        GROUP BY sender_email, workspace_slug
      )
      SELECT
        sc.sender_email,
        sc.workspace_slug,
        sc.emails_sent,
        COALESCE(bc.bounces, 0)                                                      AS bounces,
        COALESCE(rc.replies, 0)                                                      AS replies,
        ROUND(COALESCE(bc.bounces,0)::numeric / NULLIF(sc.emails_sent,0) * 100, 1)  AS bounce_rate,
        ROUND(COALESCE(rc.replies,0)::numeric / NULLIF(sc.emails_sent,0) * 100, 1)  AS reply_rate
      FROM sent_counts sc
      LEFT JOIN bounce_counts bc
        ON  bc.sender_email   = sc.sender_email
        AND bc.workspace_slug = sc.workspace_slug
      LEFT JOIN reply_counts rc
        ON  rc.sender_email   = sc.sender_email
        AND rc.workspace_slug = sc.workspace_slug
      ORDER BY
        CASE
          WHEN sc.emails_sent >= 20 AND COALESCE(rc.replies,0) = 0 THEN 0
          WHEN COALESCE(rc.replies,0)::numeric / NULLIF(sc.emails_sent,0) < 0.02 THEN 1
          ELSE 2
        END ASC,
        sc.workspace_slug ASC,
        sc.emails_sent DESC
    `;

    const result = await pool.query(sql, params);

    type Status = "spam_risk" | "low_replies" | "healthy";
    type AccountRow = {
      sender_email: string;
      workspace_slug: string;
      emails_sent: number;
      bounces: number;
      replies: number;
      bounce_rate: number;
      reply_rate: number;
      status: Status;
    };

    const accountRows: AccountRow[] = result.rows.map((r) => {
      const sent      = r.emails_sent;
      const replies   = r.replies;
      const replyRate = parseFloat(r.reply_rate ?? 0);

      let status: Status = "healthy";
      if (sent >= MIN_SENDS && replies === 0) status = "spam_risk";
      else if (replyRate < 2)                 status = "low_replies";

      return {
        sender_email:   r.sender_email,
        workspace_slug: r.workspace_slug,
        emails_sent:    sent,
        bounces:        r.bounces,
        replies,
        bounce_rate:    parseFloat(r.bounce_rate ?? 0),
        reply_rate:     replyRate,
        status,
      };
    });

    const workspaceMap: Record<string, {
      slug: string;
      accounts: AccountRow[];
      totalSent: number;
      totalReplies: number;
      totalBounces: number;
      spamRiskCount: number;
    }> = {};

    for (const acc of accountRows) {
      const slug = acc.workspace_slug;
      if (!workspaceMap[slug]) {
        workspaceMap[slug] = { slug, accounts: [], totalSent: 0, totalReplies: 0, totalBounces: 0, spamRiskCount: 0 };
      }
      const ws = workspaceMap[slug];
      ws.accounts.push(acc);
      ws.totalSent    += acc.emails_sent;
      ws.totalReplies += acc.replies;
      ws.totalBounces += acc.bounces;
      if (acc.status === "spam_risk") ws.spamRiskCount++;
    }

    const workspaces = Object.values(workspaceMap).map((ws) => ({
      slug:          ws.slug,
      accounts:      ws.accounts,
      totalSent:     ws.totalSent,
      totalReplies:  ws.totalReplies,
      totalBounces:  ws.totalBounces,
      spamRiskCount: ws.spamRiskCount,
      avgReplyRate:  ws.totalSent > 0 ? Math.round((ws.totalReplies / ws.totalSent) * 1000) / 10 : 0,
      bouncePct:     ws.totalSent > 0 ? Math.round((ws.totalBounces / ws.totalSent) * 1000) / 10 : 0,
    }));

    workspaces.sort((a, b) => b.spamRiskCount - a.spamRiskCount);

    const totalAccounts = accountRows.length;
    const totalSpamRisk = accountRows.filter(a => a.status === "spam_risk").length;
    const totalSent     = accountRows.reduce((s, a) => s + a.emails_sent, 0);
    const totalReplies  = accountRows.reduce((s, a) => s + a.replies, 0);
    const avgReplyRate  = totalSent > 0 ? Math.round((totalReplies / totalSent) * 1000) / 10 : 0;

    return NextResponse.json({
      workspaces,
      summary: { totalAccounts, totalSpamRisk, totalSent, avgReplyRate },
      days,
    });

  } catch (err: any) {
    console.error("[account-monitor]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}