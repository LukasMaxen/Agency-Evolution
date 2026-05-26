import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/account-monitor?days=7&workspace=all
//
// Sender accounts are sourced from the sender_accounts table, kept in sync
// with EmailBison via /api/sync-sender-accounts. Senders deleted from EB are
// also removed from sender_accounts, so they never appear here.

// ── Deliverability thresholds ────────────────────────────────────────────
// Reply rate target:  >= 1.0%   below = LOW_REPLIES signal fires
// Bounce rate target: <  2.0%   at/above = LIST_ISSUE signal fires
// Burn rate target:   <  0.5%   at/above OR any single burn event fires
// Account minimum sends: 50  (below this, only burn signal can fire)
// Domain minimum sends:  50 * (number of accounts in domain)

const REPLY_RATE_MIN   = 1.0;
const BOUNCE_RATE_MAX  = 2.0;
const BURN_RATE_MAX    = 0.5;
const ACCOUNT_MIN_SEND = 50;
const DOMAIN_MIN_PER_ACCOUNT = 50;

type Status = "burned" | "list_issue" | "low_replies" | "healthy" | "insufficient_data";

interface SignalFlags {
  burn:    boolean;
  bounce:  boolean;
  replies: boolean;
}

function classify(args: {
  sent: number;
  minSends: number;
  burnCount: number;
  burnRate: number;
  bounceRate: number;
  replyRate: number;
}): { status: Status; signals: SignalFlags } {
  const burnFires = args.burnCount > 0 || args.burnRate >= BURN_RATE_MAX;

  // Burn bypasses the minimum sends gate: a single 5.7.509 / DMARC failure
  // event is meaningful regardless of volume.
  if (args.sent < args.minSends) {
    if (burnFires) {
      return { status: "burned", signals: { burn: true, bounce: false, replies: false } };
    }
    return {
      status:  "insufficient_data",
      signals: { burn: false, bounce: false, replies: false },
    };
  }

  const signals: SignalFlags = {
    burn:    burnFires,
    bounce:  args.bounceRate >= BOUNCE_RATE_MAX,
    replies: args.replyRate  <  REPLY_RATE_MIN,
  };

  if (signals.burn)    return { status: "burned",       signals };
  if (signals.bounce)  return { status: "list_issue",   signals };
  if (signals.replies) return { status: "low_replies",  signals };
  return                    { status: "healthy",       signals };
}

