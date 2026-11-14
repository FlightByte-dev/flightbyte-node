import { readFileSync } from 'node:fs';
import { FlightByte, type FlightByteOptions } from '../../src/index.js';

/** One request the mock fetch received. */
export interface Recorded {
  method: string;
  url: URL;
  headers: Headers;
  body: string | undefined;
  signal: AbortSignal | undefined;
}

/** A fetch that records every request and answers with `reply`. */
export function mockFetch(reply: (request: Recorded) => Response | Promise<Response> = () => json(200, {})) {
  const calls: Recorded[] = [];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const recorded: Recorded = {
      method: init.method ?? 'GET',
      url: new URL(String(input)),
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
      signal: init.signal ?? undefined,
    };
    calls.push(recorded);
    return reply(recorded);
  };
  return {
    fetch: fetch as typeof globalThis.fetch,
    calls,
    last(): Recorded {
      const call = calls.at(-1);
      if (!call) throw new Error('no request was sent');
      return call;
    },
  };
}

/** A JSON response. */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A client pointed at a fake API root, sending through `fetch`. */
export function client(fetch: typeof globalThis.fetch, options: Partial<FlightByteOptions> = {}): FlightByte {
  return new FlightByte({ apiKey: 'frk_test_key', baseUrl: 'https://api.test/v1', fetch, ...options });
}

/** A fixture file's text, exactly as stored. */
export function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}
