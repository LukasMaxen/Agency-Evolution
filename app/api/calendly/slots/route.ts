import { NextRequest, NextResponse } from "next/server";
import {
  getCalendlyUser,
  getEventTypes,
  getAvailableSlots,
  resolveCalendlyToken,
  CALENDLY_CLIENT_CONFIG,
} from "@/lib/calendly";

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client");
  const tz = req.nextUrl.searchParams.get("tz") ?? CALENDLY_CLIENT_CONFIG[client ?? ""]?.defaultTz ?? "UTC";
  const eventTypeName = req.nextUrl.searchParams.get("event_type");

  const token = resolveCalendlyToken(client);
  if (!token) {
    const envName = client ? CALENDLY_CLIENT_CONFIG[client]?.tokenEnv ?? "CALENDLY_TOKEN" : "CALENDLY_TOKEN";
    return NextResponse.json({ error: `${envName} is not set` }, { status: 500 });
  }

  try {
    const user = await getCalendlyUser(token);
    const eventTypes = await getEventTypes(token, user.uri);
    if (!eventTypes || eventTypes.length === 0)
      return NextResponse.json({ error: "No event types found" }, { status: 404 });

    const clientConfig = client ? CALENDLY_CLIENT_CONFIG[client] : undefined;
    const eventType = clientConfig
      ? eventTypes.find((e: any) => e.scheduling_url === clientConfig.eventTypeUrl) ?? eventTypes[0]
      : eventTypeName
        ? eventTypes.find((e: any) => e.name.toLowerCase().includes(eventTypeName.toLowerCase())) ?? eventTypes[0]
        : eventTypes[0];

    const start = new Date(Date.now() + 60 * 1000);
    const end = new Date(Date.now() + 6 * 24 * 3600 * 1000);
    const slots = await getAvailableSlots(token, eventType.uri, start.toISOString(), end.toISOString());

    const localeForTz = tz.startsWith("America/") ? "en-US" : "en-GB";
    const formatted = (slots ?? []).slice(0, 12).map((slot: any) => {
      const date = new Date(slot.start_time);
      return {
        id: slot.start_time,
        startTime: slot.start_time,
        day: date.toLocaleDateString(localeForTz, { timeZone: tz, weekday: "short", month: "short", day: "numeric" }),
        time: date.toLocaleTimeString(localeForTz, { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: localeForTz === "en-US" }),
        tz,
        available: slot.status === "available",
      };
    });

    return NextResponse.json({
      slots: formatted,
      tz,
      eventType: { name: eventType.name, uri: eventType.uri, duration: eventType.duration, schedulingUrl: eventType.scheduling_url },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to fetch slots" }, { status: 500 });
  }
}
