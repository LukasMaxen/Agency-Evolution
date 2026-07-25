"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import {
  RefreshCw, Loader2, ChevronLeft, AlertTriangle, CheckCircle,
  TrendingDown, WifiOff, Wifi, Flame, ChevronDown, ChevronUp,
  Settings, Info, Zap, Tag, Calendar, Shield, AlertCircle,
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
  sender_email:             string;
  workspace_slug:           string;
  conn_status:              string;
  warmup_enabled:           boolean;
  warming_since:            string | null;
  attached_campaigns_count: number | null;
  eb_sender_id:             number | null;
  daily_limit:              number | null;
  warmup_daily_limit:       number | null;
  tags:                     string[] | null;
  eb_created_at:            string | null;
  warmup_score:             number | null;
  provider_type:            string | null;
  emails_sent:              number;
  bounces:                  number;
  burns:                    number;
  replies:                  number;
  bounce_rate:              number;
  burn_rate:                number;
  reply_rate:               number;
  status:                   Status;
  confidence:               Confidence;
  signals:                  SignalFlags;
}

interface DomainData {
  domain:       string;
  accounts:     Account[];
  totalSent:    number;
  totalReplies: number;
  totalBounces: number;
  totalBurns:   number;
  avgReplyRate: number;
  bouncePct:    number;
  burnPct:      number;
  minSends:     number;
  provisionalMinSends: number;
  status:       Status;
  confidence:   Confidence;
  signals:      SignalFlags;
  statusCounts: StatusCounts;
}

interface WorkspaceData {
  slug:            string;
  accounts:        Account[];
  domains:         DomainData[];
  domainCount:     number;
  totalSent:       number;
  totalReplies:    number;
  totalBounces:    number;
  totalInterested: number;
  totalBurns:      number;
  avgReplyRate:    number;
  bouncePct:       number;
  burnPct:         number;
  statusCounts:    StatusCounts;
}

interface Summary {
  totalAccounts:      number;
  totalDomains:       number;
  totalSent:          number;
  totalReplies:       number;
  totalBounces:       number;
  totalInterested:    number;
  totalBurns:         number;
  avgReplyRate:       number;
  avgBouncePct:       number;
  avgBurnPct:         number;
  domainStatusCounts: StatusCounts;
}

interface DiagnosticEvent {
  id:                   string;
  classification:       "Bounce" | "Burn";
  timestamp:            string;
  lead_email:           string;
  lead_name:            string;
  campaign:             string;
  sender:               string;
  domain:               string;
  smtp_code:            string;
  smtp_message:         string;
  bounce_type:          string;
  bounce_category:      string;
  subject:              string;
  provider:             string;
  auth_failures:        string[];
  blocklist_indicators: string[];
  raw_reason:           string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveWsName(workspaces: ReturnType<typeof useWorkspaces>, slug: string): string {
  const ws = findWorkspace(workspaces, slug);
  return ws.name !== "Unknown" ? ws.name : slug;
}

function resolveWsColor(workspaces: ReturnType<typeof useWorkspaces>, slug: string): string {
  return findWorkspace(workspaces, slug).color;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "Unknown";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_CFG: Record<Status, { label: string; bg: string; color: string; border: string; icon: React.ElementType }> = {
  disconnected:         { label: "Disconnected",       bg: "#EEF2FF", color: "#3730A3", border: "#A5B4FC", icon: WifiOff },
  burned:               { label: "Burned",             bg: "#FCEBEB", color: "#B91C1C", border: "#F09595", icon: Flame },
  list_issue:           { label: "List issue",         bg: "#FAEEDA", color: "#D97706", border: "#FAC775", icon: AlertTriangle },
  critical_low_replies: { label: "Critical low replies", bg: "#FCEBEB", color: "#B91C1C", border: "#F09595", icon: TrendingDown },
  low_replies:          { label: "Low replies",        bg: "#FAEEDA", color: "#D97706", border: "#FAC775", icon: TrendingDown },
  insufficient_data:    { label: "Insufficient data",  bg: "#F3F4F6", color: "#6B7280", border: "#D1D5DB", icon: Loader2 },
  healthy:              { label: "Healthy",            bg: "#EAF3DE", color: "#15803D", border: "#C0DD97", icon: CheckCircle },
};

function actionTooltip(args: { status: Status; signals: SignalFlags; sent: number; minSends: number }): string {
  const { status, signals, sent, minSends } = args;
  if (status === "disconnected")      return "Mailbox is disconnected in EmailBison. Reconnect in Sender Emails settings before this account can resume sending.";
  if (status === "insufficient_data") return `Not enough volume yet. ${sent}/${minSends} sends needed before flagging.`;
  if (status === "healthy")           return "All metrics within targets.";
  if (status === "burned") {
    if (signals.bounce && signals.replies) return "Multiple issues. Pause and warm up first (2 to 4 weeks), then clean the list before re-introducing.";
    if (signals.bounce)                    return "Pause and warm up. Also clean the recipient list before bringing this back online.";
    if (signals.replies)                   return "Burn is suppressing deliverability. Pause to warm up; reply rate should recover as reputation rebuilds.";
    return "Reputation hit. Pause this account, enable warmup, re-introduce in 2 to 4 weeks. Sanity-check DMARC/SPF/DKIM while paused.";
  }
  if (status === "list_issue") {
    return signals.replies
      ? "List quality is hurting delivery and replies. Cleanse, then reassess targeting."
      : "Bad recipient data. Cleanse or re-enrich the list before sending more.";
  }
  if (status === "critical_low_replies") return "Reply rate below 0.5% with real send volume. Pause this account from outbound and put it on warmup only for 1-2 weeks before resuming.";
  return "Reply rate between 0.5% and 1%. Not great, not drastic. Monitor and consider copy / targeting tweaks.";
}

function actionLabel(args: { status: Status; signals: SignalFlags }): string {
  const { status, signals } = args;
  if (status === "healthy")              return "";
  if (status === "disconnected")         return "Reconnect mailbox in EmailBison";
  if (status === "insufficient_data")    return "Wait for more sends";
  if (status === "critical_low_replies") return "Pause + warmup 1-2 weeks";
  if (status === "low_replies")          return "Monitor; tweak copy / targeting";
  if (status === "list_issue")           return signals.replies ? "Clean list + review targeting" : "Clean the list";
  if (signals.bounce && signals.replies) return "Pause + warm 2-4w, then clean list";
  if (signals.bounce)                    return "Pause + warm 2-4w + clean list";
  if (signals.replies)                   return "Pause + warm 2-4w (replies recover)";
  return "Pause + warm 2-4w, check DMARC/SPF/DKIM";
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

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
        whiteSpace: "nowrap", cursor: tooltip ? "help" : "default",
      }}
    >
      <Icon size={10} />
      {cfg.label}{isProvisional ? "*" : ""}
    </span>
  );
}

