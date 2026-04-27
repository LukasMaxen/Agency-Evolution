"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Loader2, ChevronDown, ChevronUp } from "lucide-react";

interface Campaign {
  id: number;
  name: string;
  step0: number;
  step1: number;
  step2: number;
  step3: number;
  step4: number;
  completed: number;
  bounced: number;
  totalLeads: number;
  syncedAt: string;
}

interface WorkspaceResult {
  workspace: string;
  slug: string;
  campaigns: Campaign[];
}

const STEPS = [
  { key: "step0",     label: "Not sent",   color: "#e5e7eb", text: "#6b7280" },
  { key: "step1",     label: "Sent 1",     color: "#dbeafe", text: "#1e40af" },
  { key: "step2",     label: "Sent 2",     color: "#e0e7ff", text: "#3730a3" },
  { key: "step3",     label: "Sent 3",     color: "#ede9fe", text: "#5b21b6" },
  { key: "step4",     label: "Sent 4+",    color: "#fae8ff", text: "#7e22ce" },
  { key: "completed", label: "Completed",  color: "#d1fae5", text: "#065f46" },
  { key: "bounced",   label: "Bounced",    color: "#fee2e2", text: "#991b1b" },
];

function CampaignRow({ c }: { c: Campaign }) {
  const [open, setOpen] = useState(false);

  const active = c.step0 + c.step1 + c.step2 + c.step3 + c.step4;
  const syncedAt = new Date(c.syncedAt).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div style={{
      background: "#ffffff",
      border: "1px solid #f0f0f0",
      borderRadius: 8,
      marginBottom: 8,
    }}>
      {/* Collapsed row */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, color: "#111827", flex: 1, minWidth: 160 }}>
          {c.name}
        </span>

        {/* Step pills — collapsed summary */}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {STEPS.map(s => {
            const val = c[s.key as keyof Campaign] as number;
            if (val === 0) return null;
            return (
              <span key={s.key} style={{
                fontSize: 10, padding: "2px 7px", borderRadius: 20,
                background: s.color, color: s.text, fontWeight: 500, whiteSpace: "nowrap",
              }}>
                {s.label}: {val.toLocaleString()}
              </span>
            );
          })}
        </div>

        <span style={{ fontSize: 10, color: "#d1d5db", whiteSpace: "nowrap" }}>
          {syncedAt}
        </span>

        {open ? <ChevronUp size={13} color="#9ca3af" /> : <ChevronDown size={13} color="#9ca3af" />}
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid #f9fafb" }}>

          {/* Visual bar */}
          <div style={{ marginTop: 12, marginBottom: 14 }}>
            <div style={{ display: "flex", height: 10, borderRadius: 10, overflow: "hidden", gap: 1 }}>
              {STEPS.map(s => {
                const val = c[s.key as keyof Campaign] as number;
                const pct = c.totalLeads > 0 ? (val / c.totalLeads) * 100 : 0;
                if (pct === 0) return null;
                return (
                  <div key={s.key} title={`${s.label}: ${val}`}
                    style={{ width: `${pct}%`, background: s.color === "#e5e7eb" ? "#d1d5db" : s.color, minWidth: 2 }} />
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
              {STEPS.map(s => {
                const val = c[s.key as keyof Campaign] as number;
                if (val === 0) return null;
                const pct = c.totalLeads > 0 ? Math.round((val / c.totalLeads) * 100) : 0;
                return (
                  <span key={s.key} style={{ fontSize: 10, color: s.text, display: "flex", alignItems: "center", gap: 3 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color === "#e5e7eb" ? "#d1d5db" : s.color, display: "inline-block" }} />
                    {s.label} {pct}%
                  </span>
                );
              })}
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 8 }}>
            {STEPS.map(s => {
              const val = c[s.key as keyof Campaign] as number;
              return (
                <div key={s.key} style={{ background: "#f8f9fa", borderRadius: 6, padding: "6px 8px" }}>
                  <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>{s.label}</p>
                  <p style={{ fontSize: 14, fontWeight: 500, color: s.text }}>{val.toLocaleString()}</p>
                </div>
              );
            })}
            <div style={{ background: "#f8f9fa", borderRadius: 6, padding: "6px 8px" }}>
              <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>Active</p>
              <p style={{ fontSize: 14, fontWeight: 500, color: "#111827" }}>{active.toLocaleString()}</p>
            </div>
            <div style={{ background: "#f8f9fa", borderRadius: 6, padding: "6px 8px" }}>
              <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>Total</p>
              <p style={{ fontSize: 14, fontWeight: 500, color: "#111827" }}>{c.totalLeads.toLocaleString()}</p>
            </div>
          </div>

          <p style={{ fontSize: 10, color: "#d1d5db", marginTop: 10 }}>Last synced: {syncedAt}</p>
        </div>
      )}
    </div>
  );
}

