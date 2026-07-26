import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const replyId = process.argv[2];
const slug = process.argv[3];
if (!replyId || !slug) {
  console.error("Usage: npx tsx scripts/process-one-reply.ts <replyId> <workspaceSlug>");
  process.exit(1);
}

async function main() {
  const { processAutoReply } = await import("../app/api/auto-reply/processor");
  await processAutoReply(replyId, slug);
  console.log("done");
}
main().catch(e => { console.error(e); process.exit(1); });