// ── RateCell ──────────────────────────────────────────────────────────────────

function RateCell({ value, type }: { value: number; type: "reply" | "bounce" | "burn" }) {
  let color: string;
  if (type === "reply") {
    color = parseFloat(value.toFixed(1)) >= 1 ? "#15803D" : parseFloat(value.toFixed(1)) >= 0.5 ? "#D97706" : "#B91C1C";
  } else if (type === "bounce") {
    color = value < 2 ? "#15803D" : "#B91C1C";
  } else {
    color = value < 0.5 ? "#15803D" : "#B91C1C";
  }
  return <span style={{ fontSize: 12, color, fontWeight: value === 0 && type === "reply" ? 600 : 400 }}>{value}%</span>;
}

// ── ActionButton ──────────────────────────────────────────────────────────────

interface ActionButtonProps {
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  loading: boolean;
  variant: "danger" | "success" | "warmup" | "neutral";
  disabled?: boolean;
}

function ActionButton({ label, icon: Icon, onClick, loading, variant, disabled }: ActionButtonProps) {
  const styles: Record<string, { bg: string; color: string; border: string; hoverBg: string }> = {
    danger:  { bg: "#FCEBEB", color: "#B91C1C", border: "#F09595", hoverBg: "#f8d7d7" },
    success: { bg: "#EAF3DE", color: "#15803D", border: "#C0DD97", hoverBg: "#daefc7" },
    warmup:  { bg: "#FEF3C7", color: "#92400E", border: "#FCD34D", hoverBg: "#fde68a" },
    neutral: { bg: "#F3F4F6", color: "#374151", border: "#D1D5DB", hoverBg: "#e5e7eb" },
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
      color: type === "success" ? "#15803D" : "#B91C1C",
      borderRadius: 10, padding: "10px 16px", fontSize: 12, fontWeight: 500,
      boxShadow: "0 4px 16px rgba(0,0,0,0.10)", maxWidth: 380,
      display: "flex", alignItems: "flex-start", gap: 8,
    }}>
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 14, lineHeight: 1, padding: 0 }}>x</button>
    </div>
  );
}

// ── DayToggle ─────────────────────────────────────────────────────────────────

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

// ── SummaryCard ───────────────────────────────────────────────────────────────

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

function MetricsRow({
  totalDomains, disconnected, listIssue, burned,
  totalSent, totalReplies, avgReplyRate, bouncePct, burnPct,
}: {
  totalDomains: number; disconnected: number; listIssue: number; burned: number;
  totalSent: number; totalReplies: number; avgReplyRate: number; bouncePct: number; burnPct: number;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
      <SummaryCard label="Total domains"   value={totalDomains} />
      <SummaryCard label="Disconnected"    value={disconnected} />
      <SummaryCard label="List issues"     value={listIssue} />
      <SummaryCard label="Burned domains"  value={burned} />
      <SummaryCard label="Emails sent"     value={totalSent.toLocaleString()} />
      <SummaryCard
        label="Avg reply rate"
        value={`${avgReplyRate}%`}
        sub={`(${totalReplies.toLocaleString()} replies)`}
        color={avgReplyRate >= 1 ? "#15803D" : avgReplyRate >= 0.5 ? "#D97706" : "#B91C1C"}
      />
      <SummaryCard label="Avg bounce rate" value={`${bouncePct}%`} color={bouncePct < 2 ? "#15803D" : "#B91C1C"} />
      <SummaryCard label="Avg burn rate"   value={`${burnPct}%`}   color={burnPct < 0.5 ? "#15803D" : "#B91C1C"} />
    </div>
  );
}

// ── Sender settings panel (Feature 1) ────────────────────────────────────────

