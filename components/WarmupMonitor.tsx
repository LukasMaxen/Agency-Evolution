"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, Loader2, Flame, AlertTriangle, CheckCircle, WifiOff, Inbox as InboxIcon, Plus,
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

function StatChip({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 10, padding: "10px 14px" }}>
      <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 500, color: color ?? "#111827" }}>{value}</p>
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

// ── Component ─────────────────────────────────────────────────────────────────

type Tab = "all" | "not_warming" | "disconnected" | "warming_only" | "ready" | "idle";

export function WarmupMonitor() {
  const workspaces = useWorkspaces();
  const [data, setData]           = useState<WarmupData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<Tab>("all");
  const [actionMap, setActionMap] = useState<Record<string, "attach_to_all" | "remove_and_warmup" | null>>({});
  const [toast, setToast]         = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/warmup-monitor", { cache: "no-store" });
      const j = await res.json();
      setData(j);
    } catch (err: any) {
      setToast({ msg: err.message ?? "Failed to load warmup data", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-clear toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function runSenderAction(s: Sender, action: "attach_to_all" | "remove_and_warmup") {
    const key = `${s.workspace_slug}:${s.sender_email}`;
    setActionMap(prev => ({ ...prev, [key]: action }));
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
        setToast({ msg: j.error ?? "Action failed", type: "error" });
        return;
      }
      const verb = action === "attach_to_all" ? "attached to" : "removed from";
      setToast({
        msg: `${s.sender_email} ${verb} ${j.campaigns_affected} campaigns. Refreshing…`,
        type: j.failed > 0 ? "error" : "success",
      });
      // Give EB a few seconds to process the async remove, then reload.
      setTimeout(() => load(), 4000);
    } catch (err: any) {
      setToast({ msg: err.message ?? "Network error", type: "error" });
    } finally {
      setActionMap(prev => ({ ...prev, [key]: null }));
    }
  }

  if (loading || !data) {
    return (
      <div style={{ padding: 24 }}>
        <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "#9ca3af" }} />
        <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 8 }}>Loading warmup monitor…</span>
      </div>
    );
  }

  const senders = data.senders.filter(s => {
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
    <div style={{ padding: "20px 24px", fontFamily: "inherit", color: "#111827", background: "#faf9f6", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 18, fontWeight: 600 }}>Warmup Monitor</p>
          <p style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            All connected senders across active workspaces. "Ready" = warming for {data.thresholds.readyDays}+ days.
          </p>
        </div>
        <button
          onClick={load}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#374151",
            background: "#ffffff", border: "0.5px solid #d1d5db", borderRadius: 7,
            padding: "6px 12px", cursor: "pointer", fontFamily: "inherit",
          }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 18 }}>
        <StatChip label="Total senders"  value={data.summary.totalSenders} />
        <StatChip label="Not warming"    value={data.summary.notWarming}   color={data.summary.notWarming   > 0 ? "#B91C1C" : undefined} />
        <StatChip label="Disconnected"   value={data.summary.disconnected} color={data.summary.disconnected > 0 ? "#3730A3" : undefined} />
        <StatChip label="Warming-only"   value={data.summary.warmingOnly} />
        <StatChip label="Ready to rejoin" value={data.summary.readyToRejoin} color={data.summary.readyToRejoin > 0 ? "#15803D" : undefined} />
        <StatChip label="Idle (0 camps)" value={data.summary.idle} />
      </div>

      {/* Per-workspace overview */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginBottom: 18 }}>
        {data.workspaces.map(w => (
          <div key={w.slug} style={{ background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 10, padding: "10px 12px" }}>
            <p style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{resolveWsName(workspaces, w.slug)}</p>
            <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 6 }}>{w.total} senders</p>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {w.notWarming    > 0 && <PillBadge text={`${w.notWarming} not warming`} tone="red" />}
              {w.disconnected  > 0 && <PillBadge text={`${w.disconnected} disconnected`} tone="indigo" />}
              {w.warmingOnly   > 0 && <PillBadge text={`${w.warmingOnly} warming-only`} tone="amber" />}
              {w.readyToRejoin > 0 && <PillBadge text={`${w.readyToRejoin} ready`} tone="green" />}
              {w.idle          > 0 && <PillBadge text={`${w.idle} idle`} tone="grey" />}
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10, borderBottom: "0.5px solid #ede9e3" }}>
        {([
          { key: "all",           label: "All",            count: data.summary.totalSenders },
          { key: "not_warming",   label: "Not warming",    count: data.summary.notWarming },
          { key: "disconnected",  label: "Disconnected",   count: data.summary.disconnected },
          { key: "warming_only",  label: "Warming only",   count: data.summary.warmingOnly },
          { key: "ready",         label: "Ready to rejoin", count: data.summary.readyToRejoin },
          { key: "idle",          label: "Idle",           count: data.summary.idle },
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

      {/* Sender table */}
      <div style={{ background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "#f8f7f5", borderBottom: "0.5px solid #ede9e3" }}>
              {[
                { h: "Sender",       w: "30%", align: "left" },
                { h: "Workspace",    w: "14%", align: "left" },
                { h: "Connection",   w: "12%", align: "left" },
                { h: "Warmup",       w: "12%", align: "left" },
                { h: "Attached",     w: "10%", align: "right" },
                { h: "Warming",      w: "10%", align: "right" },
                { h: "Action",       w: "12%", align: "center" },
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
            {senders.length === 0 && (
              <tr><td colSpan={7} style={{ padding: "30px 16px", textAlign: "center", color: "#9ca3af", fontSize: 12 }}>No senders matching this filter.</td></tr>
            )}
            {senders.map(s => {
              const key = `${s.workspace_slug}:${s.sender_email}`;
              const acting = actionMap[key];
              const disconnected = s.conn_status === "Not connected";
              const notWarming   = !s.warmup_enabled && !disconnected;
              return (
                <tr key={key} style={{ borderBottom: "0.5px solid #f3f4f6" }}>
                  <td style={{ padding: "9px 10px", color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.sender_email}</td>
                  <td style={{ padding: "9px 10px", color: "#374151" }}>{resolveWsName(workspaces, s.workspace_slug)}</td>
                  <td style={{ padding: "9px 10px" }}>
                    {disconnected
                      ? <PillBadge text="Disconnected" tone="indigo" />
                      : <PillBadge text="Connected" tone="green" />}
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

      {/* Toast */}
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
