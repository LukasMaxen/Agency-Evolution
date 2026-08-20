import { buildMeetingContext } from "@/lib/meeting-context";

const icp = "Established consumer / CPG brands (beauty, personal care, food, supplements, household) doing roughly $5M+ in revenue with repeat-purchase products, the buyer's acquisition target. Also relevant: 7-figure+ DTC brands open to growth and a future exit. NOT a fit: pure services/agencies, B2B SaaS, pre-revenue, or clearly under $5M with no path.";

async function run(label: string, workspaceSlug: string, leadEmail: string) {
  console.log(`\n=== ${label} ===`);
  const lines = await buildMeetingContext({ workspaceSlug, leadEmail, icpDescription: icp });
  console.log(lines.length ? lines.join("\n") : "(no extra lines)");
}

async function main() {
  await run("Thomas Elzner (seller claimed 18x EBITDA, no real number)", "larsen-digital", "thomas@skinspanewyork.com");
  await run("Jared Garner (fish conservas)", "larsen-digital", "jared@shopfishnook.com");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
