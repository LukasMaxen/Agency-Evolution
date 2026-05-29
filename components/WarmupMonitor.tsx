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
  totalSenders:    number;
  notWarming:      number;
  warmingOnly:     number;
  readyToRejoin:   number;
  lowWarmupHealth: number;
  warmupHealthAvg: number | null;
}

interface WsAgg {
  slug:            string;
  total:           number;
  notWarming:      number;
  warmingOnly:     number;
  readyToRejoin:   number;
  lowWarmupHealth: number;
  warmupHealthAvg: number | null;
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
  const accent =
    (w.notWarming + w.lowWarmupHealth) > 0 ? "#E24B4A" :
    w.readyToRejoin > 0                    ? "#F59E0B" :
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
          {w.notWarming      > 0 && <PillBadge text={`${w.notWarming} not warming`}     tone="red" />}
          {w.lowWarmupHealth > 0 && <PillBadge text={`${w.lowWarmupHealth} low health`} tone="red" />}
          {w.readyToRejoin   > 0 && <PillBadge text={`${w.readyToRejoin} ready`}        tone="green" />}
          {w.warmingOnly     > 0 && w.readyToRejoin === 0 && <PillBadge text={`${w.warmingOnly} warming`} tone="amber" />}
          {w.notWarming === 0 && w.lowWarmupHealth === 0 && (
            <PillBadge text="All healthy" tone="green" />
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          { label: "Total senders",  value: w.total,                                                    color: undefined },
          { label: "Not warming",    value: w.notWarming,                                               color: w.notWarming   > 0 ? "#B91C1C" : undefined },
          { label: "Warmup health",  value: w.warmupHealthAvg !== null ? `${w.warmupHealthAvg}%` : "—", color: w.warmupHealthAvg === null ? "#9ca3af" : w.warmupHealthAvg >= 98 ? "#15803D" : w.warmupHealthAvg >= 90 ? "#D97706" : "#B91C1C" },
          { label: "Warming only",   value: w.warmingOnly,                                              color: w.warmingOnly > 0 ? "#D97706" : undefined },
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

type Tab = "all" | "warming_only";

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
  const [tab, setTab] = useState<Tab>("all");
  const [actionMap, setActionMap] = useState<Record<string, "attach_to_all" | "remove_and_warmup" | "enable_warmup" | null>>({});
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);

  async function runSenderAction(s: Sender, action: "attach_to_all" | "remove_and_warmup" | "enable_warmup") {
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
      const verb = action === "attach_to_all" ? "attached to" : "removed from";
      onActionDone(
        `${s.sender_email} ${verb} ${j.campaigns_affected} campaigns. Refreshing…`,
        j.failed > 0 ? "error" : "success",
      );
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
  const isWarmingOnly  = (s: Sender) => (s.attached_campaigns_count ?? 0) === 0;
  const isNotWarming   = (s: Sender) => !s.warmup_enabled;
  const isLowHealth    = (s: Sender) => s.warmup_enabled && typeof s.warmup_score === "number" && s.warmup_score < 98;

  // Severity bucket for row sort:
  //   0  Not warming         (red, top — flag + enable warmup)
  //   1  Low health (<98%)   (red, middle — flag + pause outbound)
  //   2  Healthy / other     (green or amber, bottom)
  const severity = (s: Sender) =>
    isNotWarming(s) ? 0 :
    isLowHealth(s)  ? 1 :
                      2;

  const filtered = senders
    .filter(s => {
      switch (tab) {
        case "warming_only": return isWarmingOnly(s);
        default:             return true;
      }
    })
    .slice()
    .sort((a, b) => {
      if (severity(a) !== severity(b)) return severity(a) - severity(b);
      const scoreA = a.warmup_score ?? 100;
      const scoreB = b.warmup_score ?? 100;
      if (scoreA !== scoreB) return scoreA - scoreB;
      return a.sender_email.localeCompare(b.sender_email);
    });

  // Group filtered senders by their email domain so the workspace drilldown
  // mirrors Domain Monitor: one row per domain, click to expand individual
  // senders. Domain-level row shows aggregated counts (not warming, low
  // health, avg score) so the operator can act on whole sending domains
  // when issues are systemic (which they usually are — 66% of low-health
  // domains have >=50% of senders affected).
  type DomainGroup = {
    domain:        string;
    senders:       Sender[];
    notWarming:    number;
    lowHealth:     number;
    warmingOnly:   number;
    avgScore:      number | null;
    totalAttached: number;
    worstSev:      number;
  };
  const domainMap: Record<string, Sender[]> = {};
  for (const s of filtered) {
    const d = s.sender_email.split("@")[1] ?? "unknown";
    if (!domainMap[d]) domainMap[d] = [];
    domainMap[d].push(s);
  }
  const domainGroups: DomainGroup[] = Object.entries(domainMap).map(([dom, list]) => {
    const scored = list.filter(s => typeof s.warmup_score === "number");
    const avg = scored.length > 0
      ? Math.round(scored.reduce((a, s) => a + (s.warmup_score as number), 0) / scored.length * 10) / 10
      : null;
    return {
      domain:        dom,
      senders:       list,
      notWarming:    list.filter(isNotWarming).length,
      lowHealth:     list.filter(isLowHealth).length,
      warmingOnly:   list.filter(isWarmingOnly).length,
      avgScore:      avg,
      totalAttached: list.reduce((a, s) => a + (s.attached_campaigns_count ?? 0), 0),
      worstSev:      Math.min(...list.map(severity)),
    };
  }).sort((a, b) => {
    if (a.worstSev !== b.worstSev)         return a.worstSev - b.worstSev;
    if (b.notWarming !== a.notWarming)     return b.notWarming - a.notWarming;
    if (b.lowHealth !== a.lowHealth)       return b.lowHealth - a.lowHealth;
    const avgA = a.avgScore ?? 101;
    const avgB = b.avgScore ?? 101;
    if (avgA !== avgB)                     return avgA - avgB;
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
          { key: "all",          label: "All accounts", count: senders.length },
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
              // workspace card border.
              const domBg =
                d.notWarming > 0    ? "#FCEBEB" :
                d.lowHealth  > 0    ? "#FEF3C7" :
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
                    <td style={{ padding: "10px 10px" }}>
                      {d.warmingOnly === d.senders.length
                        ? <PillBadge text="All warming only" tone="amber" />
                        : <PillBadge text={`${d.totalAttached} campaign-slots`} tone="green" />}
                    </td>
                    <td style={{ padding: "10px 10px" }}>
                      {d.notWarming > 0
                        ? <PillBadge text={`${d.notWarming} not warming`} tone="red" />
                        : d.lowHealth > 0
                          ? <PillBadge text={`${d.lowHealth} low health`} tone="red" />
                          : <PillBadge text="All warming" tone="green" />}
                    </td>
                    <td style={{
                      padding: "10px 10px", textAlign: "right",
                      color: d.avgScore === null ? "#9ca3af"
                           : d.avgScore >= 98    ? "#15803D"
                           : d.avgScore >= 90    ? "#D97706"
                                                 : "#B91C1C",
                      fontWeight: 500,
                    }}>
                      {d.avgScore === null ? "—" : `${d.avgScore}%`}
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "center", color: "#9ca3af", fontSize: 11 }}>
                      Click to expand
                    </td>
                  </tr>

                  {/* Expanded sender rows */}
                  {isExpanded && d.senders.map(s => {
                    const acting       = actionMap[s.sender_email];
                    const notWarming   = !s.warmup_enabled;
                    const warmingOnly  = isWarmingOnly(s);
                    const senderBg     =
                      notWarming                                  ? "#FEF2F2" :
                      tab === "warming_only" && s.ready_to_rejoin ? "#F0FDF4" :
                                                                    "#ffffff";
                    return (
                      <tr key={d.domain + "::" + s.sender_email} style={{ borderBottom: "0.5px solid #f3f4f6", background: senderBg }}>
                        <td style={{ padding: "8px 10px 8px 36px", color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                          {s.sender_email}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {warmingOnly
                            ? (s.ready_to_rejoin
                                ? <PillBadge text="Ready for outbound" tone="green" />
                                : <PillBadge text="Warming only"       tone="amber" />)
                            : <PillBadge text={`In ${s.attached_campaigns_count} ${s.attached_campaigns_count === 1 ? "campaign" : "campaigns"}`} tone="green" />}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {notWarming
                            ? <PillBadge text="Not warming" tone="red" />
                            : <PillBadge text="Warming"     tone="green" />}
                        </td>
                        <td style={{
                          padding: "8px 10px", textAlign: "right",
                          color: s.warmup_score === null ? "#9ca3af"
                               : s.warmup_score >= 98   ? "#15803D"
                               : s.warmup_score >= 90   ? "#D97706"
                                                        : "#B91C1C",
                          fontWeight: 500,
                        }}>
                          {s.warmup_score === null ? "—" : `${Math.round(s.warmup_score)}%`}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "center" }}>
                          {notWarming ? (
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
                          ) : isLowHealth(s) && !warmingOnly ? (
                            <button
                              onClick={() => runSenderAction(s, "remove_and_warmup")}
                              disabled={acting === "remove_and_warmup"}
                              style={{
                                fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                background: "#FCEBEB", color: "#B91C1C", border: "0.5px solid #F09595",
                                cursor: acting ? "wait" : "pointer", fontFamily: "inherit",
                                display: "inline-flex", alignItems: "center", gap: 5,
                              }}>
                              {acting === "remove_and_warmup" ? <Loader2 size={11} className="animate-spin" /> : <Flame size={11} />}
                              Pause outbound
                            </button>
                          ) : s.ready_to_rejoin ? (
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
              label="Warming only"
              value={data.summary.warmingOnly}
              color={data.summary.warmingOnly > 0 ? "#D97706" : undefined}
              sub={data.summary.readyToRejoin > 0 ? `${data.summary.readyToRejoin} ready` : undefined}
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
