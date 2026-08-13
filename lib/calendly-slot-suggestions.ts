import {
  getCalendlyUser,
  getEventTypes,
  getAvailableSlots,
  resolveCalendlyToken,
  CALENDLY_CLIENT_CONFIG,
} from "@/lib/calendly";

export type SuggestedSlot = {
  startTime: string;
  day: string;
  time: string;
  tz: string;
  natural: string;
};

// Single source of truth for the "use the live slots" instruction.
// Inline this string into every system prompt that may have a LIVE CALENDAR
// AVAILABILITY block injected, so the model treats slot proposal as mandatory
// (not optional) whenever the block is present. Add new prompt sites by
// inlining `${CALENDLY_SLOT_PROMPT_RULE}` instead of writing fresh language.
export const CALENDLY_SLOT_PROMPT_RULE = `SCHEDULING — CALENDLY LINK ONLY: Never propose, suggest, or confirm any specific day or time (no "Would Monday at 1pm work?", no "Tuesday at 10am EST", no "Thursday afternoon", no day/time of any kind). We cannot see anyone's calendar, so any specific time would be fabricated. The ONLY way to schedule is a natural lead-in plus the Calendly link, e.g. "Easiest is to grab a time here: <link>". This holds even if an example, template, or earlier draft elsewhere in this prompt shows a "Would [SLOT] or [SLOT] work?" sentence or a literal time like "Monday at 1pm BST" — ignore those, they are stale. The body must never contain square-bracket placeholders ([SLOT 1], [SLOT 2], [SLOT 1 NATURAL], [SLOT 2 NATURAL], [DATE 1], [DATE 2]) or any natural-language reference to times you did not offer ("either of these", "the times below", "these slots", "let me know which works"). One calendar line only: a plain lead-in plus the Calendly link.`;

// Single source of truth for the "use these strings, do not reformat" header
// printed inside the LIVE CALENDAR AVAILABILITY block itself. Use this so the
// block looks identical at every injection site.
export function buildLiveCalendarBlock(slots: SuggestedSlot[]): string {
  if (slots.length < 2) return "";
  return `LIVE CALENDAR AVAILABILITY (use these natural-language slot strings exactly as written when proposing times):
Slot 1 NATURAL: ${slots[0].natural}
Slot 2 NATURAL: ${slots[1].natural}
Always pair with the Calendly link as a fallback. Do not reformat the slot strings, do not switch to 24-hour, do not add the date back in.`;
}

/**
 * Pulls live Calendly availability for a client and returns up to 2 well-spaced slots
 * formatted in the lead's timezone, ready to drop into a draft reply prompt.
 * Returns [] on any failure so callers can fall back to a Calendly-link-only CTA.
 */
