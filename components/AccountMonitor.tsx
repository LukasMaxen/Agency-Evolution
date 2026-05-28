"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import {
  RefreshCw, Loader2, ChevronLeft, AlertTriangle, CheckCircle,
  TrendingDown, WifiOff, Wifi, Flame, ChevronDown, ChevronUp,
} from "lucide-react";
import { useWorkspaces, findWorkspace } from "@/lib/workspaces-context";

// ── Types ─────────────────────────────────────────────────────────────────────

type Status =
  | "disconnected"
  | "burned"
  | "list_issue"
  | "critical_low_replies"
  | "low_replies"
  | "healthy"
  | "insufficient_data";
type Confidence = "full" | "provisional";
type ActionKey = "remove" | "reattach" | "remove_and_warmup";

interface SignalFlags {
  burn:    boolean;
  bounce:  boolean;
  replies: boolean;
}

interface StatusCounts {
  disconnected:         number;
  burned:               number;
  list_issue:           number;
  critical_low_replies: number;
  low_replies:          number;
  insufficient_data:    number;
  healthy:              number;
}

interface Account {
  sender_email: string;
  workspace_slug: string;
  conn_status: string;
  warmup_enabled: boolean;
  emails_sent: number;
  bounces: number;
  burns: number;
  replies: number;
  bounce_rate: number;
  burn_rate: number;
  reply_rate: number;
  status: Status;
  confidence: Confidence;
  signals: SignalFlags;
}

interface DomainData {
  domain: string;
  accounts: Account[];
  totalSent: number;
  totalReplies: number;
  totalBounces: number;
  totalBurns: number;
  avgReplyRate: number;
  bouncePct: number;
  burnPct: number;
  minSends: number;
  provisionalMinSends: number;
  status: Status;
  confidence: Confidence;
  signals: SignalFlags;
  statusCounts: StatusCounts;
}

interface WorkspaceData {
  slug: string;
  accounts: Account[];
  domains: DomainData[];
  domainCount: number;
  totalSent: number;
  totalReplies: number;
  totalBounces: number;
  totalInterested: number;
  totalBurns: number;
  avgReplyRate: number;
  bouncePct: number;
  burnPct: number;
  statusCounts: StatusCounts;
}

interface Summary {
  totalAccounts: number;
  totalDomains: number;
  totalSent: number;
  totalReplies: number;
  totalBounces: number;
  totalInterested: number;
  totalBurns: number;
  avgReplyRate: number;
  avgBouncePct: number;
  avgBurnPct: number;
  domainStatusCounts: StatusCounts;
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
  disconnected:         { label: "Disconnected",      bg: "#EEF2FF", color: "#3730A3", border: "#A5B4FC", icon: WifiOff },
  burned:               { label: "Burned",            bg: "#FCEBEB", color: "#A32D2D", border: "#F09595", icon: Flame },
  list_issue:           { label: "List issue",        bg: "#FAEEDA", color: "#854F0B", border: "#FAC775", icon: AlertTriangle },
  // Reply rate < 0.5% is the action-required tier: pause outbound, put on
  // warmup-only for 1-2 weeks. Same red as burned/list_issue because the
  // recovery action is comparable.
  critical_low_replies: { label: "Critical low replies", bg: "#FCEBEB", color: "#A32D2D", border: "#F09595", icon: TrendingDown },
  low_replies:          { label: "Low replies",       bg: "#FAEEDA", color: "#854F0B", border: "#FAC775", icon: TrendingDown },
  insufficient_data:    { label: "Insufficient data", bg: "#F3F4F6", color: "#6B7280", border: "#D1D5DB", icon: Loader2 },
  healthy:              { label: "Healthy",           bg: "#EAF3DE", color: "#3B6D11", border: "#C0DD97", icon: CheckCircle },
};

