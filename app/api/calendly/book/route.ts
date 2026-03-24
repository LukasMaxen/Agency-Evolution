import { NextRequest, NextResponse } from "next/server";
import { getCalendlyUser, getEventTypes, createSchedulingLink } from "../../../../lib/calendly";

export async function POST(req: NextRequest) {
  const token = process.env.CALENDLY_TOKEN;
  if (!token) return NextResponse.json({ error: "CALENDLY_TOKEN is not set" }, { status: 500 });

  const { leadName, leadEmail, eventTypeUri } = await req.json();
  if (!leadName || !leadEmail) return NextResponse.json({ error: "leadName and leadEmail required" }, { status: 400 });

  try {
    let targetEventTypeUri = eventTypeUri;
    if (!targetEventTypeUri) {
      const user = await getCalendlyUser(token);
      const eventTypes = await getEventTypes(token, user.uri);
      if (!eventTypes?.length) return NextResponse.json({ error: "No event types found" }, { status: 404 });
      targetEventTypeUri = eventTypes[0].uri;
    }
    const link = await createSchedulingLink(token, targetEventTypeUri, leadName, leadEmail);
    return NextResponse.json({ bookingUrl: link.booking_url, createdAt: link.created_at });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to create booking link" }, { status: 500 });
  }
}