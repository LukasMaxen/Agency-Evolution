// Shared Calendly live-slot verification. Used by:
//   - sweep.cjs guard 5 (re-verifies a proposed time is REAL before allowing it in a send)
//   - the interactive slot-lookup helper (pick real times while drafting)
// Mirrors lib/calendly.ts (kept in sync manually since this runs outside Next.js).
const path = require("path"), fs = require("fs");
const ROOT = path.resolve(__dirname, "../../..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null; };

const CALENDLY_CLIENT_CONFIG = {
  "larsen-digital": { tokenEnv: "CALENDLY_TOKEN_LARSEN_DIGITAL", eventTypeUrl: "https://calendly.com/d/dtm8-3nx-vr9/intro-call-operating-partner", defaultTz: "Europe/Copenhagen" },
  "acceler8rs":     { tokenEnv: "ACCELER8RS_CALENDLY_TOKEN",     eventTypeUrl: "https://calendly.com/d/dtm8-3nx-vr9/intro-call-operating-partner", defaultTz: "Europe/Copenhagen" },
};
// M&A / sell-side event type shares the same two tokens, different scheduling_url
const MA_EVENT_URL = "https://calendly.com/d/dvqt-b8q-ytq/m-a-conversation-larsen-digital";

const CALENDLY_BASE = "https://api.calendly.com";
async function cf(path_, token) {
  const r = await fetch(`${CALENDLY_BASE}${path_}`, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`Calendly ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function resolveEventType(token, wantMA) {
  const me = await cf("/users/me", token);
  const types = (await cf(`/event_types?user=${encodeURIComponent(me.resource.uri)}&active=true`, token)).collection;
  const wantUrl = wantMA ? MA_EVENT_URL : undefined;
  return (wantUrl && types.find((t) => t.scheduling_url === wantUrl)) || types[0];
}

// Returns array of { iso, dayLocal, timeLocal } within [08:00, 20:00) in `tz`, next `daysAhead` days.
async function getLiveSlots(clientSlug, tz, daysAhead = 6, wantMA = false) {
  const cfg = CALENDLY_CLIENT_CONFIG[clientSlug];
  if (!cfg) throw new Error(`No Calendly config for client "${clientSlug}"`);
  const token = g(cfg.tokenEnv);
  if (!token) throw new Error(`${cfg.tokenEnv} not set in .env.local`);
  const eventType = await resolveEventType(token, wantMA);
  const start = new Date(Date.now() + 60 * 1000);
  const end = new Date(Date.now() + daysAhead * 24 * 3600 * 1000);
  const raw = await cf(`/event_type_available_times?event_type=${encodeURIComponent(eventType.uri)}&start_time=${start.toISOString()}&end_time=${end.toISOString()}`, token);
  const tzUse = tz || cfg.defaultTz;
  return (raw.collection || [])
    .filter((s) => s.status === "available")
    .map((s) => {
      const d = new Date(s.start_time);
      const hourLocal = Number(d.toLocaleString("en-US", { timeZone: tzUse, hour: "numeric", hour12: false }));
      return { iso: s.start_time, hourLocal, tz: tzUse,
        dayLocal: d.toLocaleDateString("en-GB", { timeZone: tzUse, weekday: "long", month: "short", day: "numeric" }),
        timeLocal: d.toLocaleTimeString("en-GB", { timeZone: tzUse, hour: "numeric", minute: "2-digit" }) };
    })
    .filter((s) => s.hourLocal >= 8 && s.hourLocal < 20); // 8am-8pm local only
}

// Re-verifies a specific ISO timestamp is CURRENTLY a real, available, in-window slot.
async function verifySlot(clientSlug, iso, tz, wantMA = false) {
  try {
    const slots = await getLiveSlots(clientSlug, tz, 10, wantMA);
    return slots.some((s) => s.iso === iso);
  } catch (e) {
    console.error("verifySlot error", e.message);
    return false; // fail closed: any error = not verified = blocked
  }
}

module.exports = { getLiveSlots, verifySlot, CALENDLY_CLIENT_CONFIG };