export async function suggestSlotsForClient(
  clientSlug: string,
  tz: string,
  eventTypeUrlOverride?: string
): Promise<SuggestedSlot[]> {
  const token = resolveCalendlyToken(clientSlug);
  const config = CALENDLY_CLIENT_CONFIG[clientSlug];
  if (!token || !config) return [];

  try {
    const user = await getCalendlyUser(token);
    const eventTypes = await getEventTypes(token, user.uri);
    const normalize = (url: string) => url.toLowerCase().replace(/\/+$/, "");
    // Larsen Digital has a second (M&A / sell-side) event type sharing the same token.
    // Pass its scheduling_url here to pull slots for that calendar instead of the default.
    const targetUrl = normalize(eventTypeUrlOverride ?? config.eventTypeUrl);
    const eventType = eventTypes.find((e: any) => normalize(e.scheduling_url ?? "") === targetUrl)
      ?? eventTypes.find((e: any) => normalize(e.scheduling_url ?? "").includes(targetUrl.split("/").pop() ?? ""))
      ?? eventTypes[0];
    if (!eventType) return [];
    console.log(`[calendly-slots] matched event type: ${eventType.scheduling_url} for ${clientSlug}`);

    const start = new Date(Date.now() + 60 * 1000);
    const end = new Date(Date.now() + 6 * 24 * 3600 * 1000);
    const slots = await getAvailableSlots(token, eventType.uri, start.toISOString(), end.toISOString());

    if (!slots || slots.length === 0) return [];

    // Filter to slots that fall within the lead's business hours (8am-8pm in their TZ).
    // Matches the documented standard in clients/larsen-digital.md and the human
    // sweep tool (.claude/skills/reply-approval-sweep/calendly-verify.cjs) — kept in
    // sync manually since that script runs outside Next.js and can't import this file.
    const BUSINESS_START_HOUR = 8;
    const BUSINESS_END_HOUR = 20;
    const hourInTz = (iso: string): number => {
      const d = new Date(iso);
      const hourStr = d.toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false });
      return parseInt(hourStr, 10);
    };
    const businessHoursSlots = slots.filter((s: any) => {
      const h = hourInTz(s.start_time);
      return h >= BUSINESS_START_HOUR && h < BUSINESS_END_HOUR;
    });
    if (businessHoursSlots.length === 0) {
      console.log(`[calendly-slots] ${clientSlug}: ${slots.length} raw slots all outside business hours (8-18 ${tz})`);
      return [];
    }

    // Group business-hours slots by day in the lead's TZ.
    const byDay = new Map<string, any[]>();
    for (const s of businessHoursSlots) {
      const d = new Date(s.start_time);
      const day = d.toLocaleDateString("en-US", { timeZone: tz, year: "numeric", month: "short", day: "numeric" });
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(s);
    }
    // Sort slots within each day chronologically.
    for (const arr of byDay.values()) {
      arr.sort((a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    }

    const days = Array.from(byDay.keys());
    const pick: any[] = [];
    if (days.length >= 2) {
      // Two days, one earlier-in-day from day 1, one later-in-day from day 2.
      // Spreads the proposal across days and times-of-day (e.g. "Monday 9am or Wednesday 3pm").
      pick.push(byDay.get(days[0])![0]); // earliest slot on day 1
      const day2 = byDay.get(days[1])!;
      pick.push(day2[day2.length - 1]); // latest slot on day 2
    } else if (days.length === 1) {
      // Only one day has business-hours slots. Pick earliest and latest from that day.
      const onlyDay = byDay.get(days[0])!;
      pick.push(onlyDay[0]);
      if (onlyDay.length > 1) pick.push(onlyDay[onlyDay.length - 1]);
    }

    // JavaScript's Intl returns "GMT+X" instead of the proper abbreviation
    // (BST, EDT, AEST, etc.) when the locale doesn't match the TZ region.
    // Pick the right locale per TZ to get the natural-language abbreviation.
    const abbreviationLocaleForTz = (zone: string): string => {
      if (zone.startsWith("Australia/")) return "en-AU";
      if (zone.startsWith("America/")) return "en-US";
      if (zone.startsWith("Europe/")) return "en-GB";
      if (zone.startsWith("Pacific/")) return "en-AU";
      if (zone.startsWith("Asia/")) return "en-GB";
      if (zone.startsWith("Africa/")) return "en-GB";
      return "en-GB";
    };

    return pick.map(slot => {
      const date = new Date(slot.start_time);
      const dayLong = date.toLocaleDateString("en-US", { timeZone: tz, weekday: "long" });
      const dayShort = date.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
      // 12-hour format with no leading zero, lowercase am/pm, no space (e.g. "1pm", "2:30pm")
      const rawTime = date.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
      const time = rawTime
        .replace(/:00\s*([AP]M)/i, "$1")
        .replace(/\s+([AP]M)/i, "$1")
        .toLowerCase();
      // Pull the abbreviation in the right regional locale, then strip any "GMT+X" fallback
      const abbrLocale = abbreviationLocaleForTz(tz);
      const rawAbbr = date.toLocaleTimeString(abbrLocale, { timeZone: tz, timeZoneName: "short" }).split(" ").pop() ?? "";
      const tzShort = /^GMT[+-]/i.test(rawAbbr) ? "" : rawAbbr;
      const natural = tzShort ? `${dayLong} at ${time} ${tzShort}` : `${dayLong} at ${time}`;
      return {
        startTime: slot.start_time,
        day: dayShort,
        time,
        tz,
        natural,
      };
    });
  } catch (err: any) {
    console.error("[calendly-slots] suggestSlotsForClient failed:", err?.message);
    return [];
  }
}
