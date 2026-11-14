import { copyRateLimit, type RateLimit } from './rate-limit.js';
import { Transport } from './request.js';
import { Countries } from './resources/countries.js';
import { Flights } from './resources/flights.js';
import { Subscriptions } from './resources/subscriptions.js';
import { VERSION } from './version.js';

/** Options for {@link FlightByte}. */
export interface FlightByteOptions {
  /** Your API key, sent as `x-api-key`. Keep it on a server you control. */
  apiKey: string;
  /** The API root. Defaults to {@link FlightByte.DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** The `fetch` to send requests with: for tests, proxies or logging. Defaults to the global one. */
  fetch?: typeof fetch;
  /** Bounds each request, response body included, in milliseconds. `0` disables it. Defaults to 30 000. */
  timeoutMs?: number;
  /** Put in front of this package's own user agent, for example `my-app/1.2`. */
  userAgent?: string;
}

/**
 * A client for the FlightByte API. Create one and share it.
 *
 * ```ts
 * import { FlightByte } from 'flightbyte';
 *
 * const client = new FlightByte({ apiKey: process.env.FLIGHTBYTE_API_KEY! });
 * const flight = await client.flights.get({ carrier: 'TK', flightNumber: '1848', date: '2026-09-08' });
 * console.log(flight.status.label);
 * ```
 *
 * Keep API keys on a server you control. A key shipped inside a browser or
 * mobile app can be extracted by anyone who has the app.
 */
export class FlightByte {
  /** The production API root. */
  static readonly DEFAULT_BASE_URL = 'https://api.flightbyte.dev/v1';

  /** Flight lookups. */
  readonly flights: Flights;
  /** Watched flights and their webhooks. */
  readonly subscriptions: Subscriptions;
  /** Countries and flags. */
  readonly countries: Countries;
  /** The API root this client talks to. */
  readonly baseUrl: string;

  readonly #transport: Transport;

  constructor(options: FlightByteOptions) {
    const apiKey = typeof options?.apiKey === 'string' ? options.apiKey.trim() : '';
    if (!apiKey) throw new TypeError('flightbyte: apiKey is required.');

    const baseUrl = checkBaseUrl(options.baseUrl ?? FlightByte.DEFAULT_BASE_URL);
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new TypeError('flightbyte: timeoutMs must be a number of milliseconds, 0 or more.');
    }
    const ownAgent = `flightbyte-node/${VERSION}`;
    const userAgent = options.userAgent?.trim() ? `${options.userAgent.trim()} ${ownAgent}` : ownAgent;
    const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));

    this.baseUrl = baseUrl;
    this.#transport = new Transport({ apiKey, baseUrl, fetch: fetchImpl, timeoutMs, userAgent });
    this.flights = new Flights(this.#transport);
    this.subscriptions = new Subscriptions(this.#transport);
    this.countries = new Countries(this.#transport);
  }

  /**
   * The quota state from the latest response that reported one, or `null`
   * before any did. Each read returns a fresh copy.
   */
  get lastRateLimit(): RateLimit | null {
    return copyRateLimit(this.#transport.lastRateLimit);
  }

  /**
   * Formats `date` as the `YYYY-MM-DD` the API expects for flight dates.
   * Pass the origin airport's `timeZone`, for example `Europe/Istanbul`, to
   * get its local date; without one, the runtime's own time zone is used.
   */
  static formatDate(date: Date, timeZone?: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
  }
}

function checkBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`flightbyte: baseUrl ${JSON.stringify(value)} is not a URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError(`flightbyte: baseUrl ${JSON.stringify(value)} must be an http or https URL.`);
  }
  if (url.search || url.hash) {
    throw new TypeError(`flightbyte: baseUrl ${JSON.stringify(value)} must not have a query or fragment.`);
  }
  return url.href.replace(/\/+$/, '');
}
