import { buildMeetingContext } from "@/lib/meeting-context";
import { MEETING_CONFIG } from "@/lib/meetings-tracker";

async function main() {
  const cfg = MEETING_CONFIG["larsen-digital"];
  const icp = cfg.icpDescription;
  const leadEmail = "thomas@skinspanewyork.com";
  const leadName = "Thomas Elzner";

  const extra = await buildMeetingContext({
    workspaceSlug: "larsen-digital",
    leadEmail,
    icpDescription: icp,
    phone: "+45 22 22 22 22",
  });

  const firstName = cfg.workspaceLabel?.split(" ")[0];
  const title = `${firstName} - New meeting booked with ${leadName}`;
  const lines = [
    title,
    "",
    `Email: ${leadEmail}`,
    `Thread: https://send.emailagencyevolution.com/inbox/replies/462140`,
    `Website: skinspanewyork.com`,
    `Event type: M&A Conversation | Larsen Digital`,
    `Time: August 24, 2026 at 03:00 PM CET`,
    "",
    "1. Annual revenue (All channels: Shopify, Amazon, Wholesale, etc): $2-5M",
    "2. Primary sales channel (DTC / Amazon / wholesale / Other): Manual Booking",
    "3. Timeline to exit: 6-18 months",
    "4. Phone Number: +45 22 22 22 22",
  ];
  if (extra.length) { lines.push(""); lines.push(...extra); }

  console.log(lines.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
