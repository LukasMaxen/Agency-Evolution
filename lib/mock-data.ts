export type Workspace = {
  id: string;
  name: string;
  slug: string;
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
  message: string;
  receivedAt: Date;
  read: boolean;
  aiAnalysis?: AIAnalysis;
};

// ─── Workspaces ───────────────────────────────────────────────────────────────

export const WORKSPACES: Workspace[] = [
  { id: "w1",  name: "Larsen Digital",   slug: "larsen-digital",   color: "#185FA5", initials: "LD", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w2",  name: "ACT Capital",      slug: "act-capital",      color: "#0F6E56", initials: "AC", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w3",  name: "Acceler8rs",       slug: "acceler8rs",       color: "#7C3AED", initials: "A8", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w4",  name: "Hahnbeck",         slug: "hahnbeck",         color: "#B45309", initials: "HB", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w5",  name: "911 Restoration",  slug: "911-restoration",  color: "#DC2626", initials: "9R", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w6",  name: "Micro Nordic",     slug: "micro-nordic",     color: "#533AB7", initials: "MN", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w7",  name: "GN Motion",        slug: "gn-motion",        color: "#0369A1", initials: "GN", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w8",  name: "Statera Capital",  slug: "statera-capital",  color: "#0F6E56", initials: "SC", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w9",  name: "Venture Exits",    slug: "venture-exits",    color: "#185FA5", initials: "VE", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w10", name: "Wrobel Capital",   slug: "wrobel-capital",   color: "#9D174D", initials: "WC", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w11", name: "Zenith Global",    slug: "zenith-global",    color: "#065F46", initials: "ZG", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w12", name: "ITG Group",        slug: "itg-group",        color: "#1E3A5F", initials: "IT", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w13", name: "Sonaro AI",        slug: "sonaro-ai",        color: "#6D28D9", initials: "SA", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w14", name: "Zebs IBS",         slug: "zebs-ibs",         color: "#92400E", initials: "ZI", instanceUrl: "https://send.emailagencyevolution.com" },
  { id: "w15", name: "SRO Consulting",   slug: "sro-consulting",   color: "#0F766E", initials: "SR", instanceUrl: "https://send.emailagencyevolution.com" },
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

// ─── Empty — real data comes from DB ─────────────────────────────────────────

export const MOCK_REPLIES: Reply[] = [];
export const MOCK_NOTIFICATIONS: Notification[] = [];