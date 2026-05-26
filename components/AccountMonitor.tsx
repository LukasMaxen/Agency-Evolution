"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import {
  RefreshCw, Loader2, ChevronLeft, AlertTriangle, CheckCircle,
  TrendingDown, WifiOff, Wifi, Flame, ChevronDown, ChevronUp,
} from "lucide-react";
import { useWorkspaces, findWorkspace } from "@/lib/workspaces-context";

// ── Types ─────────────────────────────────────────────────────────────────────

type Status = "spam_risk" | "low_replies" | "healthy";
type ActionKey = "remove" | "reattach" | "remove_and_warmup";

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

interface DomainData {
  domain: string;
  accounts: Account[];
  totalSent: number;
  totalReplies: number;
  totalBounces: number;
  spamRiskCount: number;
  avgReplyRate: number;
  bouncePct: number;
}

interface WorkspaceData {
  slug: string;
  accounts: Account[];
  domains: DomainData[];
  domainCount: number;
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

interface ActionResult {
  ok: boolean;
  action: ActionKey;
  campaigns_affected: number;
  succeeded: number;
  failed: number;
  warmup: string | null;
  error?: string;
}

interface CampaignItem {
  id: number;
  name: string;
  status: string;
  reply_count: number;
  interested_count: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveWsName(workspaces: ReturnType<typeof useWorkspaces>, slug: string): string {
  return findWorkspace(workspaces, slug).name !== "Unknown"
    ? findWorkspace(workspaces, slug).name
    : slug;
}

function resolveWsColor(workspaces: ReturnType<typeof useWorkspaces>, slug: string): string {
  return findWorkspace(workspaces, slug).color;
}

const STATUS_CFG: Record<Status, { label: string; bg: string; color: string; border: string; icon: React.ElementType }> = {
  spam_risk:   { label: "Spam risk",   bg: "#FCEBEB", color: "#A32D2D", border: "#F09595", icon: AlertTriangle },
  low_replies: { label: "Low replies", bg: "#FAEEDA", color: "#854F0B", border: "#FAC775", icon: TrendingDown },
  healthy:     { label: "Healthy",     bg: "#EAF3DE", color: "#3B6D11", border: "#C0DD97", icon: CheckCircle },
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

// ── Action button ─────────────────────────────────────────────────────────────

interface ActionButtonProps {
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  loading: boolean;
  variant: "danger" | "success" | "warmup";
  disabled?: boolean;
}

function ActionButton({ label, icon: Icon, onClick, loading, variant, disabled }: ActionButtonProps) {
  const styles: Record<string, { bg: string; color: string; border: string; hoverBg: string }> = {
    danger:  { bg: "#FCEBEB", color: "#A32D2D", border: "#F09595", hoverBg: "#f8d7d7" },
    success: { bg: "#EAF3DE", color: "#3B6D11", border: "#C0DD97", hoverBg: "#daefc7" },
    warmup:  { bg: "#FEF3C7", color: "#92400E", border: "#FCD34D", hoverBg: "#fde68a" },
  };
  const s = styles[variant];
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 10, padding: "4px 9px", borderRadius: 6, border: `0.5px solid ${s.border}`,
        background: s.bg, color: s.color, cursor: loading || disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit", fontWeight: 500, whiteSpace: "nowrap",
        opacity: disabled ? 0.5 : 1, transition: "background 0.1s",
      }}
      onMouseEnter={e => { if (!loading && !disabled) (e.currentTarget as HTMLButtonElement).style.background = s.hoverBg; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = s.bg; }}
    >
      {loading
        ? <Loader2 size={9} style={{ animation: "spin 1s linear infinite" }} />
        : <Icon size={9} />
      }
      {label}
    </button>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ msg, type, onDismiss }: { msg: string; type: "success" | "error"; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 9999,
      background: type === "success" ? "#EAF3DE" : "#FCEBEB",
      border: `0.5px solid ${type === "success" ? "#C0DD97" : "#F09595"}`,
      color: type === "success" ? "#3B6D11" : "#A32D2D",
      borderRadius: 10, padding: "10px 16px", fontSize: 12, fontWeight: 500,
      boxShadow: "0 4px 16px rgba(0,0,0,0.10)", maxWidth: 380,
      display: "flex", alignItems: "flex-start", gap: 8,
    }}>
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
    </div>
  );
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

