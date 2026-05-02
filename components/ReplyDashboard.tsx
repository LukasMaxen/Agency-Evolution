"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { WORKSPACES } from "@/lib/mock-data";
import { X, RefreshCw, Loader2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type DateFilter  = "today" | "yesterday" | "7days" | "30days" | "all";
type QueueFilter = "today" | "tomorrow" | "yesterday" | "7days" | "30days" | "all";
type ModalType   = "replies" | "interested" | "followup" | "meetings" | null;

interface DashboardReply {
  id: string;
  name: string;
  email: string;
  workspaceId: string;
  message: string;
  date: string;
  type: "interested" | "not_interested" | "neutral";
}

interface FollowUpLead {
  id: string;
  name: string;
  email: string;
  workspaceId: string;
  firstReplied: string;
  lastFUSent: string | null;
  fuStep: number;
  totalEmails: number;
  nextFUDue: string;
  meetingBooked: boolean;
}

interface MeetingLead {
  id: string;
  name: string;
  email: string;
  workspaceId: string;
  meetingDate: string;
  durationMinutes: number;
  status: string;
}


interface EmailStat {
  workspaceId: string;
  total: number;
  yesterday: number;
  today: number;
  last7: number;
  last30: number;
  replies: number;
  interested: number;
}

interface EmailTotals {
  total: number;
  yesterday: number;
  today: number;
  last7: number;
  last30: number;
  replies: number;
  interested: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function diffDays(date: string | Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function inDateRange(date: string, filter: DateFilter): boolean {
  const d = diffDays(date);
  if (filter === "today")     return d === 0;
  if (filter === "yesterday") return d === -1;
  if (filter === "7days")     return d >= -7 && d <= 0;
  if (filter === "30days")    return d >= -30 && d <= 0;
  return true;
}

function inQueueRange(date: string, filter: QueueFilter): boolean {
  const d = diffDays(date);
  if (filter === "today")     return d === 0;
  if (filter === "tomorrow")  return d === 1;
  if (filter === "yesterday") return d === -1;
  if (filter === "7days")     return d >= -7 && d <= 0;
  if (filter === "30days")    return d >= -30 && d <= 0;
  return true;
}

function getFUStatus(lead: FollowUpLead) {
  const d = diffDays(lead.nextFUDue);
  if (d < 0)   return { label: "Overdue",   bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", order: 0 };
  if (d === 0) return { label: "Due today", bg: "#fef3c7", color: "#92400e", border: "#fcd34d", order: 1 };
  if (d <= 7)  return { label: "This week", bg: "#eff6ff", color: "#1e40af", border: "#93c5fd", order: 2 };
  return              { label: "Upcoming",  bg: "#f1f5f9", color: "#475569", border: "#e2e8f0", order: 3 };
}

function wsInfo(slugOrId: string): { name: string; color: string } {
  const ws = WORKSPACES.find(w => w.slug === slugOrId || w.id === slugOrId);
  return { name: ws?.name ?? slugOrId, color: ws?.color ?? "#6b7280" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ClientBadge({ workspaceId }: { workspaceId: string }) {
  const { name, color } = wsInfo(workspaceId);
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 20,
      background: color + "18", color, border: `1px solid ${color}30`,
      whiteSpace: "nowrap",
    }}>
      {name}
    </span>
  );
}

function DateFilterBar({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { key: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", gap: 3, background: "#f8f7f5", border: "1px solid #e5e7eb", borderRadius: 10, padding: 3, flexWrap: "wrap" }}>
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)}
          style={{
            fontSize: 11, padding: "4px 10px", borderRadius: 7, border: "none", cursor: "pointer",
            background: value === o.key ? "#ffffff" : "transparent",
            color: value === o.key ? "#1a56db" : "#6b7280",
            fontWeight: value === o.key ? 500 : 400,
            boxShadow: value === o.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MetricCard({ label, value, color, sub, onClick, loading }: {
  label: string; value: number; color: string; sub: string;
  onClick: () => void; loading: boolean;
}) {
  return (
    <div onClick={onClick}
      style={{
        background: "#ffffff", borderRadius: 12, border: "1px solid #ede9e3",
        padding: 14, cursor: "pointer", transition: "border-color 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = color}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = "#ede9e3"}
    >
      <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>{label}</p>
      {loading
        ? <div style={{ height: 36, display: "flex", alignItems: "center" }}><Loader2 size={18} className="animate-spin" style={{ color }} /></div>
        : <p style={{ fontSize: 26, fontWeight: 500, color }}>{value}</p>
      }
      <p style={{ fontSize: 10, color, marginTop: 4 }}>{sub} →</p>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ type, replies, fuLeads, meetings, onClose }: {
  type: ModalType;
  replies: DashboardReply[];
  fuLeads: FollowUpLead[];
  meetings: MeetingLead[];
  onClose: () => void;
}) {
  if (!type) return null;

  const titles: Record<NonNullable<ModalType>, string> = {
    replies:    `All replies (${replies.length})`,
    interested: `Interested leads (${replies.filter(r => r.type === "interested").length})`,
    followup:   `Follow-ups due (${fuLeads.length})`,
    meetings:   `Meetings booked (${meetings.length})`,
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, padding: 20,
      }}
    >
      <div style={{
        background: "#ffffff", borderRadius: 16, border: "1px solid #ede9e3",
        width: "100%", maxWidth: 640, maxHeight: "80vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{titles[type]}</p>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "12px 20px", flex: 1 }}>
          {(type === "replies" || type === "interested") && (() => {
            const items = type === "interested" ? replies.filter(r => r.type === "interested") : replies;
            if (items.length === 0) return <p style={{ color: "#9ca3af", fontSize: 12, textAlign: "center", padding: 24 }}>No items in this period</p>;
            return items.map(r => {
              const typeColor = r.type === "interested" ? "#16a34a" : r.type === "not_interested" ? "#dc2626" : "#6b7280";
              const typeLabel = r.type === "interested" ? "Interested" : r.type === "not_interested" ? "Not interested" : "Neutral";
              const typeBg    = r.type === "interested" ? "#d1fae5" : r.type === "not_interested" ? "#fee2e2" : "#f1f5f9";
              return (
                <div key={r.id} style={{ padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{r.name}</span>
                      <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 20, background: typeBg, color: typeColor, border: `1px solid ${typeColor}30` }}>{typeLabel}</span>
                      <ClientBadge workspaceId={r.workspaceId} />
                    </div>
                    <span style={{ fontSize: 10, color: "#9ca3af" }}>{fmtDate(r.date)}</span>
                  </div>
                  <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>{r.email}</p>
                  <p style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, background: "#f8f7f5", padding: "8px 10px", borderRadius: 8 }}>"{r.message}"</p>
                </div>
              );
            });
          })()}

          {type === "followup" && (() => {
            if (fuLeads.length === 0) return <p style={{ color: "#9ca3af", fontSize: 12, textAlign: "center", padding: 24 }}>No follow-ups in this period</p>;
            return fuLeads.map(l => {
              const s = getFUStatus(l);
              return (
                <div key={l.id} style={{ padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{l.name}</span>
                      <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 20, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{s.label}</span>
                      <ClientBadge workspaceId={l.workspaceId} />
                    </div>
                    <span style={{ fontSize: 10, color: "#9ca3af" }}>FU {l.fuStep + 1} due {fmtDate(l.nextFUDue)}</span>
                  </div>
                  <p style={{ fontSize: 11, color: "#6b7280" }}>{l.email} · {l.totalEmails} emails sent so far</p>
                </div>
              );
            });
          })()}

          {type === "meetings" && (() => {
            if (meetings.length === 0) return <p style={{ color: "#9ca3af", fontSize: 12, textAlign: "center", padding: 24 }}>No meetings booked</p>;
            return meetings.map(m => {
              const md = diffDays(m.meetingDate);
              const mLabel = md < 0 ? "Completed" : md === 0 ? "Today!" : fmtDate(m.meetingDate);
              const mColor = md < 0 ? "#9ca3af" : md === 0 ? "#16a34a" : "#1a56db";
              return (
                <div key={m.id} style={{ padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{m.name}</span>
                      <ClientBadge workspaceId={m.workspaceId} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 500, color: mColor }}>{mLabel}</span>
                  </div>
                  <p style={{ fontSize: 11, color: "#6b7280" }}>{m.email} · {m.durationMinutes ?? 30} min</p>
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ReplyDashboard() {
  const [replies,   setReplies]   = useState<DashboardReply[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpLead[]>([]);
  const [meetings,  setMeetings]  = useState<MeetingLead[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [emailStats,  setEmailStats]  = useState<EmailStat[]>([]);
  const [emailTotals, setEmailTotals] = useState<EmailTotals | null>(null);

  const [clientFilter, setClientFilter] = useState("all");
  const [metricFilter, setMetricFilter] = useState<DateFilter>("today");
  const [queueFilter,  setQueueFilter]  = useState<QueueFilter>("today");
  const [modal, setModal] = useState<ModalType>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to load dashboard");
      }
      const data = await res.json();
      setReplies(data.replies ?? []);
      setFollowUps(data.followUps ?? []);
      setMeetings(data.meetings ?? []);
      setEmailStats(data.emailStats ?? []);
      setEmailTotals(data.emailTotals ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const allClients = useMemo(() => {
    const slugs = new Set([
      ...replies.map(r => r.workspaceId),
      ...followUps.map(f => f.workspaceId),
      ...meetings.map(m => m.workspaceId),
      ...emailStats.map(e => e.workspaceId),
    ]);
    return Array.from(slugs).map(slug => wsInfo(slug).name).filter(Boolean).sort();
  }, [replies, followUps, meetings, emailStats]);

  function matchesClient(workspaceId: string): boolean {
    if (clientFilter === "all") return true;
    return wsInfo(workspaceId).name === clientFilter;
  }

  const filteredReplies = useMemo(() =>
    replies.filter(r => matchesClient(r.workspaceId) && inDateRange(r.date, metricFilter)),
    [replies, clientFilter, metricFilter]
  );

  const filteredFULeads = useMemo(() =>
    followUps
      .filter(l => matchesClient(l.workspaceId) && inQueueRange(l.nextFUDue, queueFilter))
      .sort((a, b) => getFUStatus(a).order - getFUStatus(b).order || new Date(a.nextFUDue).getTime() - new Date(b.nextFUDue).getTime()),
    [followUps, clientFilter, queueFilter]
  );

  const filteredMeetings = useMemo(() =>
    meetings
      .filter(m => matchesClient(m.workspaceId))
      .sort((a, b) => new Date(a.meetingDate).getTime() - new Date(b.meetingDate).getTime()),
    [meetings, clientFilter]
  );

  const overdueCount = useMemo(() =>
    followUps.filter(l => matchesClient(l.workspaceId) && diffDays(l.nextFUDue) <= 0).length,
    [followUps, clientFilter]
  );

  const metricOptions = [
    { key: "today",     label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "7days",     label: "Last 7 days" },
    { key: "30days",    label: "Last 30 days" },
    { key: "all",       label: "All" },
  ];

  const queueOptions = [
    { key: "today",     label: "Today" },
    { key: "tomorrow",  label: "Tomorrow" },
    { key: "yesterday", label: "Yesterday" },
    { key: "7days",     label: "Last 7 days" },
    { key: "30days",    label: "Last 30 days" },
    { key: "all",       label: "All" },
  ];

  const today = new Date();

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#f8f7f5" }}>
        <p style={{ fontSize: 13, color: "#991b1b" }}>Failed to load dashboard</p>
        <p style={{ fontSize: 11, color: "#9ca3af", maxWidth: 360, textAlign: "center" }}>{error}</p>
        <button onClick={fetchDashboard}
          style={{ fontSize: 12, padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", color: "#374151" }}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#f8f7f5", padding: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, color: "#111827" }}>Reply Dashboard</p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            {today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })} · {today.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })} EST
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <DateFilterBar value={metricFilter} onChange={v => setMetricFilter(v as DateFilter)} options={metricOptions} />
          <select
            value={clientFilter}
            onChange={e => setClientFilter(e.target.value)}
            style={{ fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151" }}
          >
            <option value="all">All clients</option>
            {allClients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={fetchDashboard} disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer" }}>
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Metric cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
        <MetricCard label="Total replies"   value={filteredReplies.length}                                      color="#1a56db" sub="Click to see all replies"      onClick={() => setModal("replies")}   loading={loading} />
        <MetricCard label="New interested"  value={filteredReplies.filter(r => r.type === "interested").length} color="#16a34a" sub="Click to see interested leads" onClick={() => setModal("interested")} loading={loading} />
        <MetricCard label="Follow-ups due"  value={overdueCount}                                                color="#dc2626" sub="Click to see follow-up queue"  onClick={() => setModal("followup")}  loading={loading} />
        <MetricCard label="Meetings booked" value={filteredMeetings.length}                                     color="#1a56db" sub="Click to see all meetings"     onClick={() => setModal("meetings")}  loading={loading} />
      </div>

      {/* Follow-up queue */}
      <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #ede9e3", overflow: "hidden", marginBottom: 14 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>Follow-up queue</p>
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Interested leads awaiting follow-up — sorted by urgency</p>
          </div>
          <DateFilterBar value={queueFilter} onChange={v => setQueueFilter(v as QueueFilter)} options={queueOptions} />
        </div>

        <div style={{ overflowX: "auto" }}>
          {loading ? (
            <div style={{ padding: 32, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Loader2 size={14} className="animate-spin" style={{ color: "#9ca3af" }} />
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Loading...</span>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr style={{ background: "#f8f7f5" }}>
                  {["Lead", "Email", "Client", "First replied", "Last FU sent", "Emails sent", "Next FU due", "Status", "Action"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "9px 14px", fontSize: 10, fontWeight: 500, color: "#9ca3af", borderBottom: "1px solid #f3f4f6", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredFULeads.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
                      No follow-ups for this period
                    </td>
                  </tr>
                ) : filteredFULeads.map(l => {
                  const s = getFUStatus(l);
                  const d = diffDays(l.nextFUDue);
                  const dLabel = d < 0
                    ? <span style={{ color: "#dc2626", fontWeight: 500 }}>{Math.abs(d)}d overdue</span>
                    : d === 0 ? <span style={{ color: "#d97706", fontWeight: 500 }}>Today</span>
                    : d === 1 ? <span style={{ color: "#d97706" }}>Tomorrow</span>
                    : <span style={{ color: "#6b7280" }}>in {d}d</span>;
                  const rowBg = s.order === 0 ? "#fff8f8" : s.order === 1 ? "#fffdf0" : "#ffffff";
                  const borderLeft = s.order <= 1 ? `3px solid ${s.border}` : "3px solid transparent";
                  return (
                    <tr key={l.id} style={{ background: rowBg, borderLeft }}>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}><span style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{l.name}</span></td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}><span style={{ fontSize: 11, color: "#6b7280" }}>{l.email}</span></td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}><ClientBadge workspaceId={l.workspaceId} /></td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}><span style={{ fontSize: 11, color: "#374151" }}>{fmtDate(l.firstReplied)}</span></td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}><span style={{ fontSize: 11, color: "#374151" }}>{l.lastFUSent ? fmtDate(l.lastFUSent) : "—"}</span></td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "#374151" }}>{l.totalEmails}</span>
                        <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 4 }}>emails</span>
                        <span style={{ fontSize: 10, background: "#f1f5f9", color: "#475569", padding: "1px 6px", borderRadius: 20, marginLeft: 4 }}>FU {l.fuStep}</span>
                      </td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                        <span style={{ fontSize: 11, fontWeight: 500, color: "#374151", display: "block" }}>{fmtDate(l.nextFUDue)}</span>
                        <span style={{ fontSize: 10, display: "block", marginTop: 1 }}>{dLabel}</span>
                      </td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                        <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, fontWeight: 500, background: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: "nowrap" }}>{s.label}</span>
                      </td>
                      <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                        <button style={{ fontSize: 10, fontWeight: 500, padding: "5px 10px", borderRadius: 7, border: "none", background: "#1a56db", color: "#ffffff", cursor: "pointer", whiteSpace: "nowrap" }}>
                          Send FU {l.fuStep + 1}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Meetings booked */}
      <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #ede9e3", overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>Meetings booked</p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Leads who booked a meeting</p>
        </div>
        {loading ? (
          <div style={{ padding: 32, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Loader2 size={14} className="animate-spin" style={{ color: "#9ca3af" }} />
            <span style={{ fontSize: 12, color: "#9ca3af" }}>Loading...</span>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8f7f5" }}>
                {["Lead", "Email", "Client", "Meeting date", "Duration", "Status"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "9px 14px", fontSize: 10, fontWeight: 500, color: "#9ca3af", borderBottom: "1px solid #f3f4f6", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredMeetings.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 12 }}>No meetings booked</td>
                </tr>
              ) : filteredMeetings.map(m => {
                const md = diffDays(m.meetingDate);
                const mLabel = md < 0 ? "Completed" : md === 0 ? "Today!" : `in ${md}d`;
                const mColor = md < 0 ? "#9ca3af" : md === 0 ? "#16a34a" : "#1a56db";
                return (
                  <tr key={m.id} style={{ background: "#ffffff" }}>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}><span style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{m.name}</span></td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}><span style={{ fontSize: 11, color: "#6b7280" }}>{m.email}</span></td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}><ClientBadge workspaceId={m.workspaceId} /></td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: "#374151" }}>{fmtDate(m.meetingDate)}</span>
                      <span style={{ fontSize: 10, color: mColor, marginLeft: 6, fontWeight: 500 }}>{mLabel}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}><span style={{ fontSize: 11, color: "#374151" }}>{m.durationMinutes ?? 30} min</span></td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, fontWeight: 500,
                        background: m.status === "completed" ? "#f1f5f9" : "#d1fae5",
                        color: m.status === "completed" ? "#475569" : "#065f46",
                        border: `1px solid ${m.status === "completed" ? "#e2e8f0" : "#6ee7b7"}`,
                        whiteSpace: "nowrap" }}>
                        {m.status === "completed" ? "Completed" : "Scheduled"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Emails Sent */}
      <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #ede9e3", overflow: "hidden", marginTop: 14 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>Emails sent</p>
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Volume and bounce rate per workspace</p>
          </div>
          {emailTotals && (
            <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" }}>
              {[
                { label: "Yesterday",   value: emailTotals.yesterday.toLocaleString(), color: "#374151" },
                { label: "Today",       value: emailTotals.today.toLocaleString(),     color: "#1a56db" },
                { label: "Last 7 days", value: emailTotals.last7.toLocaleString(),     color: "#1a56db" },
                { label: "All time",    value: emailTotals.total.toLocaleString(),      color: "#374151" },
                { label: "Replies",     value: emailTotals.replies.toLocaleString(),    color: "#0f6e56" },
                { label: "Interested",  value: emailTotals.interested.toLocaleString(), color: "#16a34a" },
              ].map((stat, i, arr) => (
                <div key={stat.label} style={{
                  display: "flex", alignItems: "center",
                }}>
                  <div style={{ textAlign: "right", padding: "0 20px" }}>
                    <p style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap" }}>{stat.label}</p>
                    <p style={{ fontSize: 16, fontWeight: 600, color: stat.color, marginTop: 2 }}>{stat.value}</p>
                  </div>
                  {i < arr.length - 1 && (
                    <div style={{ width: 1, height: 28, background: "#e5e7eb", flexShrink: 0 }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 32, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Loader2 size={14} className="animate-spin" style={{ color: "#9ca3af" }} />
            <span style={{ fontSize: 12, color: "#9ca3af" }}>Loading...</span>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8f7f5" }}>
                {["Client", "Yesterday", "Today", "Last 7 days", "Last 30 days", "All time", "Replies", "Interested"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "9px 14px", fontSize: 10, fontWeight: 500, color: "#9ca3af", borderBottom: "1px solid #f3f4f6", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {emailStats.filter(e => matchesClient(e.workspaceId)).length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 12 }}>No email data yet</td>
                </tr>
              ) : emailStats.filter(e => matchesClient(e.workspaceId)).map(e => {
                return (
                  <tr key={e.workspaceId} style={{ background: "#ffffff" }}>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <ClientBadge workspaceId={e.workspaceId} />
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 12, color: "#374151" }}>{e.yesterday.toLocaleString()}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "#1a56db" }}>{e.today.toLocaleString()}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 12, color: "#374151" }}>{e.last7.toLocaleString()}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 12, color: "#374151" }}>{e.last30.toLocaleString()}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 12, color: "#6b7280" }}>{e.total.toLocaleString()}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 12, color: "#0f6e56", fontWeight: 500 }}>{e.replies.toLocaleString()}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 500 }}>{e.interested.toLocaleString()}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>


      <Modal
        type={modal}
        replies={filteredReplies}
        fuLeads={filteredFULeads}
        meetings={filteredMeetings}
        onClose={() => setModal(null)}
      />
    </div>
  );
}