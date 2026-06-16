const FATHOM_BASE = "https://api.fathom.ai/external/v1";

export interface FathomTranscriptLine {
  speaker: { display_name: string; matched_calendar_invitee_email: string | null };
  text: string;
  timestamp: string;
}

export interface FathomInvitee {
  name: string;
  email: string;
  email_domain: string;
  is_external: boolean;
}

export interface FathomMeeting {
  title: string;
  meeting_title: string;
  url: string;
  created_at: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  recording_id: number;
  recording_start_time: string;
  recording_end_time: string;
  transcript: FathomTranscriptLine[] | null;
  default_summary: string | null;
  action_items: string | null;
  calendar_invitees: FathomInvitee[];
  recorded_by: { name: string; email: string; email_domain: string };
  share_url: string;
}

const INTERNAL_DOMAINS = new Set(["maxen-digital.com", "gmail.com"]);

export function isInternalMeeting(meeting: FathomMeeting): boolean {
  return meeting.calendar_invitees.every(i => INTERNAL_DOMAINS.has(i.email_domain));
}

export function compressTranscript(transcript: FathomTranscriptLine[]): string {
  const merged: Array<{ speaker: string; text: string; timestamp: string }> = [];
  for (const line of transcript) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === line.speaker.display_name) {
      last.text += " " + line.text;
    } else {
      merged.push({ speaker: line.speaker.display_name, text: line.text, timestamp: line.timestamp });
    }
  }
  return merged.map(l => `[${l.timestamp}] ${l.speaker}: ${l.text}`).join("\n");
}

export function meetingDurationMinutes(meeting: FathomMeeting): number {
  const start = new Date(meeting.recording_start_time).getTime();
  const end = new Date(meeting.recording_end_time).getTime();
  return Math.round((end - start) / 60000);
}

export function matchClientSlug(title: string, slugs: string[]): string | null {
  const titleLower = title.split(/\s*[-–]\s*/)[0].toLowerCase().trim();
  for (const slug of slugs) {
    const slugName = slug.replace(/-/g, " ").toLowerCase();
    if (titleLower.includes(slugName) || slugName.includes(titleLower)) return slug;
  }
  // Fuzzy: check if any word from slug name appears in title
  for (const slug of slugs) {
    const words = slug.replace(/-/g, " ").toLowerCase().split(" ").filter(w => w.length > 3);
    if (words.some(w => titleLower.includes(w))) return slug;
  }
  return null;
}

export async function fetchMeetings(cursor?: string): Promise<{ items: FathomMeeting[]; next_cursor: string | null }> {
  const apiKey = process.env.FATHOM_API_KEY;
  if (!apiKey) throw new Error("FATHOM_API_KEY not set");
  const url = new URL(`${FATHOM_BASE}/meetings`);
  url.searchParams.set("include_transcript", "true");
  url.searchParams.set("limit", "50");
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await fetch(url.toString(), { headers: { "X-Api-Key": apiKey } });
  if (!res.ok) throw new Error(`Fathom API error: ${res.status}`);
  const data = await res.json();
  return { items: data.items, next_cursor: data.next_cursor ?? null };
}
