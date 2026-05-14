/**
 * Simple in-process rate limiter for Anthropic API calls.
 * Uses a fixed 60-second window (not rolling): counter resets when the current
 * window expires. At a window boundary, up to 2x the limit could fire in rapid
 * succession — acceptable for a safety valve, not suitable for strict enforcement.
 * Shared across both processors via module-level state (single Node process).
 *
 * This is a safety valve only — it should never trigger under normal volume.
 * If it fires, a backlog spike or retry loop is burning tokens.
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
