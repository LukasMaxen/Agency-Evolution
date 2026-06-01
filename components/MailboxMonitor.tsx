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
//   "Today  ████████░░  2,000 / 2,300  (87%)"
// Active capacity = active × 20 (EB's safe per-mailbox cap). The fill
// shows scheduled-today against that ceiling so the operator sees how
// full the workspace is at a glance — green for headroom, amber close
// to the cap, red past it. Used both per-card and as the page-level
// summary so the same shape works everywhere.
function CapacityBar({ active, scheduledToday, compact }: {
  active: number; scheduledToday: number | null; compact?: boolean;
}) {
  const cap = active * DAILY_CAP_PER_SENDER;
  const sched = scheduledToday ?? 0;
  const pct = cap > 0 && scheduledToday !== null ? Math.min(100, (sched / cap) * 100) : 0;
  const over = scheduledToday !== null && sched > cap;
  // Colour bands match the rest of the dashboard:
  //   <80% room to grow      green
  //   80-99% near capacity   amber
  //   >=100% over capacity   red (senders carrying >20/day)
  const fillColor = scheduledToday === null ? "#d1d5db"
                  : over                    ? "#B91C1C"
                  : pct >= 80               ? "#D97706"
                  :                           "#15803D";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: compact ? 8 : 10, fontSize: compact ? 10 : 11, color: "#6b7280" }}>
      <span style={{ color: "#9ca3af", fontWeight: 500, minWidth: 38 }}>Today</span>
      <div style={{
        flex: 1, height: compact ? 5 : 6, background: "#f3f4f6",
        borderRadius: 99, overflow: "hidden", position: "relative",
      }}>
        <div style={{
          width: `${pct}%`, height: "100%", background: fillColor,
          transition: "width 0.3s ease",
        }} />
      </div>
      <span style={{ color: scheduledToday === null ? "#9ca3af" : over ? "#B91C1C" : "#111827", fontWeight: 500, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {scheduledToday === null ? "—" : fmt(sched)}
        <span style={{ color: "#9ca3af", fontWeight: 400 }}> / {fmt(cap)}</span>
      </span>
      <span style={{ color: "#9ca3af", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "right" }}>
        {scheduledToday === null ? "" : `${Math.round((sched / Math.max(cap, 1)) * 100)}%`}
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
  const replyColor  = totals.totalSent === 0      ? "#9ca3af"
                    : totals.replyRate >= 2       ? "#15803D"
                    : totals.replyRate >= 1       ? "#D97706"
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          { label: "Total senders", value: fmt(w.total) },
          { label: "Active",        value: fmt(w.active) },
          { label: "Warming only",  value: fmt(w.warmingOnly) },
          { label: "Warmup health", value: w.warmupHealthAvg !== null ? `${w.warmupHealthAvg}%` : "—",
            color: w.warmupHealthAvg === null ? "#9ca3af" : w.warmupHealthAvg >= 98 ? "#15803D" : w.warmupHealthAvg >= 90 ? "#D97706" : "#B91C1C" },
        ].map(s => (
          <div key={s.label}>
            <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>{s.label}</p>
            <p style={{ fontSize: 14, fontWeight: 500, color: s.color ?? "#111827" }}>{s.value}</p>
          </div>
        ))}
      </div>
      {/* Single horizontal bar = today's schedule vs active capacity.
          Reads at-a-glance: green if there's headroom, amber near the
          cap, red if scheduled > active × 20 (senders carrying too much). */}
      <div style={{ marginTop: 12 }}>
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
  replyRate:     number;
  bounceRate:    number;
  accStatus:     string;
  worstSev:      number;
  fullyDisconnected: boolean;
}