// ── Campaign dropdown ─────────────────────────────────────────────────────────
// Active mode: shows campaigns with Remove buttons.
// Re-attach mode: after removal, shows the same campaigns with Re-attach
// buttons so the user can restore specific ones.

function CampaignDropdown({
  senderEmail, workspaceSlug, senderId: externalSenderId, onAllRemoved, onActionDone,
}: {
  senderEmail: string;
  workspaceSlug: string;
  senderId: number | null;
  onAllRemoved: () => void;
  onActionDone: (msg: string, type: "success" | "error") => void;
}) {
  const [campaigns, setCampaigns]               = useState<CampaignItem[] | null>(null);
  const [removedCampaigns, setRemovedCampaigns] = useState<CampaignItem[]>([]);
  const [senderId, setSenderId]                 = useState<number | null>(externalSenderId);
  const [loading, setLoading]                   = useState(false);
  const [mode, setMode]                         = useState<"active" | "reattach">("active");
  const [actionMap, setActionMap]               = useState<Record<number, "removing" | "reattaching" | null>>({});
  const [reattachedIds, setReattachedIds]       = useState<Set<number>>(new Set());
  const [reattachingAll, setReattachingAll]     = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/account-monitor/campaigns?sender_email=${encodeURIComponent(senderEmail)}&workspace_slug=${encodeURIComponent(workspaceSlug)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { onActionDone(d.error, "error"); setCampaigns([]); }
        else {
          setCampaigns(d.campaigns ?? []);
          if (!senderId && d.sender_id) setSenderId(d.sender_id);
        }
      })
      .catch(err => { onActionDone(err.message, "error"); setCampaigns([]); })
      .finally(() => setLoading(false));
  }, [senderEmail, workspaceSlug]);

  async function removeOne(camp: CampaignItem) {
    setActionMap(prev => ({ ...prev, [camp.id]: "removing" }));
    try {
      const res = await fetch("/api/account-monitor/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_email: senderEmail, workspace_slug: workspaceSlug,
          action: "remove", campaign_id: camp.id, sender_id: senderId ?? undefined,
        }),
      });
      const data: ActionResult = await res.json();
      if (!res.ok || !data.ok) { onActionDone(data.error ?? "Failed", "error"); return; }
      setRemovedCampaigns(prev => [...prev, camp]);
      setCampaigns(prev => prev ? prev.filter(c => c.id !== camp.id) : prev);
      onActionDone(`Removed from "${camp.name}".`, "success");
    } catch (err: any) {
      onActionDone(err.message, "error");
    } finally {
      setActionMap(prev => ({ ...prev, [camp.id]: null }));
    }
  }

  async function removeAll() {
    if (!campaigns?.length) return;
    const toRemove = [...campaigns];
    for (const camp of toRemove) {
      setActionMap(prev => ({ ...prev, [camp.id]: "removing" }));
      try {
        const res = await fetch("/api/account-monitor/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sender_email: senderEmail, workspace_slug: workspaceSlug,
            action: "remove", campaign_id: camp.id, sender_id: senderId ?? undefined,
          }),
        });
        const data: ActionResult = await res.json();
        if (res.ok && data.ok) {
          setRemovedCampaigns(prev => [...prev, camp]);
          setCampaigns(prev => prev ? prev.filter(c => c.id !== camp.id) : prev);
        }
      } catch {}
      finally { setActionMap(prev => ({ ...prev, [camp.id]: null })); }
    }
    onAllRemoved();
    onActionDone(`Removed from all ${toRemove.length} campaigns.`, "success");
  }

  async function reattachOne(camp: CampaignItem) {
    setActionMap(prev => ({ ...prev, [camp.id]: "reattaching" }));
    try {
      const res = await fetch("/api/account-monitor/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_email: senderEmail, workspace_slug: workspaceSlug,
          action: "reattach", campaign_id: camp.id, sender_id: senderId ?? undefined,
        }),
      });
      const data: ActionResult = await res.json();
      if (!res.ok || !data.ok) { onActionDone(data.error ?? "Failed", "error"); return; }
      setReattachedIds(prev => new Set([...prev, camp.id]));
      onActionDone(`Re-attached to "${camp.name}".`, "success");
    } catch (err: any) {
      onActionDone(err.message, "error");
    } finally {
      setActionMap(prev => ({ ...prev, [camp.id]: null }));
    }
  }

  async function reattachAll() {
    const pending = removedCampaigns.filter(c => !reattachedIds.has(c.id));
    if (!pending.length) return;
    setReattachingAll(true);
    let succeeded = 0; let failed = 0;
    for (const camp of pending) {
      try {
        const res = await fetch("/api/account-monitor/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sender_email: senderEmail, workspace_slug: workspaceSlug,
            action: "reattach", campaign_id: camp.id, sender_id: senderId ?? undefined,
          }),
        });
        const data: ActionResult = await res.json();
        if (res.ok && data.ok) { setReattachedIds(prev => new Set([...prev, camp.id])); succeeded++; }
        else failed++;
      } catch { failed++; }
    }
    setReattachingAll(false);
    onActionDone(
      `Re-attached to ${succeeded} campaign(s).${failed > 0 ? ` ${failed} failed.` : ""}`,
      failed > 0 ? "error" : "success"
    );
  }

  if (loading) {
    return (
      <div style={{ padding: "7px 10px 9px", display: "flex", alignItems: "center", gap: 6, color: "#9ca3af", fontSize: 11 }}>
        <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Loading campaigns...
      </div>
    );
  }

  // ── Re-attach mode ────────────────────────────────────────────────────────
  if (mode === "reattach" || (campaigns?.length === 0 && removedCampaigns.length > 0)) {
    const pending = removedCampaigns.filter(c => !reattachedIds.has(c.id));
    return (
      <div style={{ padding: "6px 10px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <p style={{ fontSize: 10, color: "#6b7280", fontWeight: 500 }}>
            Previously attached — pick which to restore:
          </p>
          {mode === "reattach" && campaigns && campaigns.length > 0 && (
            <button onClick={() => setMode("active")}
              style={{ fontSize: 10, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
              ← back
            </button>
          )}
        </div>
        {removedCampaigns.map(c => {
          const isReattached = reattachedIds.has(c.id);
          const isLoading    = actionMap[c.id] === "reattaching";
          return (
            <div key={c.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "4px 8px", marginBottom: 4, borderRadius: 6,
              background: isReattached ? "#f0fdf4" : "#f8f7f5",
              border: `0.5px solid ${isReattached ? "#C0DD97" : "#e5e7eb"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: isReattached ? "#3B6D11" : "#9ca3af" }} />
                <span style={{ fontSize: 11, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.name || `Campaign #${c.id}`}
                </span>
                {isReattached && (
                  <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 10, background: "#EAF3DE", color: "#3B6D11", border: "0.5px solid #C0DD97" }}>
                    restored
                  </span>
                )}
              </div>
              {!isReattached && (
                <button onClick={() => reattachOne(c)} disabled={isLoading || reattachingAll}
                  style={{
                    marginLeft: 8, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3,
                    fontSize: 10, padding: "2px 7px", borderRadius: 5,
                    border: "0.5px solid #C0DD97", background: "#EAF3DE", color: "#3B6D11",
                    cursor: isLoading || reattachingAll ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 500,
                  }}>
                  {isLoading ? <Loader2 size={8} style={{ animation: "spin 1s linear infinite" }} /> : <Wifi size={8} />}
                  Re-attach
                </button>
              )}
            </div>
          );
        })}
        {pending.length > 1 && (
          <button onClick={reattachAll} disabled={reattachingAll}
            style={{
              marginTop: 6, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              fontSize: 10, padding: "5px 0", borderRadius: 6,
              border: "0.5px solid #C0DD97", background: "#EAF3DE", color: "#3B6D11",
              cursor: reattachingAll ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 500,
            }}>
            {reattachingAll
              ? <><Loader2 size={9} style={{ animation: "spin 1s linear infinite" }} /> Re-attaching...</>
              : <><Wifi size={9} /> Re-attach to all {pending.length} campaigns</>
            }
          </button>
        )}
      </div>
    );
  }

  // ── Active mode ───────────────────────────────────────────────────────────
  if (!campaigns || campaigns.length === 0) {
    return (
      <div style={{ padding: "7px 10px 9px", fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>
        Not attached to any active campaigns.
      </div>
    );
  }

  const busy = Object.values(actionMap).some(v => v !== null);

  return (
    <div style={{ padding: "6px 10px 10px" }}>
      {campaigns.map(c => {
        const isLoading = actionMap[c.id] === "removing";
        return (
          <div key={c.id} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "4px 8px", marginBottom: 4, borderRadius: 6,
            background: "#f8f7f5", border: "0.5px solid #e5e7eb",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: ["Active", "active", 1, 2].includes(c.status) ? "#3B6D11" : "#9ca3af" }} />
              <span style={{ fontSize: 11, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.name || `Campaign #${c.id}`}
              </span>
              {c.reply_count > 0 ? (
                <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 10, background: "#EAF3DE", color: "#3B6D11", border: "0.5px solid #C0DD97", whiteSpace: "nowrap" }}>
                  {c.reply_count} {c.reply_count === 1 ? "reply" : "replies"}
                  {c.interested_count > 0 && ` · ${c.interested_count} interested`}
                </span>
              ) : (
                <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 500, padding: "1px 6px", borderRadius: 10, background: "#f3f4f6", color: "#9ca3af", border: "0.5px solid #e5e7eb", whiteSpace: "nowrap" }}>
                  0 replies
                </span>
              )}
            </div>
            <button onClick={() => removeOne(c)} disabled={isLoading || busy}
              style={{
                marginLeft: 8, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3,
                fontSize: 10, padding: "2px 7px", borderRadius: 5,
                border: "0.5px solid #F09595", background: "#FCEBEB", color: "#A32D2D",
                cursor: isLoading || busy ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 500,
                opacity: busy && !isLoading ? 0.5 : 1,
              }}>
              {isLoading ? <Loader2 size={8} style={{ animation: "spin 1s linear infinite" }} /> : <WifiOff size={8} />}
              Remove
            </button>
          </div>
        );
      })}

      {campaigns.length > 1 && (
        <button onClick={removeAll} disabled={busy}
          style={{
            marginTop: 6, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            fontSize: 10, padding: "5px 0", borderRadius: 6,
            border: "0.5px solid #F09595", background: "#FCEBEB", color: "#A32D2D",
            cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 500, opacity: busy ? 0.5 : 1,
          }}>
          {busy
            ? <><Loader2 size={9} style={{ animation: "spin 1s linear infinite" }} /> Removing...</>
            : <><WifiOff size={9} /> Remove from all {campaigns.length} campaigns</>
          }
        </button>
      )}

      {removedCampaigns.length > 0 && (
        <button onClick={() => setMode("reattach")}
          style={{
            marginTop: 6, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            fontSize: 10, padding: "5px 0", borderRadius: 6,
            border: "0.5px solid #C0DD97", background: "#EAF3DE", color: "#3B6D11",
            cursor: "pointer", fontFamily: "inherit", fontWeight: 500,
          }}>
          <Wifi size={9} /> View {removedCampaigns.length} removed — re-attach?
        </button>
      )}
    </div>
  );
}

