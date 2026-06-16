"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import {
  RefreshCw, Loader2, Flame, ChevronLeft, ChevronUp, ChevronDown, Plus,
} from "lucide-react";
import { useWorkspaces, findWorkspace } from "@/lib/workspaces-context";

// MailboxMonitor — merged Domain + Warmup dashboard.
// Fetches both /api/account-monitor (sends/replies/bounces, domain status)
// and /api/warmup-monitor (warmup_score, warming lifecycle) in parallel.
// Renders one workspace card set; drilldown uses Active / Warming-only tabs.
// Both source dashboards are kept intact so this can be safely rolled back.

// ── Source-data shapes (kept loose so we can read the existing routes
//    without coupling to their full types) ────────────────────────────

interface AccountMonitorAccount {
  sender_email:             string;
  workspace_slug:           string;
  conn_status:              string;
  warmup_enabled:           boolean;
  warming_since:            string | null;
  attached_campaigns_count: number | null;
  emails_sent:              number;
  bounces:                  number;
  burns:                    number;
  replies:                  number;
  bounce_rate:              number;
  burn_rate:                number;
  reply_rate:               number;
  status:                   string;
  confidence:               string;
}
interface AccountMonitorDomain {
  domain:        string;
  accounts:      AccountMonitorAccount[];
  totalSent:     number;
  totalReplies:  number;
  totalBounces:  number;
  totalBurns:    number;
  avgReplyRate:  number;
  bouncePct:     number;
  burnPct:       number;
  status:        string;
  confidence:    string;
}
interface AccountMonitorWorkspace {
  slug:           string;
  accounts:       AccountMonitorAccount[];
  domains:        AccountMonitorDomain[];
  totalSent:      number;
  totalReplies:   number;
  totalBounces:   number;
  totalBurns:     number;
  avgReplyRate:   number;
  bouncePct:      number;
  burnPct:        number;
  domainCount:    number;
  statusCounts:   Record<string, number>;
}
interface AccountMonitorResponse {
  workspaces: AccountMonitorWorkspace[];
  summary:    any;
  thresholds: any;
  days:       number;
  lastSynced: string | null;
  mxMissingDomains?: string[];
}

interface WarmupSender {
  workspace_slug:           string;
  sender_email:             string;
  eb_sender_id:             number | null;
  conn_status:              string;
  warmup_enabled:           boolean;
  warmup_score:             number | null;
  warming_since:            string | null;
  warming_days:             number | null;
  ready_to_rejoin:          boolean;
  attached_campaigns_count: number | null;
}
interface WarmupWsAgg {
  slug:             string;
  total:            number;
  active:           number;
  disconnected:     number;
  notWarming:       number;
  warmingOnly:      number;
  readyToRejoin:    number;
  lowHealthDomains: number;
  warmupHealthAvg:  number | null;
}
interface WarmupResponse {
  senders:    WarmupSender[];
  summary:    any;
  workspaces: WarmupWsAgg[];
  thresholds: { readyDays: number; churnWindowDays: number };
}

// ── Merged internal shape ─────────────────────────────────────────────

interface Sender {
  email:                    string;
  workspace_slug:           string;
  eb_sender_id:             number | null;
  conn_status:              string;
  warmup_enabled:           boolean;
  warmup_score:             number | null;
  warming_since:            string | null;
  warming_days:             number | null;
  ready_to_rejoin:          boolean;
  attached_campaigns_count: number | null;
  emails_sent:              number;
  replies:                  number;
  bounces:                  number;
  burns:                    number;
  reply_rate:               number;
  bounce_rate:              number;
  burn_rate:                number;
  acc_status:               string;
  confidence:               string;
}

interface Workspace {
  slug:             string;
  total:            number;
  active:           number;
  warmingOnly:      number;
  disconnected:     number;
  notWarming:       number;
  readyToRejoin:    number;
  lowHealthDomains: number;
  warmupHealthAvg:  number | null;
  totalSent:        number;
  totalReplies:     number;
  totalBounces:     number;
  totalBurns:       number;
  avgReplyRate:     number;
  bouncePct:        number;
  burnPct:          number;
  // From account-monitor: count of domains in red-tier states (burned,
  // critical_low_replies, list_issue). These overlap conceptually with
  // lowHealthDomains from warmup-monitor; we keep both on the card so
  // operators see "sending burning out" vs "warming health dropping"
  // as separate signals.
  burnedDomains:    number;
  criticalDomains:  number;
  // Full per-tier domain counts from /api/account-monitor.statusCounts.
  // Used by the third row of the SummaryPanel ("domain-status strip")
  // so the operator can see at a glance how many domains are in each
  // health tier across the whole org / for one workspace.
  listIssueDomains:    number;
  lowReplyDomains:     number;
  insufficientDomains: number;
  healthyDomains:      number;
  // Count of unique sender domains in this workspace with no MX records
  // resolvable via live DNS. Live-resolved server-side and cached 1h.
  mxMissingDomains:    number;
  // Today's scheduled-emails total across all active campaigns in this
  // workspace, summed from EB's /api/campaigns/{id}/sending-schedule
  // (?day=today). Mirrors the "Emails Sent + Scheduled" column on the
  // EB Sending Schedule page. Null while loading or on fetch failure.
  scheduledToday:      number | null;
}

// Aggregated stats used by the SummaryPanel. Computed across all
// workspaces for the index view, or scoped to a single workspace in
// the drilldown.
interface Totals {
  total:           number;
  active:          number;
  warmingOnly:     number;
  disconnected:    number;
  totalSent:       number;
  totalReplies:    number;
  totalBounces:    number;
  totalBurns:      number;
  // Weighted by send volume so a workspace that sent 5k emails carries
  // more weight in the reply / bounce / burn rate than one that sent 50.
  replyRate:       number;
  bounceRate:      number;
  burnRate:        number;
  // Weighted by sender count for warmup health (volume isn't the right
  // axis for warmup; sender headcount is).
  warmupHealthAvg: number | null;
  burnedDomains:       number;
  criticalDomains:     number;
  lowHealthDomains:    number;
  notWarming:          number;
  listIssueDomains:    number;
  lowReplyDomains:     number;
  insufficientDomains: number;
  healthyDomains:      number;
  mxMissingDomains:    number;
  // Today's scheduled-emails total summed across workspaces. Null if
  // any workspace failed its EB fetch, so the UI surfaces "—" rather
  // than a misleadingly low number.
  scheduledToday:      number | null;
}

const DAILY_CAP_PER_SENDER = 20;

function aggregateTotals(workspaces: Workspace[]): Totals {
  const t: Totals = {
    total: 0, active: 0, warmingOnly: 0, disconnected: 0,
    totalSent: 0, totalReplies: 0, totalBounces: 0, totalBurns: 0,
    replyRate: 0, bounceRate: 0, burnRate: 0, warmupHealthAvg: null,
    burnedDomains: 0, criticalDomains: 0, lowHealthDomains: 0, notWarming: 0,
    listIssueDomains: 0, lowReplyDomains: 0, insufficientDomains: 0, healthyDomains: 0,
    mxMissingDomains: 0,
    scheduledToday: null,
  };
  let anySchedNull = false;
  let schedSum = 0;
  let warmupSum = 0;
  let warmupCount = 0;
  for (const w of workspaces) {
    t.total            += w.total;
    t.active           += w.active;
    t.warmingOnly      += w.warmingOnly;
    t.disconnected     += w.disconnected;
    t.notWarming       += w.notWarming;
    t.totalSent        += w.totalSent;
    t.totalReplies     += w.totalReplies;
    t.totalBounces     += w.totalBounces;
    t.totalBurns       += w.totalBurns;
    t.burnedDomains       += w.burnedDomains;
    t.criticalDomains     += w.criticalDomains;
    t.lowHealthDomains    += w.lowHealthDomains;
    t.listIssueDomains    += w.listIssueDomains;
    t.lowReplyDomains     += w.lowReplyDomains;
    t.insufficientDomains += w.insufficientDomains;
    t.healthyDomains      += w.healthyDomains;
    t.mxMissingDomains    += w.mxMissingDomains;
    if (w.scheduledToday === null) anySchedNull = true;
    else schedSum += w.scheduledToday;
    if (w.warmupHealthAvg !== null) {
      warmupSum += w.warmupHealthAvg * w.total;
      warmupCount += w.total;
    }
  }
  t.replyRate  = t.totalSent > 0 ? (t.totalReplies / t.totalSent) * 100 : 0;
  t.bounceRate = t.totalSent > 0 ? (t.totalBounces / t.totalSent) * 100 : 0;
  t.burnRate   = t.totalSent > 0 ? (t.totalBurns   / t.totalSent) * 100 : 0;
  t.warmupHealthAvg = warmupCount > 0 ? Math.round(warmupSum / warmupCount * 10) / 10 : null;
  t.scheduledToday = anySchedNull ? null : schedSum;
  return t;
}

