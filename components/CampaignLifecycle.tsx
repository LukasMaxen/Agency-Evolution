"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Loader2, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, TrendingUp, Clock } from "lucide-react";

type CampaignStatus =
  | "ramping"
  | "healthy"
  | "below_reply_rate"
  | "below_interested_rate"
  | "failed_both"
  | "approaching_70"
  | "launch_new";

interface CampaignLifecycleRow {
  campaign_name: string;
  campaign_id: number | null;
  workspace_slug: string;
  workspace_name: string;
  emails_sent: number;
  reply_count: number;
  reply_rate: number;
  interested_count: number;
  interested_rate: number;
  total_leads: number;
  contacted: number;
  pct_contacted: number;
  synced_at: string | null;
  status: CampaignStatus;
}

interface WorkspaceGroup {
  workspace_slug: string;
  workspace_name: string;
  campaigns: CampaignLifecycleRow[];
}

interface LifecycleData {
  workspaces: WorkspaceGroup[];
  summary: {
    healthy: number;
    ramping: number;
    belowKpi: number;
    launchNew: number;
    approaching: number;
  };
}

const STATUS_CFG: Record<CampaignStatus, { label: string; bg: string; color: string; border: string; bar: string; icon: React.ElementType }> = {
  healthy:              { label: "Healthy",                bg: "#d1fae5", color: "#065f46", border: "#6ee7b7", bar: "#10b981", icon: CheckCircle },
  ramping:              { label: "Ramping",                bg: "#f3f4f6", color: "#374151", border: "#d1d5db", bar: "#9ca3af", icon: Clock },
  below_reply_rate:     { label: "Below reply rate KPI",   bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", bar: "#ef4444", icon: AlertTriangle },
  below_interested_rate:{ label: "Below interested rate KPI", bg: "#fef3c7", color: "#92400e", border: "#fcd34d", bar: "#f59e0b", icon: AlertTriangle },
  failed_both:          { label: "Failed both KPIs",       bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", bar: "#ef4444", icon: AlertTriangle },
  approaching_70:       { label: "Approaching 70% contacted", bg: "#fef3c7", color: "#92400e", border: "#fcd34d", bar: "#f59e0b", icon: TrendingUp },
  launch_new:           { label: "Launch new campaign",    bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", bar: "#ef4444", icon: AlertTriangle },
};

// ── Campaign Card ─────────────────────────────────────────────────────────────

function CampaignCard({ c }: { c: CampaignLifecycleRow }) {
  const cfg = STATUS_CFG[c.status];
  const StatusIcon = cfg.icon;

  const replyOk = c.reply_rate >= 1;
  const interestedOk = c.interested_rate >= 20;
  const isRamping = c.status === "ramping";

  return (
    <div style={{
      borderRadius: "0 8px 8px 0",
      border: "1px solid #f0f0f0",
      borderLeft: `3px solid ${cfg.bar}`,
      background: "#ffffff",
      marginBottom: 8,
      padding: "12px 16px",
    }}>
      {/* Top row: name + status badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#111827", flex: 1 }}>
          {c.campaign_name}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
          background: cfg.bg, color: cfg.color,
          display: "flex", alignItems: "center", gap: 4,
        }}>
          <StatusIcon size={10} />
          {cfg.label}
        </span>
      </div>

      {/* Metrics row */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
        {/* Emails sent */}
        <div>
          <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 1 }}>Emails sent</p>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
            {c.emails_sent.toLocaleString()}
            {isRamping && <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 400, marginLeft: 4 }}>(ramping)</span>}
          </p>
        </div>

        {/* Reply rate */}
        <div>
          <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 1 }}>Reply rate</p>
          <p style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ color: isRamping ? "#6b7280" : replyOk ? "#065f46" : "#991b1b" }}>
              {c.reply_rate.toFixed(1)}%
            </span>
            {!isRamping && (
              <span style={{ fontSize: 9, color: replyOk ? "#10b981" : "#ef4444" }}>
                {replyOk ? "▲" : "▼"} KPI: ≥1%
              </span>
            )}
          </p>
        </div>

        {/* Interested rate */}
        <div>
          <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 1 }}>Interested rate</p>
          <p style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ color: isRamping ? "#6b7280" : interestedOk ? "#065f46" : "#991b1b" }}>
              {c.interested_rate.toFixed(1)}%
            </span>
            {!isRamping && (
              <span style={{ fontSize: 9, color: interestedOk ? "#10b981" : "#ef4444" }}>
                {interestedOk ? "▲" : "▼"} KPI: ≥20%
              </span>
            )}
          </p>
        </div>

        {/* Replies / interested */}
        <div>
          <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 1 }}>Replies</p>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
            {c.reply_count.toLocaleString()}
            <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>
              {" "}({c.interested_count} interested)
            </span>
          </p>
        </div>

        {/* % contacted */}
        <div style={{ flex: 1, minWidth: 120 }}>
          <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>
            Contacted
            {c.synced_at && (
              <span style={{ marginLeft: 4, color: "#d1d5db" }}>
                · synced {new Date(c.synced_at).toLocaleDateString()}
              </span>
            )}
            {!c.synced_at && c.total_leads === 0 && (
              <span style={{ marginLeft: 4, color: "#d1d5db" }}>· no sync data</span>
            )}
          </p>
          {c.total_leads > 0 ? (
            <>
              <div style={{ height: 5, background: "#f1f5f9", borderRadius: 10, overflow: "hidden", maxWidth: 160 }}>
                <div style={{
                  width: `${Math.min(c.pct_contacted, 100)}%`,
                  height: "100%",
                  background: c.pct_contacted >= 70 ? "#ef4444" : c.pct_contacted >= 60 ? "#f59e0b" : "#10b981",
                  borderRadius: 10,
                }} />
              </div>
              <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
                {c.pct_contacted.toFixed(0)}% of {c.total_leads.toLocaleString()} leads
              </p>
            </>
          ) : (
            <p style={{ fontSize: 11, color: "#d1d5db" }}>Run lead sync to see progress</p>
          )}
        </div>
      </div>

      {/* Action hint for actionable statuses */}
      {(c.status === "launch_new" || c.status === "failed_both") && (
        <div style={{
          marginTop: 10, padding: "6px 10px", background: "#fef2f2",
          border: "1px solid #fecaca", borderRadius: 6, fontSize: 11, color: "#991b1b",
        }}>
          {c.status === "launch_new"
            ? "Campaign is 70%+ contacted. Start a new campaign with the same ICP — do not push new leads here."
            : "Failed both KPIs after 1,000+ emails. Investigate script, list quality, and deliverability before rebuilding."}
        </div>
      )}
      {c.status === "approaching_70" && (
        <div style={{
          marginTop: 10, padding: "6px 10px", background: "#fffbeb",
          border: "1px solid #fde68a", borderRadius: 6, fontSize: 11, color: "#92400e",
        }}>
          Approaching 70% contacted. Prepare a new campaign so you can switch seamlessly.
        </div>
      )}
    </div>
  );
}

