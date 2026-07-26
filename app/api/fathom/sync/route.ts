import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import pool from "@/lib/db";
import {
  fetchMeetings,
  isInternalMeeting,
  compressTranscript,
  meetingDurationMinutes,
  matchClientSlug,
  FathomMeeting,
} from "@/lib/fathom";

const CLIENT_SLUGS = [
  "911-restoration", "acceler8rs", "act-capital", "agency-evolution",
  "brookline-capital", "gn-motion", "hahnbeck", "itg-group",
  "larsen-digital", "micro-nordic", "sonaro-ai", "sro-consulting",
  "statera-capital", "venture-exits", "wrobel-capital", "zebs-ibs", "zenith-global",
];

const INTERNAL_LOG = path.join(process.cwd(), "1. Departments", "operations", "internal-meeting-notes.md");

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fathom_synced_meetings (
      recording_id BIGINT PRIMARY KEY,
      meeting_title TEXT,
      meeting_type TEXT,
      client_slug TEXT,
      meeting_date TIMESTAMPTZ,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function isSynced(recordingId: number): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM fathom_synced_meetings WHERE recording_id = $1", [recordingId]);
  return r.rows.length > 0;
}

async function markSynced(meeting: FathomMeeting, type: string, clientSlug: string | null) {
  await pool.query(
    `INSERT INTO fathom_synced_meetings (recording_id, meeting_title, meeting_type, client_slug, meeting_date)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [meeting.recording_id, meeting.title, type, clientSlug, meeting.recording_start_time]
  );
}

async function callClaude(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude error: ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function attendeeNames(meeting: FathomMeeting): string {
  return meeting.calendar_invitees.map(i => i.name).join(", ");
}

function appendToSection(filePath: string, sectionHeader: string, newContent: string) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, "utf-8");
  const idx = content.indexOf(sectionHeader);
  if (idx === -1) {
    // Section doesn't exist — append to end before ## Internal Notes or at end
    const internalIdx = content.lastIndexOf("## Internal Notes");
    const insertAt = internalIdx !== -1 ? internalIdx : content.length;
    content = content.slice(0, insertAt) + `\n\n${sectionHeader}\n\n${newContent}\n\n` + content.slice(insertAt);
  } else {
    // Insert after the section header line
    const afterHeader = content.indexOf("\n", idx) + 1;
    content = content.slice(0, afterHeader) + newContent + "\n\n" + content.slice(afterHeader);
  }
  fs.writeFileSync(filePath, content, "utf-8");
}

function appendToInternalLog(newContent: string) {
  if (!fs.existsSync(INTERNAL_LOG)) {
    fs.writeFileSync(INTERNAL_LOG, `# Internal Meeting Notes\n\n_Running log of all internal team meetings._\n\n---\n\n${newContent}\n`, "utf-8");
  } else {
    const existing = fs.readFileSync(INTERNAL_LOG, "utf-8");
    const insertAfter = existing.indexOf("---\n") + 4;
    fs.writeFileSync(INTERNAL_LOG, existing.slice(0, insertAfter) + "\n" + newContent + "\n" + existing.slice(insertAfter), "utf-8");
  }
}

async function processClientMeeting(meeting: FathomMeeting, clientSlug: string) {
  const transcript = meeting.transcript ? compressTranscript(meeting.transcript) : "";
  if (!transcript) return;

  const summary = await callClaude(
    `You summarize client meetings for Maxen Partners, an M&A outreach agency. Be concise and specific. No filler.`,
    `MEETING: ${meeting.title}
DATE: ${formatDate(meeting.recording_start_time)}
ATTENDEES: ${attendeeNames(meeting)}
DURATION: ${meetingDurationMinutes(meeting)} min
FATHOM LINK: ${meeting.url}

TRANSCRIPT:
${transcript}

Write a meeting summary with these sections (only include sections that have content):
**Key discussion points** — what was talked about
**Campaign feedback** — any feedback on current campaigns, what's working or not
**Changes requested** — specific asks or changes to campaigns, scripts, targeting
**Performance updates** — any numbers or results shared
**New campaigns / strategy** — any new ideas or directions discussed
**Action items** — concrete next steps with owner if mentioned

Format: markdown. Each section is a bold heading followed by bullet points. Max 350 words total.`
  );

  const date = formatDate(meeting.recording_start_time);
  const entry = `### ${date} — ${meeting.title}\n**Attendees:** ${attendeeNames(meeting)} | **Duration:** ${meetingDurationMinutes(meeting)} min | [Fathom recording](${meeting.url})\n\n${summary}\n\n---`;

  const clientFile = path.join(process.cwd(), "clients", `${clientSlug}.md`);
  appendToSection(clientFile, "### Biweekly Meeting Notes", entry);
}

