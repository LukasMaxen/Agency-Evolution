"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Loader2, ChevronLeft, AlertTriangle, CheckCircle, TrendingDown } from "lucide-react";
import { WORKSPACES } from "@/lib/mock-data";

// ── Types ─────────────────────────────────────────────────────────────────────

type Status = "spam_risk" | "low_replies" | "healthy";

interface Account {
  sender_email: string;
  workspace_slug: string;
  emails_sent: number;
  bounces: number;
  replies: number;
  bounce_rate: number;
  reply_rate: number;
  status: Status;
}

interface WorkspaceData {
  slug: string;
  accounts: Account[];
  totalSent: number;
  totalReplies: number;
  totalBounces: number;
  spamRiskCount: number;
  avgReplyRate: number;
  bouncePct: number;
}

interface Summary {
  totalAccounts: number;
  totalSpamRisk: number;
  totalSent: number;
  avgReplyRate: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function wsName(slug: string): string {
  return WORKSPACES.find(w => w.slug === slug)?.name ?? slug;
}

function wsColor(slug: string): string {
  return WORKSPACES.find(w => w.slug === slug)?.color ?? "#6b7280";
}

const STATUS_CFG: Record<Status, { label: string; bg: string; color: string; border: string; icon: React.ElementType }> = {
  spam_risk:   { label: "Spam risk",    bg: "#FCEBEB", color: "#A32D2D", border: "#F09595", icon: AlertTriangle },
  low_replies: { label: "Low replies",  bg: "#FAEEDA", color: "#854F0B", border: "#FAC775", icon: TrendingDown },
  healthy:     { label: "Healthy",      bg: "#EAF3DE", color: "#3B6D11", border: "#C0DD97", icon: CheckCircle },
};

function StatusBadge({ status }: { status: Status }) {
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 500,
      background: cfg.bg, color: cfg.color, border: `0.5px solid ${cfg.border}`,
      whiteSpace: "nowrap",
    }}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
}

function RateCell({ value, type }: { value: number; type: "reply" | "bounce" }) {
  let color = "#6b7280";
  if (type === "reply") {
    if (value === 0) color = "#A32D2D";
    else if (value < 2) color = "#854F0B";
    else color = "#3B6D11";
  } else {
    if (value > 5) color = "#A32D2D";
    else if (value > 2) color = "#854F0B";
    else color = "#6b7280";
  }
  return <span style={{ fontSize: 12, color, fontWeight: value === 0 && type === "reply" ? 600 : 400 }}>{value}%</span>;
}

// ── Toggle group ──────────────────────────────────────────────────────────────

function DayToggle({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", background: "var(--color-bg-secondary, #f8f7f5)", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: 3, gap: 2 }}>
      {[3, 7, 14].map(d => (
        <button key={d} onClick={() => onChange(d)}
          style={{
            fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
            background: value === d ? "#ffffff" : "transparent",
            color: value === d ? "#1a56db" : "#6b7280",
            fontWeight: value === d ? 500 : 400,
            boxShadow: value === d ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
          }}>
          {d} days
        </button>
      ))}
    </div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: "#f8f7f5", borderRadius: 8, padding: "12px 14px" }}>
      <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 5 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 500, color: color ?? "#111827" }}>{value}</p>
    </div>
  );
}

// ── Level 1: Workspace cards ──────────────────────────────────────────────────

