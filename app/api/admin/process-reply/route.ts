import { NextRequest, NextResponse } from "next/server";
import { processAutoReply } from "@/app/api/auto-reply/processor";

/**
 * Admin endpoint, manually trigger auto-reply processing on a specific reply.
 * Used for testing the approval flow without waiting for a real webhook.
 *
 * Usage:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://inbox.agencyevolution.eu/api/admin/process-reply?id=<reply_id>&workspace=<slug>"
 */
export async function POST(req: NextRequest) {
  return GET(req);
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const replyId = url.searchParams.get("id");
  const workspaceSlug = url.searchParams.get("workspace");

  if (!replyId || !workspaceSlug) {
    return NextResponse.json(
      { error: "missing id or workspace query param" },
      { status: 400 }
    );
  }

  try {
    await processAutoReply(replyId, workspaceSlug);
    return NextResponse.json({ ok: true, processed: replyId });
  } catch (err: any) {
    console.error("[admin/process-reply] error:", err);
    return NextResponse.json(
      { error: err.message ?? "internal error" },
      { status: 500 }
    );
  }
}
