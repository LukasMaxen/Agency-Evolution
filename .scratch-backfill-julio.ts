import { buildMeetingContext } from "@/lib/meeting-context";
import { MEETING_CONFIG } from "@/lib/meetings-tracker";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "";

async function postSlack(channel: string, text: string): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text, mrkdwn: true }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`slack chat.postMessage -> ${data.error}`);
  console.log("posted", data.ts);
}

async function main() {
  const cfg = MEETING_CONFIG["acceler8rs"];
  const leadEmail = "julio@puroast.com";
  const leadName = "Julio Sachs";
  const meetingStartISO = "2026-08-10T17:30:00.000Z";
  const prettyTime = new Date(meetingStartISO).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" }) + " CET";
  const eventTypeName = "M&A Conversation | Larsen Digital";
  const campaign = "NEW LIST: Pathfinder (US)";
  const phone = "+1 530-608-6088";
  const qa = [
    { question: "Annual revenue", answer: "$5-10M" },
    { question: "Primary sales channel", answer: "Amazon / DTC / Wholesale" },
    { question: "Timeline to exit", answer: "0-6 months" },
    { question: "Phone Number", answer: phone },
  ];

  const extra = await buildMeetingContext({
    workspaceSlug: "acceler8rs",
    leadEmail,
    icpDescription: cfg.icpDescription,
    phone,
  });

  const lines = [`New meeting booked with ${leadName}`, ""];
  if (cfg.workspaceLabel) lines.push(`Sender: ${cfg.workspaceLabel}`);
  lines.push(`Email: ${leadEmail}`);
  lines.push(`Campaign: ${campaign}`);
  lines.push(`Event type: ${eventTypeName}`);
  lines.push(`Time: ${prettyTime}`);
  lines.push("");
  qa.forEach((q, idx) => lines.push(`${idx + 1}. ${q.question}: ${q.answer}`));
  if (extra.length) { lines.push(""); lines.push(...extra); }

  const text = lines.join("\n");
  console.log("--- message ---\n" + text + "\n---------------");
  await postSlack(cfg.slackChannel, text);
}

main().catch(e => { console.error(e); process.exit(1); });
