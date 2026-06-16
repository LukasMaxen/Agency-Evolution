// components/CallBookingModal.tsx
"use client";

import { useState } from "react";
import { X, Calendar, Loader2, Check, RefreshCw } from "lucide-react";

interface Call {
  id: string;
  scheduled_at: string;
  status: string;
  outcome: string | null;
  is_reschedule: boolean;
  source: string;
}

interface Props {
  replyId: string;
  workspaceSlug: string;
  leadName: string;
  leadEmail: string;
  existingCalls: Call[];
  onClose: () => void;
  onBooked: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  scheduled:   { label: "Scheduled",   color: "#1a56db", bg: "#eff6ff" },
  completed:   { label: "Completed",   color: "#065f46", bg: "#d1fae5" },
  no_show:     { label: "No-show",     color: "#991b1b", bg: "#fee2e2" },
  cancelled:   { label: "Cancelled",   color: "#6b7280", bg: "#f1f5f9" },
  rescheduled: { label: "Rescheduled", color: "#92400e", bg: "#fef3c7" },
};

const OUTCOME_OPTIONS = [
  { value: "closed",      label: "✅ Closed" },
  { value: "not_closed",  label: "❌ Did not close" },
  { value: "follow_up",   label: "🔄 Follow-up needed" },
  { value: "no_show",     label: "👻 No-show" },
];

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: "America/New_York",
  }) + " EST";
}

export function CallBookingModal({
  replyId, workspaceSlug, leadName, leadEmail,
  existingCalls, onClose, onBooked,
}: Props) {
  const firstName = leadName.split(" ")[0];

  // Default datetime = tomorrow 10am EST
  function defaultDatetime() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    // Format for datetime-local input (local time of user's browser)
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const [scheduledAt, setScheduledAt] = useState(defaultDatetime());
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [isReschedule, setIsReschedule] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function handleBook() {
    if (!scheduledAt || booking) return;
    setBooking(true);
    try {
      // Convert local datetime input to ISO
      const localDate = new Date(scheduledAt);
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replyId, workspaceSlug, leadEmail, leadName,
          scheduledAt: localDate.toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBooked(true);
      setIsReschedule(data.isReschedule);
      onBooked();
    } catch (err: any) {
      console.error(err);
      alert("Failed to book call: " + err.message);
    } finally {
      setBooking(false);
    }
  }

  async function handleOutcome(callId: string, outcome: string) {
    setUpdatingId(callId);
    const status = outcome === "no_show" ? "no_show" : "completed";
    try {
      await fetch("/api/calls", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: callId, status, outcome }),
      });
      onBooked(); // refresh parent
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, padding: 20,
      }}
    >
      <div style={{
        background: "#ffffff", borderRadius: 16, border: "1px solid #ede9e3",
        width: "100%", maxWidth: 480,
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.12)",
      }}>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Book a call</p>
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{leadName} · {leadEmail}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Past calls history */}
          {existingCalls.length > 0 && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 500, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Call history
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {existingCalls.map(call => {
                  const cfg = STATUS_CONFIG[call.status] ?? STATUS_CONFIG.scheduled;
                  const isPast = new Date(call.scheduled_at) < new Date();
                  const needsOutcome = isPast && call.status === "scheduled" && !call.outcome;
                  return (
                    <div key={call.id} style={{
                      padding: "10px 12px", borderRadius: 10,
                      border: "1px solid #f3f4f6", background: "#fafaf9",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 11, color: "#374151", fontWeight: 500 }}>
                            {fmtDateTime(call.scheduled_at)}
                          </span>
                          {call.is_reschedule && (
                            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 20, background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d" }}>
                              Reschedule
                            </span>
                          )}
                          {call.source === "calendly" && (
                            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 20, background: "#eff6ff", color: "#1a56db", border: "1px solid #bfdbfe" }}>
                              Calendly
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 500, background: cfg.bg, color: cfg.color }}>
                          {cfg.label}
                        </span>
                      </div>

                      {/* Outcome logging for past unresolved calls */}
                      {needsOutcome && (
                        <div style={{ marginTop: 8 }}>
                          <p style={{ fontSize: 10, color: "#9ca3af", marginBottom: 6 }}>Log outcome:</p>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {OUTCOME_OPTIONS.map(o => (
                              <button key={o.value}
                                onClick={() => handleOutcome(call.id, o.value)}
                                disabled={updatingId === call.id}
                                style={{
                                  fontSize: 10, padding: "4px 8px", borderRadius: 6,
                                  border: "1px solid #e5e7eb", background: "#ffffff",
                                  color: "#374151", cursor: "pointer", whiteSpace: "nowrap",
                                }}
                              >
                                {updatingId === call.id ? "..." : o.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Show logged outcome */}
                      {call.outcome && (
                        <p style={{ fontSize: 10, color: "#6b7280", marginTop: 6 }}>
                          Outcome: <span style={{ fontWeight: 500, color: "#374151" }}>
                            {OUTCOME_OPTIONS.find(o => o.value === call.outcome)?.label ?? call.outcome}
                          </span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Book new call */}
          {!booked ? (
            <div>
              <p style={{ fontSize: 11, fontWeight: 500, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {existingCalls.length > 0 ? "Book new / reschedule" : "Schedule call"}
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                  style={{
                    flex: 1, fontSize: 12, padding: "8px 12px", borderRadius: 8,
                    border: "1px solid #e5e7eb", color: "#111827", background: "#f8f7f5",
                  }}
                />
                <button
                  onClick={handleBook}
                  disabled={booking || !scheduledAt}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    fontSize: 12, fontWeight: 600, padding: "8px 16px",
                    borderRadius: 8, border: "none",
                    background: booking ? "#93c5fd" : "#1a56db",
                    color: "#ffffff", cursor: booking ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {booking
                    ? <><Loader2 size={12} className="animate-spin" /> Booking...</>
                    : <><Calendar size={12} /> {existingCalls.length > 0 ? "Reschedule" : "Book call"}</>
                  }
                </button>
              </div>
              <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 6 }}>
                Time entered in your local timezone. If a call exists within 60 days, it will be marked as reschedule.
              </p>
            </div>
          ) : (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 16px", borderRadius: 10,
              background: "#d1fae5", border: "1px solid #6ee7b7",
            }}>
              <Check size={16} style={{ color: "#065f46" }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#065f46" }}>
                  {isReschedule ? `Rescheduled for ${firstName}` : `Call booked for ${firstName}`}
                </p>
                <p style={{ fontSize: 11, color: "#065f46", opacity: 0.8, marginTop: 2 }}>
                  {isReschedule ? "Previous call marked as rescheduled." : "Marked as meeting booked in inbox."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}