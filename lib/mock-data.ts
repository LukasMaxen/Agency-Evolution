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
  | "interested_urgent"
  | "interested"
  | "needs_info"
  | "neutral"
  | "not_interested"
  | "unsubscribe";

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

// ─── Workspaces (your real clients) ──────────────────────────────────────────

export const WORKSPACES: Workspace[] = [
  { id: "w1",  name: "Larsen Digital",   color: "#185FA5", initials: "LD", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w2",  name: "ACT Capital",      color: "#0F6E56", initials: "AC", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w3",  name: "Acceler8rs",       color: "#7C3AED", initials: "A8", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w4",  name: "Hahnbeck",         color: "#B45309", initials: "HB", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w5",  name: "911 Restoration",  color: "#DC2626", initials: "9R", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w6",  name: "Micro Nordic",     color: "#533AB7", initials: "MN", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w7",  name: "GN Motion",        color: "#0369A1", initials: "GN", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w8",  name: "Statera Capital",  color: "#0F6E56", initials: "SC", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w9",  name: "Venture Exits",    color: "#185FA5", initials: "VE", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w10", name: "Wrobel Capital",   color: "#9D174D", initials: "WC", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w11", name: "Zenith Global",    color: "#065F46", initials: "ZG", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w12", name: "ITG Group",        color: "#1E3A5F", initials: "IT", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w13", name: "Sonaro AI",        color: "#6D28D9", initials: "SA", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w14", name: "Zebs IBS",         color: "#92400E", initials: "ZI", instanceUrl: "https://send.emailagencyevolution.com" },
];

// ─── Templates ───────────────────────────────────────────────────────────────

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

// ─── Mock data ────────────────────────────────────────────────────────────────

const now = Date.now();

export const MOCK_REPLIES: Reply[] = [
  {
    id: "r1", workspaceId: "w9", emailBisonId: "a15f01e4-5e57-4b98-87b0-3b3a9f40e313",
    leadEmail: "JLandis@woodrock.com", leadName: "Joel Landis",
    senderEmail: "tim@ventureexits.com", campaign: "Houston Texas Sell Side",
    subject: "Re: Acquisition Inquiry",
    message: "Ok, are you able to do that time: 1:30pm CT, but on Wednesday?",
    receivedAt: new Date(now - 3 * 60000), status: "new", interested: null,
  },
  {
    id: "r2", workspaceId: "w8", emailBisonId: "b22f01e4-1234-4b98-87b0-aabbcc112233",
    leadEmail: "michael.chen@peakpartners.com", leadName: "Michael Chen",
    senderEmail: "outreach@stateracapital.com", campaign: "West Coast PE — March 2026",
    subject: "Re: PE Opportunity — Statera Capital",
    message: "This looks interesting. Can you send over more details about the deal structure and timeline?",
    receivedAt: new Date(now - 18 * 60000), status: "new", interested: null,
  },
  {
    id: "r3", workspaceId: "w1", emailBisonId: "c33d01e4-5678-4b98-87b0-ddeeff334455",
    leadEmail: "s.patel@ridgecap.com", leadName: "Sandeep Patel",
    senderEmail: "outreach@larsendigital.com", campaign: "SaaS Founders Outreach",
    subject: "Re: Growth Partnership",
    message: "Not interested at this time. Please remove me from your list.",
    receivedAt: new Date(now - 45 * 60000), status: "read", interested: false,
  },
  {
    id: "r4", workspaceId: "w6", emailBisonId: "d44e01e4-9abc-4b98-87b0-112233445566",
    leadEmail: "anna.k@nordicventures.se", leadName: "Anna Karlsson",
    senderEmail: "contact@micronordic.com", campaign: "Nordic M&A Q1 2026",
    subject: "Re: Cross-border Acquisition",
    message: "Yes, we'd be open to a conversation. What does the target company's EBITDA look like? And is there an IM available?",
    receivedAt: new Date(now - 2 * 3600000), status: "new", interested: null,
  },
  {
    id: "r5", workspaceId: "w4", emailBisonId: "e55f01e4-def0-4b98-87b0-667788990011",
    leadEmail: "robert.hayes@triangleib.com", leadName: "Robert Hayes",
    senderEmail: "deals@hahnbeck.com", campaign: "UK Mid-Market M&A",
    subject: "Re: Sell-Side Mandate",
    message: "We reviewed the opportunity — the multiples seem high for the sector. What's the rationale for the valuation?",
    receivedAt: new Date(now - 4 * 3600000), status: "read", interested: null,
  },
  {
    id: "r6", workspaceId: "w2", emailBisonId: "f66a01e4-1111-4b98-87b0-aabbccddeeff",
    leadEmail: "diana.wu@apexcap.hk", leadName: "Diana Wu",
    senderEmail: "outreach@actcapital.com", campaign: "Asia Pacific Buyout — Q1",
    subject: "Re: Strategic Acquisition Target",
    message: "Forwarded to our deal team. Someone will be in touch within 48 hours. Thank you.",
    receivedAt: new Date(now - 5 * 3600000), status: "read", interested: true,
  },
  {
    id: "r7", workspaceId: "w10", emailBisonId: "g77b01e4-2222-4b98-87b0-112244336655",
    leadEmail: "tom.b@maplefinance.ca", leadName: "Tom Bouchard",
    senderEmail: "deals@wrobelcapital.com", campaign: "Canada Mid-Market Buy Side",
    subject: "Re: Buy-Side Opportunity",
    message: "We're actively looking in the $10-50M EBITDA range. Let's talk. When are you free this week?",
    receivedAt: new Date(now - 6 * 3600000), status: "new", interested: null,
  },
  {
    id: "r8", workspaceId: "w12", emailBisonId: "h88c01e4-3333-4b98-87b0-aaccbbddee11",
    leadEmail: "james.o@itggroup.com", leadName: "James O'Brien",
    senderEmail: "contact@itggroup.com", campaign: "US LBO Pipeline — March",
    subject: "Re: LBO Target — Manufacturing",
    message: "Interesting space. Can you share the CIM? We'd want to look at the customer concentration data.",
    receivedAt: new Date(now - 8 * 3600000), status: "new", interested: null,
  },
  {
    id: "r9", workspaceId: "w13", emailBisonId: "i99d01e4-4444-4b98-87b0-bbddccaaffee",
    leadEmail: "priya.nair@techfund.com", leadName: "Priya Nair",
    senderEmail: "outreach@sonaroai.com", campaign: "AI Startup Outreach Q1",
    subject: "Re: AI Partnership Opportunity",
    message: "Not the right fit for our current fund strategy. Thanks anyway.",
    receivedAt: new Date(now - 10 * 3600000), status: "read", interested: false,
  },
  {
    id: "r10", workspaceId: "w11", emailBisonId: "j00e01e4-5555-4b98-87b0-cceebb001122",
    leadEmail: "carlos.m@summitadv.mx", leadName: "Carlos Mendez",
    senderEmail: "outreach@zenithglobal.com", campaign: "LATAM M&A Outreach",
    subject: "Re: Cross-border Deal Flow",
    message: "We have been looking at similar targets in the region. Can we schedule a call to discuss further?",
    receivedAt: new Date(now - 12 * 3600000), status: "new", interested: null,
  },
  {
    id: "r11", workspaceId: "w3", emailBisonId: "k11f01e4-6666-4b98-87b0-ddeeff223344",
    leadEmail: "erik.l@bergstrom.se", leadName: "Erik Lindqvist",
    senderEmail: "contact@acceler8rs.com", campaign: "Startup Accelerator Outreach",
    subject: "Re: Accelerator Partnership",
    message: "We already have a partner on this. Please remove me.",
    receivedAt: new Date(now - 14 * 3600000), status: "read", interested: false,
  },
  {
    id: "r12", workspaceId: "w5", emailBisonId: "l22g01e4-7777-4b98-87b0-eeff00112233",
    leadEmail: "kevin.p@harborcap.com", leadName: "Kevin Park",
    senderEmail: "outreach@911restoration.com", campaign: "Franchise Expansion Outreach",
    subject: "Re: Franchise Opportunity",
    message: "Good timing. We've been looking at expanding in this sector. What's the investment range?",
    receivedAt: new Date(now - 16 * 3600000), status: "new", interested: null,
  },
  {
    id: "r13", workspaceId: "w7", emailBisonId: "m33h01e4-8888-4b98-87b0-ffee11223344",
    leadEmail: "sarah.j@motiontech.com", leadName: "Sarah Johnson",
    senderEmail: "outreach@gnmotion.com", campaign: "Motion Tech Partnerships",
    subject: "Re: Technology Partnership",
    message: "Yes, Wednesday at 2pm works perfectly for me. Looking forward to it!",
    receivedAt: new Date(now - 20 * 3600000), status: "new", interested: null,
  },
  {
    id: "r14", workspaceId: "w14", emailBisonId: "n44i01e4-9999-4b98-87b0-aabb22334455",
    leadEmail: "mark.w@zebsibs.com", leadName: "Mark Wilson",
    senderEmail: "outreach@zebsibs.com", campaign: "IBS Solutions Outreach",
    subject: "Re: Business Solutions",
    message: "Can you send more information? We're evaluating several options right now.",
    receivedAt: new Date(now - 22 * 3600000), status: "read", interested: null,
  },
];

export const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: "n1", replyId: "r1", workspaceId: "w9", event: "reply_received",
    leadName: "Joel Landis", leadEmail: "JLandis@woodrock.com",
    campaign: "Houston Texas Sell Side",
    snippet: "Ok, are you able to do that time: 1:30pm CT, but on Wednesday?",
    receivedAt: new Date(now - 3 * 60000), read: false,
  },
  {
    id: "n2", replyId: "r2", workspaceId: "w8", event: "reply_received",
    leadName: "Michael Chen", leadEmail: "michael.chen@peakpartners.com",
    campaign: "West Coast PE — March 2026",
    snippet: "This looks interesting. Can you send over more details about the deal structure?",
    receivedAt: new Date(now - 18 * 60000), read: false,
  },
  {
    id: "n3", replyId: "r4", workspaceId: "w6", event: "reply_received",
    leadName: "Anna Karlsson", leadEmail: "anna.k@nordicventures.se",
    campaign: "Nordic M&A Q1 2026",
    snippet: "Yes, we'd be open to a conversation. What does the EBITDA look like?",
    receivedAt: new Date(now - 2 * 3600000), read: false,
  },
  {
    id: "n4", replyId: "r7", workspaceId: "w10", event: "reply_received",
    leadName: "Tom Bouchard", leadEmail: "tom.b@maplefinance.ca",
    campaign: "Canada Mid-Market Buy Side",
    snippet: "We're actively looking in the $10-50M EBITDA range. Let's talk.",
    receivedAt: new Date(now - 6 * 3600000), read: false,
  },
  {
    id: "n5", replyId: "r8", workspaceId: "w12", event: "reply_received",
    leadName: "James O'Brien", leadEmail: "james.o@itggroup.com",
    campaign: "US LBO Pipeline — March",
    snippet: "Interesting space. Can you share the CIM? We'd want customer concentration data.",
    receivedAt: new Date(now - 8 * 3600000), read: false,
  },
  {
    id: "n6", replyId: "r10", workspaceId: "w11", event: "reply_received",
    leadName: "Carlos Mendez", leadEmail: "carlos.m@summitadv.mx",
    campaign: "LATAM M&A Outreach",
    snippet: "We have been looking at similar targets. Can we schedule a call?",
    receivedAt: new Date(now - 12 * 3600000), read: false,
  },
  {
    id: "n7", replyId: "r12", workspaceId: "w5", event: "reply_received",
    leadName: "Kevin Park", leadEmail: "kevin.p@harborcap.com",
    campaign: "Franchise Expansion Outreach",
    snippet: "Good timing. We've been looking at expanding. What's the investment range?",
    receivedAt: new Date(now - 16 * 3600000), read: false,
  },
  {
    id: "n8", replyId: "r13", workspaceId: "w7", event: "reply_received",
    leadName: "Sarah Johnson", leadEmail: "sarah.j@motiontech.com",
    campaign: "Motion Tech Partnerships",
    snippet: "Yes, Wednesday at 2pm works perfectly for me. Looking forward to it!",
    receivedAt: new Date(now - 20 * 3600000), read: false,
  },
  {
    id: "n9", replyId: "r14", workspaceId: "w14", event: "reply_received",
    leadName: "Mark Wilson", leadEmail: "mark.w@zebsibs.com",
    campaign: "IBS Solutions Outreach",
    snippet: "Can you send more information? We're evaluating several options right now.",
    receivedAt: new Date(now - 22 * 3600000), read: false,
  },
  {
    id: "n10", replyId: "r6", workspaceId: "w2", event: "marked_interested",
    leadName: "Diana Wu", leadEmail: "diana.wu@apexcap.hk",
    campaign: "Asia Pacific Buyout — Q1",
    snippet: "Forwarded to our deal team. Someone will be in touch within 48 hours.",
    receivedAt: new Date(now - 5 * 3600000), read: true,
  },
  {
    id: "n11", replyId: "r3", workspaceId: "w1", event: "marked_not_interested",
    leadName: "Sandeep Patel", leadEmail: "s.patel@ridgecap.com",
    campaign: "SaaS Founders Outreach",
    snippet: "Not interested at this time. Please remove me from your list.",
    receivedAt: new Date(now - 45 * 60000), read: true,
  },
  {
    id: "n12", replyId: "r5", workspaceId: "w4", event: "reply_received",
    leadName: "Robert Hayes", leadEmail: "robert.hayes@triangleib.com",
    campaign: "UK Mid-Market M&A",
    snippet: "The multiples seem high for the sector. What's the rationale for the valuation?",
    receivedAt: new Date(now - 4 * 3600000), read: true,
  },
];