function SenderTable({
  ws, senders, days, onBack, onActionDone, refresh,
}: {
  ws: Workspace;
  senders: Sender[];
  days: number;
  onBack: () => void;
  onActionDone: (msg: string, type: "success" | "error") => void;
  refresh: () => void;
}) {
  const workspaces = useWorkspaces();
  const name = findWorkspace(workspaces, ws.slug).name !== "Unknown"
    ? findWorkspace(workspaces, ws.slug).name
    : ws.slug;
  const [tab, setTab] = useState<Tab>("active");
  const [actionMap, setActionMap] = useState<Record<string, "attach_to_all" | "remove_and_warmup" | "enable_warmup" | null>>({});
  const [domainAction, setDomainAction] = useState<Record<string, "enable_warmup" | "pause_outbound" | "attach_to_all" | null>>({});
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);

  const isDisconnected = (s: Sender) => s.conn_status === "Not connected";
  const isWarmingOnly  = (s: Sender) => !isDisconnected(s) && (s.attached_campaigns_count ?? 0) === 0;
  const isNotWarming   = (s: Sender) => !isDisconnected(s) && !s.warmup_enabled;

  // Domain-level batch (calls the atomic /api/account-monitor/domain-batch).
  async function runDomainBatch(domain: string, dSenders: Sender[], action: "enable_warmup" | "pause_outbound" | "attach_to_all") {
    setDomainAction(prev => ({ ...prev, [domain]: action }));
    const reachable = dSenders.filter(s => s.conn_status !== "Not connected");
    const targets =
      action === "enable_warmup" ? reachable.filter(s => !s.warmup_enabled) : reachable;
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
                                    "remove_and_warmup";
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

  async function runSenderAction(s: Sender, action: "attach_to_all" | "remove_and_warmup" | "enable_warmup") {
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
      else onActionDone(`${s.email}: ${j.campaigns_affected ?? 0} campaign(s) ${action === "attach_to_all" ? "attached" : "removed"}.`, j.failed > 0 ? "error" : "success");
      setTimeout(() => refresh(), 4000);
    } catch (err: any) {
      onActionDone(err.message ?? "Network error", "error");
    } finally {
      setActionMap(prev => ({ ...prev, [s.email]: null }));
    }
  }

  // Tab filter: Active = attached>0, Warming-only = attached=0.
  const filtered = senders.filter(s => {
    if (tab === "warming_only") return (s.attached_campaigns_count ?? 0) === 0;
    return (s.attached_campaigns_count ?? 0) > 0;
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
    const replyRate    = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0;
    const bounceRate   = totalSent > 0 ? (totalBounces / totalSent) * 100 : 0;
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
    return {
      domain: dom, senders: list, disconnected, notWarming,
      warmingOnly: list.filter(isWarmingOnly).length,
      avgScore: avg, lowHealth, attachedMin, attachedMax,
      totalSent, totalReplies, totalBounces, replyRate, bounceRate,
      accStatus, worstSev,
      fullyDisconnected: disconnected === list.length && list.length > 0,
    };
  }).sort((a, b) => {
    if (a.worstSev !== b.worstSev) return a.worstSev - b.worstSev;
    if (b.disconnected !== a.disconnected) return b.disconnected - a.disconnected;
    if (b.notWarming !== a.notWarming) return b.notWarming - a.notWarming;
    const avgA = a.avgScore ?? 101;
    const avgB = b.avgScore ?? 101;
    if (avgA !== avgB) return avgA - avgB;
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
                { h: "Sender",          w: "26%", align: "left" },
                { h: "Status",          w: "13%", align: "left" },
                { h: "Sends",           w: "9%",  align: "right" },
                { h: "Reply",           w: "9%",  align: "right" },
                { h: "Bounce",          w: "9%",  align: "right" },
                { h: "Warmup",          w: "10%", align: "left" },
                { h: "Health",          w: "9%",  align: "right" },
                { h: "Action",          w: "15%", align: "center" },
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
              const domBg =
                d.disconnected > 0          ? "#EEF2FF" :
                d.notWarming > 0            ? "#FCEBEB" :
                d.accStatus === "burned" || d.accStatus === "critical_low_replies" ? "#FCEBEB" :
                d.lowHealth                  ? "#FEF3C7" :
                d.accStatus === "list_issue" || d.accStatus === "low_replies" ? "#FEF3C7" :
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
                    {/* Status column: same logic in both tabs. */}
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
                        <td style={{ padding: "10px 10px" }}>
                          {d.disconnected > 0 ? <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>
                           : d.notWarming > 0 ? <PillBadge text={`${d.notWarming} not warming`} tone="red" />
                           : d.lowHealth ? <PillBadge text="Low health" tone="red" />
                           : <PillBadge text="Warming" tone="green" />}
                        </td>
                        <td style={{
                          padding: "10px 10px", textAlign: "right",
                          color: d.disconnected > 0 || d.avgScore === null ? "#9ca3af"
                               : d.avgScore >= 98 ? "#15803D"
                               : d.avgScore >= 90 ? "#D97706" : "#B91C1C",
                          fontWeight: 500,
                        }}>{d.disconnected > 0 || d.avgScore === null ? "—" : `${d.avgScore}%`}</td>
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
                        // Pause-outbound: triggers on domain low-health OR
                        // burned / critical_low_replies account status.
                        const shouldPause = tab === "active" && (d.lowHealth
                          || d.accStatus === "burned" || d.accStatus === "critical_low_replies");
                        if (shouldPause) {
                          const eligible = d.senders.filter(s => !isDisconnected(s) && s.warmup_enabled && (s.attached_campaigns_count ?? 0) > 0).length;
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
                        const warmingOnlyCount = d.senders.filter(s => !isDisconnected(s) && (s.attached_campaigns_count ?? 0) === 0).length;
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
                    const senderBg =
                      disconnected               ? "#F5F7FF" :
                      notWarming                 ? "#FEF7F7" :
                      d.lowHealth                ? "#FFFBEB" :
                      d.accStatus === "burned" || d.accStatus === "critical_low_replies" ? "#FEF7F7" :
                      d.accStatus === "list_issue" || d.accStatus === "low_replies" ? "#FFFBEB" :
                      tab === "warming_only" && s.ready_to_rejoin ? "#F0FDF4" :
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
                            <td style={{ padding: "8px 10px" }}>
                              {disconnected
                                ? <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>
                                : notWarming
                                  ? <PillBadge text="Not warming" tone="red" />
                                  : <PillBadge text="Warming" tone="green" />}
                            </td>
                            <td style={{
                              padding: "8px 10px", textAlign: "right",
                              color: s.warmup_score === null || s.warmup_score === 0 ? "#9ca3af"
                                   : s.warmup_score >= 98 ? "#15803D"
                                   : s.warmup_score >= 90 ? "#D97706" : "#B91C1C",
                              fontWeight: 500,
                            }}>
                              <div>{s.warmup_score === null || s.warmup_score === 0 ? "—" : `${Math.round(s.warmup_score)}%`}</div>
                              {/* Per-sender account status (from /api/account-monitor):
                                  Healthy / Burned / Critical / List issue / Low reply / No data.
                                  Lets the operator spot the one bad sender in
                                  a mostly-healthy domain bundle. */}
                              <div style={{ marginTop: 2 }}>{accStatusBadge(s.acc_status)}</div>
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
                          })() : notWarming ? (
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
  const [data, setData]           = useState<{ workspaces: Workspace[]; senders: Sender[]; lastSynced: string | null; days: number } | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [selected, setSelected]   = useState<Workspace | null>(null);
  const [toast, setToast]         = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [pulling, setPulling]     = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [days, setDays]           = useState<7 | 14 | 30>(7);

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
          scheduledToday:       scheduledBySlug[w.slug] ?? null,
        };
      }).sort((a, b) => {
        if (b.disconnected !== a.disconnected) return b.disconnected - a.disconnected;
        if (b.notWarming !== a.notWarming) return b.notWarming - a.notWarming;
        const aRed = a.burnedDomains + a.criticalDomains + a.lowHealthDomains;
        const bRed = b.burnedDomains + b.criticalDomains + b.lowHealthDomains;
        if (bRed !== aRed) return bRed - aRed;
        return a.slug.localeCompare(b.slug);
      });

      setData({ workspaces, senders, lastSynced: acc.lastSynced, days: acc.days });
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
            {[7, 14, 30].map(d => (
              <button key={d}
                onClick={() => setDays(d as 7 | 14 | 30)}
                disabled={loading}
                style={{
                  fontSize: 11, padding: "6px 10px", fontFamily: "inherit",
                  background: days === d ? "#111827" : "#ffffff",
                  color: days === d ? "#ffffff" : "#374151",
                  border: "none", cursor: "pointer",
                  borderRight: d === 30 ? "none" : "0.5px solid #d1d5db",
                }}>
                {d}d
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
