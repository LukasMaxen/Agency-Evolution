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
//
// Confidence tiers (based on send volume):
//   - sends >= full threshold:  status is confident (no asterisk)
//   - 20 <= sends < full:       status is PROVISIONAL (asterisk + dashed)
//   - sends < 20 and no burn:   INSUFFICIENT_DATA (truly noisy)
// Account full threshold:  50
// Domain full threshold:   max(50, 20 * accounts)
// Provisional floor:       20 sends (both levels)

const REPLY_RATE_MIN   = 1.0;
const BOUNCE_RATE_MAX  = 2.0;
const BURN_RATE_MAX    = 0.5;
const ACCOUNT_MIN_SEND = 50;
const DOMAIN_MIN_PER_ACCOUNT = 20;
const DOMAIN_MIN_FLOOR = 50;
const PROVISIONAL_FLOOR = 20;

type Status = "burned" | "list_issue" | "low_replies" | "healthy" | "insufficient_data";
type Confidence = "full" | "provisional";

interface SignalFlags {
  burn:    boolean;
  bounce:  boolean;
  replies: boolean;
}

function classify(args: {
  sent: number;
  fullMinSends: number;
  burnCount: number;
  burnRate: number;
  bounceRate: number;
  replyRate: number;
}): { status: Status; confidence: Confidence; signals: SignalFlags } {
  const burnFires = args.burnCount > 0 || args.burnRate >= BURN_RATE_MAX;

  // Below the provisional floor and no burn event: truly no signal.
  if (args.sent < PROVISIONAL_FLOOR && !burnFires) {
    return {
      status:     "insufficient_data",
      confidence: "full",
      signals:    { burn: false, bounce: false, replies: false },
    };
  }

  const signals: SignalFlags = {
    burn:    burnFires,
    bounce:  args.bounceRate >= BOUNCE_RATE_MAX,
    replies: args.replyRate  <  REPLY_RATE_MIN,
  };

  // Priority cascade for the badge.
  let status: Status;
  if (signals.burn)         status = "burned";
  else if (signals.bounce)  status = "list_issue";
  else if (signals.replies) status = "low_replies";
  else                      status = "healthy";

  // Confidence: full only when sends are at or above the full threshold.
  const confidence: Confidence = args.sent >= args.fullMinSends ? "full" : "provisional";

  return { status, confidence, signals };
}

