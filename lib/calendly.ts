const CALENDLY_BASE = "https://api.calendly.com";

export type CalendlyClientConfig = {
  tokenEnv: string;
  eventTypeUrl: string;
  defaultTz?: string;
};

export const CALENDLY_CLIENT_CONFIG: Record<string, CalendlyClientConfig> = {
  "larsen-digital": {
    tokenEnv: "CALENDLY_TOKEN_LARSEN_DIGITAL",
    eventTypeUrl: "https://calendly.com/larsen-digital-marketing/intro",
    defaultTz: "Europe/London",
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