// ── Workspace Section ─────────────────────────────────────────────────────────

function WorkspaceSection({ group }: { group: WorkspaceGroup }) {
  const [open, setOpen] = useState(true);

  const urgent = group.campaigns.filter(c =>
    ["launch_new", "failed_both", "below_reply_rate", "below_interested_rate"].includes(c.status)
  ).length;

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
          cursor: "pointer", padding: "4px 0",
        }}
      >
        {open ? <ChevronUp size={13} color="#9ca3af" /> : <ChevronDown size={13} color="#9ca3af" />}
        <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", flex: 1, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {group.workspace_name}
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{group.campaigns.length} campaigns</span>
        {urgent > 0 && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "#fee2e2", color: "#991b1b" }}>
            {urgent} needs action
          </span>
        )}
      </div>

      {open && group.campaigns.map(c => (
        <CampaignCard key={c.campaign_name} c={c} />
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function CampaignLifecycle() {
  const [data, setData] = useState<LifecycleData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/campaign-lifecycle?workspace=all");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Top bar */}
      <div style={{
        padding: "16px 24px", borderBottom: "1px solid #ede9e3",
        display: "flex", alignItems: "center", gap: 12, background: "#ffffff",
      }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>Campaign Lifecycle</p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            KPI health and % contacted across all campaigns
          </p>
        </div>

        {/* Summary badges */}
        {data?.summary && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {data.summary.launchNew > 0 && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6, background: "#fee2e2", color: "#991b1b", display: "flex", alignItems: "center", gap: 4 }}>
                <AlertTriangle size={11} /> {data.summary.launchNew} launch new
              </span>
            )}
            {data.summary.belowKpi > 0 && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6, background: "#fef3c7", color: "#92400e" }}>
                {data.summary.belowKpi} below KPI
              </span>
            )}
            {data.summary.approaching > 0 && (
              <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 10px", borderRadius: 6, background: "#fffbeb", color: "#92400e" }}>
                {data.summary.approaching} approaching 70%
              </span>
            )}
            {data.summary.healthy > 0 && (
              <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 10px", borderRadius: 6, background: "#d1fae5", color: "#065f46" }}>
                {data.summary.healthy} healthy
              </span>
            )}
            {data.summary.ramping > 0 && (
              <span style={{ fontSize: 11, fontWeight: 400, padding: "3px 10px", borderRadius: 6, background: "#f3f4f6", color: "#6b7280" }}>
                {data.summary.ramping} ramping
              </span>
            )}
          </div>
        )}

        <button
          onClick={load}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
            borderRadius: 7, border: "1px solid #e5e7eb", background: "#fff",
            color: "#374151", fontSize: 12, cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      {/* KPI reference bar */}
      <div style={{
        padding: "8px 24px", borderBottom: "1px solid #f3f4f6",
        background: "#fafafa", display: "flex", gap: 20, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>
          KPI thresholds (after 1,000 emails):
        </span>
        <span style={{ fontSize: 10, color: "#374151" }}>Reply rate ≥ 1%</span>
        <span style={{ fontSize: 10, color: "#374151" }}>Interested rate ≥ 20% of replies</span>
        <span style={{ fontSize: 10, color: "#374151" }}>Launch new when 70%+ contacted</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        {loading && !data && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}>
            <Loader2 size={20} className="animate-spin" style={{ color: "#9ca3af" }} />
          </div>
        )}

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#991b1b" }}>{error}</p>
          </div>
        )}

        {data && data.workspaces.length === 0 && (
          <div style={{ textAlign: "center", padding: 60 }}>
            <p style={{ fontSize: 13, color: "#9ca3af" }}>No campaign data found.</p>
            <p style={{ fontSize: 11, color: "#d1d5db", marginTop: 6 }}>
              Campaign metrics appear once EMAIL_SENT webhook events have been received.
            </p>
          </div>
        )}

        {data?.workspaces.map(group => (
          <WorkspaceSection key={group.workspace_slug} group={group} />
        ))}
      </div>
    </div>
  );
}
