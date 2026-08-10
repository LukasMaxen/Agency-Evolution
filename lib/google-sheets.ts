// Minimal Google Sheets client — service account JWT auth via raw fetch, matching the
// rest of the codebase's style (no SDKs; see lib/calendly.ts, lib/airtable-meetings.ts).
// Used by lib/reports/larsen-weekly.ts to write the Larsen Outreach Tracking sheet.

import crypto from "crypto";

const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL ?? "";

// Different env-var UIs mangle the \n-escaped private key differently (some preserve it
// literally as we store it locally, some double-escape the backslash, some strip wrapping
// quotes, some don't). Normalize defensively rather than relying on exact platform behavior.
function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");
  return key;
}

const PRIVATE_KEY = normalizePrivateKey(process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? "");

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  if (!CLIENT_EMAIL || !PRIVATE_KEY) throw new Error("GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY not set");
  if (!PRIVATE_KEY.startsWith("-----BEGIN") || !PRIVATE_KEY.includes("-----END")) {
    throw new Error(
      `GOOGLE_SHEETS_PRIVATE_KEY does not look like a valid PEM key after normalization ` +
      `(starts with "${PRIVATE_KEY.slice(0, 15)}", length ${PRIVATE_KEY.length}, ` +
      `has real newlines: ${PRIVATE_KEY.includes("\n")}) — check how it was pasted into the host's env var UI`
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = b64url(signer.sign(PRIVATE_KEY));
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token exchange failed: ${JSON.stringify(data).slice(0, 300)}`);
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

export interface ValueRangeUpdate {
  range: string; // e.g. "'Weekly Tracking 2026'!C5:D5"
  values: (number | string)[][];
}

/**
 * Writes multiple value ranges to a spreadsheet in one batch request.
 * Uses RAW value input (no formula parsing needed, we only ever write numbers).
 */
export async function batchUpdateValues(spreadsheetId: string, updates: ValueRangeUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const token = await getAccessToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: updates.map((u) => ({ range: u.range, values: u.values })),
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets batchUpdate failed: ${res.status} ${text.slice(0, 300)}`);
  }
}

export async function getValues(spreadsheetId: string, range: string): Promise<any[][]> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets get failed: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return data.values ?? [];
}
