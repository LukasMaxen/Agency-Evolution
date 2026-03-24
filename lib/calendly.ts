const CALENDLY_BASE = "https://api.calendly.com";

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