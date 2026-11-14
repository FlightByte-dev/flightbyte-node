import { describe, expect, it } from 'vitest';
import { ConnectionError, FlightByte, FlightByteError, VERSION } from '../src/index.js';
import { client, json, mockFetch } from './helpers/mock.js';

describe('new FlightByte', () => {
  it.each([
    ['an empty key', { apiKey: '' }],
    ['a blank key', { apiKey: '   ' }],
    ['a relative base URL', { apiKey: 'k', baseUrl: '/v1' }],
    ['an ftp base URL', { apiKey: 'k', baseUrl: 'ftp://api.flightbyte.dev/v1' }],
    ['a base URL with a query', { apiKey: 'k', baseUrl: 'https://api.flightbyte.dev/v1?x=1' }],
    ['a negative timeout', { apiKey: 'k', timeoutMs: -1 }],
    ['a timeout that is not a number', { apiKey: 'k', timeoutMs: Number.NaN }],
  ])('rejects %s', (_name, options) => {
    expect(() => new FlightByte(options)).toThrow(TypeError);
  });

  it('defaults to the production API and trims what it is given', () => {
    expect(new FlightByte({ apiKey: 'k' }).baseUrl).toBe('https://api.flightbyte.dev/v1');
    expect(new FlightByte({ apiKey: 'k', baseUrl: 'http://localhost:3000/v1/' }).baseUrl).toBe('http://localhost:3000/v1');
  });
});

describe('requests', () => {
  it('sends the key, accept and user agent', async () => {
    const mock = mockFetch(() => json(200, { count: 0, data: [] }));
    await client(mock.fetch, { apiKey: '  frk_test_key  ', userAgent: 'my-app/1.2' }).countries.list();
    const { method, url, headers, body } = mock.last();
    expect(method).toBe('GET');
    expect(url.href).toBe('https://api.test/v1/countries');
    expect(headers.get('x-api-key')).toBe('frk_test_key');
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('user-agent')).toBe(`my-app/1.2 flightbyte-node/${VERSION}`);
    expect(headers.has('content-type')).toBe(false);
    expect(body).toBeUndefined();
  });

  it('escapes every path segment', async () => {
    const mock = mockFetch(() => json(200, {}));
    await client(mock.fetch).subscriptions.get('sub/../../admin?x=1');
    expect(mock.last().url.pathname).toBe('/v1/subscriptions/sub%2F..%2F..%2Fadmin%3Fx%3D1');
    expect(mock.last().url.search).toBe('');
  });

  it('rejects an empty path parameter without sending anything', async () => {
    const mock = mockFetch();
    const c = client(mock.fetch);
    await expect(c.flights.get({ carrier: '', flightNumber: '1', date: '2026-09-08' })).rejects.toThrow(/carrier is required/);
    await expect(c.flights.timeline({ carrier: 'TK', flightNumber: '1', date: ' ' })).rejects.toThrow(/date is required/);
    await expect(
      c.subscriptions.create({ carrier: 'TK', flightNumber: '1', date: '2026-09-08', webhookUrl: '' }),
    ).rejects.toThrow(/webhookUrl is required/);
    await expect(c.subscriptions.get('')).rejects.toThrow(/id is required/);
    await expect(c.subscriptions.delete(' ')).rejects.toThrow(/id is required/);
    await expect(c.countries.get('')).rejects.toThrow(/code is required/);
    expect(() => c.countries.flagUrl('')).toThrow(/code is required/);
    expect(mock.calls).toHaveLength(0);
  });

  it('treats an empty 2xx body as no value', async () => {
    const mock = mockFetch(() => new Response('', { status: 201 }));
    await expect(client(mock.fetch).subscriptions.delete('sub_1')).resolves.toBeUndefined();
  });

  it('says so when a 2xx body is not JSON', async () => {
    const mock = mockFetch(() => new Response('<html>maintenance</html>', { status: 200 }));
    const error = await client(mock.fetch).countries.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FlightByteError);
    expect((error as Error).message).toMatch(/Expected JSON from GET https:\/\/api\.test\/v1\/countries, got: <html>/);
  });
});

describe('rate limits', () => {
  const quota = () =>
    json(
      200,
      { count: 0, data: [] },
      {
        'x-ratelimit-limit-minute': '60',
        'x-ratelimit-remaining-minute': '59',
        'x-ratelimit-reset-minute': '1788858660',
        'x-ratelimit-limit-month': '120',
        'x-ratelimit-remaining-month': 'bad',
      },
    );

  it('reads the windows the headers report', async () => {
    const c = client(mockFetch(quota).fetch);
    expect(c.lastRateLimit).toBeNull();
    await c.countries.list();
    expect(c.lastRateLimit).toEqual({
      minute: { limit: 60, remaining: 59, resetAt: new Date(1788858660 * 1000) },
      day: null,
      month: null,
    });
  });

  it('keeps the last state when a response carries no headers', async () => {
    let first = true;
    const c = client(mockFetch(() => (first ? ((first = false), quota()) : json(200, { data: [] }))).fetch);
    await c.countries.list();
    await c.countries.list();
    expect(c.lastRateLimit?.minute?.remaining).toBe(59);
  });

  it('hands out a copy that cannot change the client', async () => {
    const c = client(mockFetch(quota).fetch);
    await c.countries.list();
    const copy = c.lastRateLimit!;
    copy.minute!.remaining = 0;
    copy.minute!.resetAt!.setTime(0);
    copy.minute = null;
    expect(c.lastRateLimit?.minute).toEqual({ limit: 60, remaining: 59, resetAt: new Date(1788858660 * 1000) });
  });
});

describe('failures without a response', () => {
  /** A fetch that never answers until its signal aborts, like a hung server. */
  const hang = () =>
    mockFetch(
      ({ signal }) =>
        new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason));
        }),
    );

  it('times out with a ConnectionError', async () => {
    const error = await client(hang().fetch, { timeoutMs: 30 })
      .countries.list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).timedOut).toBe(true);
    expect((error as Error).message).toMatch(/GET https:\/\/api\.test\/v1\/countries timed out after 30 ms/);
  });

  it('lets one request override the timeout', async () => {
    const error = await client(hang().fetch, { timeoutMs: 60_000 })
      .countries.list({ timeoutMs: 20 })
      .catch((e: unknown) => e);
    expect((error as ConnectionError).timedOut).toBe(true);
  });

  it('rejects with your own reason when you abort', async () => {
    const controller = new AbortController();
    const pending = client(hang().fetch).countries.list({ signal: controller.signal });
    const reason = new Error('user went away');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('wraps a network failure', async () => {
    const cause = new TypeError('fetch failed');
    const error = await client(mockFetch(() => Promise.reject(cause)).fetch)
      .countries.list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).timedOut).toBe(false);
    expect((error as Error).cause).toBe(cause);
  });

  it('reaches a refused port as a ConnectionError', async () => {
    const c = new FlightByte({ apiKey: 'k', baseUrl: 'http://127.0.0.1:1/v1' });
    await expect(c.countries.list()).rejects.toBeInstanceOf(ConnectionError);
  });
});

describe('FlightByte.formatDate', () => {
  it('formats the calendar date in the given time zone', () => {
    const instant = new Date('2026-09-07T22:30:00Z');
    expect(FlightByte.formatDate(instant, 'Europe/Istanbul')).toBe('2026-09-08');
    expect(FlightByte.formatDate(instant, 'America/New_York')).toBe('2026-09-07');
    expect(FlightByte.formatDate(instant, 'UTC')).toBe('2026-09-07');
  });
});
