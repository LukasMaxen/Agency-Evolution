"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import {
  RefreshCw, Loader2, Flame, ChevronLeft, ChevronUp, ChevronDown, Plus, WifiOff,
} from "lucide-react";
import { useWorkspaces, findWorkspace } from "@/lib/workspaces-context";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Sender {
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

interface Summary {
  totalSenders:     number;
  notWarming:       number;
  warmingOnly:      number;
  readyToRejoin:    number;
  lowHealthDomains: number;
  warmupHealthAvg:  number | null;
}

interface WsAgg {
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

interface WarmupData {
  senders:    Sender[];
  summary:    Summary;
  workspaces: WsAgg[];
  thresholds: { readyDays: number; churnWindowDays: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveWsName(workspaces: ReturnType<typeof useWorkspaces>, slug: string): string {
  return findWorkspace(workspaces, slug).name !== "Unknown"
    ? findWorkspace(workspaces, slug).name
    : slug;
}

function SummaryCard({ label, value, color, sub }: { label: string; value: number | string; color?: string; sub?: string }) {
  return (
    <div style={{ background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 12, padding: "12px 16px" }}>
      <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 500, color: color ?? "#111827" }}>
        {value}
        {sub && <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>{sub}</span>}
      </p>
    </div>
  );
}

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

// ── Workspace card (Level 1) ─────────────────────────────────────────────────

function WorkspaceCard({ w, onClick }: { w: WsAgg; onClick: () => void }) {
  const workspaces = useWorkspaces();
  const name = resolveWsName(workspaces, w.slug);

  // Border severity:
  //   red   if any sender is not warming or warmup health is below the cutoff
  //   amber if any sender is ready to rejoin (lifecycle action needed)
  //   green otherwise
  // Severity ranking matches Domain Monitor: disconnected outranks every
  // other state (mailbox is unreachable, warmup/health flags are moot
  // until the operator reconnects in EmailBison).
  const accent =
    w.disconnected > 0                      ? "#6366F1" :
    (w.notWarming + w.lowHealthDomains) > 0 ? "#E24B4A" :
    w.readyToRejoin > 0                     ? "#F59E0B" :
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
          {/* Disconnected is exclusive: when any sender is unreachable,
              warmup/health/ready states are stale or unactionable so we
              hide every other badge and just surface the Reconnect signal. */}
          {w.disconnected > 0 ? (
            <PillBadge text={`${w.disconnected} disconnected`} tone="indigo" />
          ) : (
            <>
              {w.notWarming       > 0 && <PillBadge text={`${w.notWarming} not warming`}                                                     tone="red" />}
              {w.lowHealthDomains > 0 && <PillBadge text={`${w.lowHealthDomains} low-health ${w.lowHealthDomains === 1 ? "domain" : "domains"}`} tone="red" />}
              {w.readyToRejoin    > 0 && <PillBadge text={`${w.readyToRejoin} ready`}                                                          tone="green" />}
              {w.notWarming === 0 && w.lowHealthDomains === 0 && (
                <PillBadge text="All healthy" tone="green" />
              )}
            </>
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {/*
          The four key metrics. "Active" is the load-bearing one for daily
          send capacity (~20 emails per sender per day), so it sits in the
          top row alongside the total. Warming-only counts the workforce
          currently being remediated. Warmup health is the workspace avg
          across senders that have any warmup activity (zero-score senders
          are excluded as no-data).
        */}
        {[
          { label: "Total senders",  value: w.total,                                                    color: undefined },
          { label: "Active",         value: w.active,                                                   color: undefined },
          { label: "Warming only",   value: w.warmingOnly,                                              color: w.warmingOnly > 0 ? "#D97706" : undefined },
          { label: "Warmup health",  value: w.warmupHealthAvg !== null ? `${w.warmupHealthAvg}%` : "—", color: w.warmupHealthAvg === null ? "#9ca3af" : w.warmupHealthAvg >= 98 ? "#15803D" : w.warmupHealthAvg >= 90 ? "#D97706" : "#B91C1C" },
        ].map(s => (
          <div key={s.label}>
            <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>{s.label}</p>
            <p style={{ fontSize: 14, fontWeight: 500, color: s.color ?? "#111827" }}>{s.value}</p>
          </div>
        ))}
      </div>
      <span style={{ position: "absolute", bottom: 12, right: 14, fontSize: 11, color: "#9ca3af" }}>→</span>
    </div>
  );
}

// ── Sender table for a single workspace (Level 2) ────────────────────────────

type Tab = "active" | "warming_only";

function SenderTable({
  ws, senders, onBack, onActionDone, refresh,
}: {
  ws: WsAgg;
  senders: Sender[];
  onBack: () => void;
  onActionDone: (msg: string, type: "success" | "error") => void;
  refresh: () => void;
}) {
  const workspaces = useWorkspaces();
  const name = resolveWsName(workspaces, ws.slug);
  const [tab, setTab] = useState<Tab>("active");
  const [actionMap, setActionMap] = useState<Record<string, "attach_to_all" | "pause_outbound_and_warmup" | "enable_warmup" | null>>({});
  const [domainAction, setDomainAction] = useState<Record<string, "enable_warmup" | "pause_outbound" | "attach_to_all" | null>>({});
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);

  // Domain-level batch: walk through each affected sender sequentially.
  // Sequential is intentional — pausing many campaigns in parallel would
  // be confusing for operators and may trip EB rate limits.
  async function runDomainBatch(domain: string, senders: Sender[], action: "enable_warmup" | "pause_outbound" | "attach_to_all") {
    setDomainAction(prev => ({ ...prev, [domain]: action }));
    // Disconnected senders are never valid targets — the action would
    // succeed at the API level but cannot actually run on a mailbox EB
    // can't reach. Skip them.
    //
    // For pause_outbound and attach_to_all the target is the WHOLE
    // reachable domain, not only the senders whose state currently
    // differs from the goal. Including the already-correct senders
    // makes the action idempotent on a per-sender level and the atomic
    // batch's post-condition verification ("every sender ended at
    // attached_count = X") guarantees the domain ends in one consistent
    // state. This is what prevents the "4 warming, 1 active" drift seen
    // on gnmotioninfo.com — a previously-failed sender that did not
    // clear the first time will be retried as part of the next batch.
    //
    // enable_warmup stays narrowly targeted (only off-senders) because
    // there is no useful side-effect to firing it on already-warming
    // mailboxes.
    const reachable = senders.filter(s => s.conn_status !== "Not connected");
    const targets =
      action === "enable_warmup"   ? reachable.filter(s => !s.warmup_enabled) :
                                     reachable;
    if (targets.length === 0) {
      onActionDone(`No senders in ${domain} match this action.`, "error");
      setDomainAction(prev => ({ ...prev, [domain]: null }));
      return;
    }
    const verb =
      action === "enable_warmup"  ? "Enabling warmup" :
      action === "attach_to_all"  ? "Adding to campaigns" :
                                    "Pausing outbound";
    onActionDone(`${verb} on ${targets.length} sender(s) in ${domain}…`, "success");
    const senderAction =
      action === "enable_warmup"  ? "enable_warmup" :
      action === "attach_to_all"  ? "attach_to_all" :
                                    "pause_outbound_and_warmup";
    const senderIds = targets
      .map(s => s.eb_sender_id)
      .filter((n): n is number => typeof n === "number");
    if (senderIds.length === 0) {
      onActionDone(`No EB sender IDs found for ${domain}.`, "error");
      setDomainAction(prev => ({ ...prev, [domain]: null }));
      return;
    }
    // Single atomic batch call: the new domain-batch endpoint pauses every
    // affected campaign once, removes all senders per campaign in one EB
    // call, waits once, resumes once. Then it verifies every sender ended
    // at attached_count = 0 and retries any straggler. This is what
    // prevents the "half-paused domain" state we hit on gnmotioninfo.com.
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
      if (!res.ok) {
        onActionDone(j.error ?? "Batch failed", "error");
      } else if (!j.ok) {
        const stragglerNote = j.stragglers ? ` · ${j.stragglers} sender(s) still attached after retry` : "";
        onActionDone(`${domain}: partial${stragglerNote}. Check EmailBison.`, "error");
      } else {
        const note = action === "pause_outbound"
          ? `${senderIds.length} sender(s) moved to warming, ${j.campaigns ?? 0} campaign(s) touched.`
          : `${senderIds.length} sender(s) processed.`;
        onActionDone(`${domain}: ${note}`, "success");
      }
    } catch (err: any) {
      onActionDone(err.message ?? "Network error", "error");
    }
    setDomainAction(prev => ({ ...prev, [domain]: null }));
    setTimeout(() => refresh(), 1500);
  }

  async function runSenderAction(s: Sender, action: "attach_to_all" | "pause_outbound_and_warmup" | "enable_warmup") {
    setActionMap(prev => ({ ...prev, [s.sender_email]: action }));
    try {
      const res = await fetch("/api/account-monitor/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_email: s.sender_email,
          workspace_slug: s.workspace_slug,
          sender_id: s.eb_sender_id,
          action,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        onActionDone(j.error ?? "Action failed", "error");
        return;
      }
      const verb =
        action === "attach_to_all"             ? `attached to ${j.campaigns_affected} campaigns` :
        action === "pause_outbound_and_warmup" ? "throttled to 1/day + warmup enabled" :
                                                  "warmup enabled";
      onActionDone(`${s.sender_email} ${verb}. Refreshing…`, j.failed > 0 ? "error" : "success");
      setTimeout(() => refresh(), 4000);
    } catch (err: any) {
      onActionDone(err.message ?? "Network error", "error");
    } finally {
      setActionMap(prev => ({ ...prev, [s.sender_email]: null }));
    }
  }

  // Warming-only = sender is currently not attached to any active outbound
  // campaign. Whether it was manually paused (warming_since IS NOT NULL) or
  // just hasn't been put in a campaign yet, EB is treating it as warmup-only
  // traffic. "Ready for outbound" still requires the manual-pause path so
  // the 14-day clock has a real start.
  const isDisconnected = (s: Sender) => s.conn_status === "Not connected";
  // Disconnected ALWAYS overrides every other classification. The mailbox
  // cannot send or warm up, so flagging it as not-warming or low-health is
  // both misleading and actionable on the wrong axis. All downstream
  // predicates exclude disconnected senders by construction.
  const isWarmingOnly = (s: Sender) => !isDisconnected(s) && (s.attached_campaigns_count ?? 0) === 0;
  const isNotWarming  = (s: Sender) => !isDisconnected(s) && !s.warmup_enabled;
  // Low-health is judged per-domain (see DomainGroup.lowHealth below). The
  // per-sender warmup score is still shown in the row, but it does not
  // drive individual badges or actions — a single account at 95% in an
  // otherwise-99% domain is left alone because the domain itself is healthy
  // and the outlier recovers passively.

  // Active = currently in at least one outbound campaign (sending capacity).
  // Warming only = no active campaign slots (being warmed up or paused).
  // Disconnected senders fall into whichever bucket matches their last-known
  // attached_campaigns_count, with a Reconnect link surfaced on the row.
  const filtered = senders
    .filter(s => {
      switch (tab) {
        case "warming_only": return (s.attached_campaigns_count ?? 0) === 0;
        case "active":       return (s.attached_campaigns_count ?? 0) > 0;
        default:             return true;
      }
    });

  // Group filtered senders by their email domain so the workspace drilldown
  // mirrors Domain Monitor: one row per domain, click to expand individual
  // senders. Domain-level row shows aggregated counts (not warming, low
  // health, avg score) so the operator can act on whole sending domains.
  // The current model: only the DOMAIN avg drives Pause-outbound. Individual
  // outliers in an otherwise-healthy domain are left alone — they recover
  // passively while the rest of the domain carries the volume.
  type DomainGroup = {
    domain:        string;
    senders:       Sender[];
    disconnected:  number;
    notWarming:    number;
    warmingOnly:   number;
    avgScore:      number | null;
    lowHealth:     boolean;
    // Per-account campaign attachment. The invariant we expect: all
    // reachable senders on a domain are attached to the same set of
    // campaigns, so "5 senders × 1 campaign each" should display as
    // "In 1 campaign", not as "5 campaign-slots". When the invariant
    // is broken (one sender attached to more campaigns than its peers),
    // expose the range so the operator can act.
    attachedMin:   number;
    attachedMax:   number;
    worstSev:      number;
    fullyDisconnected: boolean;
  };
  const domainMap: Record<string, Sender[]> = {};
  for (const s of filtered) {
    const d = s.sender_email.split("@")[1] ?? "unknown";
    if (!domainMap[d]) domainMap[d] = [];
    domainMap[d].push(s);
  }
  // Severity bucket for the domain sort:
  //   0  Any sender disconnected   (indigo, top — fix in EB first)
  //   1  Any sender not warming    (red — enable warmup batch)
  //   2  Domain avg below 98%      (red — Pause-outbound batch)
  //   3  Healthy / other           (green or amber, bottom)
  const domainGroups: DomainGroup[] = Object.entries(domainMap).map(([dom, list]) => {
    // Health score only computed over connected senders with real warmup
    // activity. Disconnected senders are excluded (score is stale or
    // meaningless). Senders with score = 0 are excluded too: in EB that
    // means "no warmup emails yet", not "0% deliverability". Including
    // them as zeros would mis-flag healthy domains as low-health.
    const reachable = list.filter(s => !isDisconnected(s));
    const scored = reachable.filter(s => typeof s.warmup_score === "number" && (s.warmup_score as number) > 0);
    const avg = scored.length > 0
      ? Math.round(scored.reduce((a, s) => a + (s.warmup_score as number), 0) / scored.length * 10) / 10
      : null;
    const disconnected = list.filter(isDisconnected).length;
    const notWarming   = list.filter(isNotWarming).length;
    // Low-health is only actionable when the domain has at least one active
    // sender. A fully warming-only domain is already being remediated and
    // should not be flagged again (the workspace card would never go green).
    const hasActive    = list.some(s => (s.attached_campaigns_count ?? 0) > 0);
    const lowHealth    = hasActive && avg !== null && avg < 98;
    const worstSev     = disconnected > 0 ? 0 : notWarming > 0 ? 1 : lowHealth ? 2 : 3;
    const attachedCounts = reachable.map(s => s.attached_campaigns_count ?? 0);
    const attachedMin = attachedCounts.length > 0 ? Math.min(...attachedCounts) : 0;
    const attachedMax = attachedCounts.length > 0 ? Math.max(...attachedCounts) : 0;
    return {
      domain:            dom,
      senders:           list,
      disconnected,
      notWarming,
      warmingOnly:       list.filter(isWarmingOnly).length,
      avgScore:          avg,
      lowHealth,
      attachedMin,
      attachedMax,
      worstSev,
      fullyDisconnected: disconnected === list.length && list.length > 0,
    };
  }).sort((a, b) => {
    if (a.worstSev !== b.worstSev)             return a.worstSev - b.worstSev;
    if (b.disconnected !== a.disconnected)     return b.disconnected - a.disconnected;
    if (b.notWarming !== a.notWarming)         return b.notWarming - a.notWarming;
    const avgA = a.avgScore ?? 101;
    const avgB = b.avgScore ?? 101;
    if (avgA !== avgB)                         return avgA - avgB;
    return a.domain.localeCompare(b.domain);
  });

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

      <p style={{ fontSize: 15, fontWeight: 500, color: "#111827", marginBottom: 4 }}>
        {name}, warmup status
      </p>
      <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 14 }}>
        {senders.length} senders
        {ws.notWarming > 0   ? ` · ${ws.notWarming} not warming` : ""}
        {ws.warmingOnly > 0  ? ` · ${ws.warmingOnly} warming only` : ""}
        {ws.readyToRejoin > 0 ? ` · ${ws.readyToRejoin} ready for outbound` : ""}
      </p>

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
                fontSize: 12,
                fontWeight: selected ? 600 : 500,
                color: selected ? "#111827" : "#6b7280",
                padding: "8px 14px",
                background: "transparent",
                border: "none",
                borderBottom: selected ? "2px solid #111827" : "2px solid transparent",
                cursor: "pointer",
                fontFamily: "inherit",
                marginBottom: -1,
              }}
            >
              {t.label} <span style={{ color: "#9ca3af", fontWeight: 400 }}>({t.count})</span>
            </button>
          );
        })}
      </div>

      <div style={{ background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "#f8f7f5", borderBottom: "0.5px solid #ede9e3" }}>
              {[
                { h: "Sender",         w: "38%", align: "left" },
                { h: "Status",         w: "20%", align: "left" },
                { h: "Warmup",         w: "12%", align: "left" },
                { h: "Warmup health",  w: "12%", align: "right" },
                { h: "Action",         w: "18%", align: "center" },
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
              <tr><td colSpan={5} style={{ padding: "30px 16px", textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
                No senders matching this filter.
              </td></tr>
            )}
            {domainGroups.map(d => {
              const isExpanded = expandedDomain === d.domain;
              // Domain row background tracks severity, same idea as the
              // workspace card border. Disconnected outranks everything
              // (mailbox unreachable, warmup state is moot).
              const domBg =
                d.disconnected > 0  ? "#EEF2FF" :
                d.notWarming > 0    ? "#FCEBEB" :
                d.lowHealth         ? "#FEF3C7" :
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
                    {/* Status column: when fully disconnected, suppress
                        campaign-slot / warming-only counts since they reflect
                        a stale pre-disconnect state. */}
                    <td style={{ padding: "10px 10px" }}>
                      {d.fullyDisconnected
                        ? <PillBadge text="All disconnected" tone="indigo" />
                        : d.disconnected > 0
                          ? <PillBadge text={`${d.disconnected} disconnected`} tone="indigo" />
                          : d.warmingOnly === d.senders.length
                            ? <PillBadge text="All warming only" tone="amber" />
                            : d.attachedMin === d.attachedMax
                              ? <PillBadge text={`In ${d.attachedMin} ${d.attachedMin === 1 ? "campaign" : "campaigns"}`} tone="green" />
                              : <PillBadge text={`In ${d.attachedMin}-${d.attachedMax} campaigns`} tone="amber" />}
                    </td>
                    {/* Warmup column: hidden whenever ANY sender in the
                        domain is disconnected. The warmup_enabled flag and
                        score on a disconnected mailbox are stale/unactionable,
                        and "20 disconnected · 13 not warming" double-counts
                        the same senders confusingly. Disconnected is the
                        only flag we surface until the operator reconnects. */}
                    <td style={{ padding: "10px 10px" }}>
                      {d.disconnected > 0
                        ? <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>
                        : d.notWarming > 0
                          ? <PillBadge text={`${d.notWarming} not warming`} tone="red" />
                          : d.lowHealth
                            ? <PillBadge text="Domain low health" tone="red" />
                            : <PillBadge text="All warming" tone="green" />}
                    </td>
                    <td style={{
                      padding: "10px 10px", textAlign: "right",
                      color: d.disconnected > 0  ? "#9ca3af"
                           : d.avgScore === null ? "#9ca3af"
                           : d.avgScore >= 98    ? "#15803D"
                           : d.avgScore >= 90    ? "#D97706"
                                                 : "#B91C1C",
                      fontWeight: 500,
                    }}>
                      {d.disconnected > 0 || d.avgScore === null ? "—" : `${d.avgScore}%`}
                    </td>
                    <td
                      style={{ padding: "10px 10px", textAlign: "center" }}
                      onClick={e => e.stopPropagation()}
                    >
                      {(() => {
                        const acting = domainAction[d.domain];
                        // Disconnected senders block everything else. Surface
                        // a single Reconnect link instead of any warmup batch.
                        if (d.disconnected > 0) {
                          const wsInfo = findWorkspace(workspaces, ws.slug);
                          const reconnectUrl = wsInfo.instanceUrl ? `${wsInfo.instanceUrl}/sender-emails` : null;
                          return reconnectUrl ? (
                            <a href={reconnectUrl} target="_blank" rel="noopener noreferrer"
                              style={{
                                fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                background: "#EEF2FF", color: "#3730A3", border: "0.5px solid #A5B4FC",
                                fontFamily: "inherit", textDecoration: "none",
                                display: "inline-flex", alignItems: "center", gap: 5,
                              }}>
                              Reconnect in EmailBison ({d.disconnected})
                            </a>
                          ) : (
                            <span style={{ color: "#3730A3", fontSize: 11, fontWeight: 500 }}>Reconnect in EmailBison</span>
                          );
                        }
                        if (d.notWarming > 0) {
                          return (
                            <button
                              onClick={() => runDomainBatch(d.domain, d.senders, "enable_warmup")}
                              disabled={!!acting}
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
                        // Pause-outbound fires at the DOMAIN level only: when
                        // the domain avg drops under 98%, every reachable
                        // warming sender currently in a campaign gets pulled.
                        // A single low-score outlier inside an otherwise-
                        // healthy domain is intentionally left alone.
                        const eligibleForPause = d.lowHealth
                          ? d.senders.filter(s => !isDisconnected(s) && s.warmup_enabled && (s.attached_campaigns_count ?? 0) > 0).length
                          : 0;
                        if (eligibleForPause > 0) {
                          return (
                            <button
                              onClick={() => runDomainBatch(d.domain, d.senders, "pause_outbound")}
                              disabled={!!acting}
                              style={{
                                fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                background: "#FCEBEB", color: "#B91C1C", border: "0.5px solid #F09595",
                                cursor: acting ? "wait" : "pointer", fontFamily: "inherit",
                                display: "inline-flex", alignItems: "center", gap: 5,
                              }}>
                              {acting === "pause_outbound" ? <Loader2 size={11} className="animate-spin" /> : <Flame size={11} />}
                              Pause outbound ({eligibleForPause})
                            </button>
                          );
                        }
                        // Warming-only senders can be reinstated into outbound
                        // campaigns regardless of the 14-day timer — the timer
                        // is a recommendation, not a hard gate. Once the domain
                        // is healthy and the operator wants the volume back,
                        // they can flip every warming-only sender at once.
                        const warmingOnlyCount = d.senders.filter(s => !isDisconnected(s) && (s.attached_campaigns_count ?? 0) === 0).length;
                        if (warmingOnlyCount > 0) {
                          return (
                            <button
                              onClick={() => runDomainBatch(d.domain, d.senders, "attach_to_all")}
                              disabled={!!acting}
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

                  {/* Expanded sender rows. Background colours mirror the
                      domain header in the same hue but two shades lighter,
                      so visually you can tell at a glance which rows belong
                      to which domain bundle and where the next bundle
                      starts. */}
                  {isExpanded && d.senders.map(s => {
                    const acting       = actionMap[s.sender_email];
                    const disconnected = isDisconnected(s);
                    const notWarming   = isNotWarming(s);
                    const warmingOnly  = isWarmingOnly(s);
                    // Per-row background follows the DOMAIN's classification,
                    // not the individual sender's score. A 95% account inside
                    // a 99%-avg domain is shown white — the domain is healthy,
                    // the outlier recovers passively. If the domain itself is
                    // low-health, every row inside gets the amber tint.
                    const senderBg     =
                      disconnected                                ? "#F5F7FF" :  // indigo-25 (lighter than domain #EEF2FF)
                      notWarming                                  ? "#FEF7F7" :  // red-25  (lighter than domain #FCEBEB)
                      d.lowHealth                                 ? "#FFFBEB" :  // amber-25 (lighter than domain #FEF3C7)
                      tab === "warming_only" && s.ready_to_rejoin ? "#F0FDF4" :
                                                                    "#ffffff";
                    return (
                      <tr key={d.domain + "::" + s.sender_email} style={{ borderBottom: "0.5px solid #f3f4f6", background: senderBg }}>
                        <td style={{ padding: "8px 10px 8px 36px", color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                          {s.sender_email}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {disconnected
                            ? <PillBadge text="Disconnected" tone="indigo" />
                            : warmingOnly
                              ? (s.ready_to_rejoin
                                  ? <PillBadge text="Ready for outbound" tone="green" />
                                  : <PillBadge text="Warming only"       tone="amber" />)
                              : <PillBadge text={`In ${s.attached_campaigns_count} ${s.attached_campaigns_count === 1 ? "campaign" : "campaigns"}`} tone="green" />}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {/* Warmup column: show real state. Disconnected senders show "—"
                              since EB's warmup flag is meaningless without a live connection. */}
                          {disconnected
                            ? <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>
                            : notWarming
                              ? <PillBadge text="Not warming" tone="red" />
                              : <PillBadge text="Warming"     tone="green" />}
                        </td>
                        <td style={{
                          padding: "8px 10px", textAlign: "right",
                          // Score 0 means "no warmup data yet" in EB — shown
                          // as "—" so it does not look like a 0% deliverability.
                          color: s.warmup_score === null || s.warmup_score === 0 ? "#9ca3af"
                               : s.warmup_score >= 98   ? "#15803D"
                               : s.warmup_score >= 90   ? "#D97706"
                                                        : "#B91C1C",
                          fontWeight: 500,
                        }}>
                          {s.warmup_score === null || s.warmup_score === 0 ? "—" : `${Math.round(s.warmup_score)}%`}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "center" }}>
                          {disconnected ? (() => {
                            // Disconnected -> deep-link to EB's Sender Emails page
                            // where the user re-authorizes the mailbox.
                            const wsInfo = findWorkspace(workspaces, s.workspace_slug);
                            const reconnectUrl = wsInfo.instanceUrl ? `${wsInfo.instanceUrl}/sender-emails` : null;
                            return reconnectUrl ? (
                              <a href={reconnectUrl} target="_blank" rel="noopener noreferrer"
                                style={{
                                  fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                  background: "#EEF2FF", color: "#3730A3", border: "0.5px solid #A5B4FC",
                                  fontFamily: "inherit", textDecoration: "none",
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                }}>
                                Reconnect in EmailBison
                              </a>
                            ) : (
                              <span style={{ color: "#3730A3", fontSize: 11, fontWeight: 500 }}>Reconnect in EB</span>
                            );
                          })() : notWarming ? (
                            <button
                              onClick={() => runSenderAction(s, "enable_warmup")}
                              disabled={acting === "enable_warmup"}
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
                            <button
                              onClick={() => runSenderAction(s, "attach_to_all")}
                              disabled={acting === "attach_to_all"}
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

// ── Top-level component ──────────────────────────────────────────────────────

export function WarmupMonitor() {
  const [data, setData]           = useState<WarmupData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [selected, setSelected]   = useState<WsAgg | null>(null);
  const [toast, setToast]         = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [syncing, setSyncing]     = useState(false);
  const [pulling, setPulling]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/warmup-monitor", { cache: "no-store" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      setData(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Pull the latest sender state from EmailBison into sender_accounts
  // (status, warmup_enabled, warmup_score, attached_campaigns_count) so
  // the dashboard reflects manual changes operators just made in EB,
  // without waiting for the next 6-hour scheduled sync. If the operator
  // is viewing a single workspace drilldown, target only that one — a
  // full-org pull walks every campaign and can take several minutes.
  const pullFromEB = useCallback(async (workspace_slug?: string) => {
    if (pulling) return;
    setPulling(true);
    setToast({
      msg: workspace_slug
        ? `Pulling latest sender data for ${workspace_slug} from EmailBison…`
        : "Pulling latest sender data for all workspaces from EmailBison (this can take 1-5 min)…",
      type: "success",
    });
    try {
      const url = workspace_slug
        ? `/api/sync-sender-accounts?workspace=${encodeURIComponent(workspace_slug)}`
        : "/api/sync-sender-accounts";
      const res = await fetch(url, { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setToast({ msg: j.error ?? "Sync failed", type: "error" });
        return;
      }
      const failed = j.failed ?? 0;
      setToast({
        msg: `Synced ${j.synced ?? 0} workspace(s)${failed > 0 ? ` · ${failed} failed` : ""}.`,
        type: failed > 0 ? "error" : "success",
      });
      load();
    } catch (err: any) {
      setToast({ msg: err.message ?? "Network error", type: "error" });
    } finally {
      setPulling(false);
    }
  }, [pulling, load]);

  // One-click "ensure every active sender is in every active campaign"
  // for every workspace. The button confirms before running because it
  // can attach hundreds of senders across the entire system.
  const syncAllToCampaigns = useCallback(async () => {
    if (syncing) return;
    const ok = window.confirm(
      "This will attach every active, warmup-enabled, connected sender to every active campaign across all workspaces. Warming-only senders are skipped. Continue?"
    );
    if (!ok) return;
    setSyncing(true);
    setToast({ msg: "Syncing active senders to active campaigns across all workspaces…", type: "success" });
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const selectedSenders = (data && selected)
    ? data.senders.filter(s => s.workspace_slug === selected.slug)
    : [];

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20, fontFamily: "inherit", color: "#111827", background: "#f8f7f5" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 18, fontWeight: 600 }}>Warmup Monitor</p>
          <p style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            Warmup status for every sender in active workspaces. "Ready" = warming for {data?.thresholds.readyDays ?? 14}+ days.
          </p>
        </div>
        <div style={{ display: "inline-flex", gap: 8 }}>
          <button
            onClick={() => pullFromEB(selected?.slug)}
            disabled={pulling || loading}
            title={selected
              ? `Pull latest sender state from EmailBison for ${selected.slug}`
              : "Pull latest sender state from EmailBison for every workspace (1-5 min)"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#3730A3",
              background: "#EEF2FF", border: "0.5px solid #A5B4FC", borderRadius: 7,
              padding: "6px 12px", cursor: pulling ? "wait" : "pointer", fontFamily: "inherit",
            }}>
            {pulling ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {selected ? "Sync this workspace from EB" : "Sync all from EB"}
          </button>
          <button
            onClick={syncAllToCampaigns}
            disabled={syncing || loading}
            title="Ensure every active sender is in every active campaign across all workspaces"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#15803D",
              background: "#EAF3DE", border: "0.5px solid #C0DD97", borderRadius: 7,
              padding: "6px 12px", cursor: syncing ? "wait" : "pointer", fontFamily: "inherit",
            }}>
            {syncing ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Sync all to campaigns
          </button>
          <button
            onClick={load}
            disabled={loading}
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
        <div style={{ fontSize: 12, color: "#dc2626", background: "#fee2e2", padding: "10px 14px", borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 60, justifyContent: "center" }}>
          <Loader2 size={16} className="animate-spin" style={{ color: "#9ca3af" }} />
          <span style={{ fontSize: 12, color: "#9ca3af" }}>Loading warmup data…</span>
        </div>
      )}

      {!loading && data && selected && (
        <SenderTable
          ws={selected}
          senders={selectedSenders}
          onBack={() => setSelected(null)}
          onActionDone={(msg, type) => setToast({ msg, type })}
          refresh={load}
        />
      )}

      {!loading && data && !selected && (
        <>
          {/* Summary metrics: four cards. Warmup health % pulls from EB
              /api/warmup/sender-emails.warmup_score, averaged across all
              tracked senders. Warming-only counts senders that have been
              explicitly placed on warmup-only via the Pause + warmup action
              (warming_since IS NOT NULL). */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
            <SummaryCard label="Total senders" value={data.summary.totalSenders} />
            <SummaryCard label="Not warming"   value={data.summary.notWarming} color={data.summary.notWarming > 0 ? "#B91C1C" : undefined} />
            <SummaryCard
              label="Warmup health"
              value={data.summary.warmupHealthAvg !== null ? `${data.summary.warmupHealthAvg}%` : "—"}
              color={data.summary.warmupHealthAvg === null ? "#9ca3af" :
                     data.summary.warmupHealthAvg >= 98 ? "#15803D" :
                     data.summary.warmupHealthAvg >= 90 ? "#D97706" : "#B91C1C"}
            />
            <SummaryCard
              label="Low-health domains"
              value={data.summary.lowHealthDomains}
              color={data.summary.lowHealthDomains > 0 ? "#B91C1C" : undefined}
            />
          </div>

          {data.workspaces.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 13 }}>
              No active workspaces in the last {data.thresholds.churnWindowDays} days.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {data.workspaces.map(w => (
                <WorkspaceCard
                  key={w.slug}
                  w={w}
                  onClick={() => setSelected(w)}
                />
              ))}
            </div>
          )}
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
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
