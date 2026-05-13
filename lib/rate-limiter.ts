/**
 * Simple in-process rate limiter for Anthropic API calls.
 * Uses a rolling 60-second window. Shared across the auto-reply processor and
 * the FU processor via module-level state (single Node process, instrumentation.ts).
 *
 * This is a safety valve only — it should never trigger under normal volume.
 * If it fires, it means a backlog spike or loop bug is burning tokens.
 */

interface RateWindow {
  count: number;
  windowStart: number;
}

const windows = new Map<string, RateWindow>();

/**
 * Returns true if the call is allowed, false if the rate limit has been hit.
 * Increments the counter on every allowed call.
 */
export function checkRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now - existing.windowStart > 60_000) {
    windows.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (existing.count >= maxPerMinute) {
    return false;
  }

  existing.count++;
  return true;
}