// CapacityBar renders one tight horizontal bar:
//   "Sending Capacity  ████████░░  2,000 / 2,300  87%"
// Active capacity = active × 20 (EB's safe per-mailbox cap). The fill
// shows scheduled-today against that ceiling. Utilisation bands:
//   >= 80% green — we're using the capacity we have
//   60-80% amber — meaningful headroom worth launching into
//   <  60% red   — under-utilised, mailboxes are paying rent for nothing
// Used both per-card and as the page-level summary.
function CapacityBar({ active, scheduledToday, compact }: {
  active: number; scheduledToday: number | null; compact?: boolean;
}) {
  const cap = active * DAILY_CAP_PER_SENDER;
  const sched = scheduledToday ?? 0;
  const utilPct = cap > 0 && scheduledToday !== null ? (sched / cap) * 100 : 0;
  const fillPct = Math.min(100, utilPct);
  const fillColor = scheduledToday === null ? "#d1d5db"
                  : utilPct >= 80           ? "#15803D"  // green: well-used
                  : utilPct >= 60           ? "#D97706"  // amber: room to grow
                  :                           "#B91C1C"; // red: under-utilised
  return (
    <div style={{ display: "flex", alignItems: "center", gap: compact ? 8 : 10, fontSize: compact ? 10 : 11, color: "#6b7280" }}>
      <span style={{ color: "#9ca3af", fontWeight: 500, whiteSpace: "nowrap" }}>Sending Capacity</span>
      <div style={{
        flex: 1, height: compact ? 5 : 6, background: "#f3f4f6",
        borderRadius: 99, overflow: "hidden", position: "relative",
      }}>
        <div style={{
          width: `${fillPct}%`, height: "100%", background: fillColor,
          transition: "width 0.3s ease",
        }} />
      </div>
      <span style={{ color: scheduledToday === null ? "#9ca3af" : "#111827", fontWeight: 500, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {scheduledToday === null ? "—" : fmt(sched)}
        <span style={{ color: "#9ca3af", fontWeight: 400 }}> / {fmt(cap)}</span>
      </span>
      <span style={{ color: "#9ca3af", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "right" }}>
        {scheduledToday === null ? "" : `${Math.round(utilPct)}%`}
      </span>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function PillBadge({ text, tone }: { text: string; tone: "red" | "amber" | "green" | "indigo" | "grey" }) {
  const cfg = {
    red:    { bg: "#FCEBEB", color: "#B91C1C", border: "#F09595" },
    amber:  { bg: "#FAEEDA", color: "#D97706", border: "#FAC775" },
    green:  { bg: "#EAF3DE", color: "#15803D", border: "#C0DD97" },
    indigo: { bg: "#EEF2FF", color: "#3730A3", border: "#A5B4FC" },
    grey:   { bg: "#F3F4F6", color: "#6B7280", border: "#D1D5DB" },
  }[tone];
  return (
    <span style={{
      fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 500, whiteSpace: "nowrap",
      background: cfg.bg, color: cfg.color, border: `0.5px solid ${cfg.border}`,
    }}>
      {text}
    </span>
  );
}

function pct(x: number) {
  if (!isFinite(x)) return "—";
  return `${x.toFixed(1)}%`;
}

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

// Stat card used by the SummaryPanel. The colour band only fires when
// the metric crosses an obvious bad threshold, so a panel that's mostly
// neutral grey reads as "things are fine" at a glance.
function Stat({
  label, value, sub, color, accent,
}: {
  label: string; value: string | number; sub?: string;
  color?: string; accent?: "good" | "warn" | "bad" | "info";
}) {
  const accentBg = accent === "good" ? "#15803D"
                 : accent === "warn" ? "#D97706"
                 : accent === "bad"  ? "#B91C1C"
                 : accent === "info" ? "#3730A3"
                 : undefined;
  return (
    <div style={{
      background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 10,
      padding: "10px 14px", position: "relative", overflow: "hidden",
    }}>
      {accentBg && (
        <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accentBg }} />
      )}
      <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4, fontWeight: 500 }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 600, color: color ?? "#111827", fontVariantNumeric: "tabular-nums" }}>
        {value}
        {sub && <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>{sub}</span>}
      </p>
    </div>
  );
}

// SummaryPanel renders two stat rows on top of the index / drilldown
// views. Row 1 = capacity (how many senders we run); Row 2 = 7-day
// performance (the actual outcome of the sending).
function SummaryPanel({ totals, days }: { totals: Totals; days: number }) {
  // Thresholds match the same colour logic used in the action endpoints
  // and individual cards, so the colour story is consistent.
  const healthColor = totals.warmupHealthAvg === null ? "#9ca3af"
                    : totals.warmupHealthAvg >= 98 ? "#15803D"
                    : totals.warmupHealthAvg >= 90 ? "#D97706"
                                                   : "#B91C1C";
  // Reply: ≥1% is the operator target (green), 0.5-1% is the watch
  // band (amber), anything under 0.5% is a red flag.
  const replyColor  = totals.totalSent === 0      ? "#9ca3af"
                    : totals.replyRate >= 1       ? "#15803D"
                    : totals.replyRate >= 0.5     ? "#D97706"
                                                   : "#B91C1C";
  // <2% bounce is healthy across the whole portfolio, ≥2% is the red
  // threshold we already use in the per-sender Bounce column. No amber
  // middle band on the headline metric — operators want a clear go/no-go.
  const bounceColor = totals.totalSent === 0      ? "#9ca3af"
                    : totals.bounceRate < 2       ? "#15803D"
                                                   : "#B91C1C";
  const burnColor   = totals.totalSent === 0      ? "#9ca3af"
                    : totals.burnRate <= 0.25     ? "#15803D"
                    : totals.burnRate <= 0.5      ? "#D97706"
                                                   : "#B91C1C";
  // Sub-counts (disconnected, burned, critical, low-health) are deliberately
  // omitted here — they all live in the DomainStatusStrip below. Each Stat
  // card colours only on its own metric so a healthy warmup avg never shows
  // a red accent because of an unrelated domain status count.
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
      <Stat label="Emails sent"   value={fmt(totals.totalSent)} />
      <Stat label="Total senders" value={fmt(totals.total)}       sub={`(${fmt(totals.total * 20)}/day capacity)`} />
      <Stat label="Active"        value={fmt(totals.active)}      sub={`(${fmt(totals.active * 20)}/day capacity)`} />
      <Stat label="Warming only"  value={fmt(totals.warmingOnly)} sub={`(${fmt(totals.warmingOnly * 20)}/day capacity)`} />
      <Stat label="Warmup health" value={totals.warmupHealthAvg !== null ? `${totals.warmupHealthAvg}%` : "—"} color={healthColor} />
      <Stat label="Reply rate"    value={pct(totals.replyRate)}  color={replyColor} sub={totals.totalSent > 0 ? `${fmt(totals.totalReplies)} replies` : undefined} />
      <Stat label="Bounce rate"   value={pct(totals.bounceRate)} color={bounceColor} sub={totals.totalSent > 0 ? `${fmt(totals.totalBounces)} bounces` : undefined} />
      <Stat label="Burn rate"     value={pct(totals.burnRate)}   color={burnColor}   sub={totals.totalSent > 0 ? `${fmt(totals.totalBurns)} burns` : undefined} />
    </div>
  );
}

// Compact horizontal strip of domain-status counts. Mirrors the top
// strip on the existing Domain Monitor so the operator can see the
// shape of the portfolio at a glance: how many domains are red vs
// amber vs green vs not-yet-measurable. Hides zero buckets so the
// strip stays scannable.
function DomainStatusStrip({ totals }: { totals: Totals }) {
  const tiers: { label: string; count: number; tone: "red" | "amber" | "grey" | "green" | "indigo" }[] = [
    { label: "MX missing",   count: totals.mxMissingDomains,    tone: "red"    },
    { label: "Disconnected", count: totals.disconnected,        tone: "indigo" },
    { label: "Burned",       count: totals.burnedDomains,       tone: "red"    },
    { label: "Critical low", count: totals.criticalDomains,     tone: "red"    },
    { label: "Low health",   count: totals.lowHealthDomains,    tone: "red"    },
    { label: "List issue",   count: totals.listIssueDomains,    tone: "amber"  },
    { label: "Low reply",    count: totals.lowReplyDomains,     tone: "amber"  },
    { label: "Insufficient", count: totals.insufficientDomains, tone: "grey"   },
    { label: "Healthy",      count: totals.healthyDomains,      tone: "green"  },
  ];
  const visible = tiers.filter(t => t.count > 0);
  if (visible.length === 0) return null;
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14,
      padding: "8px 10px", background: "#ffffff",
      border: "0.5px solid #ede9e3", borderRadius: 10,
    }}>
      <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 500, alignSelf: "center", marginRight: 4 }}>DOMAIN STATUS</span>
      {visible.map(t => (
        <PillBadge key={t.label} text={`${t.count} ${t.label.toLowerCase()}`} tone={t.tone} />
      ))}
    </div>
  );
}

// ── Workspace card (level 1) ──────────────────────────────────────────