// Action tooltip: derives the right sentence from which signals are firing,
// not just the badge name. Same badge can map to different actions based on
// the underlying signal combination.
function actionTooltip(args: {
  status: Status;
  signals: SignalFlags;
  sent: number;
  minSends: number;
}): string {
  const { status, signals, sent, minSends } = args;

  if (status === "disconnected") {
    return "Mailbox is disconnected in EmailBison. Reconnect in Sender Emails settings before this account can resume sending.";
  }
  if (status === "insufficient_data") {
    return `Not enough volume yet. ${sent}/${minSends} sends needed before flagging.`;
  }
  if (status === "healthy") {
    return "All metrics within targets.";
  }
  if (status === "burned") {
    if (signals.bounce && signals.replies)
      return "Multiple issues. Pause and warm up first (2 to 4 weeks), then clean the list before re-introducing.";
    if (signals.bounce)
      return "Pause and warm up. Also clean the recipient list before bringing this back online.";
    if (signals.replies)
      return "Burn is suppressing deliverability. Pause to warm up; reply rate should recover as reputation rebuilds.";
    return "Reputation hit. Pause this account, enable warmup, re-introduce in 2 to 4 weeks. Sanity-check DMARC/SPF/DKIM while paused.";
  }
  if (status === "list_issue") {
    if (signals.replies)
      return "List quality is hurting delivery and replies. Cleanse, then reassess targeting.";
    return "Bad recipient data. Cleanse or re-enrich the list before sending more.";
  }
  if (status === "critical_low_replies") {
    return "Reply rate below 0.5% with real send volume. Pause this account from outbound and put it on warmup only for 1-2 weeks before resuming.";
  }
  // low_replies (0.5% to 0.99%) — monitor only
  return "Reply rate between 0.5% and 1%. Not great, not drastic. Monitor and consider copy / targeting tweaks.";
}

// Short label of the action, shown inline next to the status so the user
// does not have to hover the badge to know what to do. The full sentence
// is still on the badge tooltip.
function actionLabel(args: {
  status: Status;
  signals: SignalFlags;
}): string {
  const { status, signals } = args;
  if (status === "healthy")              return "";
  if (status === "disconnected")         return "Reconnect mailbox in EmailBison";
  if (status === "insufficient_data")    return "Wait for more sends";
  if (status === "critical_low_replies") return "Pause + warmup 1-2 weeks";
  if (status === "low_replies")          return "Monitor; tweak copy / targeting";
  if (status === "list_issue") {
    return signals.replies ? "Clean list + review targeting" : "Clean the list";
  }
  // burned
  if (signals.bounce && signals.replies) return "Pause + warm 2-4w, then clean list";
  if (signals.bounce)                    return "Pause + warm 2-4w + clean list";
  if (signals.replies)                   return "Pause + warm 2-4w (replies recover)";
  return "Pause + warm 2-4w, check DMARC/SPF/DKIM";
}

function StatusBadge({
  status, confidence, signals, sent, minSends,
}: {
  status: Status;
  confidence?: Confidence;
  signals?: SignalFlags;
  sent?: number;
  minSends?: number;
}) {
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;
  const isProvisional = confidence === "provisional";
  const baseTooltip = signals !== undefined && sent !== undefined && minSends !== undefined
    ? actionTooltip({ status, signals, sent, minSends })
    : "";
  const tooltip = isProvisional && sent !== undefined && minSends !== undefined
    ? `Provisional: ${sent} of ${minSends} sends needed for full confidence. ${baseTooltip}`
    : baseTooltip;
  return (
    <span
      title={tooltip}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 500,
        background: cfg.bg, color: cfg.color,
        border: `1px ${isProvisional ? "dashed" : "solid"} ${cfg.border}`,
        whiteSpace: "nowrap",
        cursor: tooltip ? "help" : "default",
      }}
    >
      <Icon size={10} />
      {cfg.label}{isProvisional ? "*" : ""}
    </span>
  );
}

function RateCell({ value, type }: { value: number; type: "reply" | "bounce" | "burn" }) {
  // Binary KPI coloring: green if meeting the target, red if not.
  let color: string;
  if (type === "reply") {
    color = value >= 1 ? "#3B6D11" : "#A32D2D";
  } else if (type === "bounce") {
    color = value <  2 ? "#3B6D11" : "#A32D2D";
  } else {
    color = value <  0.5 ? "#3B6D11" : "#A32D2D";
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
      {[3, 10, 30].map(d => (
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

function SummaryCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: "#f8f7f5", borderRadius: 8, padding: "12px 14px" }}>
      <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 5 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 500, color: color ?? "#111827" }}>
        {value}
        {sub && <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>{sub}</span>}
      </p>
    </div>
  );
}

