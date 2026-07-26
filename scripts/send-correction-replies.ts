/**
 * Sends the 22 correction replies to leads who received "Hi [Name]," on May 11.
 * Run once only: npx tsx scripts/send-correction-replies.ts
 */

import { Pool } from "pg";
import * as path from "path";
import * as fs from "fs";

// Load .env.local manually without dotenv dependency
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

function resolveMergeTags(body: string, leadName: string, leadEmail: string, leadCompany: string | null, leadTitle: string | null): string {
  const firstName = leadName.split(" ")[0] ?? leadName;
  const lastName = leadName.split(" ").slice(1).join(" ") ?? "";
  return body
    .replace(/\{FIRST_NAME\}/gi, firstName)
    .replace(/\{LAST_NAME\}/gi, lastName)
    .replace(/\{FULL_NAME\}/gi, leadName)
    .replace(/\{EMAIL\}/gi, leadEmail)
    .replace(/\{COMPANY\}/gi, leadCompany ?? "")
    .replace(/\{TITLE\}/gi, leadTitle ?? "")
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{last_name\}\}/gi, lastName)
    .replace(/\{\{company\}\}/gi, leadCompany ?? "")
    .replace(/\{\{title\}\}/gi, leadTitle ?? "");
}

function bodyToHtml(body: string): string {
  const linkify = (text: string) =>
    text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return body
    .split("\n\n")
    .map(para => `<p style="margin:0 0 16px 0;">${linkify(para.replace(/\n/g, "<br>"))}</p>`)
    .join("");
}

interface Correction {
  replyId: string;
  body: string;
  toEmailOverride?: string;
  toNameOverride?: string;
}

