// ─── Dashboard Data Types ─────────────────────────────────────────────────────

export type DashboardReply = {
  id: string;
  name: string;
  email: string;
  client: string;
  workspaceId: string;
  message: string;
  date: Date;
  type: "interested" | "not_interested" | "neutral";
};

export type FollowUpLead = {
  id: string;
  name: string;
  email: string;
  client: string;
  workspaceId: string;
  firstReplied: Date;
  lastFUSent: Date;
  fuStep: number;
  totalEmails: number;
  nextFUDue: Date;
};

export type MeetingLead = {
  id: string;
  name: string;
  email: string;
  client: string;
  workspaceId: string;
  firstReplied: Date;
  totalEmails: number;
  meetingDate: Date;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, 0, 0, 0);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(10, 0, 0, 0);
  return d;
}

// ─── All Replies (last 30 days) ───────────────────────────────────────────────

export const DASHBOARD_REPLIES: DashboardReply[] = [
  // Today
  { id: "dr1",  name: "Joel Landis",         email: "JLandis@woodrock.com",          client: "Venture Exits",    workspaceId: "w9",  message: "Ok, are you able to do 1:30pm CT on Wednesday?",                         date: daysAgo(0),  type: "interested" },
  { id: "dr2",  name: "Helen Denise",         email: "hdenise@knowhen.com",           client: "Acceler8rs",       workspaceId: "w3",  message: "This looks interesting, can you share more details?",                   date: daysAgo(0),  type: "interested" },
  { id: "dr3",  name: "Christian Muschick",   email: "c.muschick@navigato.com",       client: "Agency Evolution", workspaceId: "w1",  message: "Yes we'd be open to a conversation.",                                   date: daysAgo(0),  type: "interested" },
  { id: "dr4",  name: "Priya Nair",           email: "priya.nair@solarispe.com",      client: "Statera Capital",  workspaceId: "w8",  message: "Not the right fit for our current strategy. Thanks.",                  date: daysAgo(0),  type: "not_interested" },
  { id: "dr5",  name: "Erik Lindqvist",       email: "erik.l@bergstrom.se",           client: "Micro Nordic",     workspaceId: "w6",  message: "We already have a banker on this. Please remove me.",                  date: daysAgo(0),  type: "not_interested" },
  // Yesterday
  { id: "dr6",  name: "Michael Chen",         email: "michael.chen@peakpartners.com", client: "Statera Capital",  workspaceId: "w8",  message: "Can you send deal structure details and timeline?",                    date: daysAgo(1),  type: "interested" },
  { id: "dr7",  name: "Robert Hayes",         email: "robert.hayes@triangleib.com",  client: "Hahnbeck",         workspaceId: "w4",  message: "Multiples seem high. What's the rationale for valuation?",            date: daysAgo(1),  type: "neutral" },
  // 2 days ago
  { id: "dr8",  name: "Anna Karlsson",        email: "anna.k@nordicventures.se",      client: "Micro Nordic",     workspaceId: "w6",  message: "What does the target EBITDA look like? Is there an IM?",              date: daysAgo(2),  type: "interested" },
  { id: "dr9",  name: "Sandeep Patel",        email: "s.patel@ridgecap.com",          client: "Venture Exits",    workspaceId: "w9",  message: "Not interested at this time. Please remove me.",                       date: daysAgo(2),  type: "not_interested" },
  // 3 days ago
  { id: "dr10", name: "Carlos Mendez",        email: "carlos.m@summitadv.mx",         client: "Statera Capital",  workspaceId: "w8",  message: "We've been looking at similar targets. Can we schedule a call?",     date: daysAgo(3),  type: "interested" },
  { id: "dr11", name: "Diana Wu",             email: "diana.wu@apexcap.hk",           client: "ACT Capital",      workspaceId: "w2",  message: "Forwarded to deal team. In touch within 48 hours.",                   date: daysAgo(3),  type: "interested" },
  // 5 days ago
  { id: "dr12", name: "Kevin Park",           email: "kevin.p@harborcap.com",         client: "Acceler8rs",       workspaceId: "w3",  message: "Good timing. What's the asking price range?",                         date: daysAgo(5),  type: "interested" },
  { id: "dr13", name: "Tom Bouchard",         email: "tom.b@maplefinance.ca",         client: "Venture Exits",    workspaceId: "w9",  message: "Actively looking $10-50M EBITDA. Let's talk.",                        date: daysAgo(5),  type: "interested" },
  // 7 days ago
  { id: "dr14", name: "Jay",                  email: "jay@gffl.pro",                  client: "Acceler8rs",       workspaceId: "w3",  message: "Interested, what's the next step?",                                   date: daysAgo(7),  type: "interested" },
  { id: "dr15", name: "William",              email: "will@reloptix.net",             client: "Acceler8rs",       workspaceId: "w3",  message: "Could you share a case study? Looks promising.",                      date: daysAgo(7),  type: "interested" },
  { id: "dr16", name: "Sarah Lee",            email: "s.lee@whitepeak.com",           client: "Hahnbeck",         workspaceId: "w4",  message: "We don't look at deals below £20M EBITDA.",                           date: daysAgo(7),  type: "not_interested" },
  // 10-15 days ago
  { id: "dr17", name: "Ashley",               email: "aciccel@higherinnova.com",      client: "Acceler8rs",       workspaceId: "w3",  message: "This aligns with what we're looking for. Can we talk?",              date: daysAgo(10), type: "interested" },
  { id: "dr18", name: "Elliot Justin",        email: "elliot@myfirmtech.com",         client: "Acceler8rs",       workspaceId: "w3",  message: "Send me more info and I'll share with the team.",                     date: daysAgo(12), type: "interested" },
  { id: "dr19", name: "David Torres",         email: "d.torres@meridianib.com",       client: "ACT Capital",      workspaceId: "w2",  message: "Currently not looking. Thanks anyway.",                               date: daysAgo(14), type: "not_interested" },
  { id: "dr20", name: "Valery Zolotukhin",    email: "vz@impact-capital.com",         client: "Agency Evolution", workspaceId: "w1",  message: "Looks like an interesting opportunity. Tell me more.",               date: daysAgo(15), type: "interested" },
  // 20-30 days ago
  { id: "dr21", name: "Chiaretto Calo",       email: "chiaretto.calo@blueci.com",     client: "Agency Evolution", workspaceId: "w1",  message: "Open to hearing more about the deal.",                               date: daysAgo(20), type: "interested" },
  { id: "dr22", name: "Ben Wrede",            email: "ben.wrede@saaripart.com",       client: "Agency Evolution", workspaceId: "w1",  message: "We'd consider this. What's the revenue profile?",                    date: daysAgo(21), type: "interested" },
  { id: "dr23", name: "Vittorio Terzi",       email: "vittorio.terzi@terzian.com",    client: "Agency Evolution", workspaceId: "w1",  message: "Interesting. Can you share EBITDA and margin data?",               date: daysAgo(24), type: "interested" },
  { id: "dr24", name: "Mark Wilson",          email: "mark.w@zebsibs.com",            client: "Venture Exits",    workspaceId: "w9",  message: "Can you send more information? Evaluating several options.",         date: daysAgo(28), type: "neutral" },
];