// Shared summary metrics: 8 cards in a 4-column, 2-row grid.
// Row 1 (counts):  Total domains | Disconnected | List issues | Burned
// Row 2 (rates):   Emails sent   | Reply % (replies) | Bounce % | Burn %
//
// "Healthy" was dropped from row 1 in favour of "Disconnected" — disconnected
// mailboxes are a hard block on sending and need operator attention. Healthy
// counts are still visible in the workspace cards and the domain table.
function MetricsRow({
  totalDomains,
  disconnected,
  listIssue,
  burned,
  totalSent,
  totalReplies,
  avgReplyRate,
  bouncePct,
  burnPct,
}: {
  totalDomains: number;
  disconnected: number;
  listIssue: number;
  burned: number;
  totalSent: number;
  totalReplies: number;
  avgReplyRate: number;
  bouncePct: number;
  burnPct: number;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
      {/* Row 1: counts — all black like the other non-KPI numbers. */}
      <SummaryCard label="Total domains"      value={totalDomains} />
      <SummaryCard label="Disconnected"       value={disconnected} />
      <SummaryCard label="List issues"        value={listIssue} />
      <SummaryCard label="Burned domains"     value={burned} />

      {/* Row 2: rates. Reply rate uses three tiers (red < 0.5, yellow < 1,
          green >= 1); bounce/burn are binary. */}
      <SummaryCard label="Emails sent" value={totalSent.toLocaleString()} />
      <SummaryCard
        label="Avg reply rate"
        value={`${avgReplyRate}%`}
        sub={`(${totalReplies.toLocaleString()} replies)`}
        color={
          avgReplyRate >= 1   ? "#3B6D11"
          : avgReplyRate >= 0.5 ? "#854F0B"
          : "#A32D2D"
        }
      />
      <SummaryCard
        label="Avg bounce rate"
        value={`${bouncePct}%`}
        color={bouncePct < 2 ? "#3B6D11" : "#A32D2D"}
      />
      <SummaryCard
        label="Avg burn rate"
        value={`${burnPct}%`}
        color={burnPct < 0.5 ? "#3B6D11" : "#A32D2D"}
      />
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
  const name  = resolveWsName(workspaces, ws.slug);
  const disconnectedCount = ws.statusCounts.disconnected;
  const burnedCount       = ws.statusCounts.burned;
  const criticalCount     = ws.statusCounts.critical_low_replies;
  const listCount         = ws.statusCounts.list_issue;
  const lowRepliesCount   = ws.statusCounts.low_replies;
  const insufficientCount = ws.statusCounts.insufficient_data;
  const healthyCount      = ws.statusCounts.healthy;

  // Border severity matches the priority cascade in classify():
  //   disconnected > burned > critical_low_replies > list_issue > low_replies
  // critical_low_replies is red (action-required) and ranks above list_issue.
  const accent =
    disconnectedCount > 0 ? "#6366F1" :       // indigo
    burnedCount > 0       ? "#E24B4A" :       // red
    criticalCount > 0     ? "#E24B4A" :       // red (pause + warmup)
    listCount   > 0       ? "#F59E0B" :       // amber/yellow
    lowRepliesCount > 0   ? "#F59E0B" :       // amber/yellow
    healthyCount > 0      ? "#84C56A" :       // green only when actual healthy domains exist
                            "#9CA3AF";        // grey: insufficient data, no positive signal yet

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
          {disconnectedCount > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#EEF2FF", color: "#3730A3", border: "0.5px solid #A5B4FC", fontWeight: 500, whiteSpace: "nowrap" }}>
              {disconnectedCount} disconnected
            </span>
          )}
          {burnedCount > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#FCEBEB", color: "#A32D2D", border: "0.5px solid #F09595", fontWeight: 500, whiteSpace: "nowrap" }}>
              {burnedCount} burned
            </span>
          )}
          {criticalCount > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#FCEBEB", color: "#A32D2D", border: "0.5px solid #F09595", fontWeight: 500, whiteSpace: "nowrap" }}>
              {criticalCount} critical low replies
            </span>
          )}
          {listCount > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#FAEEDA", color: "#854F0B", border: "0.5px solid #FAC775", fontWeight: 500, whiteSpace: "nowrap" }}>
              {listCount} list issue
            </span>
          )}
          {insufficientCount > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#F3F4F6", color: "#6B7280", border: "0.5px solid #D1D5DB", fontWeight: 500, whiteSpace: "nowrap" }}>
              {insufficientCount} insufficient
            </span>
          )}
          {disconnectedCount === 0 && burnedCount === 0 && criticalCount === 0 && listCount === 0 && insufficientCount === 0 && healthyCount > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#EAF3DE", color: "#3B6D11", border: "0.5px solid #C0DD97", fontWeight: 500, whiteSpace: "nowrap" }}>
              All healthy
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          // Counts: no KPI = always black
          { label: "Domains",        value: ws.domainCount,                  color: undefined },
          { label: "Emails sent",    value: ws.totalSent.toLocaleString(),   color: undefined },
          // Rates: reply rate uses three tiers (red < 0.5, yellow < 1, green
          // >= 1) to match the per-account critical_low_replies threshold.
          // Bounce rate is binary (red >= 2%, green otherwise). Reply rate
          // sits on the left mirroring the global summary at the top.
          {
            label: "Avg reply rate",
            value: `${ws.avgReplyRate}% (${ws.totalReplies.toLocaleString()})`,
            color: ws.avgReplyRate >= 1   ? "#3B6D11"
                 : ws.avgReplyRate >= 0.5 ? "#854F0B"
                 : "#A32D2D",
          },
          { label: "Bounce rate",    value: `${ws.bouncePct}%`,    color: ws.bouncePct < 2 ? "#3B6D11" : "#A32D2D" },
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
  const name  = resolveWsName(workspaces, ws.slug);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [expandedEmail, setExpandedEmail]   = useState<string | null>(null);
  const [loadingMap, setLoadingMap]         = useState<Record<string, ActionKey | null>>({});
  const [removedSet, setRemovedSet]         = useState<Set<string>>(new Set());
  // Tabs separate active-sending mailboxes from warming-only (zero sends in
  // the current dashboard window). Warming-only senders have no
  // deliverability data to evaluate so they live in their own view.
  const [tab, setTab] = useState<"active" | "warming">("active");
  const isWarming = (a: Account) => a.emails_sent === 0;
  const isActive  = (a: Account) => a.emails_sent > 0;
  const activeCount  = ws.accounts.filter(isActive).length;
  const warmingCount = ws.accounts.filter(isWarming).length;

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

  const ORDER: Record<Status, number> = {
    disconnected:         0,
    burned:               1,
    critical_low_replies: 2,
    list_issue:           3,
    low_replies:          4,
    healthy:              5,
    insufficient_data:    6,
  };
  const CONFIDENCE_ORDER: Record<Confidence, number> = {
    full:        0,
    provisional: 1,
  };
  // Domain sort: primary by status severity (burned > list_issue > etc.),
  // secondary by confidence (full before provisional). Within the same
  // tier, worst reply rate first, then worst bounce rate.
  //
  // Tab filter: "active" keeps domains that have any sending account;
  // "warming" keeps domains where any account is in warmup-only state.
  // A domain with both kinds of accounts appears in both tabs (its
  // expanded list is also filtered by the same predicate below).
  const tabPredicate = tab === "active" ? isActive : isWarming;
  const sortedDomains = ws.domains
    .filter(d => d.accounts.some(tabPredicate))
    .slice()
    .sort((a, b) => {
      if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
      if (CONFIDENCE_ORDER[a.confidence] !== CONFIDENCE_ORDER[b.confidence])
        return CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
      if (a.avgReplyRate !== b.avgReplyRate) return a.avgReplyRate - b.avgReplyRate;
      return b.bouncePct - a.bouncePct;
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

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, color: "#111827" }}>
            {name}, sending domains
          </p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            Last {days} days · {ws.domainCount} domains · {ws.accounts.length} accounts
            {ws.statusCounts.disconnected > 0 ? ` · ${ws.statusCounts.disconnected} disconnected` : ""}
            {ws.statusCounts.burned > 0 ? ` · ${ws.statusCounts.burned} burned` : ""}
            {ws.statusCounts.list_issue > 0 ? ` · ${ws.statusCounts.list_issue} list issue` : ""}
          </p>
        </div>
      </div>

      <MetricsRow
        totalDomains={ws.domainCount}
        disconnected={ws.statusCounts.disconnected}
        listIssue={ws.statusCounts.list_issue}
        burned={ws.statusCounts.burned}
        totalSent={ws.totalSent}
        totalReplies={ws.totalReplies}
        avgReplyRate={ws.avgReplyRate}
        bouncePct={ws.bouncePct}
        burnPct={ws.burnPct}
      />

      <div style={{ background: "#f8f7f5", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "9px 12px", marginBottom: 14, fontSize: 11, color: "#6b7280", lineHeight: 1.6 }}>
        <strong style={{ color: "#374151" }}>Tip:</strong>{" "}
        Click a domain to see its accounts. Click an account to see its campaigns and remove or re-attach individually.
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 10, borderBottom: "0.5px solid #ede9e3" }}>
        {([
          { key: "active",  label: "Active sending", count: activeCount },
          { key: "warming", label: "Warming only",   count: warmingCount },
        ] as const).map(t => {
          const selected = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setExpandedDomain(null); setExpandedEmail(null); }}
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
              {t.label}{" "}
              <span style={{ color: "#9ca3af", fontWeight: 400 }}>({t.count})</span>
            </button>
          );
        })}
      </div>

      <div style={{ background: "#ffffff", border: "0.5px solid #ede9e3", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "#f8f7f5", borderBottom: "0.5px solid #ede9e3" }}>
              {[
                { h: "Domain / account", w: "22%", align: "left" },
                { h: "Sent",      w: "7%",  align: "right" },
                { h: "Bounce %",  w: "8%",  align: "right" },
                { h: "Burn %",    w: "8%",  align: "right" },
                { h: "Reply %",   w: "8%",  align: "right" },
                { h: "Status",    w: "13%", align: "center" },
                { h: "Actions",   w: "34%", align: "center" },
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
              const domBg         = dom.status === "disconnected" ? "#EEF2FF" :
                                    dom.status === "burned" ? "#FCEBEB" :
                                    dom.status === "critical_low_replies" ? "#FCEBEB" :
                                    dom.status === "list_issue" ? "#FFF7E6" :
                                    "#fafafa";
              const sortedAccounts = dom.accounts
                .filter(tabPredicate)
                .slice()
                .sort((a, b) => {
                  if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
                  if (CONFIDENCE_ORDER[a.confidence] !== CONFIDENCE_ORDER[b.confidence])
                    return CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
                  if (a.reply_rate !== b.reply_rate) return a.reply_rate - b.reply_rate;
                  return b.bounce_rate - a.bounce_rate;
                });

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
                    <td style={{ padding: "10px 10px", textAlign: "right" }}><RateCell value={dom.bouncePct} type="bounce" /></td>
                    <td style={{ padding: "10px 10px", textAlign: "right" }}><RateCell value={dom.burnPct}   type="burn" /></td>
                    <td style={{ padding: "10px 10px", textAlign: "right" }}><RateCell value={dom.avgReplyRate} type="reply" /></td>
                    <td style={{ padding: "10px 10px", textAlign: "center" }}>
                      <StatusBadge
                        status={dom.status}
                        confidence={dom.confidence}
                        signals={dom.signals}
                        sent={dom.totalSent}
                        minSends={dom.minSends}
                      />
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>
                      {(() => {
                        const label = actionLabel({ status: dom.status, signals: dom.signals });
                        if (!label) return null;
                        const tone =
                          dom.status === "disconnected"         ? { bg: "#EEF2FF", color: "#3730A3", border: "#A5B4FC" } :
                          dom.status === "burned"               ? { bg: "#FCEBEB", color: "#A32D2D", border: "#F09595" } :
                          dom.status === "critical_low_replies" ? { bg: "#FCEBEB", color: "#A32D2D", border: "#F09595" } :
                          dom.status === "list_issue"           ? { bg: "#FAEEDA", color: "#854F0B", border: "#FAC775" } :
                          dom.status === "low_replies"          ? { bg: "#FAEEDA", color: "#854F0B", border: "#FAC775" } :
                                                                  { bg: "#F3F4F6", color: "#6B7280", border: "#D1D5DB" };
                        return (
                          <span style={{
                            display: "inline-block",
                            fontSize: 10, padding: "3px 9px", borderRadius: 6,
                            background: tone.bg, color: tone.color, border: `0.5px solid ${tone.border}`,
                            fontWeight: 500, whiteSpace: "nowrap",
                          }}>
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>

                  {/* Nested account rows, only when domain is expanded */}
                  {isDomExpanded && sortedAccounts.map((acc, aIdx) => {
                    const isRemoved     = removedSet.has(acc.sender_email);
                    const isExpanded    = expandedEmail === acc.sender_email;
                    const loadingAction = loadingMap[acc.sender_email] ?? null;
                    const isLoading     = loadingAction !== null;
                    const rowBg         = isRemoved ? "#f0fdf4" :
                                          acc.status === "disconnected" ? "#EEF2FF" :
                                          acc.status === "burned"     ? "#FCEBEB" :
                                          acc.status === "list_issue" ? "#FFF7E6" :
                                          "#ffffff";
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
                          <td style={{ padding: "8px 10px", textAlign: "right" }}><RateCell value={acc.bounce_rate} type="bounce" /></td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}><RateCell value={acc.burn_rate}   type="burn" /></td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}><RateCell value={acc.reply_rate} type="reply" /></td>
                          <td style={{ padding: "8px 10px", textAlign: "center" }}>
                            <div style={{ display: "inline-flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
                              <StatusBadge
                                status={acc.status}
                                confidence={acc.confidence}
                                signals={acc.signals}
                                sent={acc.emails_sent}
                                minSends={50}
                              />
                              {acc.warmup_enabled === false && acc.conn_status !== "Not connected" && (
                                <span
                                  title="Warmup is disabled for this mailbox in EmailBison. Enable it to keep inbox placement healthy."
                                  style={{
                                    fontSize: 9, padding: "1px 6px", borderRadius: 20,
                                    background: "#FCEBEB", color: "#A32D2D", border: "0.5px solid #F09595",
                                    fontWeight: 500, whiteSpace: "nowrap",
                                  }}
                                >
                                  Not warming
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "6px 10px", textAlign: "center" }}>
                            <div style={{ display: "flex", gap: 5, justifyContent: "center", flexWrap: "wrap" }}>
                              {isRemoved ? (
                                <ActionButton label="Re-attach" icon={Wifi} onClick={() => { setExpandedEmail(acc.sender_email); setRemovedSet(prev => { const s = new Set(prev); s.delete(acc.sender_email); return s; }); }} loading={false} variant="success" />
                              ) : (acc.status === "burned" || acc.status === "critical_low_replies") ? (
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
                            <td colSpan={7} style={{ padding: 0 }}>
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
  const [days, setDays]           = useState(10);
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
      ws.accounts.filter(a => a.status === "burned").map(a => ({
        sender_email: a.sender_email, workspace_slug: a.workspace_slug,
      }))
    );
    if (riskyAccounts.length === 0) return;
    const confirmed = window.confirm(
      `Remove ${riskyAccounts.length} burned accounts from all campaigns across all workspaces? This cannot be undone.`
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
          <p style={{ fontSize: 15, fontWeight: 500, color: "#111827" }}>Domain monitoring</p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            {selectedWs
              ? `${resolveWsName(workspaces, selectedWs.slug)}, sending domains`
              : "Sender-level connection, spam, and reply rate monitoring across all workspaces"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <DayToggle value={days} onChange={setDays} />
          {data && data.summary.domainStatusCounts.burned > 0 && !selectedWs && (
            <button onClick={removeAllRisky} disabled={nukingAll || loading}
              style={{
                display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "5px 10px",
                borderRadius: 8, border: "0.5px solid #F09595", background: "#FCEBEB", color: "#A32D2D",
                cursor: nukingAll ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 500,
              }}>
              {nukingAll ? <Loader2 size={11} className="animate-spin" /> : <WifiOff size={11} />}
              {nukingAll ? "Removing..." : `Remove all burned`}
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
          <MetricsRow
            totalDomains={data.summary.totalDomains}
            disconnected={data.summary.domainStatusCounts.disconnected}
            listIssue={data.summary.domainStatusCounts.list_issue}
            burned={data.summary.domainStatusCounts.burned}
            totalSent={data.summary.totalSent}
            totalReplies={data.summary.totalReplies}
            avgReplyRate={data.summary.avgReplyRate}
            bouncePct={data.summary.avgBouncePct}
            burnPct={data.summary.avgBurnPct}
          />

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