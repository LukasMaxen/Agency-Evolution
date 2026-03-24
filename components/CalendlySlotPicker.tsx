"use client";

import { useState, useEffect } from "react";
import { Calendar, RefreshCw, Loader2, CheckCircle, ExternalLink } from "lucide-react";

interface Slot {
  id: string;
  startTime: string;
  day: string;
  time: string;
  available: boolean;
}

interface EventType {
  name: string;
  uri: string;
  duration: number;
  schedulingUrl: string;
}

interface Props {
  leadName: string;
  leadEmail: string;
  onInsertReply: (text: string) => void;
}

export function CalendlySlotPicker({ leadName, leadEmail, onInsertReply }: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [eventType, setEventType] = useState<EventType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    fetchSlots();
  }, []);

  async function fetchSlots() {
    setLoading(true);
    setError(null);
    setSelectedSlot(null);
    setBooked(false);
    setBookingUrl(null);
    try {
      const res = await fetch("/api/calendly/slots");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load slots");
      setSlots(data.slots);
      setEventType(data.eventType);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBookAndInsert() {
    if (!selectedSlot || booking) return;
    setBooking(true);
    try {
      const res = await fetch("/api/calendly/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadName,
          leadEmail,
          eventTypeUri: eventType?.uri,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create booking link");

      setBookingUrl(data.bookingUrl);
      setBooked(true);

      const firstName = leadName.split(" ")[0];
      const reply = `Hi ${firstName},\n\nThanks for getting back to me — ${selectedSlot.day} at ${selectedSlot.time} works perfectly.\n\nI've sent over a calendar invite. You can also use this link to confirm or reschedule if needed: ${data.bookingUrl}\n\nLooking forward to speaking with you.\n\nBest,`;
      onInsertReply(reply);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBooking(false);
    }
  }

  const firstName = leadName.split(" ")[0];

  return (
    <div style={{ borderBottom: "1px solid #ede9e3", background: "#ffffff" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: "#f8f7f5", borderBottom: "1px solid #ede9e3" }}
      >
        <div className="flex items-center gap-2">
          <Calendar size={13} style={{ color: "#0F6E56" }} />
          <span className="text-xs font-medium text-gray-700">Available slots</span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            style={{ background: "#d1fae5", color: "#065f46" }}
          >
            Calendly
          </span>
          {eventType && (
            <span className="text-[11px] text-gray-400">
              · {eventType.name} ({eventType.duration} min)
            </span>
          )}
        </div>
        <button
          onClick={fetchSlots}
          disabled={loading}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors"
          style={{ border: "1px solid #e5e7eb", color: "#6b7280", background: "transparent" }}
        >
          {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
          Refresh
        </button>
      </div>

      {/* Slots */}
      <div className="px-4 py-3">
        {loading && (
          <div className="flex items-center gap-2 py-3 justify-center">
            <Loader2 size={13} className="animate-spin text-gray-400" />
            <span className="text-xs text-gray-400">Loading availability...</span>
          </div>
        )}

        {error && (
          <div
            className="text-xs px-3 py-2 rounded-lg mb-2"
            style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca" }}
          >
            {error} —{" "}
            <button onClick={fetchSlots} className="underline">retry</button>
          </div>
        )}

        {!loading && !error && slots.length === 0 && (
          <p className="text-xs text-gray-400 py-2 text-center">
            No available slots in the next 5 days
          </p>
        )}

        {!loading && slots.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {slots.map((slot) => {
              const isSelected = selectedSlot?.id === slot.id;
              return (
                <button
                  key={slot.id}
                  onClick={() => slot.available && setSelectedSlot(slot)}
                  disabled={!slot.available}
                  className="text-center rounded-lg transition-all"
                  style={{
                    padding: "7px 4px",
                    border: `1px solid ${isSelected ? "#16a34a" : slot.available ? "#e5e7eb" : "#f3f4f6"}`,
                    background: isSelected ? "#d1fae5" : slot.available ? "#ffffff" : "#f9fafb",
                    color: isSelected ? "#15803d" : slot.available ? "#111827" : "#d1d5db",
                    cursor: slot.available ? "pointer" : "not-allowed",
                    opacity: slot.available ? 1 : 0.5,
                  }}
                >
                  <span className="block text-[11px]" style={{ fontWeight: isSelected ? 600 : 500 }}>
                    {slot.time}
                  </span>
                  <span className="block text-[10px] mt-0.5 text-gray-400">{slot.day}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirm bar */}
      {selectedSlot && !booked && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5"
          style={{ borderTop: "1px solid #ede9e3", background: "#f0fdf4" }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle size={13} style={{ color: "#16a34a" }} />
            <span className="text-xs font-medium" style={{ color: "#15803d" }}>
              {selectedSlot.day} at {selectedSlot.time} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedSlot(null)}
              className="text-[11px] px-2.5 py-1.5 rounded-lg"
              style={{ border: "1px solid #bbf7d0", color: "#15803d", background: "transparent" }}
            >
              Change
            </button>
            <button
              onClick={handleBookAndInsert}
              disabled={booking}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg"
              style={{
                background: booking ? "#86efac" : "#16a34a",
                color: "#ffffff",
                border: "none",
              }}
            >
              {booking ? (
                <><Loader2 size={11} className="animate-spin" /> Booking...</>
              ) : (
                <><Calendar size={11} /> Book &amp; insert into reply</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Booked confirmation */}
      {booked && bookingUrl && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5"
          style={{ borderTop: "1px solid #bbf7d0", background: "#dcfce7" }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle size={13} style={{ color: "#16a34a" }} />
            <span className="text-xs font-medium" style={{ color: "#15803d" }}>
              Booked: {selectedSlot?.day} at {selectedSlot?.time} · invite sent to {firstName}
            </span>
          </div>
          <a
            href={bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px]"
            style={{ color: "#15803d" }}
          >
            <ExternalLink size={10} />
            View booking
          </a>
        </div>
      )}
    </div>
  );
}