// ─── Follow-up Queue ──────────────────────────────────────────────────────────

export const FOLLOW_UP_LEADS: FollowUpLead[] = [
  // Overdue
  { id: "fu1", name: "Ben Wrede",          email: "ben.wrede@saaripart.com",      client: "Agency Evolution", workspaceId: "w1", firstReplied: daysAgo(21), lastFUSent: daysAgo(14), fuStep: 2, totalEmails: 3, nextFUDue: daysAgo(7) },
  { id: "fu2", name: "Vittorio Terzi",     email: "vittorio.terzi@terzian.com",   client: "Agency Evolution", workspaceId: "w1", firstReplied: daysAgo(24), lastFUSent: daysAgo(17), fuStep: 3, totalEmails: 4, nextFUDue: daysAgo(10) },
  { id: "fu3", name: "Tom Bouchard",       email: "tom.b@maplefinance.ca",        client: "Venture Exits",    workspaceId: "w9", firstReplied: daysAgo(19), lastFUSent: daysAgo(12), fuStep: 2, totalEmails: 3, nextFUDue: daysAgo(5) },
  // Due today
  { id: "fu4", name: "Joel Landis",        email: "JLandis@woodrock.com",         client: "Venture Exits",    workspaceId: "w9", firstReplied: daysAgo(7),  lastFUSent: daysAgo(7),  fuStep: 1, totalEmails: 2, nextFUDue: daysAgo(0) },
  { id: "fu5", name: "Christian Muschick", email: "c.muschick@navigato.com",      client: "Agency Evolution", workspaceId: "w1", firstReplied: daysAgo(7),  lastFUSent: daysAgo(7),  fuStep: 1, totalEmails: 2, nextFUDue: daysAgo(0) },
  { id: "fu6", name: "Helen Denise",       email: "hdenise@knowhen.com",          client: "Acceler8rs",       workspaceId: "w3", firstReplied: daysAgo(7),  lastFUSent: daysAgo(7),  fuStep: 1, totalEmails: 2, nextFUDue: daysAgo(0) },
  // This week
  { id: "fu7", name: "Anna Karlsson",      email: "anna.k@nordicventures.se",     client: "Micro Nordic",     workspaceId: "w6", firstReplied: daysAgo(5),  lastFUSent: daysAgo(5),  fuStep: 1, totalEmails: 2, nextFUDue: daysFromNow(2) },
  { id: "fu8", name: "Jay",                email: "jay@gffl.pro",                 client: "Acceler8rs",       workspaceId: "w3", firstReplied: daysAgo(5),  lastFUSent: daysAgo(5),  fuStep: 1, totalEmails: 2, nextFUDue: daysFromNow(2) },
  { id: "fu9", name: "Robert Hayes",       email: "robert.hayes@triangleib.com",  client: "Hahnbeck",         workspaceId: "w4", firstReplied: daysAgo(3),  lastFUSent: daysAgo(3),  fuStep: 1, totalEmails: 2, nextFUDue: daysFromNow(4) },
  // Upcoming
  { id: "fu10", name: "Michael Chen",      email: "michael.chen@peakpartners.com",client: "Statera Capital",  workspaceId: "w8", firstReplied: daysAgo(1),  lastFUSent: daysAgo(1),  fuStep: 1, totalEmails: 2, nextFUDue: daysFromNow(6) },
  { id: "fu11", name: "Ashley",            email: "aciccel@higherinnova.com",     client: "Acceler8rs",       workspaceId: "w3", firstReplied: daysAgo(2),  lastFUSent: daysAgo(2),  fuStep: 1, totalEmails: 2, nextFUDue: daysFromNow(5) },
];

