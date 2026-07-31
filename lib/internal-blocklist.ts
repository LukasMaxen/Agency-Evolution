// Internal-contact blocklist.
//
// In the Larsen workspaces, Nicklas and Lukas are the SENDERS/reps, not leads. Their own
// addresses turn up as booking invitees (test bookings) and as reply participants, and we
// must never track them as interested replies or booked meetings (Kasper, 2026-07-31).
//
// Nicklas and Lukas rotate many sender domains, so we match on the name token in the local
// part of the address (and the display name) rather than a fixed address list. Scoped to
// the Larsen-family workspaces so a genuine lead named e.g. "Lukas" elsewhere is unaffected.

const LARSEN_WORKSPACES = new Set(["larsen-digital", "acceler8rs"]);

// Name tokens that identify our own people in the Larsen workspaces.
const INTERNAL_NAME_TOKENS = ["nicklas", "lukas", "lukasm", "nicklasl", "larsen.n", "larsen n"];

/** True if this email/name is one of our own people (Nicklas/Lukas) in a Larsen workspace. */
export function isInternalContact(workspaceSlug: string, email: string | null | undefined, name?: string | null): boolean {
  if (!LARSEN_WORKSPACES.has(workspaceSlug)) return false;
  const local = (email ?? "").toLowerCase().split("@")[0].replace(/[^a-z]/g, "");
  const nm = (name ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return INTERNAL_NAME_TOKENS.some(t => {
    const tok = t.replace(/[^a-z]/g, "");
    return local.includes(tok) || nm.includes(tok);
  });
}
