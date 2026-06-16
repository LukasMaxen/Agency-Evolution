import { promises as dns } from "node:dns";

// In-memory cache: domain → { mxMissing, expiresAt }.
// MX records change rarely; a 1-hour TTL is plenty fresh for the
// Account Monitor and avoids re-resolving 100+ domains on every load.
const TTL_MS = 60 * 60 * 1000;
const cache: Map<string, { mxMissing: boolean; expiresAt: number }> = new Map();

// Returns the set of domains with no MX records (or that fail to
// resolve in a way that means mail will not be delivered).
// Other resolution failures (timeout, network) are treated as
// "unknown" and excluded from the missing set, so a flaky DNS call
// never flags a healthy domain.
export async function checkMxMissing(domains: string[]): Promise<Set<string>> {
  const now = Date.now();
  const result = new Set<string>();
  const toResolve: string[] = [];

  for (const d of domains) {
    const hit = cache.get(d);
    if (hit && hit.expiresAt > now) {
      if (hit.mxMissing) result.add(d);
    } else {
      toResolve.push(d);
    }
  }

  await Promise.all(toResolve.map(async (d) => {
    try {
      const records = await dns.resolveMx(d);
      const missing = !records || records.length === 0;
      cache.set(d, { mxMissing: missing, expiresAt: now + TTL_MS });
      if (missing) result.add(d);
    } catch (err: any) {
      // ENOTFOUND / ENODATA = definitively no MX. Anything else
      // (ETIMEOUT, ESERVFAIL, network) we treat as unknown.
      const code = err?.code;
      const definitivelyMissing = code === "ENOTFOUND" || code === "ENODATA";
      if (definitivelyMissing) {
        cache.set(d, { mxMissing: true, expiresAt: now + TTL_MS });
        result.add(d);
      }
      // Unknown failures: do not cache, do not flag. Next request retries.
    }
  }));

  return result;
}
