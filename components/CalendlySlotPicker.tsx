"use client";

import { useState, useEffect } from "react";
import { Calendar, RefreshCw, Loader2, CheckCircle, ExternalLink, ChevronDown } from "lucide-react";

interface Slot {
  id: string;
  startTime: string;
  day: string;
  time: string;
  available: boolean;
  timezone: string;
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

const TIMEZONES = [
  { label: "EST (GMT-5)", value: "America/New_York", abbr: "EST" },
  { label: "CST (GMT-6)", value: "America/Chicago", abbr: "CST" },
  { label: "MST (GMT-7)", value: "America/Denver", abbr: "MST" },
  { label: "PST (GMT-8)", value: "America/Los_Angeles", abbr: "PST" },
  { label: "GMT (GMT+0)", value: "Europe/London", abbr: "GMT" },
  { label: "CET (GMT+1)", value: "Europe/Paris", abbr: "CET" },
  { label: "IST (GMT+5:30)", value: "Asia/Kolkata", abbr: "IST" },
  { label: "SGT (GMT+8)", value: "Asia/Singapore", abbr: "SGT" },
  { label: "AEST (GMT+10)", value: "Australia/Sydney", abbr: "AEST" },
];

const EST = TIMEZONES[0]; // EST is always the default — all clients are US-based

function detectUserTimezone(): (typeof TIMEZONES)[0] {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Only use browser timezone if it's a US zone, otherwise default to EST
  const US_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"];
  if (US_ZONES.includes(tz)) {
    return TIMEZONES.find((t) => t.value === tz) ?? EST;
  }
  return EST;
}

function convertSlotToTimezone(isoTime: string, tzValue: string, tzAbbr: string): { day: string; time: string; timezone: string } {
  const date = new Date(isoTime);
  const day = date.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    timeZone: tzValue,
  });
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: tzValue,
  });
  return { day, time, timezone: tzAbbr };
}

// Generate mock ISO times for next 3 weekdays
function getMockISOSlots(): string[] {
  const isoTimes: string[] = [];
  const now = new Date();
  let daysAdded = 0;

  while (isoTimes.length < 9) {
    const day = new Date(now);
    day.setDate(now.getDate() + daysAdded + 1);
    daysAdded++;
    if (day.getDay() === 0 || day.getDay() === 6) continue;

    [9, 11, 14].forEach((hour) => {
      const slot = new Date(day);
      slot.setHours(hour, 0, 0, 0);
      isoTimes.push(slot.toISOString());
    });
  }
  return isoTimes.slice(0, 9);
}