// Sort key by status severity. Lower = worse, sorted first.
const STATUS_ORDER: Record<Status, number> = {
  burned:            0,
  list_issue:        1,
  low_replies:       2,
  insufficient_data: 3,
  healthy:           4,
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days      = parseInt(searchParams.get("days") ?? "7");
  const workspace = searchParams.get("workspace") ?? "all";

  try {
    const wsFilter   = workspace !== "all" ? "AND es.workspace_slug = $2" : "";
    const wsFilterR  = workspace !== "all" ? "AND workspace_slug = $2" : "";
    const wsFilterB  = workspace !== "all" ? "AND eb.workspace_slug = $2" : "";
    const params: (number | string)[] = [days];
    if (workspace !== "all") params.push(workspace);

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
      burn_counts AS (
        -- New enriched bounces carry sender_email directly, so we join by
        -- sender_email (more accurate than the legacy lead_email path).
        -- Legacy webhook-path rows have no bounce_category, so they are
        -- naturally excluded from this count.
        SELECT
          eb.sender_email,
          eb.workspace_slug,
          COUNT(*)::int AS burns
        FROM email_bounces eb
        INNER JOIN active_senders sa
          ON  sa.sender_email   = eb.sender_email
          AND sa.workspace_slug = eb.workspace_slug
        WHERE eb.bounce_category = 'domain_burn'
          AND eb.bounced_at >= NOW() - ($1 || ' days')::interval
          AND eb.sender_email IS NOT NULL
          AND eb.sender_email != ''
          ${wsFilterB}
        GROUP BY eb.sender_email, eb.workspace_slug
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
        COALESCE(bn.burns,   0)                                                      AS burns,
        COALESCE(rc.replies, 0)                                                      AS replies,
        ROUND(COALESCE(bc.bounces,0)::numeric / NULLIF(sc.emails_sent,0) * 100, 2)  AS bounce_rate,
        ROUND(COALESCE(bn.burns,  0)::numeric / NULLIF(sc.emails_sent,0) * 100, 2)  AS burn_rate,
        ROUND(COALESCE(rc.replies,0)::numeric / NULLIF(sc.emails_sent,0) * 100, 2)  AS reply_rate
      FROM sent_counts sc
      LEFT JOIN bounce_counts bc
        ON  bc.sender_email   = sc.sender_email
        AND bc.workspace_slug = sc.workspace_slug
      LEFT JOIN burn_counts bn
        ON  bn.sender_email   = sc.sender_email
        AND bn.workspace_slug = sc.workspace_slug
      LEFT JOIN reply_counts rc
        ON  rc.sender_email   = sc.sender_email
        AND rc.workspace_slug = sc.workspace_slug
      ORDER BY sc.workspace_slug ASC, sc.emails_sent DESC
    `;

    const result = await pool.query(sql, params);

    const syncResult = await pool.query(
      `SELECT MAX(synced_at) AS last_synced FROM sender_accounts`
    );
    const lastSynced = syncResult.rows[0]?.last_synced ?? null;

    type AccountRow = {
      sender_email:   string;
      workspace_slug: string;
      emails_sent:    number;
      bounces:        number;
      burns:          number;
      replies:        number;
      bounce_rate:    number;
      burn_rate:      number;
      reply_rate:     number;
      status:         Status;
      signals:        SignalFlags;
    };

    const accountRows: AccountRow[] = result.rows.map((r) => {
      const sent       = r.emails_sent;
      const bounces    = r.bounces;
      const burns      = r.burns;
      const replies    = r.replies;
      const bounceRate = parseFloat(r.bounce_rate ?? 0);
      const burnRate   = parseFloat(r.burn_rate   ?? 0);
      const replyRate  = parseFloat(r.reply_rate  ?? 0);

      const { status, signals } = classify({
        sent,
        minSends: ACCOUNT_MIN_SEND,
        burnCount: burns,
        burnRate,
        bounceRate,
        replyRate,
      });

      return {
        sender_email:   r.sender_email,
        workspace_slug: r.workspace_slug,
        emails_sent:    sent,
        bounces, burns, replies,
        bounce_rate:    bounceRate,
        burn_rate:      burnRate,
        reply_rate:     replyRate,
        status, signals,
      };
    });

    type DomainAgg = {
      domain:        string;
      accounts:      AccountRow[];
      totalSent:     number;
      totalReplies:  number;
      totalBounces:  number;
      totalBurns:    number;
    };

    const workspaceMap: Record<string, {
      slug:          string;
      accounts:      AccountRow[];
      domainMap:     Record<string, DomainAgg>;
      totalSent:     number;
      totalReplies:  number;
      totalBounces:  number;
      totalBurns:    number;
    }> = {};

    for (const acc of accountRows) {
      const slug = acc.workspace_slug;
      if (!workspaceMap[slug]) {
        workspaceMap[slug] = { slug, accounts: [], domainMap: {}, totalSent: 0, totalReplies: 0, totalBounces: 0, totalBurns: 0 };
      }
      const ws = workspaceMap[slug];
      ws.accounts.push(acc);
      ws.totalSent    += acc.emails_sent;
      ws.totalReplies += acc.replies;
      ws.totalBounces += acc.bounces;
      ws.totalBurns   += acc.burns;

      const atIdx = acc.sender_email.lastIndexOf("@");
      const domain = atIdx >= 0 ? acc.sender_email.slice(atIdx + 1).toLowerCase() : "unknown";
      if (!ws.domainMap[domain]) {
        ws.domainMap[domain] = { domain, accounts: [], totalSent: 0, totalReplies: 0, totalBounces: 0, totalBurns: 0 };
      }
      const dom = ws.domainMap[domain];
      dom.accounts.push(acc);
      dom.totalSent    += acc.emails_sent;
      dom.totalReplies += acc.replies;
      dom.totalBounces += acc.bounces;
      dom.totalBurns   += acc.burns;
    }

    const workspaces = Object.values(workspaceMap).map((ws) => {
      const domains = Object.values(ws.domainMap).map((d) => {
        const sent       = d.totalSent;
        const bounceRate = sent > 0 ? Math.round((d.totalBounces / sent) * 10000) / 100 : 0;
        const burnRate   = sent > 0 ? Math.round((d.totalBurns   / sent) * 10000) / 100 : 0;
        const replyRate  = sent > 0 ? Math.round((d.totalReplies / sent) * 10000) / 100 : 0;

        const minSends = DOMAIN_MIN_PER_ACCOUNT * d.accounts.length;
        const { status, signals } = classify({
          sent,
          minSends,
          burnCount: d.totalBurns,
          burnRate,
          bounceRate,
          replyRate,
        });

        const statusCounts = {
          burned:            d.accounts.filter(a => a.status === "burned").length,
          list_issue:        d.accounts.filter(a => a.status === "list_issue").length,
          low_replies:       d.accounts.filter(a => a.status === "low_replies").length,
          insufficient_data: d.accounts.filter(a => a.status === "insufficient_data").length,
          healthy:           d.accounts.filter(a => a.status === "healthy").length,
        };

        return {
          domain:        d.domain,
          accounts:      d.accounts,
          totalSent:     sent,
          totalReplies:  d.totalReplies,
          totalBounces:  d.totalBounces,
          totalBurns:    d.totalBurns,
          bouncePct:     bounceRate,
          burnPct:       burnRate,
          avgReplyRate:  replyRate,
          minSends,
          status, signals,
          statusCounts,
        };
      });

      // Domains sorted by severity, then by volume.
      domains.sort((a, b) =>
        (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) ||
        (b.totalSent - a.totalSent)
      );

      const wsSent      = ws.totalSent;
      const wsBounceRate = wsSent > 0 ? Math.round((ws.totalBounces / wsSent) * 10000) / 100 : 0;
      const wsBurnRate   = wsSent > 0 ? Math.round((ws.totalBurns   / wsSent) * 10000) / 100 : 0;
      const wsReplyRate  = wsSent > 0 ? Math.round((ws.totalReplies / wsSent) * 10000) / 100 : 0;

      const statusCounts = {
        burned:            domains.filter(d => d.status === "burned").length,
        list_issue:        domains.filter(d => d.status === "list_issue").length,
        low_replies:       domains.filter(d => d.status === "low_replies").length,
        insufficient_data: domains.filter(d => d.status === "insufficient_data").length,
        healthy:           domains.filter(d => d.status === "healthy").length,
      };

      return {
        slug:          ws.slug,
        accounts:      ws.accounts,
        domains,
        totalSent:     wsSent,
        totalReplies:  ws.totalReplies,
        totalBounces:  ws.totalBounces,
        totalBurns:    ws.totalBurns,
        avgReplyRate:  wsReplyRate,
        bouncePct:     wsBounceRate,
        burnPct:       wsBurnRate,
        domainCount:   domains.length,
        statusCounts,
      };
    });

    // Workspace order: burn count desc, then list-issue count desc, then sent desc.
    workspaces.sort((a, b) =>
      (b.statusCounts.burned     - a.statusCounts.burned) ||
      (b.statusCounts.list_issue - a.statusCounts.list_issue) ||
      (b.totalSent               - a.totalSent)
    );

    const totalAccounts = accountRows.length;
    const totalSent     = accountRows.reduce((s, a) => s + a.emails_sent, 0);
    const totalReplies  = accountRows.reduce((s, a) => s + a.replies,     0);
    const totalBurns    = accountRows.reduce((s, a) => s + a.burns,       0);
    const avgReplyRate  = totalSent > 0 ? Math.round((totalReplies / totalSent) * 10000) / 100 : 0;

    // Domain-level rollup counts for the global summary.
    const allDomains = workspaces.flatMap(w => w.domains);
    const summaryStatusCounts = {
      burned:            allDomains.filter(d => d.status === "burned").length,
      list_issue:        allDomains.filter(d => d.status === "list_issue").length,
      low_replies:       allDomains.filter(d => d.status === "low_replies").length,
      insufficient_data: allDomains.filter(d => d.status === "insufficient_data").length,
      healthy:           allDomains.filter(d => d.status === "healthy").length,
    };

    return NextResponse.json({
      workspaces,
      summary: {
        totalAccounts,
        totalSent,
        totalBurns,
        avgReplyRate,
        domainStatusCounts: summaryStatusCounts,
      },
      thresholds: {
        replyRateMin:  REPLY_RATE_MIN,
        bounceRateMax: BOUNCE_RATE_MAX,
        burnRateMax:   BURN_RATE_MAX,
        accountMinSend: ACCOUNT_MIN_SEND,
        domainMinPerAccount: DOMAIN_MIN_PER_ACCOUNT,
      },
      days,
      lastSynced,
    });

  } catch (err: any) {
    console.error("[account-monitor]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
