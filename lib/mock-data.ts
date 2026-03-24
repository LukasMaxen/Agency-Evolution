export type Workspace = {
  id: string;
  name: string;
  color: string;
  initials: string;
  instanceUrl: string;
};

export type Reply = {
  id: string;
  workspaceId: string;
  emailBisonId: string;
  leadEmail: string;
  leadName: string;
  senderEmail: string;
  campaign: string;
  subject: string;
  message: string;
  receivedAt: Date;
  status: "new" | "read" | "replied";
  interested: boolean | null;
};

export type Template = {
  id: string;
  name: string;
  body: string;
};

// ─── AI Analysis ─────────────────────────────────────────────────────────────

export type AIIntent =
  | "interested_urgent"   // wants to move fast — schedule call, confirm time, etc.
  | "interested"          // positive but no immediate next step
  | "needs_info"          // asked a question
  | "neutral"             // generic / unclear
  | "not_interested"      // soft no
  | "unsubscribe";        // hard no / remove me

export type AIUrgency = "high" | "medium" | "low";

export type AIAnalysis = {
  intent: AIIntent;
  urgency: AIUrgency;
  summary: string;
  suggestedTemplateId: string | null;
  suggestedReply: string;
  analyzedAt: Date;
};

// ─── Notifications ────────────────────────────────────────────────────────────

export type NotificationEvent =
  | "reply_received"
  | "marked_interested"
  | "marked_not_interested"
  | "reply_sent";

export type Notification = {
  id: string;
  replyId: string;
  workspaceId: string;
  event: NotificationEvent;
  leadName: string;
  leadEmail: string;
  campaign: string;
  snippet: string;
  receivedAt: Date;
  read: boolean;
  aiAnalysis?: AIAnalysis;
};

// ─── Static data ─────────────────────────────────────────────────────────────

