"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Loader2, Upload } from "lucide-react";

interface Campaign {
  id: number;
  name: string;
  newLeadsPerDay: number;
  weeklyCapacity: number;
  remaining: number;
  leadsNeeded: number;
}

interface WorkspaceResult {
  workspace: string;
  slug: string;
  error: string | null;
  campaigns: Campaign[];
}

export function LeadMonitoring() {
  const [data, setData]       = useState<WorkspaceResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lead-monitoring");
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      const json = await res.json();

      // Filter to only active campaigns that need leads
      const workspaces: WorkspaceResult[] = (json.workspaces ?? [])
        .map((ws: any) => ({
          workspace: ws.workspace,
          slug: ws.slug,
          error: ws.error,
          campaigns: (ws.campaigns ?? [])
            .map((c: any) => ({
              id:             c.id,
              name:           c.name,
              newLeadsPerDay: c.newLeadsPerDay,
              weeklyCapacity: c.weeklyCapacity,
              remaining:      c.remaining,
              leadsNeeded:    Math.max(0, c.weeklyCapacity - c.remaining),
            }))
            .filter((c: Campaign) => c.leadsNeeded > 0)
            .sort((a: Campaign, b: Campaign) => b.leadsNeeded - a.leadsNeeded),
        }))
        .filter((ws: WorkspaceResult) => ws.campaigns.length > 0);

      setData(workspaces);
      setLastSynced(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
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

  const totalNeeded = data.flatMap(ws => ws.campaigns).reduce((s, c) => s + c.leadsNeeded, 0);
  const totalCampaigns = data.flatMap(ws => ws.campaigns).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f8f7f5" }}>

      {/* Header */}
      <div style={{
        padding: "16px 24px", borderBottom: "1px solid #ede9e3",
        background: "#ffffff", display: "flex", alignItems: "center", gap: 12,
      }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>Lead Monitoring</p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            Campaigns that need new leads uploaded this week
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {syncMsg && (
            <span style={{ fontSize: 11, color: "#6b7280" }}>{syncMsg}</span>
          )}
          {lastSynced && !loading && (
            <span style={{ fontSize: 11, color: "#d1d5db" }}>Updated {lastSynced}</span>
          )}
          <button
            onClick={sync}
            disabled={syncing || loading}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 11, padding: "5px 12px", borderRadius: 8,
              border: "1px solid #1a56db", background: "#1a56db", color: "#fff",
              cursor: syncing || loading ? "not-allowed" : "pointer",
              opacity: syncing || loading ? 0.7 : 1,
            }}
          >
            <RefreshCw size={11} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing..." : "Sync now"}
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {!loading && totalCampaigns > 0 && (
        <div style={{
          padding: "10px 24px", borderBottom: "1px solid #f3f4f6",
          background: "#fffbeb", display: "flex", alignItems: "center", gap: 8,
        }}>
          <Upload size={12} style={{ color: "#d97706" }} />
          <span style={{ fontSize: 12, color: "#92400e", fontWeight: 500 }}>
            {totalCampaigns} {totalCampaigns === 1 ? "campaign needs" : "campaigns need"} leads this week
            <span style={{ fontWeight: 700, marginLeft: 4 }}>
              ({totalNeeded.toLocaleString()} leads total)
            </span>
          </span>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

        {/* Loading */}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", padding: 60 }}>
            <Loader2 size={16} className="animate-spin" style={{ color: "#9ca3af" }} />
            <span style={{ fontSize: 12, color: "#9ca3af" }}>Loading campaigns...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ fontSize: 12, color: "#dc2626", background: "#fee2e2", padding: "10px 14px", borderRadius: 8, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* All covered */}
        {!loading && !error && data.length === 0 && (
          <div style={{ textAlign: "center", padding: 60 }}>
            <p style={{ fontSize: 13, color: "#9ca3af" }}>All active campaigns have enough leads for this week.</p>
          </div>
        )}

        {/* Workspace groups */}
        {!loading && data.map(ws => (
          <div key={ws.slug} style={{ marginBottom: 24 }}>

            {/* Workspace header */}
            <p style={{
              fontSize: 11, fontWeight: 700, color: "#6b7280",
              textTransform: "uppercase", letterSpacing: "0.06em",
              marginBottom: 10,
            }}>
              {ws.workspace}
            </p>

            {/* Campaign rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ws.campaigns.map(c => (
                <div
                  key={c.id}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: "#ffffff", borderRadius: 10,
                    border: "1px solid #ede9e3",
                    borderLeft: "3px solid #f59e0b",
                    padding: "12px 16px",
                    gap: 16,
                  }}
                >
                  {/* Campaign name + daily rate */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: "#111827", marginBottom: 3 }}>
                      {c.name}
                    </p>
                    <p style={{ fontSize: 11, color: "#9ca3af" }}>
                      {c.newLeadsPerDay.toLocaleString()} new leads/day · {c.weeklyCapacity.toLocaleString()} needed/week · {c.remaining.toLocaleString()} remaining
                    </p>
                  </div>

                  {/* Upload action */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "#fffbeb", borderRadius: 8,
                    border: "1px solid #fde68a",
                    padding: "8px 14px", flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}>
                    <Upload size={13} style={{ color: "#d97706" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>
                      Upload {c.leadsNeeded.toLocaleString()} leads
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}