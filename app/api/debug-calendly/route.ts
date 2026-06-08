import { NextRequest, NextResponse } from "next/server";
import { resolveCalendlyToken, getCalendlyUser, getEventTypes, getAvailableSlots, CALENDLY_CLIENT_CONFIG } from "@/lib/calendly";
import { suggestSlotsForClient } from "@/lib/calendly-slot-suggestions";

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client") ?? "";
  const tz = req.nextUrl.searchParams.get("tz") ?? "Europe/London";

  const token = resolveCalendlyToken(client);
  const config = CALENDLY_CLIENT_CONFIG[client];

  if (!token) return NextResponse.json({ error: "No token for client", client });

  try {
    const user = await getCalendlyUser(token);
    const eventTypes = await getEventTypes(token, user.uri);

    const normalize = (url: string) => url.toLowerCase().replace(/\/+$/, "");
    const targetUrl = normalize(config?.eventTypeUrl ?? "");
    const matched = eventTypes.find((e: any) => normalize(e.scheduling_url ?? "") === targetUrl)
      ?? eventTypes.find((e: any) => normalize(e.scheduling_url ?? "").includes(targetUrl.split("/").pop() ?? ""))
      ?? eventTypes[0];

    const start = new Date(Date.now() + 60_000).toISOString();
    const end = new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString();
    const rawSlots = matched ? await getAvailableSlots(token, matched.uri, start, end) : [];

    const bizSlots = rawSlots.filter((s: any) => {
      const h = new Date(s.start_time).toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false });
      return parseInt(h) >= 8 && parseInt(h) < 18;
    });

    const suggested = await suggestSlotsForClient(client, tz);

    return NextResponse.json({
      client,
      tz,
      configEventTypeUrl: config?.eventTypeUrl,
      matchedEventTypeUrl: matched?.scheduling_url,
      allEventTypes: eventTypes.map((e: any) => e.scheduling_url),
      rawSlotsCount: rawSlots.length,
      bizSlotsCount: bizSlots.length,
      suggestedSlots: suggested,
      first3BizSlots: bizSlots.slice(0, 3).map((s: any) => s.start_time),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