function WorkspaceSection({ ws }: { ws: WorkspaceResult }) {
  const [open, setOpen] = useState(true);

  const totalActive = ws.campaigns.reduce((s, c) =>
    s + c.step0 + c.step1 + c.step2 + c.step3 + c.step4, 0);
  const totalCompleted = ws.campaigns.reduce((s, c) => s + c.completed, 0);

  return (
    <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #ede9e3", overflow: "hidden", marginBottom: 12 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ padding: "12px 16px", background: "#f8f7f5", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", borderBottom: open ? "1px solid #ede9e3" : "none" }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: "#111827", flex: 1 }}>{ws.workspace}</span>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#dbeafe", color: "#1e40af" }}>
            {totalActive.toLocaleString()} active
          </span>
          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#d1fae5", color: "#065f46" }}>
            {totalCompleted.toLocaleString()} completed
          </span>
        </div>
        {open ? <ChevronUp size={14} color="#9ca3af" /> : <ChevronDown size={14} color="#9ca3af" />}
      </div>

      {open && (
        <div style={{ padding: "10px 14px" }}>
          {ws.campaigns.length === 0 && (
            <p style={{ fontSize: 12, color: "#9ca3af", padding: "8px 0" }}>No data yet — run a sync first.</p>
          )}
          {ws.campaigns.map(c => (
            <CampaignRow key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LeadProgress() {
  const [data,    setData]    = useState<{ workspaces: WorkspaceResult[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lead-progress");
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      setData(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const sync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync-lead-progress");
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Sync failed"); }
      const d = await res.json();
      setSyncMsg(`Synced ${d.synced?.length ?? 0} campaigns`);
      await load();
    } catch (err: any) {
      setSyncMsg(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => { load(); }, [load]);

  const all          = data?.workspaces.flatMap(w => w.campaigns) ?? [];
  const totalLeads   = all.reduce((s, c) => s + c.totalLeads, 0);
  const totalActive  = all.reduce((s, c) => s + c.step0 + c.step1 + c.step2 + c.step3 + c.step4, 0);
  const totalDone    = all.reduce((s, c) => s + c.completed, 0);
  const totalBounced = all.reduce((s, c) => s + c.bounced, 0);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#f8f7f5", padding: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, color: "#111827" }}>Daily Campaign Lead Progress</p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            Where every lead stands in the sequence — across all workspaces
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {syncMsg && (
            <span style={{ fontSize: 11, color: "#6b7280" }}>{syncMsg}</span>
          )}
          <button
            onClick={sync} disabled={syncing}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "5px 12px", borderRadius: 8, border: "1px solid #1a56db", background: "#1a56db", color: "#fff", cursor: syncing ? "not-allowed" : "pointer", opacity: syncing ? 0.7 : 1 }}
          >
            <RefreshCw size={11} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing..." : "Sync now"}
          </button>
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
            { label: "Total leads",  value: totalLeads.toLocaleString(),   color: "#111827" },
            { label: "Active",       value: totalActive.toLocaleString(),   color: "#1e40af" },
            { label: "Completed",    value: totalDone.toLocaleString(),     color: "#065f46" },
            { label: "Bounced",      value: totalBounced.toLocaleString(),  color: "#991b1b" },
          ].map(m => (
            <div key={m.label} style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #ede9e3", padding: 14 }}>
              <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>{m.label}</p>
              <p style={{ fontSize: 22, fontWeight: 500, color: m.color }}>{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Empty state — no data yet */}
      {!loading && data?.workspaces.length === 0 && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 12 }}>No data yet. Run a sync to pull lead progress from EmailBison.</p>
          <button onClick={sync} disabled={syncing}
            style={{ fontSize: 12, padding: "8px 16px", borderRadius: 8, border: "1px solid #1a56db", background: "#1a56db", color: "#fff", cursor: "pointer" }}>
            {syncing ? "Syncing..." : "Run first sync"}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ fontSize: 12, color: "#dc2626", background: "#fee2e2", padding: "10px 14px", borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 40, justifyContent: "center" }}>
          <Loader2 size={16} className="animate-spin" style={{ color: "#9ca3af" }} />
          <span style={{ fontSize: 12, color: "#9ca3af" }}>Loading lead progress...</span>
        </div>
      )}

      {/* Workspace sections */}
      {!loading && data?.workspaces.map(ws => (
        <WorkspaceSection key={ws.slug} ws={ws} />
      ))}
    </div>
  );
}