// Sort key by status severity. Lower = worse, sorted first.
const STATUS_ORDER: Record<Status, number> = {
  burned:            0,
  list_issue:        1,
  low_replies:       2,
  healthy:           3,
  insufficient_data: 4,  // truly no data drops to the bottom
};
const CONFIDENCE_ORDER: Record<Confidence, number> = {
  full:        0,
  provisional: 1,
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
        -- Two-path total: poll-ingested rows carry sender_email directly,
        -- legacy webhook rows have lead_email only and need an emails_sent
        -- join to recover the sender. Without this UNION the poll-path
        -- bounces are invisible to the bounce_rate metric.
        SELECT sender_email, workspace_slug, SUM(c)::int AS bounces
        FROM (
          -- Path A: poll rows (sender_email present directly on the bounce)
          SELECT
            eb.sender_email,
            eb.workspace_slug,
            COUNT(*)::int AS c
          FROM email_bounces eb
          INNER JOIN active_senders sa
            ON  sa.sender_email   = eb.sender_email
            AND sa.workspace_slug = eb.workspace_slug
          WHERE eb.bounced_at >= NOW() - ($1 || ' days')::interval
            AND eb.sender_email IS NOT NULL
            AND eb.sender_email != ''
            ${wsFilterB}
          GROUP BY eb.sender_email, eb.workspace_slug

          UNION ALL

          -- Path B: legacy webhook rows (lead_email join)
          SELECT
            es.sender_email,
            es.workspace_slug,
            COUNT(eb.id)::int AS c
          FROM emails_sent es
          JOIN email_bounces eb
            ON  eb.workspace_slug = es.workspace_slug
            AND eb.lead_email     = es.lead_email
            AND eb.bounced_at    >= NOW() - ($1 || ' days')::interval
            AND (eb.sender_email IS NULL OR eb.sender_email = '')
          INNER JOIN active_senders sa
            ON  sa.sender_email   = es.sender_email
            AND sa.workspace_slug = es.workspace_slug
          WHERE es.sent_at >= NOW() - ($1 || ' days')::interval
            AND es.sender_email IS NOT NULL
            AND es.sender_email != ''
            ${wsFilter}
          GROUP BY es.sender_email, es.workspace_slug
        ) all_paths
        GROUP BY sender_email, workspace_slug
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
        -- Counts UNIQUE leads (first reply per lead), not every reply row.
        -- This matches EmailBison's "unique_replies_per_contact" metric:
        -- subsequent messages in the same thread don't inflate the count.
        --
        -- Once migration 013 applies, this CTE will add
        --   AND tracked_reply = TRUE
        -- to drop EB-classified "Untracked Reply" rows (newsletters, fresh
        -- cold outreach landing in a sender mailbox, transactional). Until
        -- then the per-sender reply counts include those rows; the workspace
        -- summary cards already get their numbers from the EB stats API
        -- below, so the inflation only affects the per-sender table.
        SELECT
          sender_email,
          workspace_slug,
          COUNT(DISTINCT lead_email)::int AS replies
        FROM replies
        WHERE received_at >= NOW() - ($1 || ' days')::interval
          AND sender_email IS NOT NULL AND sender_email != ''
          AND lead_email   IS NOT NULL AND lead_email   != ''
          AND lower(lead_email) !~ '^(postmaster|mailer-daemon|noreply|no-reply|bounce|bounces|bounce-handler)@'
          AND (subject IS NULL OR subject !~* '^(Undeliverable|Delivery Status Notification|Undelivered Mail|Mail Delivery|Returned to Sender|Failure Notice|Automatic reply|Auto[- ]?reply|Out of [Oo]ffice|Away from)')
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
      confidence:     Confidence;
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

      const { status, confidence, signals } = classify({
        sent,
        fullMinSends: ACCOUNT_MIN_SEND,
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
        status, confidence, signals,
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

        const fullMinSends = Math.max(DOMAIN_MIN_FLOOR, DOMAIN_MIN_PER_ACCOUNT * d.accounts.length);
        const { status, confidence, signals } = classify({
          sent,
          fullMinSends,
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
          minSends:      fullMinSends,
          provisionalMinSends: PROVISIONAL_FLOOR,
          status, confidence, signals,
          statusCounts,
        };
      });

      // Domains sorted by severity, then by confidence (full before
      // provisional), then by reply rate ascending, then bounce rate
      // descending. So "real burned" surfaces above "provisional burned",
      // both above any list_issue, etc.
      domains.sort((a, b) =>
        (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) ||
        (CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]) ||
        (a.avgReplyRate - b.avgReplyRate) ||
        (b.bouncePct - a.bouncePct)
      );

      // Workspace-level totals: kept as DB-derived here. EB stats API
      // overrides these below (see `ebStatsBySlug`) so the numbers shown
      // on the summary cards match EB's dashboard exactly.
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
        totalInterested: 0,
        avgReplyRate:  wsReplyRate,
        bouncePct:     wsBounceRate,
        burnPct:       wsBurnRate,
        domainCount:   domains.length,
        statusCounts,
      };
    });

    // ── Override workspace-level totals with EB stats API ─────────────────
    // The /api/workspaces/v1.1/stats endpoint returns the same numbers the
    // EB dashboard shows (emails_sent, unique_replies_per_contact, bounced,
    // interested) for an arbitrary date window. We surface those on the
    // workspace summary cards so what we display matches EB exactly.
    //
    // Per-account / per-domain breakdowns continue to come from the local
    // DB query above, since EB has no per-sender date-windowed endpoint.
    const toYmd = (d: Date) => d.toISOString().slice(0, 10);
    const endDate   = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const startYmd  = toYmd(startDate);
    const endYmd    = toYmd(endDate);

    const ebCreds = await pool.query(
      `SELECT slug, email_bison_api_key AS key, email_bison_instance_url AS url
       FROM workspaces
       WHERE email_bison_api_key IS NOT NULL
         AND email_bison_instance_url IS NOT NULL
         ${workspace !== "all" ? "AND slug = $1" : ""}`,
      workspace !== "all" ? [workspace] : []
    );

    type EbStats = { sent: number; replies: number; bounced: number; interested: number };
    const ebStatsBySlug: Record<string, EbStats> = {};
    await Promise.all(ebCreds.rows.map(async (w) => {
      try {
        const url = `${w.url}/api/workspaces/v1.1/stats?start_date=${startYmd}&end_date=${endYmd}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${w.key}` } });
        if (!r.ok) return;
        const body = await r.json();
        const d = body?.data ?? {};
        ebStatsBySlug[w.slug] = {
          sent:       d.emails_sent ?? 0,
          replies:    d.unique_replies_per_contact ?? 0,
          bounced:    d.bounced ?? 0,
          interested: d.interested ?? 0,
        };
      } catch (err) {
        console.error(`[account-monitor] EB stats fetch failed for ${w.slug}:`, err);
      }
    }));

    for (const ws of workspaces) {
      const eb = ebStatsBySlug[ws.slug];
      if (!eb) continue;
      ws.totalSent       = eb.sent;
      ws.totalReplies    = eb.replies;
      ws.totalBounces    = eb.bounced;
      ws.totalInterested = eb.interested;
      ws.avgReplyRate    = eb.sent > 0 ? Math.round((eb.replies / eb.sent) * 10000) / 100 : 0;
      ws.bouncePct       = eb.sent > 0 ? Math.round((eb.bounced / eb.sent) * 10000) / 100 : 0;
    }

    // Workspace order: burn count desc, then list-issue count desc, then sent desc.
    workspaces.sort((a, b) =>
      (b.statusCounts.burned     - a.statusCounts.burned) ||
      (b.statusCounts.list_issue - a.statusCounts.list_issue) ||
      (b.totalSent               - a.totalSent)
    );

    const totalAccounts   = accountRows.length;
    // Workspace-level totals already overridden with EB stats above. Sum
    // those instead of the DB-derived account rows so the global summary
    // also matches EB's dashboard numbers.
    const totalSent       = workspaces.reduce((s, w) => s + w.totalSent,       0);
    const totalReplies    = workspaces.reduce((s, w) => s + w.totalReplies,    0);
    const totalBounces    = workspaces.reduce((s, w) => s + w.totalBounces,    0);
    const totalInterested = workspaces.reduce((s, w) => s + w.totalInterested, 0);
    const totalBurns      = accountRows.reduce((s, a) => s + a.burns,          0);
    const totalDomains    = workspaces.reduce((s, w) => s + w.domainCount, 0);
    const avgReplyRate    = totalSent > 0 ? Math.round((totalReplies / totalSent) * 10000) / 100 : 0;
    const avgBouncePct    = totalSent > 0 ? Math.round((totalBounces / totalSent) * 10000) / 100 : 0;
    const avgBurnPct      = totalSent > 0 ? Math.round((totalBurns   / totalSent) * 10000) / 100 : 0;

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
        totalDomains,
        totalSent,
        totalReplies,
        totalBounces,
        totalInterested,
        totalBurns,
        avgReplyRate,
        avgBouncePct,
        avgBurnPct,
        domainStatusCounts: summaryStatusCounts,
      },
      thresholds: {
        replyRateMin:  REPLY_RATE_MIN,
        bounceRateMax: BOUNCE_RATE_MAX,
        burnRateMax:   BURN_RATE_MAX,
        accountMinSend: ACCOUNT_MIN_SEND,
        domainMinPerAccount: DOMAIN_MIN_PER_ACCOUNT,
        domainMinFloor: DOMAIN_MIN_FLOOR,
      },
      days,
      lastSynced,
    });

  } catch (err: any) {
    console.error("[account-monitor]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
