"use client";

import { useState, useEffect, useCallback } from "react";
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

// These are module-level hooks that take workspaces as a param (not hooks themselves)
// so they can be called from sub-components that also consume the context.
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

function CampaignDropdown({
  senderEmail, workspaceSlug, onCampaignRemoved, onAllRemoved, onActionDone,
}: {
  senderEmail: string;
  workspaceSlug: string;
  onCampaignRemoved: (campaignId: number) => void;
  onAllRemoved: () => void;
  onActionDone: (msg: string, type: "success" | "error") => void;
}) {
  const [campaigns, setCampaigns]     = useState<CampaignItem[] | null>(null);
  const [senderId, setSenderId]       = useState<number | null>(null);
  const [loading, setLoading]         = useState(false);
  const [removingId, setRemovingId]   = useState<number | null>(null);
  const [removingAll, setRemovingAll] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/account-monitor/campaigns?sender_email=${encodeURIComponent(senderEmail)}&workspace_slug=${encodeURIComponent(workspaceSlug)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { onActionDone(d.error, "error"); setCampaigns([]); }
        else { setCampaigns(d.campaigns ?? []); setSenderId(d.sender_id ?? null); }
      })
      .catch(err => { onActionDone(err.message, "error"); setCampaigns([]); })
      .finally(() => setLoading(false));
  }, [senderEmail, workspaceSlug]);

  async function removeFromOne(campId: number, campName: string) {
    setRemovingId(campId);
    try {
      const res = await fetch("/api/account-monitor/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender_email: senderEmail, workspace_slug: workspaceSlug, action: "remove", campaign_id: campId, sender_id: senderId ?? undefined }),
      });
      const data: ActionResult = await res.json();
      if (!res.ok || !data.ok) { onActionDone(data.error ?? "Failed", "error"); return; }
      setCampaigns(prev => prev ? prev.filter(c => c.id !== campId) : prev);
      onCampaignRemoved(campId);
      onActionDone(`Removed from "${campName}".`, "success");
    } catch (err: any) {
      onActionDone(err.message, "error");
    } finally {
      setRemovingId(null);
    }
  }

  async function removeFromAll() {
    if (!campaigns?.length) return;
    setRemovingAll(true);
    try {
      const res = await fetch("/api/account-monitor/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender_email: senderEmail, workspace_slug: workspaceSlug, action: "remove", sender_id: senderId ?? undefined }),
      });
      const data: ActionResult = await res.json();
      if (!res.ok || !data.ok) { onActionDone(data.error ?? "Failed", "error"); return; }
      setCampaigns([]);
      onAllRemoved();
      onActionDone(
        `Removed from all ${data.campaigns_affected} campaign(s).${data.failed > 0 ? ` ${data.failed} failed.` : ""}`,
        data.failed > 0 ? "error" : "success"
      );
    } catch (err: any) {
      onActionDone(err.message, "error");
    } finally {
      setRemovingAll(false);
    }
  }

  const busy = removingId !== null || removingAll;

  if (loading) {
    return (
      <div style={{ padding: "7px 10px 9px", display: "flex", alignItems: "center", gap: 6, color: "#9ca3af", fontSize: 11 }}>
        <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Loading campaigns...
      </div>
    );
  }

  if (!campaigns) return null;

  if (campaigns.length === 0) {
    return (
      <div style={{ padding: "7px 10px 9px", fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>
        Not attached to any active campaigns.
      </div>
    );
  }

  return (
    <div style={{ padding: "6px 10px 10px" }}>
      {campaigns.map(c => (
        <div key={c.id} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "4px 8px", marginBottom: 4, borderRadius: 6,
          background: "#f8f7f5", border: "0.5px solid #e5e7eb",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              background: ["Active", "active", 1, 2].includes(c.status) ? "#3B6D11" : "#9ca3af",
            }} />
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
          <button
            onClick={() => removeFromOne(c.id, c.name || `Campaign #${c.id}`)}
            disabled={busy}
            style={{
              marginLeft: 8, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3,
              fontSize: 10, padding: "2px 7px", borderRadius: 5,
              border: "0.5px solid #F09595", background: "#FCEBEB", color: "#A32D2D",
              cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 500, opacity: busy ? 0.5 : 1,
            }}
          >
            {removingId === c.id ? <Loader2 size={8} style={{ animation: "spin 1s linear infinite" }} /> : <WifiOff size={8} />}
            Remove
          </button>
        </div>
      ))}
      {campaigns.length > 1 && (
        <button
          onClick={removeFromAll}
          disabled={busy}
          style={{
            marginTop: 6, width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            fontSize: 10, padding: "5px 0", borderRadius: 6,
            border: "0.5px solid #F09595", background: "#FCEBEB", color: "#A32D2D",
            cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 500, opacity: busy ? 0.5 : 1,
          }}
        >
          {removingAll
            ? <><Loader2 size={9} style={{ animation: "spin 1s linear infinite" }} /> Removing all...</>
            : <><WifiOff size={9} /> Remove from all {campaigns.length} campaigns</>
          }
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

// ── Level 2: Account table ────────────────────────────────────────────────────

function AccountTable({ ws, days, onBack, onActionDone }: {
  ws: WorkspaceData;
  days: number;
  onBack: () => void;
  onActionDone: (msg: string, type: "success" | "error") => void;
}) {
  const workspaces = useWorkspaces();
  const color = resolveWsColor(workspaces, ws.slug);
  const name  = resolveWsName(workspaces, ws.slug);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [loadingMap, setLoadingMap]       = useState<Record<string, ActionKey | null>>({});
  const [removedSet, setRemovedSet]       = useState<Set<string>>(new Set());

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
  const sorted = [...ws.accounts].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

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
            <span style={{ color }}>{name}</span> — sender accounts
          </p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            Last {days} days · {ws.accounts.length} accounts{ws.spamRiskCount > 0 ? ` · ${ws.spamRiskCount} at spam risk` : ""}
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        <SummaryCard label="Accounts"       value={ws.accounts.length} color="#185FA5" />
        <SummaryCard label="Spam risk"      value={ws.spamRiskCount} color={ws.spamRiskCount > 0 ? "#A32D2D" : "#111827"} />
        <SummaryCard label="Emails sent"    value={ws.totalSent.toLocaleString()} />
        <SummaryCard label="Avg reply rate" value={`${ws.avgReplyRate}%`} color={ws.avgReplyRate < 1 ? "#A32D2D" : ws.avgReplyRate < 2 ? "#854F0B" : "#3B6D11"} />
      </div>

      <div style={{ background: "#f8f7f5", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "9px 12px", marginBottom: 14, fontSize: 11, color: "#6b7280", lineHeight: 1.6 }}>
        <strong style={{ color: "#374151" }}>Tip:</strong>{" "}
        Click an email address to see which campaigns it is attached to and remove from individual ones.
        Use the action buttons to remove from all at once or enable warmup.
      </div>

      <div style={{ background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "#f8f7f5", borderBottom: "0.5px solid #ede9e3" }}>
              {[
                { h: "Sender account", w: "24%", align: "left" },
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
            {sorted.map((acc, idx) => {
              const isRemoved     = removedSet.has(acc.sender_email);
              const isExpanded    = expandedEmail === acc.sender_email;
              const loadingAction = loadingMap[acc.sender_email] ?? null;
              const isLoading     = loadingAction !== null;
              const rowBg         = isRemoved ? "#f0fdf4" : acc.status === "spam_risk" ? "#FCEBEB" : "transparent";
              const isLast        = idx === sorted.length - 1;

              return (
                <>
                  <tr key={acc.sender_email}
                    style={{
                      borderBottom: isExpanded ? "none" : isLast ? "none" : "0.5px solid #f3f4f6",
                      background: rowBg, transition: "background 0.2s",
                    }}>
                    <td style={{ padding: "9px 10px" }}>
                      <button
                        onClick={() => setExpandedEmail(isExpanded ? null : acc.sender_email)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          background: "none", border: "none", cursor: "pointer",
                          padding: 0, fontFamily: "inherit", textAlign: "left", maxWidth: "100%",
                        }}
                      >
                        <span style={{
                          fontSize: 12, fontWeight: 500,
                          color: isExpanded ? "#1a56db" : "#111827",
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
                    <td style={{ padding: "9px 10px", textAlign: "right", color: "#374151" }}>{acc.emails_sent.toLocaleString()}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: "#374151" }}>{acc.bounces}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}><RateCell value={acc.bounce_rate} type="bounce" /></td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: "#374151" }}>{acc.replies}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}><RateCell value={acc.reply_rate} type="reply" /></td>
                    <td style={{ padding: "9px 10px", textAlign: "center" }}><StatusBadge status={acc.status} /></td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 5, justifyContent: "center", flexWrap: "wrap" }}>
                        {isRemoved ? (
                          <ActionButton label="Re-attach" icon={Wifi} onClick={() => runAction(acc.sender_email, "reattach")} loading={isLoading && loadingAction === "reattach"} variant="success" disabled={isLoading} />
                        ) : acc.status === "spam_risk" ? (
                          <>
                            <ActionButton label="Remove all"     icon={WifiOff} onClick={() => runAction(acc.sender_email, "remove")}           loading={isLoading && loadingAction === "remove"}           variant="danger" disabled={isLoading} />
                            <ActionButton label="Remove + warmup" icon={Flame}  onClick={() => runAction(acc.sender_email, "remove_and_warmup")} loading={isLoading && loadingAction === "remove_and_warmup"} variant="warmup" disabled={isLoading} />
                          </>
                        ) : (
                          <ActionButton label="Remove all" icon={WifiOff} onClick={() => runAction(acc.sender_email, "remove")} loading={isLoading && loadingAction === "remove"} variant="danger" disabled={isLoading} />
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${acc.sender_email}-expanded`} style={{ borderBottom: isLast ? "none" : "0.5px solid #f3f4f6", background: rowBg }}>
                      <td colSpan={8} style={{ padding: 0 }}>
                        <div style={{ borderTop: "0.5px solid #e5e7eb", margin: "0 10px" }}>
                          <CampaignDropdown
                            senderEmail={acc.sender_email}
                            workspaceSlug={ws.slug}
                            onCampaignRemoved={() => {}}
                            onAllRemoved={() => { setRemovedSet(prev => new Set([...prev, acc.sender_email])); setExpandedEmail(null); }}
                            onActionDone={onActionDone}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </>
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
  const workspaces = useWorkspaces();
  const [days, setDays]         = useState(7);
  const [data, setData]         = useState<{ workspaces: WorkspaceData[]; summary: Summary } | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [selected, setSelected] = useState<WorkspaceData | null>(null);
  const [toast, setToast]       = useState<{ msg: string; type: "success" | "error" } | null>(null);

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
              ? `${resolveWsName(workspaces, selectedWs.slug)} — sender accounts`
              : "Sender-level spam & reply rate monitoring across all workspaces"}
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
        <AccountTable ws={selectedWs} days={days} onBack={() => setSelected(null)} onActionDone={(msg, type) => setToast({ msg, type })} />
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