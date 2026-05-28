"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, Loader2, Flame, ChevronLeft, Plus, WifiOff,
} from "lucide-react";
import { useWorkspaces, findWorkspace } from "@/lib/workspaces-context";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Sender {
  workspace_slug:           string;
  sender_email:             string;
  eb_sender_id:             number | null;
  conn_status:              string;
  warmup_enabled:           boolean;
  warming_since:            string | null;
  warming_days:             number | null;
  ready_to_rejoin:          boolean;
  attached_campaigns_count: number | null;
}

interface Summary {
  totalSenders:  number;
  notWarming:    number;
  disconnected:  number;
  warmingOnly:   number;
  readyToRejoin: number;
  idle:          number;
}

interface WsAgg {
  slug:          string;
  total:         number;
  notWarming:    number;
  disconnected:  number;
  warmingOnly:   number;
  readyToRejoin: number;
  idle:          number;
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

function WorkspaceCard({ w, attachedCount, onClick }: { w: WsAgg; attachedCount: number; onClick: () => void }) {
  const workspaces = useWorkspaces();
  const name = resolveWsName(workspaces, w.slug);

  // Border severity: not-warming + disconnected are urgent (red); ready/
  // warming-only show amber; idle-only shows grey; otherwise green.
  const accent =
    (w.notWarming + w.disconnected) > 0 ? "#E24B4A" :
    (w.warmingOnly + w.readyToRejoin) > 0 ? "#F59E0B" :
    w.idle > 0                          ? "#9CA3AF" :
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
          {w.notWarming    > 0 && <PillBadge text={`${w.notWarming} not warming`}  tone="red" />}
          {w.disconnected  > 0 && <PillBadge text={`${w.disconnected} disconnected`} tone="indigo" />}
          {w.readyToRejoin > 0 && <PillBadge text={`${w.readyToRejoin} ready`}      tone="green" />}
          {w.warmingOnly   > 0 && <PillBadge text={`${w.warmingOnly} warming`}      tone="amber" />}
          {w.idle          > 0 && <PillBadge text={`${w.idle} idle`}                tone="grey" />}
          {w.notWarming === 0 && w.disconnected === 0 && w.warmingOnly === 0 && w.idle === 0 && (
            <PillBadge text="All healthy" tone="green" />
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          // Row 1: top-level counts (no KPI = always black)
          { label: "Total senders",    value: w.total,                  color: undefined },
          { label: "Attached / Total", value: `${attachedCount} / ${w.total}`, color: undefined },
          // Row 2: status counts — colored only when the count > 0
          { label: "Not warming",      value: w.notWarming,             color: w.notWarming   > 0 ? "#B91C1C" : undefined },
          { label: "Idle (0 camps)",   value: w.idle,                   color: w.idle         > 0 ? "#6B7280" : undefined },
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

type Tab = "all" | "not_warming" | "disconnected" | "warming_only" | "ready" | "idle";

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
  const [actionMap, setActionMap] = useState<Record<string, "attach_to_all" | "remove_and_warmup" | null>>({});

  async function runSenderAction(s: Sender, action: "attach_to_all" | "remove_and_warmup") {
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

  const filtered = senders.filter(s => {
    switch (tab) {
      case "not_warming":  return !s.warmup_enabled && s.conn_status !== "Not connected";
      case "disconnected": return s.conn_status === "Not connected";
      case "warming_only": return s.warming_since !== null;
      case "ready":        return s.ready_to_rejoin;
      case "idle":         return (s.attached_campaigns_count ?? 0) === 0 && s.warming_since === null && s.conn_status === "Connected";
      default:             return true;
    }
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
        {senders.length} senders ·
        {ws.notWarming > 0 ? ` ${ws.notWarming} not warming ·` : ""}
        {ws.disconnected > 0 ? ` ${ws.disconnected} disconnected ·` : ""}
        {ws.idle > 0 ? ` ${ws.idle} idle` : ""}
      </p>

      <div style={{ display: "flex", gap: 4, marginBottom: 10, borderBottom: "0.5px solid #ede9e3" }}>
        {([
          { key: "all",          label: "All",            count: senders.length },
          { key: "not_warming",  label: "Not warming",    count: ws.notWarming },
          { key: "disconnected", label: "Disconnected",   count: ws.disconnected },
          { key: "warming_only", label: "Warming only",   count: ws.warmingOnly },
          { key: "ready",        label: "Ready to rejoin", count: ws.readyToRejoin },
          { key: "idle",         label: "Idle",           count: ws.idle },
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
                { h: "Sender",       w: "32%", align: "left" },
                { h: "Connection",   w: "14%", align: "left" },
                { h: "Warmup",       w: "14%", align: "left" },
                { h: "Attached",     w: "10%", align: "right" },
                { h: "Warming",      w: "10%", align: "right" },
                { h: "Action",       w: "20%", align: "center" },
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
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "30px 16px", textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
                No senders matching this filter.
              </td></tr>
            )}
            {filtered.map(s => {
              const acting = actionMap[s.sender_email];
              const disconnected = s.conn_status === "Not connected";
              const notWarming   = !s.warmup_enabled && !disconnected;
              return (
                <tr key={s.sender_email} style={{ borderBottom: "0.5px solid #f3f4f6" }}>
                  <td style={{ padding: "9px 10px", color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.sender_email}</td>
                  <td style={{ padding: "9px 10px" }}>
                    {disconnected
                      ? <PillBadge text="Disconnected" tone="indigo" />
                      : <PillBadge text="Connected"    tone="green" />}
                  </td>
                  <td style={{ padding: "9px 10px" }}>
                    {notWarming
                      ? <PillBadge text="Not warming" tone="red" />
                      : s.warmup_enabled
                        ? <PillBadge text="Warming" tone="green" />
                        : <PillBadge text="—" tone="grey" />}
                  </td>
                  <td style={{ padding: "9px 10px", textAlign: "right", color: (s.attached_campaigns_count ?? 0) === 0 ? "#6B7280" : "#111827" }}>
                    {s.attached_campaigns_count ?? "—"}
                  </td>
                  <td style={{ padding: "9px 10px", textAlign: "right", color: s.ready_to_rejoin ? "#15803D" : "#6B7280" }}>
                    {s.warming_days !== null ? `${s.warming_days}d` : "—"}
                  </td>
                  <td style={{ padding: "9px 10px", textAlign: "center" }}>
                    {(s.attached_campaigns_count ?? 0) === 0 && !disconnected ? (
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
                        Attach to all
                      </button>
                    ) : (s.attached_campaigns_count ?? 0) > 0 && !disconnected ? (
                      <button
                        onClick={() => runSenderAction(s, "remove_and_warmup")}
                        disabled={acting === "remove_and_warmup"}
                        style={{
                          fontSize: 11, padding: "4px 10px", borderRadius: 6,
                          background: "#FAEEDA", color: "#D97706", border: "0.5px solid #FAC775",
                          cursor: acting ? "wait" : "pointer", fontFamily: "inherit",
                          display: "inline-flex", alignItems: "center", gap: 5,
                        }}>
                        {acting === "remove_and_warmup" ? <Loader2 size={11} className="animate-spin" /> : <Flame size={11} />}
                        Pause + warmup
                      </button>
                    ) : null}
                  </td>
                </tr>
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

  // Active senders per workspace = attached_campaigns_count > 0. Computed
  // once here from the senders list and passed into each WorkspaceCard.
  const attachedBySlug: Record<string, number> = {};
  if (data) {
    for (const s of data.senders) {
      if ((s.attached_campaigns_count ?? 0) > 0) {
        attachedBySlug[s.workspace_slug] = (attachedBySlug[s.workspace_slug] ?? 0) + 1;
      }
    }
  }

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
          {/* Summary metrics row: 4-col grid, 2 rows, matches AccountMonitor. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
            <SummaryCard label="Total senders"     value={data.summary.totalSenders} />
            <SummaryCard label="Not warming"       value={data.summary.notWarming}    color={data.summary.notWarming    > 0 ? "#B91C1C" : undefined} />
            <SummaryCard label="Disconnected"      value={data.summary.disconnected}  color={data.summary.disconnected  > 0 ? "#3730A3" : undefined} />
            <SummaryCard label="Ready to rejoin"   value={data.summary.readyToRejoin} color={data.summary.readyToRejoin > 0 ? "#15803D" : undefined} />
            <SummaryCard label="Warming-only"      value={data.summary.warmingOnly} />
            <SummaryCard label="Idle (0 camps)"    value={data.summary.idle} />
            <SummaryCard label="Workspaces"        value={data.workspaces.length} />
            <SummaryCard label="Senders attached"  value={Object.values(attachedBySlug).reduce((s, n) => s + n, 0)} sub={`of ${data.summary.totalSenders}`} />
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
                  attachedCount={attachedBySlug[w.slug] ?? 0}
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