function WorkspaceCard({ w, onClick }: { w: Workspace; onClick: () => void }) {
  const workspaces = useWorkspaces();
  const name = findWorkspace(workspaces, w.slug).name !== "Unknown"
    ? findWorkspace(workspaces, w.slug).name
    : w.slug;

  // Severity ranking matches the source dashboards: disconnected outranks
  // everything, then red-tier (not warming / low warmup health / burned
  // domains / critical low replies), then amber, then green.
  const redCount = w.notWarming + w.lowHealthDomains + w.burnedDomains + w.criticalDomains;
  const accent =
    w.disconnected > 0 ? "#6366F1" :
    redCount > 0       ? "#E24B4A" :
    w.readyToRejoin > 0 ? "#F59E0B" :
                          "#84C56A";

  return (
    <div onClick={onClick}
      style={{
        background: "#ffffff",
        border: `1.5px solid ${accent}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: "0 12px 12px 0",
        padding: "14px 16px", cursor: "pointer", position: "relative",
        transition: "box-shadow 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.07)"}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.boxShadow = "none"}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 6, flexWrap: "wrap" }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{name}</p>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {w.disconnected > 0 ? (
            <PillBadge text={`${w.disconnected} disconnected`} tone="indigo" />
          ) : (
            <>
              {w.notWarming       > 0 && <PillBadge text={`${w.notWarming} not warming`} tone="red" />}
              {w.burnedDomains    > 0 && <PillBadge text={`${w.burnedDomains} burned`} tone="red" />}
              {w.criticalDomains  > 0 && <PillBadge text={`${w.criticalDomains} low reply`} tone="red" />}
              {w.lowHealthDomains > 0 && <PillBadge text={`${w.lowHealthDomains} low-health ${w.lowHealthDomains === 1 ? "domain" : "domains"}`} tone="red" />}
              {w.readyToRejoin    > 0 && <PillBadge text={`${w.readyToRejoin} ready`} tone="green" />}
              {redCount === 0 && <PillBadge text="All healthy" tone="green" />}
            </>
          )}
        </div>
      </div>
      {/* 3-column stat grid. Row 1 = capacity counts, row 2 = the
          performance triple (Warmup health, Reply, Burn). Each cell
          uses identical typography so the eye can compare straight
          across. Colour bands match the SummaryPanel up top:
            warmup  >=98 green, >=90 amber, else red
            reply   >=1  green, >=0.5 amber, else red
            burn    <=0.25 green, <=0.5 amber, else red                  */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { label: "Total senders", value: fmt(w.total) },
          { label: "Active",        value: fmt(w.active) },
          { label: "Warming only",  value: fmt(w.warmingOnly) },
          { label: "Warmup health", value: w.warmupHealthAvg !== null ? `${w.warmupHealthAvg}%` : "—",
            color: w.warmupHealthAvg === null ? "#9ca3af" : w.warmupHealthAvg >= 98 ? "#15803D" : w.warmupHealthAvg >= 90 ? "#D97706" : "#B91C1C" },
          { label: "Reply rate",
            value: w.totalSent === 0 ? "—" : `${w.avgReplyRate.toFixed(1)}%`,
            color: w.totalSent === 0      ? "#9ca3af"
                 : w.avgReplyRate >= 1    ? "#15803D"
                 : w.avgReplyRate >= 0.5  ? "#D97706"
                                          : "#B91C1C" },
          { label: "Burn rate",
            value: w.totalSent === 0 ? "—" : `${w.burnPct.toFixed(1)}%`,
            color: w.totalSent === 0   ? "#9ca3af"
                 : w.burnPct <= 0.25   ? "#15803D"
                 : w.burnPct <= 0.5    ? "#D97706"
                                       : "#B91C1C" },
        ].map(s => (
          <div key={s.label}>
            <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>{s.label}</p>
            <p style={{ fontSize: 14, fontWeight: 500, color: s.color ?? "#111827" }}>{s.value}</p>
          </div>
        ))}
      </div>
      {/* Single horizontal bar = today's schedule vs active capacity.
          paddingRight reserves space so the percent text doesn't run
          under the absolutely-positioned "→" affordance bottom-right. */}
      <div style={{ marginTop: 12, paddingRight: 18 }}>
        <CapacityBar active={w.active} scheduledToday={w.scheduledToday} compact />
      </div>
      <span style={{ position: "absolute", bottom: 12, right: 14, fontSize: 11, color: "#9ca3af" }}>→</span>
    </div>
  );
}

// ── Sender table (level 2) ────────────────────────────────────────────

type Tab = "active" | "warming_only";

interface DomainGroup {
  domain:        string;
  senders:       Sender[];
  disconnected:  number;
  notWarming:    number;
  warmingOnly:   number;
  avgScore:      number | null;
  lowHealth:     boolean;
  attachedMin:   number;
  attachedMax:   number;
  totalSent:     number;
  totalReplies:  number;
  totalBounces:  number;
  totalBurns:    number;
  replyRate:     number;
  bounceRate:    number;
  burnRate:      number;
  accStatus:     string;
  worstSev:      number;
  fullyDisconnected: boolean;
  mxMissing:     boolean;
  // ANY sender on this domain has a burn rate at/above 0.5% or a recorded
  // burn event. Per operator rule, one burned sender taints the domain,
  // so this binary flag drives the domain badge and sort priority — it
  // is NOT smoothed by the domain-aggregate burn rate.
  anyBurnFlagged: boolean;
}

function SenderTable({
  ws, senders, days, mxMissingDomains, thresholds, onBack, onActionDone, refresh,
}: {
  ws: Workspace;
  senders: Sender[];
  days: number;
  mxMissingDomains: Set<string>;
  thresholds: { criticalMinSend: number; provisionalFloor: number };
  onBack: () => void;
  onActionDone: (msg: string, type: "success" | "error") => void;
  refresh: () => void;
}) {
  const workspaces = useWorkspaces();
  const name = findWorkspace(workspaces, ws.slug).name !== "Unknown"
    ? findWorkspace(workspaces, ws.slug).name
    : ws.slug;
  const [tab, setTab] = useState<Tab>("active");
  const [actionMap, setActionMap] = useState<Record<string, "attach_to_all" | "pause_outbound_and_warmup" | "enable_warmup" | null>>({});
  const [domainAction, setDomainAction] = useState<Record<string, "enable_warmup" | "pause_outbound" | "attach_to_all" | null>>({});
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);

  const isDisconnected = (s: Sender) => s.conn_status === "Not connected";
  // Warming-only includes senders that are unattached (attached=0) AND
  // senders we've paused via the throttle action (warming_since != null).
  // The latter stay attached for follow-up continuity but should not show
  // up as "Active".
  const isWarmingOnly  = (s: Sender) => !isDisconnected(s) && ((s.attached_campaigns_count ?? 0) === 0 || s.warming_since != null);
  const isNotWarming   = (s: Sender) => !isDisconnected(s) && !s.warmup_enabled;

  // Domain-level batch (calls the atomic /api/account-monitor/domain-batch).
  async function runDomainBatch(domain: string, dSenders: Sender[], action: "enable_warmup" | "pause_outbound" | "attach_to_all") {
    setDomainAction(prev => ({ ...prev, [domain]: action }));
    const reachable = dSenders.filter(s => s.conn_status !== "Not connected");
    const targets =
      action === "enable_warmup" ? reachable.filter(s => !s.warmup_enabled) :
      action === "pause_outbound" ? reachable.filter(s => (s.attached_campaigns_count ?? 0) > 0 && s.warming_since == null) :
                                     reachable;
    if (targets.length === 0) {
      onActionDone(`No senders in ${domain} match this action.`, "error");
      setDomainAction(prev => ({ ...prev, [domain]: null }));
      return;
    }
    const senderIds = targets.map(s => s.eb_sender_id).filter((n): n is number => typeof n === "number");
    if (senderIds.length === 0) {
      onActionDone(`No EB sender IDs for ${domain}.`, "error");
      setDomainAction(prev => ({ ...prev, [domain]: null }));
      return;
    }
    const senderAction =
      action === "enable_warmup" ? "enable_warmup" :
      action === "attach_to_all" ? "attach_to_all" :
                                    "pause_outbound_and_warmup";
    const verb =
      action === "enable_warmup" ? "Enabling warmup" :
      action === "attach_to_all" ? "Adding to campaigns" :
                                    "Pausing outbound";
    onActionDone(`${verb} on ${targets.length} sender(s) in ${domain}…`, "success");
    try {
      const res = await fetch("/api/account-monitor/domain-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_slug: targets[0].workspace_slug,
          sender_ids:     senderIds,
          action:         senderAction,
        }),
      });
      const j = await res.json();
      if (!res.ok) onActionDone(j.error ?? "Batch failed", "error");
      else if (!j.ok) onActionDone(`${domain}: partial${j.stragglers ? ` · ${j.stragglers} stragglers` : ""}.`, "error");
      else onActionDone(`${domain}: ${senderIds.length} sender(s) processed, ${j.campaigns ?? 0} campaign(s) touched.`, "success");
    } catch (err: any) {
      onActionDone(err.message ?? "Network error", "error");
    }
    setDomainAction(prev => ({ ...prev, [domain]: null }));
    setTimeout(() => refresh(), 1500);
  }

  async function runSenderAction(s: Sender, action: "attach_to_all" | "pause_outbound_and_warmup" | "enable_warmup") {
    setActionMap(prev => ({ ...prev, [s.email]: action }));
    try {
      const res = await fetch("/api/account-monitor/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_email: s.email,
          workspace_slug: s.workspace_slug,
          sender_id: s.eb_sender_id,
          action,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) onActionDone(j.error ?? "Action failed", "error");
      else {
        const verb =
          action === "attach_to_all"            ? `${j.campaigns_affected ?? 0} campaign(s) attached` :
          action === "pause_outbound_and_warmup" ? "throttled to 1/day + warmup" :
                                                    "warmup enabled";
        onActionDone(`${s.email}: ${verb}.`, j.failed > 0 ? "error" : "success");
      }
      setTimeout(() => refresh(), 4000);
    } catch (err: any) {
      onActionDone(err.message ?? "Network error", "error");
    } finally {
      setActionMap(prev => ({ ...prev, [s.email]: null }));
    }
  }

  // Tab filter: Active = attached>0 AND not paused. Warming-only = either
  // unattached or paused (warming_since != null) via the throttle action.
  const filtered = senders.filter(s => {
    const paused = s.warming_since != null;
    const attached = (s.attached_campaigns_count ?? 0) > 0;
    if (tab === "warming_only") return !attached || paused;
    return attached && !paused;
  });

  // Domain grouping.
  const domainMap: Record<string, Sender[]> = {};
  for (const s of filtered) {
    const dom = s.email.split("@")[1] ?? "unknown";
    (domainMap[dom] ??= []).push(s);
  }
  const domainGroups: DomainGroup[] = Object.entries(domainMap).map(([dom, list]) => {
    const reachable = list.filter(s => !isDisconnected(s));
    const scored = reachable.filter(s => typeof s.warmup_score === "number" && (s.warmup_score as number) > 0);
    const avg = scored.length > 0
      ? Math.round(scored.reduce((a, s) => a + (s.warmup_score as number), 0) / scored.length * 10) / 10
      : null;
    const disconnected = list.filter(isDisconnected).length;
    const notWarming   = list.filter(isNotWarming).length;
    const hasActive    = list.some(s => (s.attached_campaigns_count ?? 0) > 0);
    const lowHealth    = hasActive && avg !== null && avg < 98;
    const worstSev     = disconnected > 0 ? 0 : notWarming > 0 ? 1 : lowHealth ? 2 : 3;
    const attached     = reachable.map(s => s.attached_campaigns_count ?? 0);
    const attachedMin  = attached.length > 0 ? Math.min(...attached) : 0;
    const attachedMax  = attached.length > 0 ? Math.max(...attached) : 0;
    const totalSent    = list.reduce((a, s) => a + (s.emails_sent || 0), 0);
    const totalReplies = list.reduce((a, s) => a + (s.replies || 0), 0);
    const totalBounces = list.reduce((a, s) => a + (s.bounces || 0), 0);
    const totalBurns   = list.reduce((a, s) => a + (s.burns || 0), 0);
    const replyRate    = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0;
    const bounceRate   = totalSent > 0 ? (totalBounces / totalSent) * 100 : 0;
    const burnRate     = totalSent > 0 ? (totalBurns   / totalSent) * 100 : 0;
    // Domain accStatus picked from worst sender (account-monitor's tiers
    // are: disconnected > burned > critical_low_replies > list_issue >
    // low_replies > insufficient_data > healthy).
    const tierRank: Record<string, number> = {
      disconnected: 0, burned: 1, critical_low_replies: 2, list_issue: 3,
      low_replies: 4, insufficient_data: 5, healthy: 6,
    };
    const accStatus = list
      .map(s => s.acc_status || "insufficient_data")
      .sort((a, b) => (tierRank[a] ?? 7) - (tierRank[b] ?? 7))[0] ?? "insufficient_data";

    // Sender severity tier — mirrors senderStatusBadge priority so the
    // sort order matches the Status pill the operator sees. Lower = worse.
    // Reply-rate problems rank above bounce/list_issue: reply rate is the
    // metric we optimise for, so it triages ahead of list cleanliness.
    //   0 Disconnected   1 MX missing      2 Burned
    //   3 Not warming    4 Critical reply  5 Low reply
    //   6 List issue     7 No data         8 Healthy
    const senderSeverity = (s: Sender, mxMissing: boolean): number => {
      if (isDisconnected(s))                       return 0;
      if (mxMissing)                               return 1;
      if (s.acc_status === "burned")               return 2;
      if (isNotWarming(s))                         return 3;
      if (s.acc_status === "critical_low_replies") return 4;
      if (s.acc_status === "low_replies")          return 5;
      if (s.acc_status === "list_issue")           return 6;
      if (s.acc_status === "insufficient_data")    return 7;
      return 8;
    };
    const domMxMissing = mxMissingDomains.has(dom);
    const sortedList = [...list].sort((a, b) => {
      const sa = senderSeverity(a, domMxMissing);
      const sb = senderSeverity(b, domMxMissing);
      if (sa !== sb) return sa - sb;
      // Within a tier, worst reply rate first — reply is the optimisation
      // metric, so a Healthy sender at 1.1% should sit above one at 5%.
      if ((a.reply_rate ?? 0) !== (b.reply_rate ?? 0)) {
        return (a.reply_rate ?? 0) - (b.reply_rate ?? 0);
      }
      return (b.emails_sent ?? 0) - (a.emails_sent ?? 0);
    });

    const anyBurnFlagged = list.some(s => (s.burn_rate ?? 0) >= 0.5 || (s.burns ?? 0) > 0);

    return {
      domain: dom, senders: sortedList, disconnected, notWarming,
      warmingOnly: list.filter(isWarmingOnly).length,
      avgScore: avg, lowHealth, attachedMin, attachedMax,
      totalSent, totalReplies, totalBounces, totalBurns,
      replyRate, bounceRate, burnRate,
      accStatus, worstSev,
      fullyDisconnected: disconnected === list.length && list.length > 0,
      mxMissing: mxMissingDomains.has(dom),
      anyBurnFlagged,
    };
  }).sort((a, b) => {
    // Domain severity tier — mirrors domainStatusBadge so sort order
    // matches the Status pill the operator sees. Lower = worse.
    //   0 Disconnected     1 MX missing       2 Burned (any sender)
    //   3 Not warming      4 Critical reply   5 Low reply
    //   6 List issue       7 Low health       8 No data    9 Healthy
    const domainSeverity = (d: DomainGroup): number => {
      if (d.disconnected > 0)                      return 0;
      if (d.mxMissing)                             return 1;
      if (d.anyBurnFlagged)                        return 2;
      if (d.notWarming > 0)                        return 3;
      if (d.totalSent >= 200 && d.replyRate < 0.5) return 4;
      if (d.totalSent >=  50 && d.replyRate < 1)   return 5;
      if (d.bounceRate >= 2)                       return 6;
      if (d.avgScore !== null && d.avgScore < 98)  return 7;
      if (d.totalSent === 0)                       return 8;
      return 9;
    };
    const sa = domainSeverity(a);
    const sb = domainSeverity(b);
    if (sa !== sb) return sa - sb;
    // Within a tier, worst reply rate first — reply is the optimisation
    // metric, so the lowest-reply Healthy domain leads the green block.
    if (a.replyRate !== b.replyRate) return a.replyRate - b.replyRate;
    // Volume as the next tiebreaker so equal-reply rows favour the
    // higher-volume one.
    if (b.totalSent !== a.totalSent) return b.totalSent - a.totalSent;
    return a.domain.localeCompare(b.domain);
  });

  // Account-status to badge mapping.
  const accStatusBadge = (status: string) => {
    switch (status) {
      case "burned":               return <PillBadge text="Burned"      tone="red" />;
      case "critical_low_replies": return <PillBadge text="Low reply"   tone="red" />;
      case "list_issue":           return <PillBadge text="List issue"  tone="amber" />;
      case "low_replies":          return <PillBadge text="Low reply"   tone="amber" />;
      case "insufficient_data":    return <PillBadge text="No data"     tone="grey" />;
      case "healthy":              return <PillBadge text="Healthy"     tone="green" />;
      default:                     return <PillBadge text={status}      tone="grey" />;
    }
  };

  // Per-sender Status column. Priority (worst first):
  //   Disconnected > MX missing > Burned > Not warming >
  //   Critical reply > Low reply > List issue > No data > Healthy.
  // Reply problems rank above bounce/list-issue per operator rule: a
  // bad-angle script burns through send budget faster than a list-cleanse
  // does, so it should surface first.
  const senderStatusBadge = (s: Sender, mxMissing: boolean) => {
    if (isDisconnected(s))                       return <PillBadge text="Disconnected" tone="indigo" />;
    if (mxMissing)                               return <PillBadge text="MX missing"   tone="red" />;
    if (s.acc_status === "burned")               return <PillBadge text="Burned"       tone="red" />;
    if (isNotWarming(s))                         return <PillBadge text="Not warming"  tone="red" />;
    if (s.acc_status === "critical_low_replies") return <PillBadge text="Critical reply" tone="red" />;
    if (s.acc_status === "low_replies")          return <PillBadge text="Low reply"    tone="amber" />;
    if (s.acc_status === "list_issue")           return <PillBadge text="List issue"   tone="amber" />;
    if (s.acc_status === "insufficient_data")    return <PillBadge text="No data"      tone="grey" />;
    return <PillBadge text="Healthy" tone="green" />;
  };

  // Domain-level Status column. Per-metric rules:
  //   burn        → ANY sender at/above 0.5% taints the whole domain
  //   bounce      → DOMAIN-AGGREGATE rate (>= 2% = list issue)
  //   reply       → DOMAIN-AGGREGATE rate (main optimisation metric)
  //   warmup      → DOMAIN-AGGREGATE avg score
  // Disconnected / MX-missing / Not-warming remain binary-any-sender.
  // Reply outranks bounce: reply is the optimisation metric, list-issue
  // is amber even when it fires.
  const domainStatusBadge = (d: DomainGroup) => {
    if (d.fullyDisconnected)                     return <PillBadge text="All disconnected" tone="indigo" />;
    if (d.disconnected > 0)                      return <PillBadge text={`${d.disconnected} disconnected`} tone="indigo" />;
    if (d.mxMissing)                             return <PillBadge text="MX missing" tone="red" />;
    if (d.anyBurnFlagged)                        return <PillBadge text="Burned" tone="red" />;
    if (d.notWarming > 0)                        return <PillBadge text={`${d.notWarming} not warming`} tone="red" />;
    // Reply-rate thresholds use the route's scaled minimum sends so the
    // badge behaves consistently across the 24h / 7d / 14d / 30d toggle.
    // Hardcoded 200/50 used to be 7d-only: at 24h a 59-send domain with
    // 0 replies would tip Low reply while a 49-send domain with 0 replies
    // (genuinely the same signal) would fall through to Healthy.
    if (d.totalSent >= thresholds.criticalMinSend  && d.replyRate < 0.5) return <PillBadge text="Critical reply" tone="red" />;
    if (d.totalSent >= thresholds.provisionalFloor && d.replyRate < 1)   return <PillBadge text="Low reply" tone="amber" />;
    if (d.bounceRate >= 2)                                               return <PillBadge text="List issue" tone="amber" />;
    if (d.avgScore !== null && d.avgScore < 98)                          return <PillBadge text="Low health" tone="amber" />;
    if (d.totalSent < thresholds.provisionalFloor)                       return <PillBadge text="No data" tone="grey" />;
    return <PillBadge text="Healthy" tone="green" />;
  };

  return (
    <div>
      <button onClick={onBack}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 12, color: "#6b7280", cursor: "pointer",
          background: "#f8f7f5", border: "0.5px solid #e5e7eb",
          borderRadius: 7, padding: "5px 10px", marginBottom: 16, fontFamily: "inherit",
        }}>
        <ChevronLeft size={13} /> All workspaces
      </button>

      <p style={{ fontSize: 15, fontWeight: 500, color: "#111827", marginBottom: 10 }}>
        {name}, mailbox status
      </p>
      <SummaryPanel totals={aggregateTotals([ws])} days={days} />
      <div style={{ background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
        <CapacityBar active={ws.active} scheduledToday={ws.scheduledToday} />
      </div>
      <DomainStatusStrip totals={aggregateTotals([ws])} />

      <div style={{ display: "flex", gap: 4, marginBottom: 10, borderBottom: "0.5px solid #ede9e3" }}>
        {([
          { key: "active",       label: "Active",       count: ws.active },
          { key: "warming_only", label: "Warming only", count: ws.warmingOnly },
        ] as const).map(t => {
          const selected = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                fontSize: 12, fontWeight: selected ? 600 : 500,
                color: selected ? "#111827" : "#6b7280",
                padding: "8px 14px", background: "transparent", border: "none",
                borderBottom: selected ? "2px solid #111827" : "2px solid transparent",
                cursor: "pointer", fontFamily: "inherit", marginBottom: -1,
              }}>
              {t.label} <span style={{ color: "#9ca3af", fontWeight: 400 }}>({t.count})</span>
            </button>
          );
        })}
      </div>

      <div style={{ background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "#f8f7f5", borderBottom: "0.5px solid #ede9e3" }}>
              {tab === "active" ? [
                { h: "Sender",         w: "21%", align: "left" },
                { h: "Campaigns",      w: "11%", align: "left" },
                { h: "Sends",          w: "7%",  align: "right" },
                { h: "Reply",          w: "7%",  align: "right" },
                { h: "Bounce",         w: "7%",  align: "right" },
                { h: "Burn",           w: "7%",  align: "right" },
                { h: "Warmup health",  w: "9%",  align: "right" },
                { h: "Status",         w: "14%", align: "left" },
                { h: "Action",         w: "17%", align: "center" },
              ].map(({ h, w, align }) => (
                <th key={h} style={{
                  fontSize: 10, fontWeight: 500, color: "#9ca3af",
                  padding: "9px 10px", textAlign: align as any,
                  textTransform: "uppercase", letterSpacing: "0.04em", width: w,
                }}>{h}</th>
              )) : [
                { h: "Sender",        w: "32%", align: "left" },
                { h: "Status",        w: "18%", align: "left" },
                { h: "Warmup",        w: "12%", align: "left" },
                { h: "Days warming",  w: "12%", align: "right" },
                { h: "Health",        w: "10%", align: "right" },
                { h: "Action",        w: "16%", align: "center" },
              ].map(({ h, w, align }) => (
                <th key={h} style={{
                  fontSize: 10, fontWeight: 500, color: "#9ca3af",
                  padding: "9px 10px", textAlign: align as any,
                  textTransform: "uppercase", letterSpacing: "0.04em", width: w,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {domainGroups.length === 0 && (
              <tr><td colSpan={tab === "active" ? 8 : 6} style={{ padding: "30px 16px", textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
                No senders matching this filter.
              </td></tr>
            )}
            {domainGroups.map(d => {
              const isExpanded = expandedDomain === d.domain;
              // Row tint follows the same per-metric rules as the Status
              // pill: burn = any-sender, bounce/reply/warmup = domain-level.
              const domCritReply = d.totalSent >= 200 && d.replyRate < 0.5;
              const domLowReply  = d.totalSent >=  50 && d.replyRate < 1;
              const domListIssue = d.bounceRate >= 2;
              const domLowHealth = d.avgScore !== null && d.avgScore < 98;
              const domBg =
                d.disconnected > 0  ? "#EEF2FF" :
                d.mxMissing         ? "#FCEBEB" :
                d.anyBurnFlagged    ? "#FCEBEB" :
                d.notWarming > 0    ? "#FCEBEB" :
                domCritReply        ? "#FCEBEB" :
                domLowReply         ? "#FEF3C7" :
                domListIssue        ? "#FEF3C7" :
                domLowHealth        ? "#FEF3C7" :
                                      "#fafafa";
              return (
                <Fragment key={d.domain}>
                  {/* Domain header row */}
                  <tr
                    onClick={() => setExpandedDomain(isExpanded ? null : d.domain)}
                    style={{ cursor: "pointer", borderBottom: "0.5px solid #ede9e3", background: domBg }}
                  >
                    <td style={{ padding: "10px 10px", fontWeight: 500, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {d.domain}
                        <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 400 }}>· {d.senders.length} {d.senders.length === 1 ? "sender" : "senders"}</span>
                      </span>
                    </td>
                    {/* Campaigns column. */}
                    <td style={{ padding: "10px 10px" }}>
                      {d.fullyDisconnected ? <PillBadge text="All disconnected" tone="indigo" />
                       : d.disconnected > 0 ? <PillBadge text={`${d.disconnected} disconnected`} tone="indigo" />
                       : tab === "warming_only"
                         ? <PillBadge text="All warming only" tone="amber" />
                         : d.attachedMin === d.attachedMax
                           ? <PillBadge text={`In ${d.attachedMin} ${d.attachedMin === 1 ? "campaign" : "campaigns"}`} tone="green" />
                           : <PillBadge text={`In ${d.attachedMin}-${d.attachedMax} campaigns`} tone="amber" />}
                    </td>
                    {tab === "active" ? (
                      <>
                        <td style={{ padding: "10px 10px", textAlign: "right", color: "#374151", fontVariantNumeric: "tabular-nums" }}>{fmt(d.totalSent)}</td>
                        <td style={{ padding: "10px 10px", textAlign: "right", color: d.replyRate < 1 ? "#B91C1C" : d.replyRate < 2 ? "#D97706" : "#15803D", fontVariantNumeric: "tabular-nums" }}>
                          {pct(d.replyRate)}
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "right", color: d.bounceRate > 2 ? "#B91C1C" : d.bounceRate > 1 ? "#D97706" : "#374151", fontVariantNumeric: "tabular-nums" }}>
                          {pct(d.bounceRate)}
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "right", color: d.burnRate > 0.5 ? "#B91C1C" : d.burnRate > 0.25 ? "#D97706" : "#374151", fontVariantNumeric: "tabular-nums" }}>
                          {pct(d.burnRate)}
                        </td>
                        <td style={{
                          padding: "10px 10px", textAlign: "right",
                          color: d.disconnected > 0 || d.avgScore === null ? "#9ca3af"
                               : d.avgScore >= 98 ? "#15803D"
                               : d.avgScore >= 90 ? "#D97706" : "#B91C1C",
                          fontWeight: 500,
                        }}>{d.disconnected > 0 || d.avgScore === null ? "—" : `${d.avgScore}%`}</td>
                        <td style={{ padding: "10px 10px" }}>
                          {domainStatusBadge(d)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: "10px 10px" }}>
                          <PillBadge text="Warming" tone="green" />
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "right", color: "#374151", fontVariantNumeric: "tabular-nums" }}>
                          {(() => {
                            const days = d.senders.map(s => s.warming_days ?? 0).filter(n => n > 0);
                            if (days.length === 0) return <span style={{ color: "#9ca3af" }}>—</span>;
                            const min = Math.min(...days);
                            const max = Math.max(...days);
                            return min === max ? `${min}d` : `${min}–${max}d`;
                          })()}
                        </td>
                        <td style={{
                          padding: "10px 10px", textAlign: "right",
                          color: d.avgScore === null ? "#9ca3af"
                               : d.avgScore >= 98 ? "#15803D"
                               : d.avgScore >= 90 ? "#D97706" : "#B91C1C",
                          fontWeight: 500,
                        }}>{d.avgScore === null ? "—" : `${d.avgScore}%`}</td>
                      </>
                    )}
                    <td style={{ padding: "10px 10px", textAlign: "center" }} onClick={e => e.stopPropagation()}>
                      {(() => {
                        const acting = domainAction[d.domain];
                        if (d.disconnected > 0) {
                          const wsInfo = findWorkspace(workspaces, ws.slug);
                          const url = wsInfo.instanceUrl ? `${wsInfo.instanceUrl}/sender-emails` : null;
                          return url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" style={{
                              fontSize: 11, padding: "4px 10px", borderRadius: 6,
                              background: "#EEF2FF", color: "#3730A3", border: "0.5px solid #A5B4FC",
                              fontFamily: "inherit", textDecoration: "none",
                              display: "inline-flex", alignItems: "center", gap: 5,
                            }}>Reconnect in EB ({d.disconnected})</a>
                          ) : <span style={{ color: "#3730A3", fontSize: 11, fontWeight: 500 }}>Reconnect in EB</span>;
                        }
                        // MX missing is an operator-only fix (DNS provider),
                        // so we surface a non-actionable label rather than a
                        // button. The Status pill is what flags it; this is
                        // just the matching action prompt.
                        if (d.mxMissing) {
                          return (
                            <span style={{
                              fontSize: 11, padding: "4px 10px", borderRadius: 6,
                              background: "#FEF2F2", color: "#B91C1C", border: "0.5px solid #FCA5A5",
                              fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5,
                            }}>Fix MX in DNS</span>
                          );
                        }
                        if (d.notWarming > 0) {
                          return (
                            <button onClick={() => runDomainBatch(d.domain, d.senders, "enable_warmup")} disabled={!!acting}
                              style={{
                                fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                background: "#EAF3DE", color: "#15803D", border: "0.5px solid #C0DD97",
                                cursor: acting ? "wait" : "pointer", fontFamily: "inherit",
                                display: "inline-flex", alignItems: "center", gap: 5,
                              }}>
                              {acting === "enable_warmup" ? <Loader2 size={11} className="animate-spin" /> : <Flame size={11} />}
                              Enable warmup ({d.notWarming})
                            </button>
                          );
                        }
                        // Pause-outbound (= pause_outbound_and_warmup on the
                        // backend): throttles each sender's daily_limit to 1
                        // AND enables warmup. Senders STAY attached so any
                        // mid-sequence leads keep getting their follow-ups.
                        // Fires when the domain is showing a red
                        // deliverability signal: any-sender burn, any-sender
                        // not-warming, or domain-aggregate Critical reply
                        // (<0.5% on >=200 sends). Low-health warmup also
                        // still triggers it.
                        // NEVER swap this back to a DELETE-from-campaign
                        // action; EB strands lead follow-ups otherwise. See
                        // feedback-never-remove-sender-from-campaign.
                        const domCritReplyAction = d.totalSent >= 200 && d.replyRate < 0.5;
                        const shouldPause = tab === "active" && (
                             d.anyBurnFlagged
                          || domCritReplyAction
                          || (d.avgScore !== null && d.avgScore < 98));
                        if (shouldPause) {
                          const eligible = d.senders.filter(s => !isDisconnected(s) && s.warmup_enabled && (s.attached_campaigns_count ?? 0) > 0 && s.warming_since == null).length;
                          if (eligible > 0) {
                            return (
                              <button onClick={() => runDomainBatch(d.domain, d.senders, "pause_outbound")} disabled={!!acting}
                                style={{
                                  fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                  background: "#FCEBEB", color: "#B91C1C", border: "0.5px solid #F09595",
                                  cursor: acting ? "wait" : "pointer", fontFamily: "inherit",
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                }}>
                                {acting === "pause_outbound" ? <Loader2 size={11} className="animate-spin" /> : <Flame size={11} />}
                                Pause outbound ({eligible})
                              </button>
                            );
                          }
                        }
                        const warmingOnlyCount = d.senders.filter(s => !isDisconnected(s) && ((s.attached_campaigns_count ?? 0) === 0 || s.warming_since != null)).length;
                        if (warmingOnlyCount > 0 && tab === "warming_only") {
                          return (
                            <button onClick={() => runDomainBatch(d.domain, d.senders, "attach_to_all")} disabled={!!acting}
                              style={{
                                fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                background: "#EAF3DE", color: "#15803D", border: "0.5px solid #C0DD97",
                                cursor: acting ? "wait" : "pointer", fontFamily: "inherit",
                                display: "inline-flex", alignItems: "center", gap: 5,
                              }}>
                              {acting === "attach_to_all" ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                              Add to campaigns ({warmingOnlyCount})
                            </button>
                          );
                        }
                        return <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>;
                      })()}
                    </td>
                  </tr>

                  {/* Expanded sender rows */}
                  {isExpanded && d.senders.map(s => {
                    const acting       = actionMap[s.email];
                    const disconnected = isDisconnected(s);
                    const notWarming   = isNotWarming(s);
                    const warmingOnly  = isWarmingOnly(s);
                    // Sender row tint follows the SENDER's own status, not
                      // the domain's worst-sender. Same priority chain as the
                      // Status pill so a healthy peer of a burned sender no
                      // longer looks burned.
                    const senderBg =
                      disconnected                                                    ? "#F5F7FF" :
                      s.acc_status === "burned"                                       ? "#FEF7F7" :
                      notWarming                                                      ? "#FEF7F7" :
                      s.acc_status === "critical_low_replies"                         ? "#FEF7F7" :
                      s.acc_status === "low_replies"                                  ? "#FFFBEB" :
                      s.acc_status === "list_issue"                                   ? "#FFFBEB" :
                      tab === "warming_only" && s.ready_to_rejoin                     ? "#F0FDF4" :
                                                                                        "#ffffff";
                    return (
                      <tr key={d.domain + "::" + s.email} style={{ borderBottom: "0.5px solid #f3f4f6", background: senderBg }}>
                        <td style={{ padding: "8px 10px 8px 36px", color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                          {s.email}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {disconnected
                            ? <PillBadge text="Disconnected" tone="indigo" />
                            : warmingOnly
                              ? (s.ready_to_rejoin
                                  ? <PillBadge text="Ready for outbound" tone="green" />
                                  : <PillBadge text="Warming only" tone="amber" />)
                              : <PillBadge text={`In ${s.attached_campaigns_count} ${s.attached_campaigns_count === 1 ? "campaign" : "campaigns"}`} tone="green" />}
                        </td>
                        {tab === "active" ? (
                          <>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: "#374151", fontVariantNumeric: "tabular-nums" }}>
                              <div>{fmt(s.emails_sent)}</div>
                              {/* Confidence indicator: full / provisional /
                                  insufficient. A 3.0% reply rate on 12 sends
                                  is noise; the badge tells you so. */}
                              <div style={{ fontSize: 9, color: "#9ca3af", marginTop: 1 }}>
                                {s.confidence === "full"        ? "full"
                                 : s.confidence === "provisional" ? "provisional"
                                 :                                  "insufficient"}
                              </div>
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: s.reply_rate < 1 ? "#B91C1C" : s.reply_rate < 2 ? "#D97706" : "#15803D", fontVariantNumeric: "tabular-nums" }}>
                              {s.emails_sent === 0 ? "—" : pct(s.reply_rate)}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: s.bounce_rate > 2 ? "#B91C1C" : s.bounce_rate > 1 ? "#D97706" : "#374151", fontVariantNumeric: "tabular-nums" }}>
                              {s.emails_sent === 0 ? "—" : pct(s.bounce_rate)}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: s.burn_rate > 0.5 ? "#B91C1C" : s.burn_rate > 0.25 ? "#D97706" : "#374151", fontVariantNumeric: "tabular-nums" }}>
                              {s.emails_sent === 0 ? "—" : pct(s.burn_rate)}
                            </td>
                            <td style={{
                              padding: "8px 10px", textAlign: "right",
                              color: s.warmup_score === null || s.warmup_score === 0 ? "#9ca3af"
                                   : s.warmup_score >= 98 ? "#15803D"
                                   : s.warmup_score >= 90 ? "#D97706" : "#B91C1C",
                              fontWeight: 500,
                            }}>
                              {s.warmup_score === null || s.warmup_score === 0 ? "—" : `${Math.round(s.warmup_score)}%`}
                            </td>
                            <td style={{ padding: "8px 10px" }}>
                              {senderStatusBadge(s, d.mxMissing)}
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={{ padding: "8px 10px" }}>
                              {disconnected
                                ? <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>
                                : <PillBadge text="Warming" tone="green" />}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: "#374151", fontVariantNumeric: "tabular-nums" }}>
                              {s.warming_days === null ? "—" : `${s.warming_days}d`}
                            </td>
                            <td style={{
                              padding: "8px 10px", textAlign: "right",
                              color: s.warmup_score === null || s.warmup_score === 0 ? "#9ca3af"
                                   : s.warmup_score >= 98 ? "#15803D"
                                   : s.warmup_score >= 90 ? "#D97706" : "#B91C1C",
                              fontWeight: 500,
                            }}>{s.warmup_score === null || s.warmup_score === 0 ? "—" : `${Math.round(s.warmup_score)}%`}</td>
                          </>
                        )}
                        <td style={{ padding: "8px 10px", textAlign: "center" }}>
                          {disconnected ? (() => {
                            const wsInfo = findWorkspace(workspaces, s.workspace_slug);
                            const url = wsInfo.instanceUrl ? `${wsInfo.instanceUrl}/sender-emails` : null;
                            return url ? (
                              <a href={url} target="_blank" rel="noopener noreferrer" style={{
                                fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                background: "#EEF2FF", color: "#3730A3", border: "0.5px solid #A5B4FC",
                                fontFamily: "inherit", textDecoration: "none",
                                display: "inline-flex", alignItems: "center", gap: 5,
                              }}>Reconnect in EB</a>
                            ) : <span style={{ color: "#3730A3", fontSize: 11, fontWeight: 500 }}>Reconnect in EB</span>;
                          })() : d.mxMissing ? (
                            <span style={{
                              fontSize: 11, padding: "4px 10px", borderRadius: 6,
                              background: "#FEF2F2", color: "#B91C1C", border: "0.5px solid #FCA5A5",
                              fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5,
                            }}>Fix MX in DNS</span>
                          ) : notWarming ? (
                            <button onClick={() => runSenderAction(s, "enable_warmup")} disabled={acting === "enable_warmup"}
                              style={{
                                fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                background: "#EAF3DE", color: "#15803D", border: "0.5px solid #C0DD97",
                                cursor: acting ? "wait" : "pointer", fontFamily: "inherit",
                                display: "inline-flex", alignItems: "center", gap: 5,
                              }}>
                              {acting === "enable_warmup" ? <Loader2 size={11} className="animate-spin" /> : <Flame size={11} />}
                              Enable warmup
                            </button>
                          ) : warmingOnly ? (
                            <button onClick={() => runSenderAction(s, "attach_to_all")} disabled={acting === "attach_to_all"}
                              style={{
                                fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                background: "#EAF3DE", color: "#15803D", border: "0.5px solid #C0DD97",
                                cursor: acting ? "wait" : "pointer", fontFamily: "inherit",
                                display: "inline-flex", alignItems: "center", gap: 5,
                              }}>
                              {acting === "attach_to_all" ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                              Add to campaigns
                            </button>
                          ) : (
                            <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Top-level component ──────────────────────────────────────────────

export function MailboxMonitor() {
  const [data, setData]           = useState<{ workspaces: Workspace[]; senders: Sender[]; lastSynced: string | null; days: number; mxMissingDomains: Set<string>; thresholds: { criticalMinSend: number; provisionalFloor: number } } | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [selected, setSelected]   = useState<Workspace | null>(null);
  const [toast, setToast]         = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [pulling, setPulling]     = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [days, setDays]           = useState<1 | 7 | 14 | 30>(7);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accRes, warmRes, dailyRes] = await Promise.all([
        fetch(`/api/account-monitor?days=${days}`, { cache: "no-store" }),
        fetch("/api/warmup-monitor", { cache: "no-store" }),
        fetch("/api/mailbox-monitor/daily-sends", { cache: "no-store" }),
      ]);
      if (!accRes.ok || !warmRes.ok) {
        const errBody = !accRes.ok ? await accRes.json() : await warmRes.json();
        throw new Error(errBody.error ?? "Failed to load");
      }
      const acc: AccountMonitorResponse = await accRes.json();
      const warm: WarmupResponse        = await warmRes.json();
      // Daily-sends is non-fatal: a slow EB instance can time out without
      // breaking the rest of the dashboard. Missing values render as "—".
      const daily: { workspaces: { slug: string; scheduled_today: number }[] } | null =
        dailyRes.ok ? await dailyRes.json() : null;
      const scheduledBySlug: Record<string, number> = {};
      for (const r of (daily?.workspaces ?? [])) scheduledBySlug[r.slug] = r.scheduled_today;

      // Merge: index account data by sender_email, then walk the
      // warmup-monitor sender list (which is the canonical "every
      // tracked sender" source) and stitch.
      const accByEmail: Record<string, AccountMonitorAccount> = {};
      for (const ws of acc.workspaces) {
        for (const a of ws.accounts) accByEmail[`${ws.slug}::${a.sender_email.toLowerCase()}`] = a;
      }
      const senders: Sender[] = warm.senders.map(s => {
        const a = accByEmail[`${s.workspace_slug}::${s.sender_email.toLowerCase()}`];
        return {
          email:                    s.sender_email,
          workspace_slug:           s.workspace_slug,
          eb_sender_id:             s.eb_sender_id,
          conn_status:              s.conn_status,
          warmup_enabled:           s.warmup_enabled,
          warmup_score:             s.warmup_score,
          warming_since:            s.warming_since,
          warming_days:             s.warming_days,
          ready_to_rejoin:          s.ready_to_rejoin,
          attached_campaigns_count: s.attached_campaigns_count,
          emails_sent:              a?.emails_sent ?? 0,
          replies:                  a?.replies    ?? 0,
          bounces:                  a?.bounces    ?? 0,
          burns:                    a?.burns      ?? 0,
          reply_rate:               a?.reply_rate ?? 0,
          bounce_rate:              a?.bounce_rate ?? 0,
          burn_rate:                a?.burn_rate  ?? 0,
          acc_status:               a?.status     ?? "insufficient_data",
          confidence:               a?.confidence ?? "insufficient",
        };
      });

      const accBySlug: Record<string, AccountMonitorWorkspace> = {};
      for (const ws of acc.workspaces) accBySlug[ws.slug] = ws;

      const mxMissingDomains = new Set(acc.mxMissingDomains ?? []);

      // For each workspace, count unique sender domains that are MX-missing.
      const mxMissingCountBySlug: Record<string, number> = {};
      const domainsBySlug: Record<string, Set<string>> = {};
      for (const s of senders) {
        const dom = s.email.split("@")[1];
        if (!dom) continue;
        (domainsBySlug[s.workspace_slug] ??= new Set()).add(dom);
      }
      for (const [slug, set] of Object.entries(domainsBySlug)) {
        let c = 0;
        for (const d of set) if (mxMissingDomains.has(d)) c++;
        mxMissingCountBySlug[slug] = c;
      }

      const workspaces: Workspace[] = warm.workspaces.map(w => {
        const a = accBySlug[w.slug];
        const sc = a?.statusCounts ?? {};
        return {
          slug:             w.slug,
          total:            w.total,
          active:           w.active,
          warmingOnly:      w.warmingOnly,
          disconnected:     w.disconnected,
          notWarming:       w.notWarming,
          readyToRejoin:    w.readyToRejoin,
          lowHealthDomains: w.lowHealthDomains,
          warmupHealthAvg:  w.warmupHealthAvg,
          totalSent:        a?.totalSent ?? 0,
          totalReplies:     a?.totalReplies ?? 0,
          totalBounces:     a?.totalBounces ?? 0,
          totalBurns:       a?.totalBurns ?? 0,
          avgReplyRate:     a?.avgReplyRate ?? 0,
          bouncePct:        a?.bouncePct ?? 0,
          burnPct:          a?.burnPct ?? 0,
          burnedDomains:        (sc.burned ?? 0),
          criticalDomains:      (sc.critical_low_replies ?? 0),
          listIssueDomains:     (sc.list_issue ?? 0),
          lowReplyDomains:      (sc.low_replies ?? 0),
          insufficientDomains:  (sc.insufficient_data ?? 0),
          healthyDomains:       (sc.healthy ?? 0),
          mxMissingDomains:     mxMissingCountBySlug[w.slug] ?? 0,
          scheduledToday:       scheduledBySlug[w.slug] ?? null,
        };
      }).sort((a, b) => {
        if (b.disconnected !== a.disconnected) return b.disconnected - a.disconnected;
        if (b.mxMissingDomains !== a.mxMissingDomains) return b.mxMissingDomains - a.mxMissingDomains;
        if (b.notWarming !== a.notWarming) return b.notWarming - a.notWarming;
        const aRed = a.burnedDomains + a.criticalDomains + a.lowHealthDomains;
        const bRed = b.burnedDomains + b.criticalDomains + b.lowHealthDomains;
        if (bRed !== aRed) return bRed - aRed;
        return a.slug.localeCompare(b.slug);
      });

      // Pluck the scaled volume thresholds the route already computed for
      // this window. The client uses them to gate Low/Critical-reply
      // domain badges so the badges scale with the days toggle instead of
      // sitting on hardcoded 7d numbers (50 / 200) that mis-flag 24h /
      // misses on 30d.
      const th = acc.thresholds ?? {};
      const thresholds = {
        criticalMinSend:  Number(th.criticalMinSend  ?? 200),
        provisionalFloor: Number(th.provisionalFloor ?? 20),
      };
      setData({ workspaces, senders, lastSynced: acc.lastSynced, days: acc.days, mxMissingDomains, thresholds });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // One-click "ensure every active sender is in every active campaign".
  // Same endpoint as the Warmup Monitor's "Sync all to campaigns" — the
  // guard there skips senders on domains with a peer currently warming,
  // so paused-on-purpose mailboxes are not re-attached.
  const syncAllToCampaigns = useCallback(async () => {
    if (syncing) return;
    const ok = window.confirm(
      "This will attach every active, warmup-enabled, connected sender to every active campaign across all workspaces. Warming-only senders are skipped. Continue?"
    );
    if (!ok) return;
    setSyncing(true);
    setToast({ msg: "Syncing active senders to active campaigns…", type: "success" });
    try {
      const res = await fetch("/api/warmup-monitor/sync-campaigns", { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setToast({ msg: j.error ?? "Sync failed", type: "error" });
        return;
      }
      const errCount = (j.workspaces ?? []).reduce((acc: number, w: any) => acc + (w.errors?.length ?? 0), 0);
      setToast({
        msg: `Synced ${j.total_attached} new attachment(s) across ${j.workspaces?.length ?? 0} workspaces${errCount > 0 ? ` · ${errCount} error(s)` : ""}.`,
        type: errCount > 0 ? "error" : "success",
      });
      load();
    } catch (err: any) {
      setToast({ msg: err.message ?? "Network error", type: "error" });
    } finally {
      setSyncing(false);
    }
  }, [syncing, load]);

  const pullFromEB = useCallback(async (slug?: string) => {
    if (pulling) return;
    setPulling(true);
    setToast({ msg: slug ? `Syncing ${slug}…` : "Syncing all workspaces from EB (1-5 min)…", type: "success" });
    try {
      const url = slug ? `/api/sync-sender-accounts?workspace=${encodeURIComponent(slug)}` : "/api/sync-sender-accounts";
      const res = await fetch(url, { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.ok) setToast({ msg: j.error ?? "Sync failed", type: "error" });
      else setToast({ msg: `Synced ${j.synced ?? 0} workspace(s)${(j.failed ?? 0) > 0 ? ` · ${j.failed} failed` : ""}.`, type: (j.failed ?? 0) > 0 ? "error" : "success" });
      load();
    } catch (err: any) {
      setToast({ msg: err.message ?? "Network error", type: "error" });
    } finally {
      setPulling(false);
    }
  }, [pulling, load]);

  const selectedSenders = (data && selected)
    ? data.senders.filter(s => s.workspace_slug === selected.slug)
    : [];

  // When days changes (or refresh fires), `data` updates but `selected`
  // still points at the Workspace object captured at click time. Re-sync
  // it from the fresh `data.workspaces` so the drill-down SummaryPanel /
  // CapacityBar / DomainStatusStrip reflect the new window's totals.
  // Without this, switching 7d → 24h leaves the top stats stuck on the
  // 7d snapshot while only the per-domain rows update.
  useEffect(() => {
    if (!data || !selected) return;
    const fresh = data.workspaces.find(w => w.slug === selected.slug);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [data, selected]);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20, fontFamily: "inherit", color: "#111827", background: "#f8f7f5" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: 18, fontWeight: 600 }}>Account Monitor</p>
          {data?.lastSynced && (
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
              Last synced {new Date(data.lastSynced).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Days range toggle — affects sends/reply/bounce/burn windows
              from /api/account-monitor only. Warmup health is a current
              snapshot from EB so the toggle does not change it. */}
          <div style={{ display: "inline-flex", border: "0.5px solid #d1d5db", borderRadius: 7, overflow: "hidden" }}>
            {/* 24h sits on the left as the freshest read; useful for
                pattern / trajectory checks day over day. The route
                scales its volume thresholds by days/7 so a 24h view
                has tighter minimums before flagging tiers. */}
            {([
              { v: 1,  label: "24h" },
              { v: 7,  label: "7d"  },
              { v: 14, label: "14d" },
              { v: 30, label: "30d" },
            ] as const).map((opt, i, arr) => (
              <button key={opt.v}
                onClick={() => setDays(opt.v)}
                disabled={loading}
                style={{
                  fontSize: 11, padding: "6px 10px", fontFamily: "inherit",
                  background: days === opt.v ? "#111827" : "#ffffff",
                  color: days === opt.v ? "#ffffff" : "#374151",
                  border: "none", cursor: "pointer",
                  borderRight: i === arr.length - 1 ? "none" : "0.5px solid #d1d5db",
                }}>
                {opt.label}
              </button>
            ))}
          </div>
          <button onClick={syncAllToCampaigns} disabled={syncing || loading}
            title="Ensure every active sender is in every active campaign across all workspaces"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#15803D",
              background: "#EAF3DE", border: "0.5px solid #C0DD97", borderRadius: 7,
              padding: "6px 12px", cursor: syncing ? "wait" : "pointer", fontFamily: "inherit",
            }}>
            {syncing ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Sync all to campaigns
          </button>
          <button onClick={() => pullFromEB(selected?.slug)} disabled={pulling || loading}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#3730A3",
              background: "#EEF2FF", border: "0.5px solid #A5B4FC", borderRadius: 7,
              padding: "6px 12px", cursor: pulling ? "wait" : "pointer", fontFamily: "inherit",
            }}>
            {pulling ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {selected ? "Sync this workspace from EB" : "Sync all from EB"}
          </button>
          <button onClick={load} disabled={loading}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#374151",
              background: "#ffffff", border: "0.5px solid #d1d5db", borderRadius: 7,
              padding: "6px 12px", cursor: "pointer", fontFamily: "inherit",
            }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "#dc2626", background: "#fee2e2", padding: "10px 14px", borderRadius: 8, marginBottom: 16 }}>{error}</div>
      )}

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 60, justifyContent: "center" }}>
          <Loader2 size={16} className="animate-spin" style={{ color: "#9ca3af" }} />
          <span style={{ fontSize: 12, color: "#9ca3af" }}>Loading mailbox data…</span>
        </div>
      )}

      {!loading && data && selected && (
        <SenderTable
          ws={selected}
          senders={selectedSenders}
          days={data.days}
          mxMissingDomains={data.mxMissingDomains}
          thresholds={data.thresholds}
          onBack={() => setSelected(null)}
          onActionDone={(msg, type) => setToast({ msg, type })}
          refresh={load}
        />
      )}

      {!loading && data && !selected && data.workspaces.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 13 }}>
          No active workspaces.
        </div>
      )}

      {!loading && data && !selected && data.workspaces.length > 0 && (
        <>
          <SummaryPanel totals={aggregateTotals(data.workspaces)} days={data.days} />
          <div style={{ background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
            <CapacityBar
              active={aggregateTotals(data.workspaces).active}
              scheduledToday={aggregateTotals(data.workspaces).scheduledToday}
            />
          </div>
          <DomainStatusStrip totals={aggregateTotals(data.workspaces)} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {data.workspaces.map(w => (
              <WorkspaceCard key={w.slug} w={w} onClick={() => setSelected(w)} />
            ))}
          </div>
        </>
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, padding: "10px 14px",
          background: toast.type === "error" ? "#FCEBEB" : "#EAF3DE",
          color: toast.type === "error" ? "#B91C1C" : "#15803D",
          border: `0.5px solid ${toast.type === "error" ? "#F09595" : "#C0DD97"}`,
          borderRadius: 8, fontSize: 12, fontWeight: 500, maxWidth: 400,
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        }}>{toast.msg}</div>
      )}
    </div>
  );
}
