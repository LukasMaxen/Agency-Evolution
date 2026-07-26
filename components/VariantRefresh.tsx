"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Loader2, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { useWorkspaces } from "@/lib/workspaces-context";

interface VariantStat {
  email_body: string;
  send_count: number;
  threshold: "green" | "yellow" | "red";
  last_refresh: string | null;
  last_refresh_type: "light" | "moderate" | "emergency" | null;
  pending_refresh_id: string | null;
}

interface CampaignVariantStats {
  campaign_name: string;
  campaign_id: number | null;
  workspace_slug: string;
  variants: VariantStat[];
}

interface VariantData {
  campaigns: CampaignVariantStats[];
  redCount: number;
  yellowCount: number;
  pendingCount: number;
}

const THRESHOLD_CFG = {
  green:  { label: "OK",              bg: "#d1fae5", color: "#065f46", border: "#6ee7b7", bar: "#10b981" },
  yellow: { label: "Light refresh",   bg: "#fef3c7", color: "#92400e", border: "#fcd34d", bar: "#f59e0b" },
  red:    { label: "Moderate refresh", bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", bar: "#ef4444" },
};

// ── Refresh Modal ─────────────────────────────────────────────────────────────

function RefreshModal({
  variant,
  campaign,
  workspace,
  onClose,
  onPushed,
}: {
  variant: VariantStat;
  campaign: CampaignVariantStats;
  workspace: string;
  onClose: () => void;
  onPushed: () => void;
}) {
  const [stage, setStage] = useState<"idle" | "generating" | "review" | "pushing" | "done" | "error">("idle");
  const [refreshId, setRefreshId] = useState<string | null>(variant.pending_refresh_id);
  const [refreshedBody, setRefreshedBody] = useState<string>("");
  const [refreshType, setRefreshType] = useState<string>("");
  const [error, setError] = useState<string>("");

  // If there's already a pending refresh, load it
  useEffect(() => {
    if (variant.pending_refresh_id) {
      setStage("review");
      // We don't have the body in the listing — fetch it
      fetch(`/api/variant-refresh?workspace=${workspace}`)
        .then(r => r.json())
        .then(() => {
          // We need a separate endpoint to fetch pending refresh body — for now show regenerate option
          setStage("idle");
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setStage("generating");
    setError("");
    try {
      const res = await fetch("/api/variant-refresh/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_slug: workspace,
          campaign_name: campaign.campaign_name,
          campaign_id: campaign.campaign_id,
          step_order: 0,
          original_body: variant.email_body,
          send_count: variant.send_count,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setRefreshId(data.refresh_id);
      setRefreshedBody(data.refreshed_body);
      setRefreshType(data.refresh_type);
      setStage("review");
    } catch (e: any) {
      setError(e.message);
      setStage("error");
    }
  }

  async function approve() {
    if (!refreshId) return;
    setStage("pushing");
    setError("");
    try {
      const res = await fetch("/api/variant-refresh/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_id: refreshId, workspace }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Push failed");
      setStage("done");
    } catch (e: any) {
      setError(e.message);
      setStage("error");
    }
  }

  async function reject() {
    if (refreshId) {
      await fetch("/api/variant-refresh/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_id: refreshId }),
      });
    }
    setRefreshId(null);
    setRefreshedBody("");
    setStage("idle");
  }

  function handleDone() {
    onPushed();
    onClose();
  }

  const cfg = THRESHOLD_CFG[variant.threshold];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.4)",
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff", borderRadius: 12, padding: 28, width: 760, maxWidth: "90vw",
        maxHeight: "85vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{campaign.campaign_name}</p>
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
              {variant.send_count.toLocaleString()} sends
              {" · "}
              <span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label} needed</span>
            </p>
          </div>
          <button onClick={onClose} style={{ fontSize: 20, color: "#9ca3af", border: "none", background: "none", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* Body comparison */}
        <div style={{ display: "grid", gridTemplateColumns: stage === "review" || stage === "pushing" || stage === "done" ? "1fr 1fr" : "1fr", gap: 16, marginBottom: 20 }}>
          {/* Original */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Current variant
            </p>
            <div style={{
              background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8,
              padding: 14, fontSize: 12, color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "inherit",
            }}>
              {variant.email_body}
            </div>
          </div>

          {/* Refreshed */}
          {(stage === "review" || stage === "pushing" || stage === "done") && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Refreshed variant
                {refreshType && (
                  <span style={{ marginLeft: 8, fontWeight: 400, textTransform: "none", color: "#9ca3af" }}>
                    ({refreshType} refresh)
                  </span>
                )}
              </p>
              <div style={{
                background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8,
                padding: 14, fontSize: 12, color: "#14532d", lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "inherit",
              }}>
                {refreshedBody || <span style={{ color: "#9ca3af" }}>No refreshed copy yet</span>}
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {stage === "error" && error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: "#991b1b" }}>{error}</p>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          {stage === "done" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#065f46", fontSize: 12, fontWeight: 500 }}>
                <CheckCircle size={14} /> Pushed to EmailBison
              </div>
              <button onClick={handleDone} style={{
                padding: "7px 16px", borderRadius: 7, border: "none", background: "#1a56db", color: "#fff",
                fontSize: 12, fontWeight: 500, cursor: "pointer",
              }}>Done</button>
            </>
          )}

          {stage === "review" && (
            <>
              <button onClick={reject} style={{
                padding: "7px 16px", borderRadius: 7, border: "1px solid #e5e7eb", background: "#fff",
                color: "#374151", fontSize: 12, fontWeight: 500, cursor: "pointer",
              }}>Regenerate</button>
              <button onClick={approve} style={{
                padding: "7px 16px", borderRadius: 7, border: "none", background: "#1a56db", color: "#fff",
                fontSize: 12, fontWeight: 500, cursor: "pointer",
              }}>Approve and push</button>
            </>
          )}

          {stage === "pushing" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#6b7280", fontSize: 12 }}>
              <Loader2 size={14} className="animate-spin" /> Pushing to EmailBison...
            </div>
          )}

          {(stage === "idle" || stage === "error") && (
            <>
              <button onClick={onClose} style={{
                padding: "7px 16px", borderRadius: 7, border: "1px solid #e5e7eb", background: "#fff",
                color: "#374151", fontSize: 12, fontWeight: 500, cursor: "pointer",
              }}>Cancel</button>
              <button onClick={generate} style={{
                padding: "7px 16px", borderRadius: 7, border: "none", background: "#1a56db", color: "#fff",
                fontSize: 12, fontWeight: 500, cursor: "pointer",
              }}>Generate refresh</button>
            </>
          )}

          {stage === "generating" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#6b7280", fontSize: 12 }}>
              <Loader2 size={14} className="animate-spin" /> Generating with Claude...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Variant Row ───────────────────────────────────────────────────────────────

function VariantRow({
  variant,
  campaign,
  workspace,
  onPushed,
}: {
  variant: VariantStat;
  campaign: CampaignVariantStats;
  workspace: string;
  onPushed: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const cfg = THRESHOLD_CFG[variant.threshold];

  const preview = variant.email_body.length > 150
    ? variant.email_body.slice(0, 150).trimEnd() + "…"
    : variant.email_body;

  return (
    <>
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "9px 14px",
        borderBottom: "1px solid #f3f4f6", flexWrap: "wrap",
      }}>
        {/* Threshold dot */}
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.bar, flexShrink: 0 }} />

        {/* Preview */}
        <span style={{ flex: 1, fontSize: 12, color: "#374151", minWidth: 200, fontFamily: "inherit" }}>
          {preview}
        </span>

        {/* Send count */}
        <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>
          {variant.send_count.toLocaleString()} sends
        </span>

        {/* Threshold badge */}
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
          background: cfg.bg, color: cfg.color, whiteSpace: "nowrap",
        }}>
          {cfg.label}
        </span>

        {/* Last refresh */}
        {variant.last_refresh && (
          <span style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap" }}>
            Refreshed {new Date(variant.last_refresh).toLocaleDateString()}
          </span>
        )}

        {/* Pending badge or refresh button */}
        {variant.pending_refresh_id ? (
          <span style={{
            fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
            background: "#eff6ff", color: "#1a56db", display: "flex", alignItems: "center", gap: 4,
          }}>
            <Clock size={10} /> Pending approval
          </span>
        ) : variant.threshold !== "green" && campaign.campaign_id ? (
          <button
            onClick={() => setModalOpen(true)}
            style={{
              padding: "4px 12px", borderRadius: 6, border: "1px solid #e5e7eb",
              background: "#fff", color: "#1a56db", fontSize: 11, fontWeight: 500,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <RefreshCw size={11} /> Refresh
          </button>
        ) : variant.threshold !== "green" ? (
          <span style={{ fontSize: 10, color: "#9ca3af" }} title="Campaign ID not resolved — run lead sync first">
            Sync needed
          </span>
        ) : null}
      </div>

      {modalOpen && (
        <RefreshModal
          variant={variant}
          campaign={campaign}
          workspace={workspace}
          onClose={() => setModalOpen(false)}
          onPushed={onPushed}
        />
      )}
    </>
  );
}

// ── Campaign Section ──────────────────────────────────────────────────────────

function CampaignSection({
  campaign,
  workspace,
  onPushed,
}: {
  campaign: CampaignVariantStats;
  workspace: string;
  onPushed: () => void;
}) {
  const [open, setOpen] = useState(true);

  const redCount = campaign.variants.filter(v => v.threshold === "red").length;
  const yellowCount = campaign.variants.filter(v => v.threshold === "yellow").length;

  return (
    <div style={{ marginBottom: 12, border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden" }}>
      {/* Header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
          background: "#f9fafb", cursor: "pointer", borderBottom: open ? "1px solid #f0f0f0" : "none",
        }}
      >
        {open ? <ChevronUp size={14} color="#9ca3af" /> : <ChevronDown size={14} color="#9ca3af" />}
        <span style={{ fontSize: 12, fontWeight: 600, color: "#111827", flex: 1 }}>
          {campaign.campaign_name}
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{campaign.variants.length} variant{campaign.variants.length !== 1 ? "s" : ""}</span>
        {redCount > 0 && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "#fee2e2", color: "#991b1b" }}>
            {redCount} urgent
          </span>
        )}
        {yellowCount > 0 && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "#fef3c7", color: "#92400e" }}>
            {yellowCount} due
          </span>
        )}
        {!campaign.campaign_id && (
          <span style={{ fontSize: 10, color: "#9ca3af" }} title="Run lead sync to resolve">
            No campaign ID
          </span>
        )}
      </div>

      {/* Rows */}
      {open && campaign.variants.map((v, i) => (
        <VariantRow key={i} variant={v} campaign={campaign} workspace={workspace} onPushed={onPushed} />
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function VariantRefresh() {
  const workspaces = useWorkspaces();
const [workspace, setWorkspace] = useState("");

useEffect(() => {
  if (workspaces.length > 0 && !workspace) {
    setWorkspace(workspaces[0].slug);
  }
}, [workspaces]);

  const [data, setData] = useState<VariantData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/variant-refresh?workspace=${workspace}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Top bar */}
      <div style={{
        padding: "16px 24px", borderBottom: "1px solid #ede9e3",
        display: "flex", alignItems: "center", gap: 12, background: "#ffffff",
      }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>Variant Refresh</p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            Track sends per variant body and refresh copy before spam filters kick in
          </p>
        </div>

        {/* Summary badges */}
        {data && (
          <div style={{ display: "flex", gap: 8 }}>
            {data.redCount > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
                background: "#fee2e2", color: "#991b1b", display: "flex", alignItems: "center", gap: 4,
              }}>
                <AlertTriangle size={11} /> {data.redCount} urgent
              </span>
            )}
            {data.yellowCount > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
                background: "#fef3c7", color: "#92400e",
              }}>
                {data.yellowCount} due soon
              </span>
            )}
            {data.pendingCount > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 500, padding: "3px 10px", borderRadius: 6,
                background: "#eff6ff", color: "#1a56db", display: "flex", alignItems: "center", gap: 4,
              }}>
                <Clock size={11} /> {data.pendingCount} pending
              </span>
            )}
          </div>
        )}

        {/* Workspace selector */}
        <select
          value={workspace}
          onChange={e => setWorkspace(e.target.value)}
          style={{
            fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 7,
            padding: "5px 10px", background: "#fff", color: "#374151", cursor: "pointer",
          }}
        >
          {workspaces.map(w => (
  <option key={w.slug} value={w.slug}>{w.name}</option>
))}
        </select>

        {/* Refresh button */}
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

        {data && data.campaigns.length === 0 && (
          <div style={{ textAlign: "center", padding: 60 }}>
            <p style={{ fontSize: 13, color: "#9ca3af" }}>No email body data found for this workspace.</p>
            <p style={{ fontSize: 11, color: "#d1d5db", marginTop: 6 }}>
              Variant send counts appear once EMAIL_SENT webhook events have been received.
            </p>
          </div>
        )}

        {/* Threshold legend */}
        {data && data.campaigns.length > 0 && (
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            {(["green", "yellow", "red"] as const).map(t => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: THRESHOLD_CFG[t].bar }} />
                <span style={{ fontSize: 11, color: "#6b7280" }}>
                  {t === "green" ? "Under 500 sends — OK" : t === "yellow" ? "500–1,999 sends — light refresh" : "2,000+ sends — moderate refresh"}
                </span>
              </div>
            ))}
          </div>
        )}

        {data?.campaigns.map(c => (
          <CampaignSection
            key={c.campaign_name}
            campaign={c}
            workspace={workspace}
            onPushed={load}
          />
        ))}
      </div>
    </div>
  );
}
