// Cold Email Leads tracker — writes Larsen Digital interested-reply leads into the
// shared "Cold Email Leads" Airtable table (same base as the Deals/Meetings tracker,
// see lib/meetings-tracker.ts). Fires once a reply is classified interested or
// interested_urgent for either Larsen sender workspace (larsen-digital / acceler8rs).
//
// Upserts by email (search first, matching the meetings-tracker pattern) so a lead
// who replies interested more than once updates the existing row instead of creating
// a duplicate.

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY ?? "";

export interface ColdLeadConfig {
  airtableBaseId: string;
  airtableTableId: string;
}

// Both Larsen sender workspaces share one Cold Email Leads table, same base as
// MEETING_CONFIG in lib/meetings-tracker.ts ("Larsen Nicklas/Lukas" in the
// "Larsen Digital 2" Airtable workspace).
const COLD_LEAD_CONFIG: Record<string, ColdLeadConfig> = {
  "larsen-digital": { airtableBaseId: "appp8h0kv9DEHYpXR", airtableTableId: "tbl8BPA1kQm3TqNLA" },
  "acceler8rs": { airtableBaseId: "appp8h0kv9DEHYpXR", airtableTableId: "tbl8BPA1kQm3TqNLA" },
};

async function airtable(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    method,
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`airtable ${method} ${path.split("?")[0]} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const isoDate = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

export interface InterestedLeadInput {
  workspaceSlug: string;
  leadEmail: string;
  leadName?: string | null;
}

/**
 * Upsert an interested-reply lead into the "Cold Email Leads" Airtable table.
 * No-ops for workspaces without a config entry (only Larsen's two sender workspaces
 * are wired up as of 2026-08-31). Search by email first — a lead who replies
 * interested more than once updates the existing row (Status back to "Interested
 * Reply") instead of duplicating it. Best-effort: never throws.
 */
export async function trackInterestedLead(input: InterestedLeadInput): Promise<boolean> {
  const cfg = COLD_LEAD_CONFIG[input.workspaceSlug];
  if (!cfg) return false;
  if (!AIRTABLE_API_KEY) { console.warn("[cold-leads] missing AIRTABLE_API_KEY"); return false; }
  const email = (input.leadEmail || "").trim();
  if (!email) return false;

  const tbl = `${cfg.airtableBaseId}/${encodeURIComponent(cfg.airtableTableId)}`;
  try {
    const formula = `LOWER({Email}) = LOWER("${email.replace(/"/g, '\\"')}")`;
    const found = await airtable("GET", `${tbl}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`);
    const existing = found?.records?.[0];

    if (!existing) {
      await airtable("POST", tbl, {
        records: [{
          fields: {
            Email: email,
            "Full Name": input.leadName || "",
            Status: "Interested Reply",
            "Capture Source": "Cold Email",
            "Lead added date": isoDate(),
          },
        }],
        typecast: true,
      });
      console.log(`[cold-leads] created (${input.workspaceSlug}) ${email}`);
    } else {
      await airtable("PATCH", tbl, {
        records: [{ id: existing.id, fields: { Status: "Interested Reply" } }],
        typecast: true,
      });
      console.log(`[cold-leads] updated status (${input.workspaceSlug}) ${email}`);
    }
    return true;
  } catch (err: any) {
    console.error(`[cold-leads] failed ${input.workspaceSlug}/${email}:`, err?.message ?? err);
    return false;
  }
}