async function processInternalMeeting(meeting: FathomMeeting) {
  const transcript = meeting.transcript ? compressTranscript(meeting.transcript) : "";
  if (!transcript) return;

  const clientList = CLIENT_SLUGS.map(s => s.replace(/-/g, " ")).join(", ");

  const raw = await callClaude(
    `You summarize internal team meetings for Maxen Partners, an M&A outreach agency. Return ONLY valid JSON.`,
    `MEETING: ${meeting.title}
DATE: ${formatDate(meeting.recording_start_time)}
ATTENDEES: ${attendeeNames(meeting)}
DURATION: ${meetingDurationMinutes(meeting)} min

TRANSCRIPT:
${transcript}

Return a JSON object with this exact shape:
{
  "summary": "Full meeting summary — key topics, decisions, action items. Max 400 words. Markdown with bold headings.",
  "client_mentions": [
    {
      "client_slug": "exact-slug-from-list",
      "notes": "What was specifically discussed about this client — feedback, performance, changes, concerns. 2-5 sentences."
    }
  ]
}

Known client slugs: ${CLIENT_SLUGS.join(", ")}
Only include clients that were actually discussed. If none were mentioned, return an empty array.`
  );

  let parsed: { summary: string; client_mentions: Array<{ client_slug: string; notes: string }> };
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    console.error("[fathom] Failed to parse internal meeting JSON");
    return;
  }

  const date = formatDate(meeting.recording_start_time);
  const logEntry = `## ${date} — ${meeting.title}\n**Attendees:** ${attendeeNames(meeting)} | **Duration:** ${meetingDurationMinutes(meeting)} min | [Fathom recording](${meeting.url})\n\n${parsed.summary}\n\n---`;
  appendToInternalLog(logEntry);

  for (const mention of parsed.client_mentions) {
    if (!CLIENT_SLUGS.includes(mention.client_slug)) continue;
    const clientFile = path.join(process.cwd(), "clients", `${mention.client_slug}.md`);
    const entry = `**${date} (Internal meeting)** — ${mention.notes}`;
    appendToSection(clientFile, "### Internal Meeting Notes", entry);
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();

    const { since_days = 30 } = await req.json().catch(() => ({}));
    const { items: meetings } = await fetchMeetings();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - since_days);

    const results = { processed: 0, skipped: 0, errors: [] as string[] };

    for (const meeting of meetings) {
      if (new Date(meeting.recording_start_time) < cutoff) continue;
      if (meeting.title.toLowerCase().includes("impromptu")) { results.skipped++; continue; }
      if (await isSynced(meeting.recording_id)) { results.skipped++; continue; }
      if (!meeting.transcript?.length) { results.skipped++; continue; }

      try {
        if (isInternalMeeting(meeting)) {
          await processInternalMeeting(meeting);
          await markSynced(meeting, "internal", null);
        } else {
          const clientSlug = matchClientSlug(meeting.title, CLIENT_SLUGS);
          if (clientSlug) {
            await processClientMeeting(meeting, clientSlug);
            await markSynced(meeting, "client", clientSlug);
          } else {
            // Unknown client meeting — log to internal notes anyway
            await processInternalMeeting(meeting);
            await markSynced(meeting, "unknown", null);
          }
        }
        results.processed++;
      } catch (e: any) {
        results.errors.push(`${meeting.recording_id}: ${e.message}`);
      }
    }

    return NextResponse.json(results);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
