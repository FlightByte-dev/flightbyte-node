import { APIError, ConnectionError, FlightByteError } from './errors.js';
import { parseRateLimit, type RateLimit } from './rate-limit.js';

/** Options every method accepts as its last argument. */
export interface RequestOptions {
  /** Cancels the request. It then rejects with the signal's reason, as `fetch` does. */
  signal?: AbortSignal;
  /** Overrides the client's timeout for this request, in milliseconds. `0` disables it. */
  timeoutMs?: number;
}

/** A query string value; `undefined`, `null` and `''` are left out. */
export type QueryValue = string | number | boolean | undefined | null;

/** @internal */
export interface TransportConfig {
  apiKey: string;
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs: number;
  userAgent: string;
}

/** @internal */
export interface SendOptions extends RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
}

/** How many same-origin redirects a GET or HEAD follows. */
const MAX_REDIRECTS = 5;

/**
 * Sends authenticated requests and turns error statuses into errors.
 *
 * @internal Reach the API through `FlightByte`.
 */
export class Transport {
  /** The quota state from the latest response that carried one. */
  lastRateLimit: RateLimit | null = null;

  constructor(readonly config: TransportConfig) {}

  /** Builds the URL for `path` under the base URL, each segment escaped. */
  url(path: readonly string[], query?: Record<string, QueryValue>): string {
    let url = `${this.config.baseUrl}/${path.map((segment) => encodeURIComponent(segment)).join('/')}`;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const search = params.toString();
    if (search) url += `?${search}`;
    return url;
  }

  /** Sends a request and returns the decoded JSON, or `undefined` for an empty body. */
  async send<T>(method: string, path: readonly string[], options: SendOptions = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    const signals = [timeoutSignal, options.signal].filter((s): s is AbortSignal => s !== undefined);
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

    const headers: Record<string, string> = {
      'x-api-key': this.config.apiKey,
      accept: 'application/json',
      'user-agent': this.config.userAgent,
      ...options.headers,
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const initialUrl = this.url(path, options.query);
    let url = initialUrl;
    let response: Response;
    let text: string;
    try {
      for (let hops = 0; ; hops++) {
        response = await this.config.fetch(url, { method, headers, body, signal, redirect: 'manual' });
        const next = followableRedirect(response, url, method);
        if (next === undefined || hops >= MAX_REDIRECTS) break;
        await response.body?.cancel();
        url = next;
      }
      text = await response.text();
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (timeoutSignal?.aborted) {
        throw new ConnectionError(`${method} ${initialUrl} timed out after ${timeoutMs} ms.`, {
          cause: error,
          timedOut: true,
        });
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new ConnectionError(`${method} ${initialUrl} failed: ${reason}`, { cause: error });
    }

    const rateLimit = parseRateLimit(response.headers);
    if (rateLimit) this.lastRateLimit = rateLimit;

    if (response.status < 200 || response.status > 299) {
      throw APIError.from(response.status, response.statusText, text, response.headers);
    }
    if (response.status === 204 || text.trim() === '') return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      const preview = text.length > 200 ? `${text.slice(0, 200)}...` : text;
      throw new FlightByteError(`Expected JSON from ${method} ${initialUrl}, got: ${preview}`, { cause: error });
    }
  }
}

/**
 * Returns where to go next when `response` is a redirect this client may
 * follow: a GET or HEAD, to the same origin (scheme, host and port). Anything
 * else is returned to the caller as an error, so the API key, sent on every
 * request, never reaches another server or travels in the clear.
 */
function followableRedirect(response: Response, from: string, method: string): string | undefined {
  if (response.status < 300 || response.status > 399) return undefined;
  if (method !== 'GET' && method !== 'HEAD') return undefined;
  const location = response.headers.get('location');
  if (!location) return undefined;
  let target: URL;
  try {
    target = new URL(location, from);
  } catch {
    return undefined;
  }
  return target.origin === new URL(from).origin ? target.href : undefined;
}

/** Rejects an empty path parameter before it turns into a request for the wrong URL. */
export function required(name: string, value: string | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`flightbyte: ${name} is required.`);
  }
  return value;
}
