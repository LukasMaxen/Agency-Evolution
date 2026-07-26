import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/account-monitor/diagnostics?sender_email=x&workspace_slug=y&days=30
//
// Returns normalized bounce/burn diagnostic events for a specific sender.
// Parses raw bounce_reason text to surface SMTP codes, auth failures,
// blocklist indicators so operators can diagnose account failures without
// opening EmailBison or reading raw logs.

function parseSmtpCode(reason: string | null): string {
  if (!reason) return "Unknown";
  const match = reason.match(/\b([45]\d{2})\b/);
  return match ? match[1] : "Unknown";
}

function parseSmtpMessage(reason: string | null): string {
  if (!reason) return "Unknown";
  // Return the first line or the full string up to 300 chars.
  return reason.split(/\r?\n/)[0].slice(0, 300) || "Unknown";
}

function parseAuthFailures(reason: string | null): string[] {
  if (!reason) return [];
  const r = reason.toLowerCase();
  const found: string[] = [];
  if (/\bspf\b/.test(r) && /(fail|reject|none|neutral|softfail|temperror|permerror)/.test(r)) found.push("SPF");
  if (/\bdkim\b/.test(r) && /(fail|reject|none|neutral|invalid|error|missing|not found)/.test(r)) found.push("DKIM");
  if (/\bdmarc\b/.test(r) && /(fail|reject|quarantine|policy)/.test(r)) found.push("DMARC");
  return found;
}

function parseBlocklistIndicators(reason: string | null): string[] {
  if (!reason) return [];
  const r = reason.toLowerCase();
  const found: string[] = [];
  if (/\bblacklist(ed)?\b|\blisted\b/.test(r)) found.push("Blacklisted");
  if (/\bspam\b/.test(r))                       found.push("Spam classification");
  if (/\bbarracuda\b/.test(r))                  found.push("Barracuda block");
  if (/\bmimecast\b/.test(r))                   found.push("Mimecast block");
  if (/\bproofpoint\b/.test(r))                 found.push("Proofpoint block");
  if (/\bspamhaus\b/.test(r))                   found.push("Spamhaus");
  if (/\bbl\.spamcop\b/.test(r))                found.push("SpamCop");
  if (/\bsorbs\b/.test(r))                      found.push("SORBS");
  return found;
}

export interface DiagnosticEvent {
  id:                   string;
  classification:       "Bounce" | "Burn";
  timestamp:            string;
  lead_email:           string;
  lead_name:            string;
  campaign:             string;
  sender:               string;
  domain:               string;
  smtp_code:            string;
  smtp_message:         string;
  bounce_type:          string;
  bounce_category:      string;
  subject:              string;
  provider:             string;
  auth_failures:        string[];
  blocklist_indicators: string[];
  raw_reason:           string | null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const senderEmail   = searchParams.get("sender_email");
  const workspaceSlug = searchParams.get("workspace_slug");
  const days          = Math.min(Math.max(parseInt(searchParams.get("days") ?? "30"), 1), 90);

  if (!senderEmail || !workspaceSlug) {
    return NextResponse.json({ error: "sender_email and workspace_slug are required" }, { status: 400 });
  }

  try {
    const result = await pool.query<{
      id:               string;
      workspace_slug:   string;
      lead_email:       string | null;
      lead_name:        string | null;
      campaign_name:    string | null;
      sender_email:     string | null;
      bounce_type:      string | null;
      bounce_category:  string | null;
      bounced_at:       Date;
      bounce_subject:   string | null;
      bounce_reason:    string | null;
      provider:         string | null;
    }>(
      `SELECT
         id, workspace_slug, lead_email, lead_name,
         campaign_name, sender_email, bounce_type, bounce_category,
         bounced_at, bounce_subject, bounce_reason, provider
       FROM email_bounces
       WHERE workspace_slug = $1
         AND sender_email   = $2
         AND bounced_at >= NOW() - ($3 || ' days')::interval
       ORDER BY bounced_at DESC
       LIMIT 100`,
      [workspaceSlug, senderEmail.toLowerCase(), days]
    );

    const diagnostics: DiagnosticEvent[] = result.rows.map(r => {
      const isBurn = r.bounce_category === "domain_burn";
      const domain = r.sender_email?.split("@")[1] ?? "Unknown";
      return {
        id:                   String(r.id),
        classification:       isBurn ? "Burn" : "Bounce",
        timestamp:            r.bounced_at.toISOString(),
        lead_email:           r.lead_email   ?? "Unknown",
        lead_name:            r.lead_name    ?? "Unknown",
        campaign:             r.campaign_name ?? "Unknown",
        sender:               r.sender_email  ?? senderEmail,
        domain,
        smtp_code:            parseSmtpCode(r.bounce_reason),
        smtp_message:         parseSmtpMessage(r.bounce_reason),
        bounce_type:          r.bounce_type     ?? "Unknown",
        bounce_category:      r.bounce_category ?? "Unknown",
        subject:              r.bounce_subject  ?? "Unknown",
        provider:             r.provider        ?? "Unknown",
        auth_failures:        parseAuthFailures(r.bounce_reason),
        blocklist_indicators: parseBlocklistIndicators(r.bounce_reason),
        raw_reason:           r.bounce_reason ?? null,
      };
    });

    const burns   = diagnostics.filter(d => d.classification === "Burn").length;
    const bounces = diagnostics.filter(d => d.classification === "Bounce").length;

    return NextResponse.json({ diagnostics, summary: { burns, bounces, total: diagnostics.length }, days });
  } catch (err: any) {
    console.error("[account-monitor/diagnostics]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
