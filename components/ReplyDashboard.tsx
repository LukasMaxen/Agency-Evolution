"use client";

import { useState, useMemo } from "react";
import {
  DASHBOARD_REPLIES, FOLLOW_UP_LEADS, MEETING_LEADS, WORKSPACE_COLORS,
  DashboardReply, FollowUpLead, MeetingLead,
} from "@/lib/dashboard-data";
import { WORKSPACES } from "@/lib/mock-data";
import { X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type DateFilter = "today" | "yesterday" | "7days" | "30days" | "all";
type QueueFilter = "today" | "tomorrow" | "yesterday" | "7days" | "30days" | "all";
type ModalType = "replies" | "interested" | "followup" | "meetings" | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function diffDays(date: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function inDateRange(date: Date, filter: DateFilter): boolean {
  const d = diffDays(date);
  if (filter === "today")     return d === 0;
  if (filter === "yesterday") return d === -1;
  if (filter === "7days")     return d >= -7 && d <= 0;
  if (filter === "30days")    return d >= -30 && d <= 0;
  return true;
}

function inQueueRange(date: Date, filter: QueueFilter): boolean {
  const d = diffDays(date);
  if (filter === "today")     return d === 0;
  if (filter === "tomorrow")  return d === 1;
  if (filter === "yesterday") return d === -1;
  if (filter === "7days")     return d >= -7 && d <= 0;
  if (filter === "30days")    return d >= -30 && d <= 0;
  return true;
}

function getFUStatus(lead: FollowUpLead): { label: string; bg: string; color: string; border: string; order: number } {
  const d = diffDays(lead.nextFUDue);
  if (d < 0)   return { label: "Overdue",   bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", order: 0 };
  if (d === 0) return { label: "Due today", bg: "#fef3c7", color: "#92400e", border: "#fcd34d", order: 1 };
  if (d <= 7)  return { label: "This week", bg: "#eff6ff", color: "#1e40af", border: "#93c5fd", order: 2 };
  return              { label: "Upcoming",  bg: "#f1f5f9", color: "#475569", border: "#e2e8f0", order: 3 };
}

function clientName(workspaceId: string): string {
  return WORKSPACES.find(w => w.id === workspaceId)?.name ?? workspaceId;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ClientBadge({ workspaceId }: { workspaceId: string }) {
  const color = WORKSPACE_COLORS[workspaceId] ?? "#6b7280";
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 20,
      background: color + "18", color, border: `1px solid ${color}30`,
      whiteSpace: "nowrap",
    }}>
      {clientName(workspaceId)}
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

function MetricCard({ label, value, color, sub, onClick }: {
  label: string; value: number; color: string; sub: string; onClick: () => void;
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
      <p style={{ fontSize: 26, fontWeight: 500, color }}>{value}</p>
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
    replies:   `All replies (${replies.length})`,
    interested:`Interested leads (${replies.filter(r => r.type === "interested").length})`,
    followup:  `Follow-ups due (${fuLeads.length})`,
    meetings:  `Meetings booked (${meetings.length})`,
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
        {/* Modal header */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary, #111827)" }}>{titles[type]}</p>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}>
            <X size={16} />
          </button>
        </div>

        {/* Modal body */}
        <div style={{ overflowY: "auto", padding: "12px 20px", flex: 1 }}>

          {/* Replies or Interested */}
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

          {/* Follow-ups */}
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

          {/* Meetings */}
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
                  <p style={{ fontSize: 11, color: "#6b7280" }}>{m.email} · {m.totalEmails} emails sent · First replied {fmtDate(m.firstReplied)}</p>
                </div>
              );
            });
          })()}

        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ReplyDashboard() {
  const [clientFilter, setClientFilter] = useState("all");
  const [metricFilter, setMetricFilter] = useState<DateFilter>("today");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("today");
  const [modal, setModal] = useState<ModalType>(null);

  const today = new Date();

  // Filtered data
  const filteredReplies = useMemo(() =>
    DASHBOARD_REPLIES.filter(r =>
      (clientFilter === "all" || clientName(r.workspaceId) === clientFilter) &&
      inDateRange(r.date, metricFilter)
    ), [clientFilter, metricFilter]);

  const filteredFULeads = useMemo(() =>
    FOLLOW_UP_LEADS.filter(l =>
      (clientFilter === "all" || clientName(l.workspaceId) === clientFilter) &&
      inQueueRange(l.nextFUDue, queueFilter)
    ).sort((a, b) => getFUStatus(a).order - getFUStatus(b).order || a.nextFUDue.getTime() - b.nextFUDue.getTime()),
    [clientFilter, queueFilter]);

  const filteredMeetings = useMemo(() =>
    MEETING_LEADS.filter(m => clientFilter === "all" || clientName(m.workspaceId) === clientFilter)
    .sort((a, b) => a.meetingDate.getTime() - b.meetingDate.getTime()),
    [clientFilter]);

  // Modal data — always uses metric filter for replies/interested/followup
  const modalReplies = useMemo(() =>
    DASHBOARD_REPLIES.filter(r =>
      (clientFilter === "all" || clientName(r.workspaceId) === clientFilter) &&
      inDateRange(r.date, metricFilter)
    ), [clientFilter, metricFilter]);

  const modalFULeads = useMemo(() =>
    FOLLOW_UP_LEADS.filter(l =>
      (clientFilter === "all" || clientName(l.workspaceId) === clientFilter) &&
      inQueueRange(l.nextFUDue, queueFilter)
    ), [clientFilter, queueFilter]);

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

  const allClients = Array.from(new Set(WORKSPACES.map(w => w.name))).sort();

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#f8f7f5", padding: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, color: "#111827" }}>Reply Dashboard</p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            {today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
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
        </div>
      </div>

      {/* Metric cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
        <MetricCard
          label="Total replies"
          value={filteredReplies.length}
          color="#1a56db"
          sub="Click to see all replies"
          onClick={() => setModal("replies")}
        />
        <MetricCard
          label="New interested"
          value={filteredReplies.filter(r => r.type === "interested").length}
          color="#16a34a"
          sub="Click to see interested leads"
          onClick={() => setModal("interested")}
        />
        <MetricCard
          label="Follow-ups due"
          value={FOLLOW_UP_LEADS.filter(l =>
            (clientFilter === "all" || clientName(l.workspaceId) === clientFilter) &&
            diffDays(l.nextFUDue) <= 0
          ).length}
          color="#dc2626"
          sub="Click to see follow-up queue"
          onClick={() => setModal("followup")}
        />
        <MetricCard
          label="Meetings booked"
          value={filteredMeetings.length}
          color="#1a56db"
          sub="Click to see all meetings"
          onClick={() => setModal("meetings")}
        />
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
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{l.name}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 11, color: "#6b7280" }}>{l.email}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <ClientBadge workspaceId={l.workspaceId} />
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 11, color: "#374151" }}>{fmtDate(l.firstReplied)}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 11, color: "#374151" }}>{fmtDate(l.lastFUSent)}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "#374151" }}>{l.totalEmails}</span>
                      <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 4 }}>emails</span>
                      <span style={{ fontSize: 10, background: "#f1f5f9", color: "#475569", padding: "1px 6px", borderRadius: 20, marginLeft: 4 }}>
                        FU {l.fuStep}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: "#374151", display: "block" }}>{fmtDate(l.nextFUDue)}</span>
                      <span style={{ fontSize: 10, display: "block", marginTop: 1 }}>{dLabel}</span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                      <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, fontWeight: 500, background: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: "nowrap" }}>
                        {s.label}
                      </span>
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
        </div>
      </div>

      {/* Meetings booked */}
      <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #ede9e3", overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>Meetings booked</p>
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Leads who booked a meeting</p>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8f7f5" }}>
              {["Lead", "Email", "Client", "First replied", "Total emails", "Meeting date", "Status"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "9px 14px", fontSize: 10, fontWeight: 500, color: "#9ca3af", borderBottom: "1px solid #f3f4f6", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredMeetings.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
                  No meetings booked
                </td>
              </tr>
            ) : filteredMeetings.map(m => {
              const md = diffDays(m.meetingDate);
              const mLabel = md < 0 ? "Completed" : md === 0 ? "Today!" : `in ${md}d`;
              const mColor = md < 0 ? "#9ca3af" : md === 0 ? "#16a34a" : "#1a56db";
              return (
                <tr key={m.id} style={{ background: "#ffffff" }}>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{m.name}</span>
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>{m.email}</span>
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                    <ClientBadge workspaceId={m.workspaceId} />
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                    <span style={{ fontSize: 11, color: "#374151" }}>{fmtDate(m.firstReplied)}</span>
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "#374151" }}>{m.totalEmails}</span>
                    <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 4 }}>emails</span>
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: "#374151" }}>{fmtDate(m.meetingDate)}</span>
                    <span style={{ fontSize: 10, color: mColor, marginLeft: 6, fontWeight: 500 }}>{mLabel}</span>
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f8" }}>
                    <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, fontWeight: 500, background: "#d1fae5", color: "#065f46", border: "1px solid #6ee7b7", whiteSpace: "nowrap" }}>
                      Meeting booked
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <Modal
        type={modal}
        replies={modalReplies}
        fuLeads={modalFULeads}
        meetings={filteredMeetings}
        onClose={() => setModal(null)}
      />
    </div>
  );
}