// ── Level 1: Workspace cards ──────────────────────────────────────────────────

function WorkspaceCard({ ws, onClick }: { ws: WorkspaceData; onClick: () => void }) {
  const workspaces = useWorkspaces();
  const color = resolveWsColor(workspaces, ws.slug);
  const name  = resolveWsName(workspaces, ws.slug);
  const hasRisk = ws.spamRiskCount > 0;

  return (
    <div onClick={onClick}
      style={{
        background: "#ffffff",
        border: hasRisk ? `1.5px solid #E24B4A` : "0.5px solid #ede9e3",
        borderLeft: hasRisk ? `3px solid #E24B4A` : `3px solid ${color}`,
        borderRadius: "0 12px 12px 0",
        padding: "14px 16px", cursor: "pointer", position: "relative",
        transition: "box-shadow 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.07)"}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.boxShadow = "none"}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{name}</p>
        {hasRisk
          ? <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#FCEBEB", color: "#A32D2D", border: "0.5px solid #F09595", fontWeight: 500 }}>{ws.spamRiskCount} at risk</span>
          : <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#EAF3DE", color: "#3B6D11", border: "0.5px solid #C0DD97", fontWeight: 500 }}>All healthy</span>
        }
      </div>
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

// ── Level 2: Domain-grouped table (domains as rows, accounts expand under each)

function DomainTable({ ws, days, onBack, onActionDone }: {
  ws: WorkspaceData;
  days: number;
  onBack: () => void;
  onActionDone: (msg: string, type: "success" | "error") => void;
}) {
  const workspaces = useWorkspaces();
  const color = resolveWsColor(workspaces, ws.slug);
  const name  = resolveWsName(workspaces, ws.slug);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [expandedEmail, setExpandedEmail]   = useState<string | null>(null);
  const [loadingMap, setLoadingMap]         = useState<Record<string, ActionKey | null>>({});
  const [removedSet, setRemovedSet]         = useState<Set<string>>(new Set());

  async function runAction(senderEmail: string, action: ActionKey) {
    setLoadingMap(prev => ({ ...prev, [senderEmail]: action }));
    try {
      const res = await fetch("/api/account-monitor/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender_email: senderEmail, workspace_slug: ws.slug, action }),
      });
      const data: ActionResult = await res.json();
      if (!res.ok || !data.ok) { onActionDone(data.error ?? "Action failed", "error"); return; }
      const campWord = data.campaigns_affected === 1 ? "campaign" : "campaigns";
      if (action === "remove" || action === "remove_and_warmup") {
        setRemovedSet(prev => new Set([...prev, senderEmail]));
        setExpandedEmail(null);
        const warmupNote = action === "remove_and_warmup"
          ? data.warmup === "enabled" ? ", warmup enabled"
          : data.warmup === "already_enabled" ? ", warmup already on" : ""
          : "";
        onActionDone(`${senderEmail} removed from ${data.campaigns_affected} ${campWord}${warmupNote}.`, data.failed > 0 ? "error" : "success");
      } else {
        setRemovedSet(prev => { const s = new Set(prev); s.delete(senderEmail); return s; });
        onActionDone(`${senderEmail} re-attached to ${data.campaigns_affected} ${campWord}.`, data.failed > 0 ? "error" : "success");
      }
    } catch (err: any) {
      onActionDone(err.message ?? "Network error", "error");
    } finally {
      setLoadingMap(prev => ({ ...prev, [senderEmail]: null }));
    }
  }

  const ORDER: Record<Status, number> = { spam_risk: 0, low_replies: 1, healthy: 2 };
  const sortedDomains = [...ws.domains].sort(
    (a, b) => (b.spamRiskCount - a.spamRiskCount) || (b.totalSent - a.totalSent)
  );

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

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, color: "#111827" }}>
            <span style={{ color }}>{name}</span> — sending domains
          </p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            Last {days} days · {ws.domainCount} domains · {ws.accounts.length} accounts
            {ws.spamRiskCount > 0 ? ` · ${ws.spamRiskCount} at spam risk` : ""}
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        <SummaryCard label="Domains"        value={ws.domainCount} color="#185FA5" />
        <SummaryCard label="Spam risk"      value={ws.spamRiskCount} color={ws.spamRiskCount > 0 ? "#A32D2D" : "#111827"} />
        <SummaryCard label="Emails sent"    value={ws.totalSent.toLocaleString()} />
        <SummaryCard label="Avg reply rate" value={`${ws.avgReplyRate}%`} color={ws.avgReplyRate < 1 ? "#A32D2D" : ws.avgReplyRate < 2 ? "#854F0B" : "#3B6D11"} />
      </div>

      <div style={{ background: "#f8f7f5", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "9px 12px", marginBottom: 14, fontSize: 11, color: "#6b7280", lineHeight: 1.6 }}>
        <strong style={{ color: "#374151" }}>Tip:</strong>{" "}
        Click a domain to see its accounts. Click an account to see its campaigns and remove or re-attach individually.
      </div>

      <div style={{ background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "#f8f7f5", borderBottom: "0.5px solid #ede9e3" }}>
              {[
                { h: "Domain / account", w: "24%", align: "left" },
                { h: "Sent",      w: "7%",  align: "right" },
                { h: "Bounces",   w: "7%",  align: "right" },
                { h: "Bounce %",  w: "8%",  align: "right" },
                { h: "Replies",   w: "7%",  align: "right" },
                { h: "Reply %",   w: "8%",  align: "right" },
                { h: "Status",    w: "12%", align: "center" },
                { h: "Actions",   w: "27%", align: "center" },
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
            {sortedDomains.map((dom, dIdx) => {
              const isDomExpanded = expandedDomain === dom.domain;
              const isLastDomain  = dIdx === sortedDomains.length - 1;
              const domHasRisk    = dom.spamRiskCount > 0;
              const domBg         = domHasRisk ? "#FCEBEB" : "#fafafa";
              const sortedAccounts = [...dom.accounts].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

              return (
                <Fragment key={dom.domain}>
                  {/* Domain row */}
                  <tr
                    style={{
                      borderBottom: isDomExpanded ? "none" : isLastDomain ? "none" : "0.5px solid #ede9e3",
                      background: domBg,
                      transition: "background 0.2s",
                      cursor: "pointer",
                    }}
                    onClick={() => setExpandedDomain(isDomExpanded ? null : dom.domain)}
                  >
                    <td style={{ padding: "10px 10px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        {isDomExpanded
                          ? <ChevronUp size={12} style={{ color: "#1a56db", flexShrink: 0 }} />
                          : <ChevronDown size={12} style={{ color: "#6b7280", flexShrink: 0 }} />
                        }
                        <span style={{
                          fontSize: 13, fontWeight: 600,
                          color: isDomExpanded ? "#1a56db" : "#111827",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {dom.domain}
                        </span>
                        <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 4 }}>
                          {dom.accounts.length} {dom.accounts.length === 1 ? "account" : "accounts"}
                        </span>
                      </span>
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "right", color: "#111827", fontWeight: 500 }}>{dom.totalSent.toLocaleString()}</td>
                    <td style={{ padding: "10px 10px", textAlign: "right", color: "#111827", fontWeight: 500 }}>{dom.totalBounces}</td>
                    <td style={{ padding: "10px 10px", textAlign: "right" }}><RateCell value={dom.bouncePct} type="bounce" /></td>
                    <td style={{ padding: "10px 10px", textAlign: "right", color: "#111827", fontWeight: 500 }}>{dom.totalReplies}</td>
                    <td style={{ padding: "10px 10px", textAlign: "right" }}><RateCell value={dom.avgReplyRate} type="reply" /></td>
                    <td style={{ padding: "10px 10px", textAlign: "center" }}>
                      {domHasRisk
                        ? <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#FCEBEB", color: "#A32D2D", border: "0.5px solid #F09595", fontWeight: 500, whiteSpace: "nowrap" }}>{dom.spamRiskCount} at risk</span>
                        : <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#EAF3DE", color: "#3B6D11", border: "0.5px solid #C0DD97", fontWeight: 500, whiteSpace: "nowrap" }}>All healthy</span>
                      }
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center", color: "#9ca3af", fontSize: 10 }}>
                      {isDomExpanded ? "" : "click to expand"}
                    </td>
                  </tr>

                  {/* Nested account rows, only when domain is expanded */}
                  {isDomExpanded && sortedAccounts.map((acc, aIdx) => {
                    const isRemoved     = removedSet.has(acc.sender_email);
                    const isExpanded    = expandedEmail === acc.sender_email;
                    const loadingAction = loadingMap[acc.sender_email] ?? null;
                    const isLoading     = loadingAction !== null;
                    const rowBg         = isRemoved ? "#f0fdf4" : acc.status === "spam_risk" ? "#FCEBEB" : "#ffffff";
                    const isLastAccount = aIdx === sortedAccounts.length - 1;

                    return (
                      <Fragment key={acc.sender_email}>
                        <tr
                          style={{
                            borderBottom: isExpanded ? "none" : (isLastAccount && isLastDomain) ? "none" : "0.5px solid #f3f4f6",
                            background: rowBg, transition: "background 0.2s",
                          }}>
                          <td style={{ padding: "8px 10px 8px 32px" }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); setExpandedEmail(isExpanded ? null : acc.sender_email); }}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 5,
                                background: "none", border: "none", cursor: "pointer",
                                padding: 0, fontFamily: "inherit", textAlign: "left", maxWidth: "100%",
                              }}
                            >
                              <span style={{
                                fontSize: 12, fontWeight: 400,
                                color: isExpanded ? "#1a56db" : "#374151",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                textDecoration: isExpanded ? "underline" : "none", textUnderlineOffset: 2,
                              }}>
                                {acc.sender_email}
                              </span>
                              {isExpanded
                                ? <ChevronUp size={11} style={{ color: "#1a56db", flexShrink: 0 }} />
                                : <ChevronDown size={11} style={{ color: "#9ca3af", flexShrink: 0 }} />
                              }
                            </button>
                            {isRemoved && (
                              <span style={{ display: "block", marginTop: 2, fontSize: 9, color: "#3B6D11", background: "#EAF3DE", border: "0.5px solid #C0DD97", borderRadius: 4, padding: "1px 5px", width: "fit-content" }}>
                                removed from all
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right", color: "#374151" }}>{acc.emails_sent.toLocaleString()}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right", color: "#374151" }}>{acc.bounces}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}><RateCell value={acc.bounce_rate} type="bounce" /></td>
                          <td style={{ padding: "8px 10px", textAlign: "right", color: "#374151" }}>{acc.replies}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}><RateCell value={acc.reply_rate} type="reply" /></td>
                          <td style={{ padding: "8px 10px", textAlign: "center" }}><StatusBadge status={acc.status} /></td>
                          <td style={{ padding: "6px 10px", textAlign: "center" }}>
                            <div style={{ display: "flex", gap: 5, justifyContent: "center", flexWrap: "wrap" }}>
                              {isRemoved ? (
                                <ActionButton label="Re-attach" icon={Wifi} onClick={() => { setExpandedEmail(acc.sender_email); setRemovedSet(prev => { const s = new Set(prev); s.delete(acc.sender_email); return s; }); }} loading={false} variant="success" />
                              ) : acc.status === "spam_risk" ? (
                                <>
                                  <ActionButton label="Remove all"      icon={WifiOff} onClick={() => runAction(acc.sender_email, "remove")}           loading={isLoading && loadingAction === "remove"}           variant="danger" disabled={isLoading} />
                                  <ActionButton label="Remove + warmup" icon={Flame}   onClick={() => runAction(acc.sender_email, "remove_and_warmup")} loading={isLoading && loadingAction === "remove_and_warmup"} variant="warmup" disabled={isLoading} />
                                </>
                              ) : (
                                <ActionButton label="Remove all" icon={WifiOff} onClick={() => runAction(acc.sender_email, "remove")} loading={isLoading && loadingAction === "remove"} variant="danger" disabled={isLoading} />
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr style={{ borderBottom: (isLastAccount && isLastDomain) ? "none" : "0.5px solid #f3f4f6", background: rowBg }}>
                            <td colSpan={8} style={{ padding: 0 }}>
                              <div style={{ borderTop: "0.5px solid #e5e7eb", margin: "0 10px 0 32px" }}>
                                <CampaignDropdown
                                  senderEmail={acc.sender_email}
                                  workspaceSlug={ws.slug}
                                  senderId={null}
                                  onAllRemoved={() => setRemovedSet(prev => new Set([...prev, acc.sender_email]))}
                                  onActionDone={onActionDone}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
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

// ── Main component ────────────────────────────────────────────────────────────

export function AccountMonitor() {
  const workspaces        = useWorkspaces();
  const [days, setDays]           = useState(7);
  const [data, setData]           = useState<{ workspaces: WorkspaceData[]; summary: Summary } | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [selected, setSelected]   = useState<WorkspaceData | null>(null);
  const [toast, setToast]         = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [nukingAll, setNukingAll] = useState(false);

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

  async function removeAllRisky() {
    if (!data) return;
    const riskyAccounts = data.workspaces.flatMap(ws =>
      ws.accounts.filter(a => a.status === "spam_risk").map(a => ({
        sender_email: a.sender_email, workspace_slug: a.workspace_slug,
      }))
    );
    if (riskyAccounts.length === 0) return;
    const confirmed = window.confirm(
      `Remove ${riskyAccounts.length} spam-risk accounts from all campaigns across all workspaces? This cannot be undone.`
    );
    if (!confirmed) return;
    setNukingAll(true);
    let succeeded = 0; let failed = 0;
    for (const acc of riskyAccounts) {
      try {
        const res = await fetch("/api/account-monitor/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sender_email: acc.sender_email, workspace_slug: acc.workspace_slug, action: "remove" }),
        });
        const d = await res.json();
        if (res.ok && d.ok) succeeded++;
        else failed++;
      } catch { failed++; }
    }
    setNukingAll(false);
    setToast({
      msg: `Done — ${succeeded} accounts removed.${failed > 0 ? ` ${failed} failed.` : ""}`,
      type: failed > 0 ? "error" : "success",
    });
    load();
  }

  const selectedWs = selected && data
    ? data.workspaces.find(w => w.slug === selected.slug) ?? null
    : null;

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#f8f7f5", padding: 20 }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, color: "#111827" }}>Account monitor</p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            {selectedWs
              ? `${resolveWsName(workspaces, selectedWs.slug)} — sending domains`
              : "Sender-level spam & reply rate monitoring across all workspaces"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <DayToggle value={days} onChange={setDays} />
          {data && data.summary.totalSpamRisk > 0 && !selectedWs && (
            <button onClick={removeAllRisky} disabled={nukingAll || loading}
              style={{
                display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "5px 10px",
                borderRadius: 8, border: "0.5px solid #F09595", background: "#FCEBEB", color: "#A32D2D",
                cursor: nukingAll ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 500,
              }}>
              {nukingAll ? <Loader2 size={11} className="animate-spin" /> : <WifiOff size={11} />}
              {nukingAll ? "Removing..." : `Remove all ${data.summary.totalSpamRisk} risky`}
            </button>
          )}
          <button onClick={load} disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "0.5px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer", fontFamily: "inherit" }}>
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
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
          <span style={{ fontSize: 12, color: "#9ca3af" }}>Loading account stats...</span>
        </div>
      )}

      {!loading && selectedWs && (
        <DomainTable
          ws={selectedWs}
          days={days}
          onBack={() => setSelected(null)}
          onActionDone={(msg, type) => setToast({ msg, type })}
        />
      )}

      {!loading && !selectedWs && data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
            <SummaryCard label="Total accounts"  value={data.summary.totalAccounts} color="#185FA5" />
            <SummaryCard label="Spam risk"        value={data.summary.totalSpamRisk} color={data.summary.totalSpamRisk > 0 ? "#A32D2D" : "#111827"} />
            <SummaryCard label="Emails sent"      value={data.summary.totalSent.toLocaleString()} />
            <SummaryCard label="Avg reply rate"   value={`${data.summary.avgReplyRate}%`} color={data.summary.avgReplyRate < 1 ? "#A32D2D" : data.summary.avgReplyRate < 2 ? "#854F0B" : "#3B6D11"} />
          </div>

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