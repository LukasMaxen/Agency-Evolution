import { NextRequest, NextResponse } from "next/server";
import { getCalendlyUser, getEventTypes, getAvailableSlots } from "@/lib/calendly";

export async function GET(req: NextRequest) {
  const token = process.env.CALENDLY_TOKEN;
  if (!token) return NextResponse.json({ error: "CALENDLY_TOKEN is not set" }, { status: 500 });

  try {
    const user = await getCalendlyUser(token);
    const eventTypes = await getEventTypes(token, user.uri);
    if (!eventTypes || eventTypes.length === 0)
      return NextResponse.json({ error: "No event types found" }, { status: 404 });

    const eventTypeName = req.nextUrl.searchParams.get("event_type");
    const eventType = eventTypeName
      ? eventTypes.find((e: any) => e.name.toLowerCase().includes(eventTypeName.toLowerCase())) ?? eventTypes[0]
      : eventTypes[0];

    const now = new Date();
    const slots = await getAvailableSlots(
      token, eventType.uri,
      now.toISOString(),
      new Date(now.getTime() + 5 * 24 * 3600 * 1000).toISOString()
    );

    const formatted = slots.slice(0, 9).map((slot: any) => {
      const date = new Date(slot.start_time);
      return {
        id: slot.start_time,
        startTime: slot.start_time,
        day: date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        time: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
        available: slot.status === "available",
      };
    });

    return NextResponse.json({
      slots: formatted,
      eventType: { name: eventType.name, uri: eventType.uri, duration: eventType.duration, schedulingUrl: eventType.scheduling_url },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to fetch slots" }, { status: 500 });
  }
}