function SettingsPanel({
  account,
  workspaceSlug,
  onActionDone,
  onAccountUpdated,
}: {
  account: Account;
  workspaceSlug: string;
  onActionDone: (msg: string, type: "success" | "error") => void;
  onAccountUpdated: (patch: Partial<Account>) => void;
}) {
  const [dailyVal,   setDailyVal]   = useState(String(account.daily_limit   ?? ""));
  const [warmupVal,  setWarmupVal]  = useState(String(account.warmup_daily_limit ?? ""));
  const [savingD,    setSavingD]    = useState(false);
  const [savingW,    setSavingW]    = useState(false);
  const [savingWE,   setSavingWE]   = useState(false);

  async function save(field: "daily_limit" | "warmup_daily_limit" | "warmup_enabled", value: number | boolean) {
    const setSaving = field === "daily_limit" ? setSavingD : field === "warmup_daily_limit" ? setSavingW : setSavingWE;
    setSaving(true);
    try {
      const res = await fetch("/api/account-monitor/sender-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender_email: account.sender_email, workspace_slug: workspaceSlug, [field]: value }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        onActionDone(data.error ?? `Failed to update ${field}`, "error");
      } else {
        onAccountUpdated({ [field]: value });
        onActionDone(`${field.replace(/_/g, " ")} updated to ${value}.`, "success");
      }
    } catch (err: any) {
      onActionDone(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "10px 10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {/* Daily sending limit */}
      <div>
        <p style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 5 }}>Daily sending limit</p>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input
            type="number"
            min={1}
            max={500}
            value={dailyVal}
            onChange={e => setDailyVal(e.target.value)}
            placeholder={account.daily_limit != null ? String(account.daily_limit) : "Not set"}
            style={{
              width: 70, fontSize: 11, padding: "3px 6px", borderRadius: 5,
              border: "0.5px solid #d1d5db", fontFamily: "inherit",
              outline: "none",
            }}
          />
          <button
            onClick={() => {
              const v = parseInt(dailyVal, 10);
              if (!Number.isInteger(v) || v < 1) { onActionDone("Daily limit must be a whole number >= 1", "error"); return; }
              save("daily_limit", v);
            }}
            disabled={savingD || !dailyVal}
            style={{
              fontSize: 10, padding: "3px 8px", borderRadius: 5, border: "0.5px solid #d1d5db",
              background: "#f3f4f6", color: "#374151", cursor: savingD || !dailyVal ? "not-allowed" : "pointer",
              fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 3,
            }}
          >
            {savingD ? <Loader2 size={8} style={{ animation: "spin 1s linear infinite" }} /> : null}
            Set
          </button>
          {account.daily_limit != null && (
            <span style={{ fontSize: 10, color: "#9ca3af" }}>current: {account.daily_limit}</span>
          )}
        </div>
      </div>

      {/* Warmup daily limit */}
      <div>
        <p style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 5 }}>Warmup daily limit</p>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input
            type="number"
            min={0}
            max={50}
            value={warmupVal}
            onChange={e => setWarmupVal(e.target.value)}
            placeholder={account.warmup_daily_limit != null ? String(account.warmup_daily_limit) : "Not set"}
            style={{
              width: 70, fontSize: 11, padding: "3px 6px", borderRadius: 5,
              border: "0.5px solid #d1d5db", fontFamily: "inherit",
              outline: "none",
            }}
          />
          <button
            onClick={() => {
              const v = parseInt(warmupVal, 10);
              if (!Number.isInteger(v) || v < 0 || v > 50) { onActionDone("Warmup limit must be 0-50", "error"); return; }
              save("warmup_daily_limit", v);
            }}
            disabled={savingW || !warmupVal}
            style={{
              fontSize: 10, padding: "3px 8px", borderRadius: 5, border: "0.5px solid #d1d5db",
              background: "#f3f4f6", color: "#374151", cursor: savingW || !warmupVal ? "not-allowed" : "pointer",
              fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 3,
            }}
          >
            {savingW ? <Loader2 size={8} style={{ animation: "spin 1s linear infinite" }} /> : null}
            Set
          </button>
          {account.warmup_daily_limit != null && (
            <span style={{ fontSize: 10, color: "#9ca3af" }}>current: {account.warmup_daily_limit}</span>
          )}
        </div>
        <p style={{ fontSize: 9, color: "#9ca3af", marginTop: 3 }}>Max 50 (EB limit)</p>
      </div>

      {/* Warmup toggle */}
      <div>
        <p style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 5 }}>Warmup</p>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <ActionButton
            label={account.warmup_enabled ? "Disable warmup" : "Enable warmup"}
            icon={account.warmup_enabled ? WifiOff : Wifi}
            onClick={() => save("warmup_enabled", !account.warmup_enabled)}
            loading={savingWE}
            variant={account.warmup_enabled ? "neutral" : "warmup"}
          />
          <span style={{
            fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 500,
            background: account.warmup_enabled ? "#EAF3DE" : "#F3F4F6",
            color:      account.warmup_enabled ? "#15803D"  : "#6B7280",
            border: `0.5px solid ${account.warmup_enabled ? "#C0DD97" : "#D1D5DB"}`,
          }}>
            {account.warmup_enabled ? "On" : "Off"}
          </span>
          {account.warmup_score != null && (
            <span style={{ fontSize: 10, color: "#9ca3af" }}>score: {account.warmup_score}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sender info panel (Feature 2) ─────────────────────────────────────────────

function InfoPanel({ account }: { account: Account }) {
  const providerLabel = account.provider_type
    ? account.provider_type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : "Unknown";

  return (
    <div style={{ padding: "10px 10px 12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {/* Tags */}
        <div>
          <p style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 5, display: "flex", alignItems: "center", gap: 4 }}>
            <Tag size={9} /> Tags
          </p>
          {account.tags && account.tags.length > 0 ? (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {account.tags.map(tag => (
                <span key={tag} style={{
                  fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 500,
                  background: "#EEF2FF", color: "#3730A3", border: "0.5px solid #A5B4FC",
                  whiteSpace: "nowrap",
                }}>{tag}</span>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 11, color: "#9ca3af" }}>No tags</span>
          )}
        </div>

        {/* Created date */}
        <div>
          <p style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 5, display: "flex", alignItems: "center", gap: 4 }}>
            <Calendar size={9} /> Added to EB
          </p>
          <span style={{ fontSize: 11, color: "#374151" }}>{fmtDate(account.eb_created_at)}</span>
        </div>

        {/* Provider */}
        <div>
          <p style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 5 }}>Provider</p>
          <span style={{ fontSize: 11, color: "#374151" }}>{providerLabel}</span>
        </div>

        {/* Warmup score */}
        <div>
          <p style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 5 }}>Warmup score</p>
          {account.warmup_score != null ? (
            <span style={{
              fontSize: 11, fontWeight: 500,
              color: account.warmup_score >= 98 ? "#15803D" : account.warmup_score >= 90 ? "#D97706" : "#B91C1C",
            }}>{account.warmup_score}%</span>
          ) : (
            <span style={{ fontSize: 11, color: "#9ca3af" }}>Unknown</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Diagnostics panel (Feature 4) ────────────────────────────────────────────

function DiagnosticsPanel({ account, workspaceSlug }: { account: Account; workspaceSlug: string }) {
  const [events, setEvents]   = useState<DiagnosticEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/account-monitor/diagnostics?sender_email=${encodeURIComponent(account.sender_email)}&workspace_slug=${encodeURIComponent(workspaceSlug)}&days=30`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setEvents([]); }
        else setEvents(d.diagnostics ?? []);
      })
      .catch(err => { setError(err.message); setEvents([]); })
      .finally(() => setLoading(false));
  }, [account.sender_email, workspaceSlug]);

  if (loading) {
    return (
      <div style={{ padding: "14px 10px", display: "flex", gap: 6, alignItems: "center", color: "#9ca3af", fontSize: 11 }}>
        <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Loading diagnostics...
      </div>
    );
  }
  if (error) {
    return <div style={{ padding: "10px", fontSize: 11, color: "#B91C1C" }}>{error}</div>;
  }
  if (!events || events.length === 0) {
    return <div style={{ padding: "10px", fontSize: 11, color: "#9ca3af" }}>No bounce or burn events in the last 30 days.</div>;
  }

  const burns   = events.filter(e => e.classification === "Burn").length;
  const bounces = events.filter(e => e.classification === "Bounce").length;

  return (
    <div style={{ padding: "10px 10px 12px" }}>
      {/* Summary */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 500, background: burns > 0 ? "#FCEBEB" : "#EAF3DE", color: burns > 0 ? "#B91C1C" : "#15803D", border: `0.5px solid ${burns > 0 ? "#F09595" : "#C0DD97"}` }}>
          {burns} burn{burns !== 1 ? "s" : ""}
        </span>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 500, background: bounces > 0 ? "#FAEEDA" : "#EAF3DE", color: bounces > 0 ? "#D97706" : "#15803D", border: `0.5px solid ${bounces > 0 ? "#FAC775" : "#C0DD97"}` }}>
          {bounces} bounce{bounces !== 1 ? "s" : ""}
        </span>
        <span style={{ fontSize: 10, color: "#9ca3af", alignSelf: "center" }}>Last 30 days</span>
      </div>

      {/* Events table */}
      <div style={{ border: "0.5px solid #ede9e3", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ background: "#f8f7f5", borderBottom: "0.5px solid #ede9e3" }}>
              {["Date", "Type", "Lead", "Campaign", "SMTP", "Flags", ""].map(h => (
                <th key={h} style={{ fontSize: 9, fontWeight: 500, color: "#9ca3af", padding: "6px 8px", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => {
              const isBurn    = ev.classification === "Burn";
              const isOpen    = expanded === ev.id;
              const hasFlags  = ev.auth_failures.length > 0 || ev.blocklist_indicators.length > 0;
              return (
                <Fragment key={ev.id}>
                  <tr style={{ borderBottom: isOpen ? "none" : i < events.length - 1 ? "0.5px solid #f3f4f6" : "none", background: isOpen ? "#fafafa" : "transparent" }}>
                    <td style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "#6b7280", fontSize: 10 }}>
                      {new Date(ev.timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </td>
                    <td style={{ padding: "5px 8px" }}>
                      <span style={{
                        fontSize: 9, padding: "1px 6px", borderRadius: 20, fontWeight: 600, whiteSpace: "nowrap",
                        background: isBurn ? "#FCEBEB" : "#FAEEDA",
                        color:      isBurn ? "#B91C1C"  : "#D97706",
                        border:    `0.5px solid ${isBurn ? "#F09595" : "#FAC775"}`,
                      }}>{ev.classification}</span>
                    </td>
                    <td style={{ padding: "5px 8px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151" }}>
                      {ev.lead_email}
                    </td>
                    <td style={{ padding: "5px 8px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151" }}>
                      {ev.campaign}
                    </td>
                    <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                      <span style={{
                        fontSize: 10, fontWeight: 500,
                        color: ev.smtp_code !== "Unknown" && ev.smtp_code.startsWith("5") ? "#B91C1C"
                             : ev.smtp_code !== "Unknown" && ev.smtp_code.startsWith("4") ? "#D97706"
                             : "#6b7280",
                      }}>
                        {ev.smtp_code}
                      </span>
                    </td>
                    <td style={{ padding: "5px 8px" }}>
                      {hasFlags ? (
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                          {ev.auth_failures.map(f => (
                            <span key={f} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, background: "#FCEBEB", color: "#B91C1C", border: "0.5px solid #F09595", fontWeight: 600 }}>{f}</span>
                          ))}
                          {ev.blocklist_indicators.map(f => (
                            <span key={f} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, background: "#FAEEDA", color: "#D97706", border: "0.5px solid #FAC775", fontWeight: 500 }}>{f}</span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontSize: 10, color: "#d1d5db" }}>None</span>
                      )}
                    </td>
                    <td style={{ padding: "5px 8px" }}>
                      <button
                        onClick={() => setExpanded(isOpen ? null : ev.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 0 }}
                        title="Show full SMTP message"
                      >
                        {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr style={{ background: "#fafafa", borderBottom: i < events.length - 1 ? "0.5px solid #f3f4f6" : "none" }}>
                      <td colSpan={7} style={{ padding: "6px 8px 10px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
                          <div>
                            <p style={{ fontSize: 9, color: "#9ca3af", fontWeight: 500, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>Bounce type</p>
                            <p style={{ fontSize: 11, color: "#374151" }}>{ev.bounce_type}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: 9, color: "#9ca3af", fontWeight: 500, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>Category</p>
                            <p style={{ fontSize: 11, color: "#374151" }}>{ev.bounce_category}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: 9, color: "#9ca3af", fontWeight: 500, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>Provider</p>
                            <p style={{ fontSize: 11, color: "#374151" }}>{ev.provider}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: 9, color: "#9ca3af", fontWeight: 500, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>Subject</p>
                            <p style={{ fontSize: 11, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{ev.subject}</p>
                          </div>
                        </div>
                        <div>
                          <p style={{ fontSize: 9, color: "#9ca3af", fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Mail server response</p>
                          <pre style={{ fontSize: 10, color: "#374151", background: "#f3f4f6", border: "0.5px solid #e5e7eb", borderRadius: 6, padding: "6px 8px", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontFamily: "monospace", maxHeight: 120, overflowY: "auto" }}>
                            {ev.smtp_message}
                          </pre>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Sender expanded panel (replaces CampaignDropdown) ────────────────────────

function SenderExpandedPanel({
  account,
  workspaceSlug,
  onActionDone,
  onAccountUpdated,
}: {
  account: Account;
  workspaceSlug: string;
  onActionDone: (msg: string, type: "success" | "error") => void;
  onAccountUpdated: (patch: Partial<Account>) => void;
}) {
  const [tab, setTab] = useState<"controls" | "info" | "diagnostics">("controls");

  const TABS: { key: typeof tab; label: string; icon: React.ElementType }[] = [
    { key: "controls",    label: "Controls",    icon: Settings },
    { key: "info",        label: "Info",         icon: Info },
    { key: "diagnostics", label: "Diagnostics",  icon: Zap },
  ];

  return (
    <div style={{ borderTop: "0.5px solid #e5e7eb", margin: "0 10px 0 32px" }}>
      <div style={{ display: "flex", gap: 0, borderBottom: "0.5px solid #f3f4f6", paddingTop: 2 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              fontSize: 10, padding: "5px 10px", fontFamily: "inherit", cursor: "pointer",
              background: "none", border: "none", display: "inline-flex", alignItems: "center", gap: 4,
              fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? "#111827" : "#9ca3af",
              borderBottom: tab === t.key ? "2px solid #111827" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            <t.icon size={9} />
            {t.label}
          </button>
        ))}
      </div>
      {tab === "controls" && (
        <SettingsPanel
          account={account}
          workspaceSlug={workspaceSlug}
          onActionDone={onActionDone}
          onAccountUpdated={onAccountUpdated}
        />
      )}
      {tab === "info" && <InfoPanel account={account} />}
      {tab === "diagnostics" && <DiagnosticsPanel account={account} workspaceSlug={workspaceSlug} />}
    </div>
  );
}

// ── WorkspaceCard (Level 1) ───────────────────────────────────────────────────

function WorkspaceCard({ ws, onClick }: { ws: WorkspaceData; onClick: () => void }) {
  const workspaces = useWorkspaces();
  const name = resolveWsName(workspaces, ws.slug);
  const { disconnected: disconnectedCount, burned: burnedCount, critical_low_replies: criticalCount,
          list_issue: listCount, insufficient_data: insufficientCount, healthy: healthyCount } = ws.statusCounts;

  const accent =
    disconnectedCount > 0 ? "#6366F1" :
    burnedCount > 0       ? "#E24B4A" :
    criticalCount > 0     ? "#E24B4A" :
    listCount > 0         ? "#F59E0B" :
    ws.statusCounts.low_replies > 0 ? "#F59E0B" :
    healthyCount > 0      ? "#84C56A" :
                            "#9CA3AF";

  return (
    <div
      onClick={onClick}
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
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#FCEBEB", color: "#B91C1C", border: "0.5px solid #F09595", fontWeight: 500, whiteSpace: "nowrap" }}>
              {burnedCount} burned
            </span>
          )}
          {criticalCount > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#FCEBEB", color: "#B91C1C", border: "0.5px solid #F09595", fontWeight: 500, whiteSpace: "nowrap" }}>
              {criticalCount} critical low replies
            </span>
          )}
          {listCount > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#FAEEDA", color: "#D97706", border: "0.5px solid #FAC775", fontWeight: 500, whiteSpace: "nowrap" }}>
              {listCount} list issue
            </span>
          )}
          {insufficientCount > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#F3F4F6", color: "#6B7280", border: "0.5px solid #D1D5DB", fontWeight: 500, whiteSpace: "nowrap" }}>
              {insufficientCount} insufficient
            </span>
          )}
          {disconnectedCount === 0 && burnedCount === 0 && criticalCount === 0 && listCount === 0 && insufficientCount === 0 && healthyCount > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#EAF3DE", color: "#15803D", border: "0.5px solid #C0DD97", fontWeight: 500, whiteSpace: "nowrap" }}>
              All healthy
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          { label: "Domains",       value: ws.domainCount,                        color: undefined },
          { label: "Emails sent",   value: ws.totalSent.toLocaleString(),          color: undefined },
          {
            label: "Avg reply rate",
            value: `${ws.avgReplyRate}% (${ws.totalReplies.toLocaleString()})`,
            color: ws.avgReplyRate >= 1 ? "#15803D" : ws.avgReplyRate >= 0.5 ? "#D97706" : "#B91C1C",
          },
          { label: "Bounce rate",   value: `${ws.bouncePct}%`, color: ws.bouncePct < 2 ? "#15803D" : "#B91C1C" },
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

// ── DomainTable (Level 2) ─────────────────────────────────────────────────────

function DomainTable({ ws, days, onBack, onActionDone }: {
  ws: WorkspaceData;
  days: number;
  onBack: () => void;
  onActionDone: (msg: string, type: "success" | "error") => void;
}) {
  const workspaces = useWorkspaces();
  const name = resolveWsName(workspaces, ws.slug);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [expandedEmail,  setExpandedEmail]  = useState<string | null>(null);
  const [loadingMap,     setLoadingMap]     = useState<Record<string, string | null>>({});
  const [pausedSet,      setPausedSet]      = useState<Set<string>>(new Set());
  const [localAccounts,  setLocalAccounts]  = useState<Record<string, Account>>({});
  const [tab, setTab] = useState<"active" | "warming">("active");
  const [domainBatch, setDomainBatch] = useState<Record<string, "pause_outbound_and_warmup" | null>>({});

  const isWarming = (a: Account) => a.emails_sent === 0;
  const isActive  = (a: Account) => a.emails_sent > 0;
  const activeCount  = ws.accounts.filter(isActive).length;
  const warmingCount = ws.accounts.filter(isWarming).length;

  function resolveAccount(acc: Account): Account {
    return localAccounts[acc.sender_email] ? { ...acc, ...localAccounts[acc.sender_email] } : acc;
  }

  async function runAction(senderEmail: string, action: "pause_outbound_and_warmup" | "attach_to_all" | "enable_warmup") {
    setLoadingMap(prev => ({ ...prev, [senderEmail]: action }));
    try {
      const res = await fetch("/api/account-monitor/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender_email: senderEmail, workspace_slug: ws.slug, action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        onActionDone(data.error ?? "Action failed", "error");
        return;
      }
      if (action === "pause_outbound_and_warmup") {
        setPausedSet(prev => new Set([...prev, senderEmail]));
        onActionDone(`${senderEmail}: paused outbound, warmup enabled.`, "success");
      } else if (action === "attach_to_all") {
        setPausedSet(prev => { const s = new Set(prev); s.delete(senderEmail); return s; });
        onActionDone(`${senderEmail}: re-added to all campaigns.`, "success");
      } else {
        onActionDone(`${senderEmail}: warmup enabled.`, "success");
      }
    } catch (err: any) {
      onActionDone(err.message ?? "Network error", "error");
    } finally {
      setLoadingMap(prev => ({ ...prev, [senderEmail]: null }));
    }
  }

  async function runDomainBatch(domain: string, accounts: Account[], action: "pause_outbound_and_warmup") {
    const eligible = accounts.filter(a => !pausedSet.has(a.sender_email));
    if (eligible.length === 0) { onActionDone(`No active senders left to act on in ${domain}.`, "error"); return; }

    const senderIds = eligible.map(a => a.eb_sender_id).filter(Boolean) as number[];
    if (senderIds.length === 0) {
      onActionDone(`No EB sender IDs found for ${domain}. Sync senders first.`, "error");
      return;
    }

    setDomainBatch(prev => ({ ...prev, [domain]: action }));
    onActionDone(`Pausing outbound + enabling warmup on ${eligible.length} senders in ${domain}...`, "success");

    try {
      const res = await fetch("/api/account-monitor/domain-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_slug: ws.slug, sender_ids: senderIds, action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        onActionDone(data.error ?? `${domain}: batch failed.`, "error");
      } else {
        eligible.forEach(a => setPausedSet(prev => new Set([...prev, a.sender_email])));
        onActionDone(`${domain}: ${data.sender_count ?? eligible.length} senders paused.`, "success");
      }
    } catch (err: any) {
      onActionDone(err.message, "error");
    } finally {
      setDomainBatch(prev => ({ ...prev, [domain]: null }));
    }
  }

  const ORDER: Record<Status, number> = {
    disconnected: 0, burned: 1, critical_low_replies: 2, list_issue: 3,
    low_replies: 4, healthy: 5, insufficient_data: 6,
  };
  const CONFIDENCE_ORDER: Record<Confidence, number> = { full: 0, provisional: 1 };

  const tabPredicate = tab === "active" ? isActive : isWarming;
  const sortedDomains = ws.domains
    .filter(d => d.accounts.some(tabPredicate))
    .slice()
    .sort((a, b) => {
      if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
      if (CONFIDENCE_ORDER[a.confidence] !== CONFIDENCE_ORDER[b.confidence]) return CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
      if (a.avgReplyRate !== b.avgReplyRate) return a.avgReplyRate - b.avgReplyRate;
      return b.bouncePct - a.bouncePct;
    });

  return (
    <div>
      <button onClick={onBack} style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 12, color: "#6b7280", cursor: "pointer",
        background: "#f8f7f5", border: "0.5px solid #e5e7eb",
        borderRadius: 7, padding: "5px 10px", marginBottom: 16, fontFamily: "inherit",
      }}>
        <ChevronLeft size={13} /> All workspaces
      </button>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, color: "#111827" }}>{name}, sending domains</p>
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
        Click a domain to see its accounts. Click an account to manage settings, view metadata, and see bounce/burn diagnostics.
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 10, borderBottom: "0.5px solid #ede9e3" }}>
        {([
          { key: "active",  label: "Active sending", count: activeCount },
          { key: "warming", label: "Warming only",   count: warmingCount },
        ] as const).map(t => {
          const selected = tab === t.key;
          return (
            <button key={t.key} onClick={() => { setTab(t.key); setExpandedDomain(null); setExpandedEmail(null); }}
              style={{
                fontSize: 12, fontWeight: selected ? 600 : 500, color: selected ? "#111827" : "#6b7280",
                padding: "8px 14px", background: "transparent", border: "none",
                borderBottom: selected ? "2px solid #111827" : "2px solid transparent",
                cursor: "pointer", fontFamily: "inherit", marginBottom: -1,
              }}
            >
              {t.label} <span style={{ color: "#9ca3af", fontWeight: 400 }}>({t.count})</span>
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
                <th key={h} style={{ fontSize: 10, fontWeight: 500, color: "#9ca3af", padding: "9px 10px", textAlign: align as any, textTransform: "uppercase", letterSpacing: "0.04em", width: w }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedDomains.map((dom, dIdx) => {
              const isDomExpanded = expandedDomain === dom.domain;
              const isLastDomain  = dIdx === sortedDomains.length - 1;
              const domBg =
                dom.status === "disconnected"        ? "#EEF2FF" :
                dom.status === "burned"              ? "#FCEBEB" :
                dom.status === "critical_low_replies"? "#FCEBEB" :
                dom.status === "list_issue"          ? "#FFF7E6" :
                "#fafafa";
              const sortedAccounts = dom.accounts
                .filter(tabPredicate)
                .slice()
                .sort((a, b) => {
                  if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
                  if (CONFIDENCE_ORDER[a.confidence] !== CONFIDENCE_ORDER[b.confidence]) return CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
                  if (a.reply_rate !== b.reply_rate) return a.reply_rate - b.reply_rate;
                  return b.bounce_rate - a.bounce_rate;
                });

              return (
                <Fragment key={dom.domain}>
                  {/* Domain row */}
                  <tr
                    style={{ borderBottom: isDomExpanded ? "none" : isLastDomain ? "none" : "0.5px solid #ede9e3", background: domBg, transition: "background 0.2s", cursor: "pointer" }}
                    onClick={() => setExpandedDomain(isDomExpanded ? null : dom.domain)}
                  >
                    <td style={{ padding: "10px 10px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        {isDomExpanded
                          ? <ChevronUp size={12} style={{ color: "#1a56db", flexShrink: 0 }} />
                          : <ChevronDown size={12} style={{ color: "#6b7280", flexShrink: 0 }} />
                        }
                        <span style={{ fontSize: 13, fontWeight: 600, color: isDomExpanded ? "#1a56db" : "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {dom.domain}
                        </span>
                        <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 4 }}>
                          {dom.accounts.length} {dom.accounts.length === 1 ? "account" : "accounts"}
                        </span>
                      </span>
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "right", color: "#111827", fontWeight: 500 }}>{dom.totalSent.toLocaleString()}</td>
                    <td style={{ padding: "10px 10px", textAlign: "right" }}><RateCell value={dom.bouncePct}    type="bounce" /></td>
                    <td style={{ padding: "10px 10px", textAlign: "right" }}><RateCell value={dom.burnPct}      type="burn" /></td>
                    <td style={{ padding: "10px 10px", textAlign: "right" }}><RateCell value={dom.avgReplyRate} type="reply" /></td>
                    <td style={{ padding: "10px 10px", textAlign: "center" }}>
                      <StatusBadge status={dom.status} confidence={dom.confidence} signals={dom.signals} sent={dom.totalSent} minSends={dom.minSends} />
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }} onClick={e => e.stopPropagation()}>
                      {(() => {
                        const batchAction = domainBatch[dom.domain];
                        const eligible    = sortedAccounts.filter(a => !pausedSet.has(a.sender_email));
                        const isRed   = dom.status === "burned" || dom.status === "critical_low_replies";
                        const isAmber = dom.status === "list_issue";

                        if (dom.status === "disconnected") {
                          const wsInfo       = findWorkspace(workspaces, ws.slug);
                          const reconnectUrl = wsInfo.instanceUrl ? `${wsInfo.instanceUrl}/sender-emails` : null;
                          return reconnectUrl ? (
                            <a href={reconnectUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "#EEF2FF", color: "#3730A3", border: "0.5px solid #A5B4FC", fontFamily: "inherit", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
                              <Wifi size={11} /> Reconnect in EmailBison
                            </a>
                          ) : <span style={{ color: "#9ca3af", fontSize: 11 }}>Reconnect in EmailBison</span>;
                        }

                        if ((isRed || isAmber) && eligible.length > 0) {
                          return (
                            <button
                              onClick={() => runDomainBatch(dom.domain, eligible, "pause_outbound_and_warmup")}
                              disabled={!!batchAction}
                              style={{
                                fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                background: isRed ? "#FCEBEB" : "#FAEEDA",
                                color:      isRed ? "#B91C1C"  : "#D97706",
                                border:    `0.5px solid ${isRed ? "#F09595" : "#FAC775"}`,
                                cursor: batchAction ? "wait" : "pointer", fontFamily: "inherit",
                                display: "inline-flex", alignItems: "center", gap: 5,
                              }}>
                              {batchAction ? <Loader2 size={11} className="animate-spin" /> : <Flame size={11} />}
                              Pause + warmup ({eligible.length})
                            </button>
                          );
                        }

                        const label = actionLabel({ status: dom.status, signals: dom.signals });
                        if (!label) return null;
                        const tone = dom.status === "low_replies"
                          ? { bg: "#FAEEDA", color: "#D97706", border: "#FAC775" }
                          : { bg: "#F3F4F6", color: "#6B7280", border: "#D1D5DB" };
                        return (
                          <span style={{ display: "inline-block", fontSize: 10, padding: "3px 9px", borderRadius: 6, background: tone.bg, color: tone.color, border: `0.5px solid ${tone.border}`, fontWeight: 500, whiteSpace: "nowrap" }}>
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>

                  {/* Account rows */}
                  {isDomExpanded && sortedAccounts.map((rawAcc, aIdx) => {
                    const acc         = resolveAccount(rawAcc);
                    const isPaused    = pausedSet.has(acc.sender_email);
                    const isExpanded  = expandedEmail === acc.sender_email;
                    const loadingAct  = loadingMap[acc.sender_email] ?? null;
                    const isLoading   = loadingAct !== null;
                    const rowBg =
                      isPaused                             ? "#f0fdf4" :
                      acc.status === "disconnected"        ? "#F5F7FF" :
                      acc.status === "burned"              ? "#FEF7F7" :
                      acc.status === "critical_low_replies"? "#FEF7F7" :
                      acc.status === "list_issue"          ? "#FFFBEB" :
                      acc.status === "low_replies"         ? "#FFFBEB" :
                      "#ffffff";
                    const isLastAccount = aIdx === sortedAccounts.length - 1;

                    return (
                      <Fragment key={acc.sender_email}>
                        <tr style={{ borderBottom: isExpanded ? "none" : (isLastAccount && isLastDomain) ? "none" : "0.5px solid #f3f4f6", background: rowBg, transition: "background 0.2s" }}>
                          <td style={{ padding: "8px 10px 8px 32px" }}>
                            <button
                              onClick={e => { e.stopPropagation(); setExpandedEmail(isExpanded ? null : acc.sender_email); }}
                              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", textAlign: "left", maxWidth: "100%" }}
                            >
                              <span style={{ fontSize: 12, fontWeight: 400, color: isExpanded ? "#1a56db" : "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: isExpanded ? "underline" : "none", textUnderlineOffset: 2 }}>
                                {acc.sender_email}
                              </span>
                              {isExpanded ? <ChevronUp size={11} style={{ color: "#1a56db", flexShrink: 0 }} /> : <ChevronDown size={11} style={{ color: "#9ca3af", flexShrink: 0 }} />}
                            </button>
                            {isPaused && (
                              <span style={{ display: "block", marginTop: 2, fontSize: 9, color: "#15803D", background: "#EAF3DE", border: "0.5px solid #C0DD97", borderRadius: 4, padding: "1px 5px", width: "fit-content" }}>
                                paused outbound
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right", color: "#374151" }}>{acc.emails_sent.toLocaleString()}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}><RateCell value={acc.bounce_rate} type="bounce" /></td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}><RateCell value={acc.burn_rate}   type="burn" /></td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}><RateCell value={acc.reply_rate} type="reply" /></td>
                          <td style={{ padding: "8px 10px", textAlign: "center" }}>
                            <div style={{ display: "inline-flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
                              <StatusBadge status={acc.status} confidence={acc.confidence} signals={acc.signals} sent={acc.emails_sent} minSends={50} />
                              {acc.warmup_enabled === false && acc.conn_status !== "Not connected" && (
                                <span title="Warmup is disabled for this mailbox in EmailBison. Enable it to keep inbox placement healthy." style={{ fontSize: 9, padding: "1px 6px", borderRadius: 20, background: "#FCEBEB", color: "#B91C1C", border: "0.5px solid #F09595", fontWeight: 500, whiteSpace: "nowrap" }}>
                                  Not warming
                                </span>
                              )}
                              {acc.attached_campaigns_count === 0 && acc.conn_status !== "Not connected" && (
                                <span title="This sender is not attached to any active campaign in EmailBison." style={{ fontSize: 9, padding: "1px 6px", borderRadius: 20, background: "#F3F4F6", color: "#6B7280", border: "0.5px solid #D1D5DB", fontWeight: 500, whiteSpace: "nowrap" }}>
                                  0 campaigns
                                </span>
                              )}
                              {acc.warming_since && (
                                <span title={`On warmup since ${new Date(acc.warming_since).toLocaleDateString()}.`} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 20, background: "#FAEEDA", color: "#D97706", border: "0.5px solid #FAC775", fontWeight: 500, whiteSpace: "nowrap" }}>
                                  Warming {Math.floor((Date.now() - new Date(acc.warming_since).getTime()) / (24 * 60 * 60 * 1000))}d
                                </span>
                              )}
                              {acc.daily_limit != null && (
                                <span style={{ fontSize: 9, color: "#9ca3af", whiteSpace: "nowrap" }}>{acc.daily_limit}/day</span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "6px 10px", textAlign: "center" }}>
                            <div style={{ display: "flex", gap: 5, justifyContent: "center", flexWrap: "wrap" }}>
                              {acc.status === "disconnected" ? (() => {
                                const wsInfo       = findWorkspace(workspaces, ws.slug);
                                const reconnectUrl = wsInfo.instanceUrl ? `${wsInfo.instanceUrl}/sender-emails` : null;
                                return reconnectUrl ? (
                                  <a href={reconnectUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "#EEF2FF", color: "#3730A3", border: "0.5px solid #A5B4FC", fontFamily: "inherit", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
                                    <Wifi size={11} /> Reconnect in EmailBison
                                  </a>
                                ) : <span style={{ color: "#9ca3af", fontSize: 11 }}>Reconnect in EmailBison</span>;
                              })() : isPaused ? (
                                <ActionButton label="Re-add to campaigns" icon={Wifi} onClick={() => runAction(acc.sender_email, "attach_to_all")} loading={isLoading && loadingAct === "attach_to_all"} variant="success" disabled={isLoading} />
                              ) : (acc.status === "burned" || acc.status === "critical_low_replies" || acc.status === "list_issue") ? (
                                <ActionButton label="Pause + warmup" icon={Flame} onClick={() => runAction(acc.sender_email, "pause_outbound_and_warmup")} loading={isLoading && loadingAct === "pause_outbound_and_warmup"} variant="warmup" disabled={isLoading} />
                              ) : acc.warmup_enabled === false ? (
                                <ActionButton label="Enable warmup" icon={Wifi} onClick={() => runAction(acc.sender_email, "enable_warmup")} loading={isLoading && loadingAct === "enable_warmup"} variant="success" disabled={isLoading} />
                              ) : null}
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr style={{ borderBottom: (isLastAccount && isLastDomain) ? "none" : "0.5px solid #f3f4f6", background: rowBg }}>
                            <td colSpan={7} style={{ padding: 0 }}>
                              <SenderExpandedPanel
                                account={acc}
                                workspaceSlug={ws.slug}
                                onActionDone={onActionDone}
                                onAccountUpdated={patch => setLocalAccounts(prev => ({
                                  ...prev,
                                  [acc.sender_email]: { ...(prev[acc.sender_email] ?? acc), ...patch },
                                }))}
                              />
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
  const workspaces = useWorkspaces();
  const [days, setDays]       = useState(10);
  const [data, setData]       = useState<{ workspaces: WorkspaceData[]; summary: Summary } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [selected, setSelected] = useState<WorkspaceData | null>(null);
  const [toast, setToast]     = useState<{ msg: string; type: "success" | "error" } | null>(null);
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

  async function pauseAllBurned() {
    if (!data) return;
    const burned = data.workspaces.flatMap(ws =>
      ws.accounts.filter(a => a.status === "burned").map(a => ({ sender_email: a.sender_email, workspace_slug: a.workspace_slug }))
    );
    if (burned.length === 0) return;
    const confirmed = window.confirm(`Pause outbound + enable warmup on ${burned.length} burned accounts across all workspaces?`);
    if (!confirmed) return;
    setNukingAll(true);
    let ok = 0; let fail = 0;
    for (const acc of burned) {
      try {
        const res = await fetch("/api/account-monitor/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sender_email: acc.sender_email, workspace_slug: acc.workspace_slug, action: "pause_outbound_and_warmup" }),
        });
        const d = await res.json();
        if (res.ok && d.ok) ok++; else fail++;
      } catch { fail++; }
    }
    setNukingAll(false);
    setToast({ msg: `Done: ${ok} paused.${fail > 0 ? ` ${fail} failed.` : ""}`, type: fail > 0 ? "error" : "success" });
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
            <button onClick={pauseAllBurned} disabled={nukingAll || loading}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "0.5px solid #F09595", background: "#FCEBEB", color: "#B91C1C", cursor: nukingAll ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 500 }}>
              {nukingAll ? <Loader2 size={11} className="animate-spin" /> : <Flame size={11} />}
              {nukingAll ? "Pausing..." : "Pause all burned"}
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
        <DomainTable ws={selectedWs} days={days} onBack={() => setSelected(null)} onActionDone={(msg, type) => setToast({ msg, type })} />
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