function WorkspaceCard({ ws, onClick }: { ws: WorkspaceData; onClick: () => void }) {
  const color = wsColor(ws.slug);
  const hasRisk = ws.spamRiskCount > 0;

  return (
    <div onClick={onClick}
      style={{
        background: "#ffffff",
        border: hasRisk ? `1.5px solid #E24B4A` : "0.5px solid #ede9e3",
        borderLeft: hasRisk ? `3px solid #E24B4A` : `3px solid ${color}`,
        borderRadius: "0 12px 12px 0",
        padding: "14px 16px",
        cursor: "pointer",
        position: "relative",
        transition: "box-shadow 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.07)"}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.boxShadow = "none"}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{wsName(ws.slug)}</p>
        {hasRisk
          ? <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#FCEBEB", color: "#A32D2D", border: "0.5px solid #F09595", fontWeight: 500 }}>{ws.spamRiskCount} at risk</span>
          : <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#EAF3DE", color: "#3B6D11", border: "0.5px solid #C0DD97", fontWeight: 500 }}>All healthy</span>
        }
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          { label: "Accounts",       value: ws.accounts.length },
          { label: "Emails sent",    value: ws.totalSent.toLocaleString() },
          { label: "Bounce rate",    value: `${ws.bouncePct}%`,    color: ws.bouncePct > 5 ? "#A32D2D" : ws.bouncePct > 2 ? "#854F0B" : "#111827" },
          { label: "Avg reply rate", value: `${ws.avgReplyRate}%`, color: ws.avgReplyRate < 1 ? "#A32D2D" : ws.avgReplyRate < 2 ? "#854F0B" : "#3B6D11" },
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

// ── Level 2: Account table ────────────────────────────────────────────────────

function AccountTable({ ws, days, onBack }: { ws: WorkspaceData; days: number; onBack: () => void }) {
  const color = wsColor(ws.slug);

  return (
    <div>
      {/* Back */}
      <button onClick={onBack}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 12, color: "#6b7280", cursor: "pointer",
          background: "#f8f7f5", border: "0.5px solid #e5e7eb",
          borderRadius: 7, padding: "5px 10px", marginBottom: 16,
          fontFamily: "inherit",
        }}>
        <ChevronLeft size={13} /> All workspaces
      </button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, color: "#111827" }}>
            <span style={{ color }}>{wsName(ws.slug)}</span> — sender accounts
          </p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            Last {days} days · {ws.accounts.length} accounts{ws.spamRiskCount > 0 ? ` · ${ws.spamRiskCount} at spam risk` : ""}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        <SummaryCard label="Accounts" value={ws.accounts.length} color="#185FA5" />
        <SummaryCard label="Spam risk" value={ws.spamRiskCount} color={ws.spamRiskCount > 0 ? "#A32D2D" : "#111827"} />
        <SummaryCard label="Emails sent" value={ws.totalSent.toLocaleString()} />
        <SummaryCard label="Avg reply rate" value={`${ws.avgReplyRate}%`} color={ws.avgReplyRate < 1 ? "#A32D2D" : ws.avgReplyRate < 2 ? "#854F0B" : "#3B6D11"} />
      </div>

      {/* Table */}
      <div style={{ background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "#f8f7f5", borderBottom: "0.5px solid #ede9e3" }}>
              {["Sender account", "Sent", "Bounces", "Bounce %", "Replies", "Reply %", "Status"].map((h, i) => (
                <th key={h} style={{
                  fontSize: 10, fontWeight: 500, color: "#9ca3af",
                  padding: "9px 12px", textAlign: i === 0 ? "left" : "right",
                  textTransform: "uppercase", letterSpacing: "0.04em",
                  width: i === 0 ? "30%" : i === 6 ? "14%" : "9.3%",
                  ...(i === 6 ? { textAlign: "center" } : {}),
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ws.accounts.map((acc, idx) => (
              <tr key={acc.sender_email}
                style={{
                  borderBottom: idx < ws.accounts.length - 1 ? "0.5px solid #f3f4f6" : "none",
                  background: acc.status === "spam_risk" ? "#FCEBEB" : "transparent",
                }}>
                <td style={{ padding: "9px 12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{acc.sender_email}</span>
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right", color: "#374151" }}>{acc.emails_sent.toLocaleString()}</td>
                <td style={{ padding: "9px 12px", textAlign: "right", color: "#374151" }}>{acc.bounces}</td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}><RateCell value={acc.bounce_rate} type="bounce" /></td>
                <td style={{ padding: "9px 12px", textAlign: "right", color: "#374151" }}>{acc.replies}</td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}><RateCell value={acc.reply_rate} type="reply" /></td>
                <td style={{ padding: "9px 12px", textAlign: "center" }}><StatusBadge status={acc.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AccountMonitor() {
  const [days, setDays]               = useState(7);
  const [data, setData]               = useState<{ workspaces: WorkspaceData[]; summary: Summary } | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [selected, setSelected]       = useState<WorkspaceData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/account-monitor?days=${days}`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      setData(await res.json());
      setSelected(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  // If a workspace is selected, sync it with fresh data
  const selectedWs = selected && data
    ? data.workspaces.find(w => w.slug === selected.slug) ?? null
    : null;

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#f8f7f5", padding: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, color: "#111827" }}>Account monitor</p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            {selectedWs ? `${wsName(selectedWs.slug)} — sender accounts` : "Sender-level spam & reply rate monitoring across all workspaces"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <DayToggle value={days} onChange={setDays} />
          <button onClick={load} disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "0.5px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer", fontFamily: "inherit" }}>
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ fontSize: 12, color: "#dc2626", background: "#fee2e2", padding: "10px 14px", borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 60, justifyContent: "center" }}>
          <Loader2 size={16} className="animate-spin" style={{ color: "#9ca3af" }} />
          <span style={{ fontSize: 12, color: "#9ca3af" }}>Loading account stats...</span>
        </div>
      )}

      {/* Level 2 — workspace detail */}
      {!loading && selectedWs && (
        <AccountTable ws={selectedWs} days={days} onBack={() => setSelected(null)} />
      )}

      {/* Level 1 — workspace overview */}
      {!loading && !selectedWs && data && (
        <>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
            <SummaryCard label="Total accounts"  value={data.summary.totalAccounts} color="#185FA5" />
            <SummaryCard label="Spam risk"       value={data.summary.totalSpamRisk} color={data.summary.totalSpamRisk > 0 ? "#A32D2D" : "#111827"} />
            <SummaryCard label="Emails sent"     value={data.summary.totalSent.toLocaleString()} />
            <SummaryCard label="Avg reply rate"  value={`${data.summary.avgReplyRate}%`} color={data.summary.avgReplyRate < 1 ? "#A32D2D" : data.summary.avgReplyRate < 2 ? "#854F0B" : "#3B6D11"} />
          </div>

          {/* Workspace cards grid */}
          {data.workspaces.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 13 }}>
              No sending activity in the last {days} days.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {data.workspaces.map(ws => (
                <WorkspaceCard key={ws.slug} ws={ws} onClick={() => setSelected(ws)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}