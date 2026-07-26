import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
async function main() {
  const { runEmailBisonInboxSync } = await import("../lib/emailbison-inbox-sync");
  await runEmailBisonInboxSync();
  console.log("done");
}
main().catch(e => { console.error(e); process.exit(1); });