// ─── Meetings Booked ──────────────────────────────────────────────────────────

export const MEETING_LEADS: MeetingLead[] = [
  { id: "ml1", name: "Jan-Philipp Matthewes", email: "jpm@lama.partners",       client: "Agency Evolution", workspaceId: "w1", firstReplied: daysAgo(28), totalEmails: 4, meetingDate: daysFromNow(1) },
  { id: "ml2", name: "Pascal Riviere",        email: "Pascal.RIVIERE@soci.com", client: "Agency Evolution", workspaceId: "w1", firstReplied: daysAgo(26), totalEmails: 3, meetingDate: daysFromNow(5) },
  { id: "ml3", name: "Awa",                   email: "awa@n-umorigins.co",      client: "Acceler8rs",       workspaceId: "w3", firstReplied: daysAgo(17), totalEmails: 3, meetingDate: daysFromNow(4) },
  { id: "ml4", name: "Sarah Schmidt",         email: "s.schmidt@hmcapital.de",  client: "Hahnbeck",         workspaceId: "w4", firstReplied: daysAgo(22), totalEmails: 5, meetingDate: daysFromNow(2) },
  { id: "ml5", name: "Erik Svensson",         email: "e.svensson@nordicpe.se",  client: "Micro Nordic",     workspaceId: "w6", firstReplied: daysAgo(19), totalEmails: 4, meetingDate: daysFromNow(6) },
];

// ─── Workspace color map (for badges) ────────────────────────────────────────

export const WORKSPACE_COLORS: Record<string, string> = {
  w1: "#185FA5", w2: "#0F6E56", w3: "#7C3AED", w4: "#B45309",
  w5: "#DC2626", w6: "#533AB7", w7: "#0369A1", w8: "#0F6E56",
  w9: "#185FA5", w10: "#9D174D", w11: "#065F46", w12: "#1E3A5F",
  w13: "#6D28D9", w14: "#92400E",
};