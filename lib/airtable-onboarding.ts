// Client onboarding intake — writes Tally "Onboarding" form submissions into the
// "Clients" table in the Onboarding Library Airtable base. Fired from
// app/api/webhook/tally/route.ts on every FORM_RESPONSE webhook event.
//
// Tally form: https://tally.so (workspace "n94E1V", form id "VL6Oj6", named "Onboarding").
// Airtable: base "Onboarding Library" (appuCgt56sLClKqED), table "Clients" (tblZlkmvegxDCe4A0).
//
// Maps by question label (not block id) so the mapping survives Tally form edits that
// don't change question wording. Upserts by Tally submission id so webhook retries
// don't create duplicate rows.

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY ?? "";
const BASE_ID = "appuCgt56sLClKqED";
const TABLE_ID = "tblZlkmvegxDCe4A0";

async function airtable(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`airtable ${method} ${path.split("?")[0]} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export interface TallyField {
  key: string;
  label: string;
  type: string;
  value: unknown;
  options?: { id: string; text: string }[];
}

export interface TallySubmission {
  responseId?: string;
  submissionId?: string;
  formId?: string;
  formName?: string;
  createdAt?: string;
  fields: TallyField[];
}

// Resolves a CHECKBOXES/MULTIPLE_CHOICE field's selected option id(s) to their text label(s),
// using the option list Tally includes on the field itself. Falls back to the raw value if
// no options array is present (defensive — Tally's exact webhook shape isn't publicly documented).
function resolveChoiceText(field: TallyField | undefined): string[] {
  if (!field || field.value == null) return [];
  const raw = Array.isArray(field.value) ? field.value : [field.value];
  if (!field.options?.length) return raw.map(String);
  const byId = new Map(field.options.map(o => [o.id, o.text]));
  return raw.map(v => byId.get(String(v)) ?? String(v));
}

function text(field: TallyField | undefined): string {
  if (!field || field.value == null) return "";
  return Array.isArray(field.value) ? field.value.join(", ") : String(field.value);
}

function firstFileUrl(field: TallyField | undefined): string | null {
  const v = field?.value;
  if (!Array.isArray(v) || v.length === 0) return null;
  const f = v[0] as any;
  return typeof f?.url === "string" ? f.url : null;
}

/**
 * Upserts a Tally onboarding submission into the Clients table. Best-effort: throws on
 * hard failures (missing API key, Airtable errors) so the webhook route can log them —
 * callers should still always return 200 to Tally regardless of the outcome here.
 */
export async function upsertClientFromSubmission(sub: TallySubmission): Promise<{ created: boolean; recordId: string }> {
  if (!AIRTABLE_API_KEY) throw new Error("missing AIRTABLE_API_KEY");

  const byLabel = new Map(sub.fields.map(f => [f.label.trim(), f]));
  const get = (label: string) => byLabel.get(label);

  const submissionId = sub.submissionId || sub.responseId || "";

  const fields: Record<string, unknown> = {
    "Company Name": text(get("Company / brand name")),
    "Contact Name": text(get("Your name")),
    "Contact Email": text(get("Your email address")),
    "Submitted At": sub.createdAt || new Date().toISOString(),
    "Campaign Sender": text(get("Who is the sender for this campaign?")),
    "Reply Call Handler": text(get("Who takes the call after a lead replies?")),
    "Call Booking Methods": resolveChoiceText(get("How should leads book a call?")),
    "Phone vs Online": resolveChoiceText(get("Are you open to phone calls or strictly online meetings?"))[0] || undefined,
    "Lead Offer": text(get("What is the offer we lead with in outreach?")),
    "Offer - Never Imply": text(get("What should never be implied or assumed about the offer?")),
    "Case Study 1": text(get("Share your strongest case study.")),
    "Case Study 2": text(get("Case study two")),
    "Case Study 3": text(get("Case study three")),
    "Target ICP": text(get("Who are we targeting?")),
    "Never Contact": text(get("Who should we never contact?")),
    "Referenceable Names": text(get("Which client or brand names can we reference in outreach?")),
    "Names Never Mentioned": text(get("Which names should never be mentioned?")),
    "Never Say / Imply / Promise": text(get("What should we never say, imply, or promise?")),
    "Compliance Requirements?": resolveChoiceText(get("Are there compliance or regulatory requirements?"))[0] || undefined,
    "Compliance Details": text(get("Describe the compliance requirements.")),
    "Qualified Lead Definition": text(get("What does a qualified lead look like?")),
    "Common Objections & Responses": text(get("What are the most common objections leads raise and what is the approved response to each?")),
    "Past Issues / Embarrassments": text(get("Has anything caused problems or embarrassment in past outreach?")),
    "Calendar Platform": resolveChoiceText(get("Which calendar platform do you use?"))[0] || undefined,
    "Primary Booking Link": text(get("Paste your primary booking link.")),
    "Meeting Tracking Access": text(get("Share API access or admin details for meeting tracking.")),
    "Tally Submission ID": submissionId,
  };

  const photoUrl = firstFileUrl(get("Sender profile photo"));
  if (photoUrl) fields["Sender Profile Photo"] = [{ url: photoUrl }];

  // Drop empty/undefined values so we don't overwrite manual edits with blanks on retry.
  for (const k of Object.keys(fields)) {
    const v = fields[k];
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete fields[k];
  }

  let existingId: string | null = null;
  if (submissionId) {
    const formula = `{Tally Submission ID} = "${submissionId.replace(/"/g, '\\"')}"`;
    const found = await airtable("GET", `?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`);
    existingId = found?.records?.[0]?.id ?? null;
  }

  if (existingId) {
    await airtable("PATCH", "", { records: [{ id: existingId, fields }], typecast: true });
    return { created: false, recordId: existingId };
  }

  fields["Client Status"] = "Onboarding In Progress";
  const created = await airtable("POST", "", { records: [{ fields }], typecast: true });
  return { created: true, recordId: created.records[0].id };
}
