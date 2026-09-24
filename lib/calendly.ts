const CALENDLY_BASE = "https://api.calendly.com";

export type CalendlyClientConfig = {
  tokenEnv: string;
  eventTypeUrl: string;
  defaultTz?: string;
};

export const CALENDLY_CLIENT_CONFIG: Record<string, CalendlyClientConfig> = {
  "larsen-digital": {
    tokenEnv: "CALENDLY_TOKEN_LARSEN_DIGITAL",
    eventTypeUrl: "https://calendly.com/d/dtm8-3nx-vr9/intro-call-operating-partner",
    defaultTz: "Europe/London",
  },
  "acceler8rs": {
    tokenEnv: "ACCELER8RS_CALENDLY_TOKEN",
    eventTypeUrl: "https://calendly.com/d/dtm8-3nx-vr9/intro-call-operating-partner",
    defaultTz: "Europe/London",
  },
  // Austin Heaton has 3 active Calendly event types (Lureon AEO Services,
  // Redo AEO Services, and this general intro call). Defaulted to the
  // general one since the current campaign doesn't name a specific product —
  // confirm with Kasper if a specific campaign should use a different link.
  "ah-consulting": {
    tokenEnv: "AH_CONSULTING_CALENDLY_TOKEN",
    eventTypeUrl: "https://calendly.com/austin-austinheaton/30min",
    defaultTz: "Europe/Chisinau",
  },
  // Same Austin Heaton, same Calendly account, new agencyevolution-instance
  // workspace (2026-09-11). Reuses the same token/link as ah-consulting.
  "ah-consulting-2": {
    tokenEnv: "AH_CONSULTING_CALENDLY_TOKEN",
    eventTypeUrl: "https://calendly.com/austin-austinheaton/30min",
    defaultTz: "Europe/Chisinau",
  },
  // MP Consulting (2026-09-24). Keyed by the resolved CLIENT FILE slug ("mp-consulting"),
  // not the EmailBison workspace slug — that's "ah-consulting" (shared sending capacity
  // with Austin Heaton's own AEO Consulting campaign, see clients/mp-consulting.md). Maddie
  // has her own separate Calendly account/token, entirely unrelated to Austin's own
  // "ah-consulting"/"ah-consulting-2" entries above. Nothing in the auto-reply live-slot
  // path looks this up yet (that path is gated on isFullyAutomated, which MP Consulting is
  // not, and it also keys off workspace_slug not fileSlug) — this entry exists so the
  // Calendly webhook / meetings-tracker wiring and any future manual slot lookup can
  // resolve the token by "mp-consulting".
  "mp-consulting": {
    tokenEnv: "MP_CONSULTING_CALENDLY_TOKEN",
    eventTypeUrl: "https://calendly.com/mpc-maddie/mpc-interview-call-20-min-clone",
    defaultTz: "America/Chicago",
  },
};

export function resolveCalendlyToken(client?: string | null): string | undefined {
  if (client && CALENDLY_CLIENT_CONFIG[client]) {
    const env = CALENDLY_CLIENT_CONFIG[client].tokenEnv;
    return process.env[env] ?? process.env.CALENDLY_TOKEN;
  }
  return process.env.CALENDLY_TOKEN;
}

async function calendlyFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`${CALENDLY_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Calendly API error ${res.status}: ${err}`);
  }
  return res.json();
}

export async function getCalendlyUser(token: string) {
  const data = await calendlyFetch("/users/me", token);
  return data.resource;
}

export async function getEventTypes(token: string, userUri: string) {
  const data = await calendlyFetch(
    `/event_types?user=${encodeURIComponent(userUri)}&active=true`,
    token
  );
  return data.collection;
}

export async function getAvailableSlots(
  token: string,
  eventTypeUri: string,
  startTime: string,
  endTime: string
) {
  const params = new URLSearchParams({
    event_type: eventTypeUri,
    start_time: startTime,
    end_time: endTime,
  });
  const data = await calendlyFetch(
    `/event_type_available_times?${params.toString()}`,
    token
  );
  return data.collection;
}

export async function createSchedulingLink(
  token: string,
  eventTypeUri: string,
  leadName: string,
  leadEmail: string
) {
  const data = await calendlyFetch("/scheduling_links", token, {
    method: "POST",
    body: JSON.stringify({
      max_event_count: 1,
      owner: eventTypeUri,
      owner_type: "EventType",
    }),
  });
  return data.resource;
}