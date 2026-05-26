import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/account-monitor?days=7&workspace=all
//
// Sender accounts are sourced from the sender_accounts table, which is kept
// in sync with EmailBison via POST /api/sync-sender-accounts.
// Accounts deleted from EB are also deleted from sender_accounts, so they
// never appear here even if they still have rows in emails_sent.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days      = parseInt(searchParams.get("days") ?? "7");
  const workspace = searchParams.get("workspace") ?? "all";

  const MIN_SENDS = 20;

  try {
    const wsFilter   = workspace !== "all" ? "AND es.workspace_slug = $2" : "";
    const wsFilterR  = workspace !== "all" ? "AND workspace_slug = $2" : "";
    const params: (number | string)[] = [days];
    if (workspace !== "all") params.push(workspace);

    // Only include sender_emails that currently exist in sender_accounts
    // (i.e. are active in EmailBison). Senders deleted from EB will have
    // been removed from sender_accounts by the sync job and won't appear.
    const sql = `
      WITH active_senders AS (
        SELECT email AS sender_email, workspace_slug
        FROM sender_accounts
        ${workspace !== "all" ? "WHERE workspace_slug = $2" : ""}
      ),
      sent_counts AS (
        SELECT
          es.sender_email,
          es.workspace_slug,
          COUNT(es.id)::int AS emails_sent
        FROM emails_sent es
        INNER JOIN active_senders sa
          ON  sa.sender_email   = es.sender_email
          AND sa.workspace_slug = es.workspace_slug
        WHERE es.sent_at >= NOW() - ($1 || ' days')::interval
          AND es.sender_email IS NOT NULL
          AND es.sender_email != ''
          ${wsFilter}
        GROUP BY es.sender_email, es.workspace_slug
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
        INNER JOIN active_senders sa
          ON  sa.sender_email   = es.sender_email
          AND sa.workspace_slug = es.workspace_slug
        WHERE es.sent_at >= NOW() - ($1 || ' days')::interval
          AND es.sender_email IS NOT NULL
          AND es.sender_email != ''
          ${wsFilter}
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
          ${wsFilterR}
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

    // Check when sender_accounts was last synced
    const syncResult = await pool.query(
      `SELECT MAX(synced_at) AS last_synced FROM sender_accounts`
    );
    const lastSynced = syncResult.rows[0]?.last_synced ?? null;

    type Status = "spam_risk" | "low_replies" | "healthy";
    type AccountRow = {
      sender_email:   string;
      workspace_slug: string;
      emails_sent:    number;
      bounces:        number;
      replies:        number;
      bounce_rate:    number;
      reply_rate:     number;
      status:         Status;
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

    type DomainAgg = {
      domain:        string;
      accounts:      AccountRow[];
      totalSent:     number;
      totalReplies:  number;
      totalBounces:  number;
      spamRiskCount: number;
    };

    const workspaceMap: Record<string, {
      slug:          string;
      accounts:      AccountRow[];
      domainMap:     Record<string, DomainAgg>;
      totalSent:     number;
      totalReplies:  number;
      totalBounces:  number;
      spamRiskCount: number;
    }> = {};

    for (const acc of accountRows) {
      const slug = acc.workspace_slug;
      if (!workspaceMap[slug]) {
        workspaceMap[slug] = { slug, accounts: [], domainMap: {}, totalSent: 0, totalReplies: 0, totalBounces: 0, spamRiskCount: 0 };
      }
      const ws = workspaceMap[slug];
      ws.accounts.push(acc);
      ws.totalSent    += acc.emails_sent;
      ws.totalReplies += acc.replies;
      ws.totalBounces += acc.bounces;
      if (acc.status === "spam_risk") ws.spamRiskCount++;

      // Level 2: domain rollup. Parses the sending domain from the account
      // email (after the '@'). Domains are grouped per workspace so we can
      // see e.g. how 911restorationpros.com is doing vs 911restoreteam.com
      // inside the same client.
      const atIdx = acc.sender_email.lastIndexOf("@");
      const domain = atIdx >= 0 ? acc.sender_email.slice(atIdx + 1).toLowerCase() : "unknown";
      if (!ws.domainMap[domain]) {
        ws.domainMap[domain] = { domain, accounts: [], totalSent: 0, totalReplies: 0, totalBounces: 0, spamRiskCount: 0 };
      }
      const dom = ws.domainMap[domain];
      dom.accounts.push(acc);
      dom.totalSent    += acc.emails_sent;
      dom.totalReplies += acc.replies;
      dom.totalBounces += acc.bounces;
      if (acc.status === "spam_risk") dom.spamRiskCount++;
    }

    const workspaces = Object.values(workspaceMap).map((ws) => {
      const domains = Object.values(ws.domainMap).map((d) => ({
        domain:        d.domain,
        accounts:      d.accounts,
        totalSent:     d.totalSent,
        totalReplies:  d.totalReplies,
        totalBounces:  d.totalBounces,
        spamRiskCount: d.spamRiskCount,
        bouncePct:     d.totalSent > 0 ? Math.round((d.totalBounces / d.totalSent) * 1000) / 10 : 0,
        avgReplyRate:  d.totalSent > 0 ? Math.round((d.totalReplies / d.totalSent) * 1000) / 10 : 0,
      }));

      // Sort domains: spam-risk first, then by total sent desc.
      domains.sort((a, b) => (b.spamRiskCount - a.spamRiskCount) || (b.totalSent - a.totalSent));

      return {
        slug:          ws.slug,
        accounts:      ws.accounts,
        domains,
        totalSent:     ws.totalSent,
        totalReplies:  ws.totalReplies,
        totalBounces:  ws.totalBounces,
        spamRiskCount: ws.spamRiskCount,
        avgReplyRate:  ws.totalSent > 0 ? Math.round((ws.totalReplies / ws.totalSent) * 1000) / 10 : 0,
        bouncePct:     ws.totalSent > 0 ? Math.round((ws.totalBounces / ws.totalSent) * 1000) / 10 : 0,
        domainCount:   domains.length,
      };
    });

    workspaces.sort((a, b) => b.spamRiskCount - a.spamRiskCount);

    const totalAccounts = accountRows.length;
    const totalSpamRisk = accountRows.filter(a => a.status === "spam_risk").length;
    const totalSent     = accountRows.reduce((s, a) => s + a.emails_sent, 0);
    const totalReplies  = accountRows.reduce((s, a) => s + a.replies, 0);
    const avgReplyRate  = totalSent > 0 ? Math.round((totalReplies / totalSent) * 1000) / 10 : 0;

    return NextResponse.json({
      workspaces,
      summary:    { totalAccounts, totalSpamRisk, totalSent, avgReplyRate },
      days,
      lastSynced, // lets the UI show "last synced X ago"
    });

  } catch (err: any) {
    console.error("[account-monitor]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}