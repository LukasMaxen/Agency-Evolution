import { NextRequest, NextResponse } from "next/server";
import { getLeadCompanyContext, resolveLeadDomain } from "@/lib/fetch-lead-website";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email") ?? "";
  const domain = resolveLeadDomain({ leadEmail: email });
  if (!domain) return NextResponse.json({ error: "no domain", email });
  try {
    const ctx = await getLeadCompanyContext(domain);
    return NextResponse.json({ domain, ctx });
  } catch (err: any) {
    return NextResponse.json({ domain, error: err?.message ?? String(err), stack: err?.stack?.slice(0, 2000) }, { status: 500 });
  }
}