export const WORKSPACES: Workspace[] = [
  { id: "w1", name: "Venture Exits",   color: "#185FA5", initials: "VE", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w2", name: "Statera",         color: "#0F6E56", initials: "ST", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w3", name: "Micro Nordic",    color: "#533AB7", initials: "MN", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w4", name: "SRO Consulting",  color: "#993C1D", initials: "SR", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w5", name: "Apex Capital",    color: "#854F0B", initials: "AC", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w6", name: "Meridian IB",     color: "#3B6D11", initials: "MI", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w7", name: "Blackwood PE",    color: "#993556", initials: "BP", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w8", name: "Summit Advisors", color: "#1D9E75", initials: "SA", instanceUrl: "https://send.emailagencyevolution.com" },
];

export const TEMPLATES: Template[] = [
  {
    id: "t1",
    name: "Schedule a call",
    body: `Hi {{first_name}},\n\nThanks for getting back to me. I'd love to connect and learn more about your situation.\n\nAre you available for a 20-minute call this week? Here's my calendar link: [LINK]\n\nLooking forward to speaking.`,
  },
  {
    id: "t2",
    name: "Send deck / materials",
    body: `Hi {{first_name}},\n\nGreat to hear from you. I've attached our overview deck for your review.\n\nFeel free to reach out with any questions — happy to walk you through it on a call.\n\nBest,`,
  },
  {
    id: "t3",
    name: "Request more info",
    body: `Hi {{first_name}},\n\nThank you for your reply. To make sure we're aligned, could you share a bit more about:\n\n- The size/stage of the opportunity\n- Your ideal timeline\n- Any specific criteria you have in mind\n\nThis will help us tailor our approach. Thanks!`,
  },
  {
    id: "t4",
    name: "Not a fit — polite decline",
    body: `Hi {{first_name}},\n\nThank you for taking the time to respond. Based on what you've shared, it seems like this might not be the right fit at this stage.\n\nI'll keep your details on file and reach out if something more relevant comes up.\n\nWish you all the best.`,
  },
  {
    id: "t5",
    name: "Follow up — no response",
    body: `Hi {{first_name}},\n\nJust circling back on my previous message in case it got buried.\n\nWould love to connect when you have a moment — even a quick 15-minute call could be valuable.\n\nLet me know what works for you.`,
  },
  {
    id: "t6",
    name: "Confirm meeting",
    body: `Hi {{first_name}},\n\nPerfect — I've got us booked in. You should receive a calendar invite shortly.\n\nLooking forward to our conversation. Let me know if anything changes on your end.\n\nTalk soon,`,
  },
];

const now = Date.now();

export const MOCK_REPLIES: Reply[] = [
  {
    id: "r1", workspaceId: "w1", emailBisonId: "a15f01e4-5e57-4b98-87b0-3b3a9f40e313",
    leadEmail: "JLandis@woodrock.com", leadName: "Joel Landis",
    senderEmail: "timenger@ventureexitsgroup.com", campaign: "Houston Texas Sell Side",
    subject: "Re: Acquisition Inquiry",
    message: "Ok, are you able to do that time: 1:30pm CT, but on Wednesday?",
    receivedAt: new Date(now - 3 * 60000), status: "new", interested: null,
  },
  {
    id: "r2", workspaceId: "w2", emailBisonId: "b22f01e4-1234-4b98-87b0-aabbcc112233",
    leadEmail: "michael.chen@peakpartners.com", leadName: "Michael Chen",
    senderEmail: "outreach@statera.io", campaign: "West Coast PE — March 2026",
    subject: "Re: PE Opportunity — Statera",
    message: "This looks interesting. Can you send over more details about the deal structure and timeline?",
    receivedAt: new Date(now - 18 * 60000), status: "new", interested: null,
  },
  {
    id: "r3", workspaceId: "w1", emailBisonId: "c33d01e4-5678-4b98-87b0-ddeeff334455",
    leadEmail: "s.patel@ridgecap.com", leadName: "Sandeep Patel",
    senderEmail: "timenger@ventureexitsgroup.com", campaign: "Houston Texas Sell Side",
    subject: "Re: Business Sale — Confidential",
    message: "Not interested at this time. Please remove me from your list.",
    receivedAt: new Date(now - 45 * 60000), status: "read", interested: false,
  },
  {
    id: "r4", workspaceId: "w3", emailBisonId: "d44e01e4-9abc-4b98-87b0-112233445566",
    leadEmail: "anna.k@nordicventures.se", leadName: "Anna Karlsson",
    senderEmail: "contact@micronordic.com", campaign: "Nordic M&A Q1 2026",
    subject: "Re: Cross-border Acquisition",
    message: "Yes, we'd be open to a conversation. What does the target company's EBITDA look like? And is there an IM available?",
    receivedAt: new Date(now - 2 * 3600000), status: "new", interested: null,
  },
  {
    id: "r5", workspaceId: "w4", emailBisonId: "e55f01e4-def0-4b98-87b0-667788990011",
    leadEmail: "robert.hayes@triangleib.com", leadName: "Robert Hayes",
    senderEmail: "deals@sroconsulting.com", campaign: "Southeast Sell Side — Feb 2026",
    subject: "Re: Sell-Side Mandate",
    message: "We reviewed the opportunity — the multiples seem high for the sector. What's the rationale for the valuation?",
    receivedAt: new Date(now - 4 * 3600000), status: "read", interested: null,
  },
  {
    id: "r6", workspaceId: "w5", emailBisonId: "f66a01e4-1111-4b98-87b0-aabbccddeeff",
    leadEmail: "diana.wu@apexcap.hk", leadName: "Diana Wu",
    senderEmail: "outreach@apexcapital.com", campaign: "Asia Pacific Buyout — Q1",
    subject: "Re: Strategic Acquisition Target",
    message: "Forwarded to our deal team. Someone will be in touch within 48 hours. Thank you.",
    receivedAt: new Date(now - 5 * 3600000), status: "read", interested: true,
  },
  {
    id: "r7", workspaceId: "w6", emailBisonId: "g77b01e4-2222-4b98-87b0-112244336655",
    leadEmail: "tom.b@maplefinance.ca", leadName: "Tom Bouchard",
    senderEmail: "deals@meridianib.com", campaign: "Canada Mid-Market Buy Side",
    subject: "Re: Buy-Side Opportunity",
    message: "We're actively looking in the $10-50M EBITDA range. Let's talk. When are you free this week?",
    receivedAt: new Date(now - 6 * 3600000), status: "new", interested: null,
  },
  {
    id: "r8", workspaceId: "w7", emailBisonId: "h88c01e4-3333-4b98-87b0-aaccbbddee11",
    leadEmail: "james.o@blackstonealts.com", leadName: "James O'Brien",
    senderEmail: "contact@blackwoodpe.com", campaign: "US LBO Pipeline — March",
    subject: "Re: LBO Target — Manufacturing",
    message: "Interesting space. Can you share the CIM? We'd want to look at the customer concentration data.",
    receivedAt: new Date(now - 8 * 3600000), status: "new", interested: null,
  },
  {
    id: "r9", workspaceId: "w2", emailBisonId: "i99d01e4-4444-4b98-87b0-bbddccaaffee",
    leadEmail: "priya.nair@solarispe.com", leadName: "Priya Nair",
    senderEmail: "outreach@statera.io", campaign: "West Coast PE — March 2026",
    subject: "Re: PE Opportunity — Statera",
    message: "Not the right fit for our current fund strategy. Thanks anyway.",
    receivedAt: new Date(now - 10 * 3600000), status: "read", interested: false,
  },
  {
    id: "r10", workspaceId: "w8", emailBisonId: "j00e01e4-5555-4b98-87b0-cceebb001122",
    leadEmail: "carlos.m@summitadv.mx", leadName: "Carlos Mendez",
    senderEmail: "outreach@summitadvisors.com", campaign: "LATAM M&A Outreach",
    subject: "Re: Cross-border Deal Flow",
    message: "We have been looking at similar targets in the region. Can we schedule a call to discuss further?",
    receivedAt: new Date(now - 12 * 3600000), status: "new", interested: null,
  },
  {
    id: "r11", workspaceId: "w3", emailBisonId: "k11f01e4-6666-4b98-87b0-ddeeff223344",
    leadEmail: "erik.l@bergstrom.se", leadName: "Erik Lindqvist",
    senderEmail: "contact@micronordic.com", campaign: "Nordic M&A Q1 2026",
    subject: "Re: Cross-border Acquisition",
    message: "We already have a banker on this. Please remove me.",
    receivedAt: new Date(now - 14 * 3600000), status: "read", interested: false,
  },
  {
    id: "r12", workspaceId: "w5", emailBisonId: "l22g01e4-7777-4b98-87b0-eeff00112233",
    leadEmail: "kevin.p@harborcap.com", leadName: "Kevin Park",
    senderEmail: "outreach@apexcapital.com", campaign: "Asia Pacific Buyout — Q1",
    subject: "Re: Strategic Acquisition Target",
    message: "Good timing. We've been looking at this sector. What's the asking price range?",
    receivedAt: new Date(now - 16 * 3600000), status: "new", interested: null,
  },
];

export const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: "n1", replyId: "r1", workspaceId: "w1", event: "reply_received",
    leadName: "Joel Landis", leadEmail: "JLandis@woodrock.com",
    campaign: "Houston Texas Sell Side",
    snippet: "Ok, are you able to do that time: 1:30pm CT, but on Wednesday?",
    receivedAt: new Date(now - 3 * 60000), read: false,
  },
  {
    id: "n2", replyId: "r2", workspaceId: "w2", event: "reply_received",
    leadName: "Michael Chen", leadEmail: "michael.chen@peakpartners.com",
    campaign: "West Coast PE — March 2026",
    snippet: "This looks interesting. Can you send over more details about the deal structure?",
    receivedAt: new Date(now - 18 * 60000), read: false,
  },
  {
    id: "n3", replyId: "r4", workspaceId: "w3", event: "reply_received",
    leadName: "Anna Karlsson", leadEmail: "anna.k@nordicventures.se",
    campaign: "Nordic M&A Q1 2026",
    snippet: "Yes, we'd be open to a conversation. What does the EBITDA look like?",
    receivedAt: new Date(now - 2 * 3600000), read: false,
  },
  {
    id: "n4", replyId: "r7", workspaceId: "w6", event: "reply_received",
    leadName: "Tom Bouchard", leadEmail: "tom.b@maplefinance.ca",
    campaign: "Canada Mid-Market Buy Side",
    snippet: "We're actively looking in the $10-50M EBITDA range. Let's talk.",
    receivedAt: new Date(now - 6 * 3600000), read: false,
  },
  {
    id: "n5", replyId: "r8", workspaceId: "w7", event: "reply_received",
    leadName: "James O'Brien", leadEmail: "james.o@blackstonealts.com",
    campaign: "US LBO Pipeline — March",
    snippet: "Interesting space. Can you share the CIM? We'd want customer concentration data.",
    receivedAt: new Date(now - 8 * 3600000), read: false,
  },
  {
    id: "n6", replyId: "r10", workspaceId: "w8", event: "reply_received",
    leadName: "Carlos Mendez", leadEmail: "carlos.m@summitadv.mx",
    campaign: "LATAM M&A Outreach",
    snippet: "We have been looking at similar targets. Can we schedule a call?",
    receivedAt: new Date(now - 12 * 3600000), read: false,
  },
  {
    id: "n7", replyId: "r12", workspaceId: "w5", event: "reply_received",
    leadName: "Kevin Park", leadEmail: "kevin.p@harborcap.com",
    campaign: "Asia Pacific Buyout — Q1",
    snippet: "Good timing. We've been looking at this sector. What's the asking price range?",
    receivedAt: new Date(now - 16 * 3600000), read: false,
  },
  {
    id: "n8", replyId: "r6", workspaceId: "w5", event: "marked_interested",
    leadName: "Diana Wu", leadEmail: "diana.wu@apexcap.hk",
    campaign: "Asia Pacific Buyout — Q1",
    snippet: "Forwarded to our deal team. Someone will be in touch within 48 hours.",
    receivedAt: new Date(now - 5 * 3600000), read: true,
  },
  {
    id: "n9", replyId: "r3", workspaceId: "w1", event: "marked_not_interested",
    leadName: "Sandeep Patel", leadEmail: "s.patel@ridgecap.com",
    campaign: "Houston Texas Sell Side",
    snippet: "Not interested at this time. Please remove me from your list.",
    receivedAt: new Date(now - 45 * 60000), read: true,
  },
  {
    id: "n10", replyId: "r5", workspaceId: "w4", event: "reply_received",
    leadName: "Robert Hayes", leadEmail: "robert.hayes@triangleib.com",
    campaign: "Southeast Sell Side — Feb 2026",
    snippet: "The multiples seem high for the sector. What's the rationale for the valuation?",
    receivedAt: new Date(now - 4 * 3600000), read: true,
  },
];