export function CalendlySlotPicker({ leadName, leadEmail, onInsertReply }: Props) {
  const [rawSlots, setRawSlots] = useState<{ iso: string; available: boolean }[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [eventType, setEventType] = useState<EventType | null>(null);
  const [loading, setLoading] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const [selectedTz, setSelectedTz] = useState<(typeof TIMEZONES)[0]>(detectUserTimezone);
  const [tzOpen, setTzOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);

  useEffect(() => { fetchSlots(); }, []);

  // Recompute displayed slots when timezone changes
  useEffect(() => {
    if (rawSlots.length === 0) return;
    setSelectedSlot(null);
    setBooked(false);
    setSlots(
      rawSlots.map((s, i) => {
        const converted = convertSlotToTimezone(s.iso, selectedTz.value, selectedTz.abbr);
        return { id: `slot-${i}`, startTime: s.iso, ...converted, available: s.available };
      })
    );
  }, [rawSlots, selectedTz]);

  async function fetchSlots() {
    setLoading(true);
    setSelectedSlot(null);
    setBooked(false);
    setIsMock(false);

    try {
      const res = await fetch("/api/calendly/slots");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setRawSlots(data.slots.map((s: any) => ({ iso: s.startTime, available: s.available })));
      setEventType(data.eventType);
    } catch {
      setIsMock(true);
      const isoTimes = getMockISOSlots();
      setRawSlots(isoTimes.map((iso, i) => ({ iso, available: i !== 2 })));
      setEventType({ name: "30 Min Discovery Call", uri: "", duration: 30, schedulingUrl: "" });
    } finally {
      setLoading(false);
    }
  }

  async function handleBookAndInsert() {
    if (!selectedSlot || booking) return;
    setBooking(true);
    try {
      let bookingLink = "";
      if (!isMock) {
        const res = await fetch("/api/calendly/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadName, leadEmail, eventTypeUri: eventType?.uri }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        bookingLink = data.bookingUrl;
      }

      setBooked(true);
      setBookingUrl(bookingLink || null);

      const firstName = leadName.split(" ")[0];
      const timeStr = `${selectedSlot.day} at ${selectedSlot.time} ${selectedSlot.timezone}`;
      const reply = isMock
        ? `Hi ${firstName},\n\nThanks for getting back to me — ${timeStr} works perfectly for me.\n\nI'll send over a calendar invite to confirm. Looking forward to speaking with you.\n\nBest,`
        : `Hi ${firstName},\n\nThanks for getting back to me — ${timeStr} works perfectly.\n\nI've sent over a calendar invite. You can also use this link to confirm or reschedule: ${bookingLink}\n\nLooking forward to speaking with you.\n\nBest,`;

      onInsertReply(reply);
    } catch (err: any) {
      console.error(err);
    } finally {
      setBooking(false);
    }
  }

  return (
    <div style={{ borderBottom: "1px solid #ede9e3", background: "#ffffff" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{ background: "#f8f7f5", borderBottom: "1px solid #ede9e3" }}>
        <div className="flex items-center gap-2">
          <Calendar size={13} style={{ color: "#0F6E56" }} />
          <span className="text-xs font-medium text-gray-700">Available slots</span>
          {isMock ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "#fef3c7", color: "#92400e" }}>Demo mode</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "#d1fae5", color: "#065f46" }}>Calendly</span>
          )}
          {eventType && (
            <span className="text-[11px] text-gray-400">· {eventType.name} ({eventType.duration} min)</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Timezone dropdown */}
          <div className="relative">
            <button
              onClick={() => setTzOpen((p) => !p)}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg"
              style={{ border: "1px solid #e5e7eb", background: "#ffffff", color: "#374151" }}
            >
              {selectedTz.abbr}
              <ChevronDown size={10} className="text-gray-400" />
            </button>
            {tzOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 rounded-xl overflow-hidden z-30"
                style={{ background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
                {TIMEZONES.map((tz) => (
                  <button
                    key={tz.value}
                    onClick={() => { setSelectedTz(tz); setTzOpen(false); }}
                    className="w-full text-left px-3 py-2 text-[11px] transition-colors"
                    style={{
                      color: selectedTz.value === tz.value ? "#7c3aed" : "#374151",
                      fontWeight: selectedTz.value === tz.value ? 600 : 400,
                      background: selectedTz.value === tz.value ? "#faf5ff" : "transparent",
                      borderBottom: "1px solid #f3f4f6",
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f8f7f5")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = selectedTz.value === tz.value ? "#faf5ff" : "transparent")}
                  >
                    {tz.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={fetchSlots} disabled={loading}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md"
            style={{ border: "1px solid #e5e7eb", color: "#6b7280", background: "transparent" }}>
            {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            Refresh
          </button>
        </div>
      </div>

      {/* Slots */}
      <div className="px-4 py-3">
        {loading ? (
          <div className="flex items-center gap-2 py-3 justify-center">
            <Loader2 size={13} className="animate-spin text-gray-400" />
            <span className="text-xs text-gray-400">Loading availability...</span>
          </div>
        ) : slots.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {slots.map((slot) => {
              const isSelected = selectedSlot?.id === slot.id;
              return (
                <button key={slot.id}
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
                  <span className="block text-[9px] mt-0.5" style={{ color: isSelected ? "#16a34a" : "#9ca3af" }}>
                    {slot.timezone}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Confirm bar */}
      {selectedSlot && !booked && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5"
          style={{ borderTop: "1px solid #ede9e3", background: "#f0fdf4" }}>
          <div className="flex items-center gap-2">
            <CheckCircle size={13} style={{ color: "#16a34a" }} />
            <span className="text-xs font-medium" style={{ color: "#15803d" }}>
              {selectedSlot.day} · {selectedSlot.time} {selectedSlot.timezone} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedSlot(null)}
              className="text-[11px] px-2.5 py-1.5 rounded-lg"
              style={{ border: "1px solid #bbf7d0", color: "#15803d", background: "transparent" }}>
              Change
            </button>
            <button onClick={handleBookAndInsert} disabled={booking}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: booking ? "#86efac" : "#16a34a", color: "#ffffff", border: "none" }}>
              {booking
                ? <><Loader2 size={11} className="animate-spin" /> Booking...</>
                : <><Calendar size={11} /> {isMock ? "Insert into reply" : "Book & insert into reply"}</>}
            </button>
          </div>
        </div>
      )}

      {/* Booked */}
      {booked && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5"
          style={{ borderTop: "1px solid #bbf7d0", background: "#dcfce7" }}>
          <div className="flex items-center gap-2">
            <CheckCircle size={13} style={{ color: "#16a34a" }} />
            <span className="text-xs font-medium" style={{ color: "#15803d" }}>
              {selectedSlot?.day} · {selectedSlot?.time} {selectedSlot?.timezone} · reply ready to send
            </span>
          </div>
          {bookingUrl && (
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px]" style={{ color: "#15803d" }}>
              <ExternalLink size={10} />
              View booking
            </a>
          )}
        </div>
      )}
    </div>
  );
}