const facts = [
  "Company name / identifier: skinspanewyork.com",
  "Company email/website domain(s): skinspanewyork.com",
  "Contact phone (country tells you where they operate): +45 22 22 22 22",
  "What the lead said about their own business: This sounds interesting. I'm selling at 18x EBITDA cash only. Premium NYC brand with 21 years in business. This is a steal for your investors.",
].join("\n");

const ask =
  `You are researching a company that just booked a sales call, to brief the rep on their approximate ` +
  `EBITDA. Use web search to find any public revenue or EBITDA for this company. Actually look it up, do ` +
  `not rely only on the notes below.\n\n` +
  `IMPORTANT: identify the SPECIFIC company from the domain(s) and what the lead said. The brand/store domain is the ` +
  `strongest signal; a holding-company domain is weaker. Do NOT confuse it with a similarly-named company in another ` +
  `country, cross-check against the lead's description and the phone's country. If sources conflict or you are not ` +
  `confident which company it is, say "none".\n\n${facts}\n\n` +
  `When you are done searching, end your reply with EXACTLY this line and nothing after it:\n` +
  `EBITDA: <~$amount | from public info OR from revenue OR stated in thread, or the single word none>`;

for (let i = 0; i < 4; i++) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: ask }],
    }),
  });
  const data = await res.json();
  const text = (data?.content ?? []).filter(b => b?.type === "text").map(b => b.text).join(" ").trim();
  console.log(`\n=== run ${i} ===`);
  console.log(text.slice(-400));
}