const CORRECTIONS: Correction[] = [
  // ── ACT Capital ────────────────────────────────────────────────────────────
  {
    replyId: "a1c12d3d-b723-4e8a-98cb-f902c62b5b10", // Marwan
    body: `Hi Marwan,

Happy to connect. Feel free to grab a time that works here: https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting

Looking forward to speaking.

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1bfac42-5f2f-4fd4-8c70-9214d0e555f1", // Asad
    body: `Hi Asad,

Here is the teaser for the opportunity: https://www.actcapitaladvisors.com/open-deals/highly-profitable-general-contractor-and-construction/

The teaser also includes the NDA, so you can review both in one place. Happy to walk you through the details on a quick call. Feel free to grab a time here: https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting or let me know what works on your end.

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1bcfff1-a85e-4703-bb88-389bb2eb1bbf", // Jurrisha
    body: `Hi Jurrisha,

Great. Here is a link to grab a time for a quick call: https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting

Looking forward to it.

{SENDER_EMAIL_SIGNATURE}`,
  },

  // ── Venture Exits ──────────────────────────────────────────────────────────
  {
    replyId: "a1a53ed0-e1e0-465c-a27f-fed53b035afd", // Wesley
    body: `Hi Wesley,

Here is the teaser: https://drive.google.com/file/d/1W16xGuzI26WwBNsHRL52C7O7GWTPBL1h/view?usp=sharing

Happy to walk through the details once you have had a chance to review. Feel free to grab a time here: https://calendly.com/tim-ventureexits/30min or let me know what works on your end.

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1c148dc-c67f-4805-b273-adef71e1ecfd", // Adam
    body: `Hi Adam,

Here is the teaser: https://drive.google.com/file/d/1W16xGuzI26WwBNsHRL52C7O7GWTPBL1h/view?usp=sharing

Happy to jump on a quick call once you have had a chance to review. Feel free to grab a time here: https://calendly.com/tim-ventureexits/30min

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1c15ffb-d0d0-40d6-bf1d-9f366f4d9839", // Oren
    body: `Hi Oren,

Here is the teaser: https://drive.google.com/file/d/1W16xGuzI26WwBNsHRL52C7O7GWTPBL1h/view?usp=sharing

Happy to connect on a quick call to go through the details. Feel free to grab a time here: https://calendly.com/tim-ventureexits/30min

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1c11110-2170-408c-a593-c955b3c86dc3", // Mitesh
    body: `Hi Mitesh,

Here is the teaser: https://drive.google.com/file/d/1W16xGuzI26WwBNsHRL52C7O7GWTPBL1h/view?usp=sharing

Happy to jump on a quick call to go through the details, whether for this deal or something else you have in mind. Feel free to grab a time here: https://calendly.com/tim-ventureexits/30min

{SENDER_EMAIL_SIGNATURE}`,
  },

  // ── ZEBS ───────────────────────────────────────────────────────────────────
  {
    replyId: "a1c14097-e2ca-4a6c-a5c2-46556a15d196", // Adrian
    body: `Hi Adrian,

That context is helpful. Here is the teaser for your review: https://docs.google.com/presentation/d/11j96USFphexZ8Bmk543bjIHjHWD0HnBd04bw2_tyKcs/edit?usp=sharing

If it looks like a fit for your network, happy to jump on a quick call to go over the allocator profile and what the round looks like in more detail. Feel free to grab a time here: https://calendly.com/d/ct3h-sbj-xmb/zebs-s-seed-round-intro

{SENDER_EMAIL_SIGNATURE}`,
  },

  // ── Statera Capital ────────────────────────────────────────────────────────
  {
    replyId: "a1b943be-5a13-4c3a-9e45-379cdfdae08a", // Roman / Mirko
    body: `Hi Mirko,

Thank you for jumping in. Roman gave me a great overview of your position at TAB and I appreciate you being open to a direct conversation.

Happy to walk you through what a process could look like from here. Feel free to grab a time that works for you: https://calendly.com/d/cvb5-pf9-d4b/sell-side-mandate or just let me know your availability and we will coordinate.

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1b972c4-ea43-4c7e-bc98-641db2d38966", // Joseph
    body: `Hi Joe,

No issue at all on the timezone. The easiest way to find a slot that works across time zones is through the calendar link below.

Feel free to grab a time here: https://calendly.com/d/cvb5-pf9-d4b/sell-side-mandate. If none of the slots line up, just let me know and we can sort something that works.

{SENDER_EMAIL_SIGNATURE}`,
  },

  // ── Wrobel Capital ─────────────────────────────────────────────────────────
  {
    replyId: "a1b97543-3c5a-4a16-8f22-14a8bc6b45df", // Luke
    body: `Hi Luke,

Yes, there is a specific buyer. Standard practice at this stage is to keep them confidential before an NDA is in place, which is exactly what the first call is for.

To answer your second question, the interest is in acquisition, not investment. The buyer is looking for an outright or majority purchase, not a capital injection.

Are you open to a quick 15-minute call to explore whether it makes sense? Feel free to grab a time here: https://calendly.com/swrobel-wrobelcap/30min

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1c1527c-dc17-4abc-9501-ecf50da500fa", // Heather / Benjamin
    toEmailOverride: "ben@cappellos.com",
    toNameOverride: "Benjamin Frohlichstein",
    body: `Hi Benjamin,

I appreciate Heather looping you in. The buyer is focused on the consumer packaged goods space, including food and beverage brands with established distribution. They are looking at businesses in the mid-seven to low-eight-figure revenue range with healthy margins.

For deal structure and specifics, better to cover that on a call. Feel free to grab a time here: https://calendly.com/swrobel-wrobelcap/30min

{SENDER_EMAIL_SIGNATURE}`,
  },

  // ── 911 Restoration ────────────────────────────────────────────────────────
  {
    replyId: "a1b986b2-a29f-4ef3-9b4b-70ec028b56bb", // Bryan
    body: `Hi Bryan,

Sending everything over now.

One of our operators, Chris, ran a window cleaning business in Reno. He layered a 911 Restoration franchise alongside it and scaled into plumbing and reconstruction through the 911 network. Work came through insurance-backed claim pipelines so he was not out chasing customers. His existing business kept running the same way.

Two short videos that walk through how it works: Watch Chris's Story (3:00) https://www.youtube.com/watch?v=TQVUORpK35M&feature=youtu.be and The Power of the Network (1:30) https://www.youtube.com/watch?v=JoPThufW1uc.

Three things franchisees point to most: restoration work ramps when trade work slows so it fills seasonal gaps, your existing client relationships become a natural referral base, and the franchisee network is something most operators say was the biggest unexpected advantage.

Per our 2024 FDD, top 25% of franchisees average 2M+ in gross revenue. SBA financing is available.

Our Franchise Developer will follow up within 48 hours. If you would prefer to book a time directly: https://calendly.com/dre-c-911restoration/quick-introduction-call-clone

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1bd04f7-c0e2-4573-a5e9-c1453d4888fe", // John
    body: `Hi John,

Fair enough, here is the overview.

One of our operators, Chris, ran a window cleaning business in Reno. He layered a 911 Restoration franchise alongside it and scaled into plumbing and reconstruction through the 911 network. Work came through insurance-backed claim pipelines, so he was not out chasing customers. His existing business kept running exactly the same way.

Two short videos: Watch Chris's Story (3:00) https://www.youtube.com/watch?v=TQVUORpK35M&feature=youtu.be and The Power of the Network (1:30) https://www.youtube.com/watch?v=JoPThufW1uc.

Per our 2024 FDD, top 25% of franchisees average 2M+ in gross revenue. SBA financing is available.

Our Franchise Developer will follow up within 48 hours. If you would prefer to book directly: https://calendly.com/dre-c-911restoration/quick-introduction-call-clone

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1b96c9e-23cb-4af2-bc51-073575174d12", // George
    body: `Hi George,

Sending it over now.

One of our operators, Chris, ran a window cleaning business in Reno. He layered a 911 Restoration franchise alongside it and scaled into plumbing and reconstruction through the 911 network. Work came through insurance-backed claim pipelines so he was not out chasing customers.

Two short videos: Watch Chris's Story (3:00) https://www.youtube.com/watch?v=TQVUORpK35M&feature=youtu.be and The Power of the Network (1:30) https://www.youtube.com/watch?v=JoPThufW1uc.

Per our 2024 FDD, top 25% of franchisees average 2M+ in gross revenue. SBA financing is available.

Our Franchise Developer will follow up within 48 hours. If you would prefer to book directly: https://calendly.com/dre-c-911restoration/quick-introduction-call-clone

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1b953c7-ec3e-4cef-af8a-7a71ec04002c", // Alan
    body: `Hi Alan,

Great, skylights and exterior trades are exactly the type of background that fits well. The insurance pipeline is what makes the overlap natural since restoration work ramps from the same claim events that affect roofing and exterior work.

Here is how the franchise model works. One of our operators, Chris, ran a window cleaning business in Reno. He layered a 911 Restoration franchise alongside it and scaled into plumbing and reconstruction through the 911 network. Work came through insurance-backed pipelines, so he was not out chasing customers.

Two short videos: Watch Chris's Story (3:00) https://www.youtube.com/watch?v=TQVUORpK35M&feature=youtu.be and The Power of the Network (1:30) https://www.youtube.com/watch?v=JoPThufW1uc.

Per our 2024 FDD, top 25% of franchisees average 2M+ in gross revenue. SBA financing is available.

Our Franchise Developer will follow up within 48 hours. If you would prefer to book directly: https://calendly.com/dre-c-911restoration/quick-introduction-call-clone

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1a53e9e-8554-4e73-9763-d710f3e0642a", // Tom
    body: `Hi Tom,

Fair point, I should have been clearer.

911 Restoration is a national franchise in the water, fire, and mold restoration space. Franchisees receive insurance-backed jobs directly through claim pipelines, meaning work comes to you rather than you chasing it. It is built to run alongside an existing trade or service business without disrupting what you already have.

Per our 2024 FDD, top 25% of franchisees average 2M+ in gross revenue. SBA financing is available.

Two short videos if it is worth a closer look: Watch Chris's Story (3:00) https://www.youtube.com/watch?v=TQVUORpK35M&feature=youtu.be and The Power of the Network (1:30) https://www.youtube.com/watch?v=JoPThufW1uc.

Our Franchise Developer will follow up in 48 hours, or you can book directly: https://calendly.com/dre-c-911restoration/quick-introduction-call-clone

{SENDER_EMAIL_SIGNATURE}`,
  },

  // ── Larsen Digital ─────────────────────────────────────────────────────────
  {
    replyId: "a1a54630-ce4a-4e0e-bbcd-87c40c8c0ca4", // Samantha
    body: `Hi Samantha,

Yes, fully performance-based. No upfront fee, no retainer. Compensation is aligned entirely to your brand's outcome, whether that is revenue growth, profitability, or exit value.

Happy to walk through exactly how it works on a quick call. Easiest to lock something in here: https://calendly.com/larsen-digital-marketing/intro

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1a542e6-12cf-44ff-bc94-56a2409e7096", // Stefani
    body: `Hi Stefani,

Looking forward to it. Easiest to lock something in through the calendar so you can grab whichever slot works best on your end: https://calendly.com/larsen-digital-marketing/intro

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1a53dfb-39a6-4d2f-9858-3bbd4feede44", // Spencer
    body: `Hi Spencer,

Perfect, looking forward to Monday.

{SENDER_EMAIL_SIGNATURE}`,
  },
  {
    replyId: "a1a6d5f9-5ba4-44e8-94f1-7d77e7a86134", // Nic
    body: `Hi Nic,

Glad it landed. On the channel question, the edge here is on the M&A side. The partners Nicklas works with have closed over 1B in CPG exits, which means the exit path is not theoretical. The growth work is built specifically around improving the metrics buyers look at, so the whole engagement points toward one outcome.

Happy to get into specifics on how that plays out for Icebeanie. Easiest to grab a time here: https://calendly.com/larsen-digital-marketing/intro

{SENDER_EMAIL_SIGNATURE}`,
  },

  // ── GN Motion ──────────────────────────────────────────────────────────────
  {
    replyId: "a1a5946b-e786-41f4-a4b2-e499e4dffb7f", // Anna
    body: `Hi Anna,

Completely understand, producing locally makes sense at scale. Where CGI tends to add value is when you need visuals that are difficult or expensive to capture consistently on set, things like texture, ingredient visualization, or hero shots that need to look identical across markets.

You can see examples here: https://www.canva.com/design/DAHCb_CiXzA/UA6aPIn-u-MAXQiuuanQAQ/view?utm_content=DAHCb_CiXzA&utm_campaign=designshare&utm_medium=link2&utm_source=uniquelinks&utlId=h6402713df7

On pricing, best to cover that after a quick call so I can understand what you are working on specifically. Happy to produce a complimentary sample for one of your products so you can see the quality before committing to anything. Feel free to grab a time here: https://app.iclosed.io/e/GNMOTION/creative-campaign-strategy-call-email

{SENDER_EMAIL_SIGNATURE}`,
  },
];

async function sendOne(correction: Correction): Promise<void> {
  const { replyId, body, toEmailOverride, toNameOverride } = correction;

  // Fetch reply + workspace creds
  const r = await pool.query(
    `SELECT r.*, w.email_bison_api_key, w.email_bison_instance_url
     FROM replies r
     JOIN workspaces w ON w.slug = r.workspace_slug
     WHERE r.id = $1`,
    [replyId]
  );
  if (r.rows.length === 0) {
    console.error(`[SKIP] Reply not found: ${replyId}`);
    return;
  }
  const reply = r.rows[0];

  const resolvedBody = resolveMergeTags(
    body,
    reply.lead_name ?? "",
    reply.lead_email ?? "",
    reply.lead_company ?? null,
    reply.lead_title ?? null
  );

  const recipientEmail = toEmailOverride ?? reply.lead_email;
  const recipientName = toNameOverride ?? reply.lead_name ?? null;

  const htmlBody = bodyToHtml(resolvedBody);

  const ebResponse = await fetch(
    `${reply.email_bison_instance_url}/api/replies/${reply.email_bison_reply_id}/reply`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reply.email_bison_api_key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        message: htmlBody,
        sender_email_id: reply.sender_email_id,
        to_emails: [{ name: recipientName, email_address: recipientEmail }],
        inject_previous_email_body: true,
        content_type: "html",
      }),
    }
  );

  if (!ebResponse.ok) {
    const err = await ebResponse.text();
    console.error(`[FAIL] ${reply.lead_name} (${reply.workspace_slug}): ${ebResponse.status} ${err}`);
    return;
  }

  // Log to sent_emails
  const sentId = `correction-${replyId}-${Date.now()}`;
  await pool.query(
    `INSERT INTO sent_emails (id, reply_id, workspace_slug, lead_email, lead_name, email_type, subject, body, sent_at)
     VALUES ($1,$2,$3,$4,$5,'reply',$6,$7,NOW())`,
    [sentId, replyId, reply.workspace_slug, toEmailOverride ?? reply.lead_email, toNameOverride ?? reply.lead_name, reply.subject ?? "", resolvedBody]
  );

  console.log(`[OK] ${reply.lead_name} <${recipientEmail}> (${reply.workspace_slug})`);
}

async function main() {
  console.log(`Sending ${CORRECTIONS.length} correction replies...\n`);
  for (const c of CORRECTIONS) {
    await sendOne(c);
    await new Promise(r => setTimeout(r, 1500)); // pace to avoid rate limits
  }
  console.log("\nDone.");
  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); });
