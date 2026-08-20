import { buildMeetingContext } from "@/lib/meeting-context";

const icp = "Established consumer / CPG brands (beauty, personal care, food, supplements, household) doing roughly $5M+ in revenue with repeat-purchase products, the buyer's acquisition target. Also relevant: 7-figure+ DTC brands open to growth and a future exit. NOT a fit: pure services/agencies, B2B SaaS, pre-revenue, or clearly under $5M with no path.";

async function run(label: string, workspaceSlug: string, leadEmail: string) {
  console.log(`\n=== ${label} (${workspaceSlug} / ${leadEmail}) ===`);
  const lines = await buildMeetingContext({ workspaceSlug, leadEmail, icpDescription: icp });
  console.log(lines.length ? lines.join("\n") : "(no extra lines)");
}

async function main() {
  // Cross-workspace fix: substantive reply sits under acceler8rs, booking is larsen-digital.
  await run("Thomas Elzner (cross-workspace EBITDA/context)", "larsen-digital", "thomas@skinspanewyork.com");
  // Broadened-prompt fix: thread only has a question, no business/revenue stated.
  await run("Amanda Thomson (question-only thread)", "larsen-digital", "amanda@thomsonandscott.com");
  // Sanity check: a lead we've never heard from (no replies row at all) -> should omit cleanly.
  await run("Nobody (no thread at all)", "larsen-digital", "nobody-test-lead@example.com");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
