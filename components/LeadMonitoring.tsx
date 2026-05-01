"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Loader2, ChevronDown, ChevronUp } from "lucide-react";

interface Campaign {
  id: number;
  name: string;
  newLeadsPerDay: number;
  weeklyCapacity: number;
  totalLeads: number;
  contacted: number;
  remaining: number;
  shortfall: number;
  coveragePct: number;
  coverageDays: number;
  health: "healthy" | "low" | "critical" | "empty";
}

interface WorkspaceResult {
  workspace: string;
  slug: string;
  error: string | null;
  campaigns: Campaign[];
}

const HEALTH = {
  empty:    { label: "Empty",    bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", bar: "#ef4444" },
  critical: { label: "Critical", bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", bar: "#ef4444" },
  low:      { label: "Low",      bg: "#fef3c7", color: "#92400e", border: "#fcd34d", bar: "#f59e0b" },
  healthy:  { label: "Healthy",  bg: "#d1fae5", color: "#065f46", border: "#6ee7b7", bar: "#10b981" },
};

function CampaignRow({ c }: { c: Campaign }) {
  const [open, setOpen] = useState(false);
  const cfg = HEALTH[c.health];

  let alertText = "";
  if (c.health === "empty") {
    alertText = `No uncontacted leads remaining — nothing will send. Add at least ${c.weeklyCapacity.toLocaleString()} leads to cover the week.`;
  } else if (c.shortfall > 0) {
    alertText = `Add ${c.shortfall.toLocaleString()} more leads to cover the full week. Pipeline lasts ${c.coverageDays} days.`;
  } else {
    alertText = `Pipeline covers ${c.coverageDays} days of sending. You're good for the week.`;
  }

  return (
    <div style={{
      borderRadius: "0 8px 8px 0",
      border: `1px solid #f0f0f0`,
      borderLeft: `3px solid ${cfg.bar}`,
      background: "#ffffff",
      marginBottom: 8,
    }}>
      {/* Row header — always visible */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, color: "#111827", flex: 1, minWidth: 140 }}>
          {c.name}
        </span>

        <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>
          {c.newLeadsPerDay.toLocaleString()}<span style={{ color: "#d1d5db" }}>/day</span>
        </span>
        <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>
          {c.weeklyCapacity.toLocaleString()}<span style={{ color: "#d1d5db" }}>/week</span>
        </span>
        <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>
          {c.remaining.toLocaleString()} remaining
        </span>

        <div style={{ flex: 1, minWidth: 80, maxWidth: 120 }}>
          <div style={{ height: 4, background: "#f1f5f9", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ width: `${c.coveragePct}%`, height: "100%", background: cfg.bar, borderRadius: 10 }} />
          </div>
          <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{c.coveragePct}% coverage</p>
        </div>

        <span style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 500, whiteSpace: "nowrap",
          background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
        }}>
          {cfg.label}
        </span>

        {open ? <ChevronUp size={13} color="#9ca3af" /> : <ChevronDown size={13} color="#9ca3af" />}
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid #f9fafb" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8, marginTop: 12, marginBottom: 10 }}>
            {[
              { label: "New leads/day",   value: c.newLeadsPerDay.toLocaleString() },
              { label: "Weekly capacity", value: c.weeklyCapacity.toLocaleString() },
              { label: "Total leads",     value: c.totalLeads.toLocaleString() },
              { label: "Contacted",       value: c.contacted.toLocaleString() },
              { label: "Remaining",       value: c.remaining.toLocaleString(), color: cfg.color },
              { label: "Leads to add",    value: c.shortfall > 0 ? `+${c.shortfall.toLocaleString()}` : "—", color: c.shortfall > 0 ? "#dc2626" : "#16a34a" },
              { label: "Days covered",    value: c.coverageDays.toString() },
            ].map(s => (
              <div key={s.label} style={{ background: "#f8f9fa", borderRadius: 6, padding: "6px 8px" }}>
                <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>{s.label}</p>
                <p style={{ fontSize: 13, fontWeight: 500, color: s.color ?? "#111827" }}>{s.value}</p>
              </div>
            ))}
          </div>

          <div style={{
            fontSize: 11, padding: "7px 10px", borderRadius: 6,
            background: cfg.bg, color: cfg.color, lineHeight: 1.5,
          }}>
            {alertText}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkspaceSection({ ws }: { ws: WorkspaceResult }) {
  const [open, setOpen] = useState(true);

  const danger  = ws.campaigns.filter(c => c.health === "critical" || c.health === "empty").length;
  const low     = ws.campaigns.filter(c => c.health === "low").length;
  const healthy = ws.campaigns.filter(c => c.health === "healthy").length;

  return (
    <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #ede9e3", overflow: "hidden", marginBottom: 12 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ padding: "12px 16px", background: "#f8f7f5", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", borderBottom: open ? "1px solid #ede9e3" : "none" }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: "#111827", flex: 1 }}>{ws.workspace}</span>
        <div style={{ display: "flex", gap: 6 }}>
          {danger > 0  && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#fee2e2", color: "#991b1b" }}>{danger} critical</span>}
          {low > 0     && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#fef3c7", color: "#92400e" }}>{low} low</span>}
          {healthy > 0 && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#d1fae5", color: "#065f46" }}>{healthy} healthy</span>}
        </div>
        {open ? <ChevronUp size={14} color="#9ca3af" /> : <ChevronDown size={14} color="#9ca3af" />}
      </div>

      {open && (
        <div style={{ padding: "10px 14px" }}>
          {ws.error && (
            <p style={{ fontSize: 11, color: "#dc2626", background: "#fee2e2", padding: "6px 10px", borderRadius: 6, marginBottom: 8 }}>
              Error: {ws.error}
            </p>
          )}
          {!ws.error && ws.campaigns.length === 0 && (
            <p style={{ fontSize: 12, color: "#9ca3af", padding: "8px 0" }}>No active campaigns found.</p>
          )}
          {ws.campaigns.map(c => (
            <CampaignRow key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LeadMonitoring() {
  const [data,     setData]     = useState<{ workspaces: WorkspaceResult[] } | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [sendDays, setSendDays] = useState(5);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/lead-monitoring?sendDays=${sendDays}`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      setData(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sendDays]);

  useEffect(() => { load(); }, [load]);

  const all       = data?.workspaces.flatMap(w => w.campaigns) ?? [];
  const danger    = all.filter(c => c.health === "critical" || c.health === "empty").length;
  const low       = all.filter(c => c.health === "low").length;
  const healthy   = all.filter(c => c.health === "healthy").length;
  const remaining = all.reduce((s, c) => s + c.remaining, 0);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#f8f7f5", padding: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, color: "#111827" }}>Campaign Health</p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            New leads/day · weekly capacity · remaining pipeline — across all workspaces
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, color: "#6b7280", display: "flex", alignItems: "center", gap: 6 }}>
            Sending days/week
            <input
              type="number" min={1} max={7} value={sendDays}
              onChange={e => setSendDays(parseInt(e.target.value) || 5)}
              style={{ width: 44, fontSize: 12, padding: "4px 6px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", color: "#111827" }}
            />
          </label>
          <button
            onClick={load} disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer" }}
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Critical / Empty", value: danger,                    color: danger > 0 ? "#dc2626" : "#111827" },
            { label: "Low",              value: low,                        color: low > 0    ? "#d97706" : "#111827" },
            { label: "Healthy",          value: healthy,                    color: "#16a34a" },
            { label: "Total remaining",  value: remaining.toLocaleString(), color: "#1a56db" },
          ].map(m => (
            <div key={m.label} style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #ede9e3", padding: 14 }}>
              <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>{m.label}</p>
              <p style={{ fontSize: 22, fontWeight: 500, color: m.color }}>{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{ fontSize: 12, color: "#dc2626", background: "#fee2e2", padding: "10px 14px", borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 40, justifyContent: "center" }}>
          <Loader2 size={16} className="animate-spin" style={{ color: "#9ca3af" }} />
          <span style={{ fontSize: 12, color: "#9ca3af" }}>Fetching campaigns from all workspaces...</span>
        </div>
      )}

      {/* Workspace sections */}
      {!loading && data?.workspaces.map(ws => (
        <WorkspaceSection key={ws.slug} ws={ws} />
      ))}
    </div>
  );
}