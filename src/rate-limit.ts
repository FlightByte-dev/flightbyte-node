/** One quota window, from the `X-RateLimit-*` response headers. */
export interface RateLimitWindow {
  /** Requests the window allows. */
  limit: number;
  /** Requests left in the window. */
  remaining: number;
  /** When the window resets, or `null` when not reported. */
  resetAt: Date | null;
}

/**
 * The quota state sent with a response. A window the key has no limit on is
 * `null`; keys without limits get no headers at all.
 */
export interface RateLimit {
  /** The per-minute window. */
  minute: RateLimitWindow | null;
  /** The per-day window. */
  day: RateLimitWindow | null;
  /** The per-month window. */
  month: RateLimitWindow | null;
}

/** Reads the quota headers, or returns `null` when there are none. */
export function parseRateLimit(headers: Headers): RateLimit | null {
  const rateLimit: RateLimit = {
    minute: parseWindow(headers, 'minute'),
    day: parseWindow(headers, 'day'),
    month: parseWindow(headers, 'month'),
  };
  return rateLimit.minute || rateLimit.day || rateLimit.month ? rateLimit : null;
}

/** A deep copy, so callers can never change the client's own state. */
export function copyRateLimit(rateLimit: RateLimit | null): RateLimit | null {
  if (!rateLimit) return null;
  return {
    minute: copyWindow(rateLimit.minute),
    day: copyWindow(rateLimit.day),
    month: copyWindow(rateLimit.month),
  };
}

function copyWindow(window: RateLimitWindow | null): RateLimitWindow | null {
  if (!window) return null;
  return {
    limit: window.limit,
    remaining: window.remaining,
    resetAt: window.resetAt ? new Date(window.resetAt.getTime()) : null,
  };
}

function parseWindow(headers: Headers, name: string): RateLimitWindow | null {
  const limit = parseInteger(headers.get(`x-ratelimit-limit-${name}`));
  const remaining = parseInteger(headers.get(`x-ratelimit-remaining-${name}`));
  if (limit === undefined || remaining === undefined) return null;
  const reset = parseInteger(headers.get(`x-ratelimit-reset-${name}`));
  return { limit, remaining, resetAt: reset === undefined ? null : new Date(reset * 1000) };
}

function parseInteger(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  return Number(value.trim());
}
