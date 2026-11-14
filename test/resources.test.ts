import { describe, expect, it } from 'vitest';
import { ServerError, type FlightByte, type Subscription } from '../src/index.js';
import { client, fixture, json, mockFetch } from './helpers/mock.js';

const flight = JSON.parse(fixture('flight.json'));
const subscription = JSON.parse(fixture('subscription.json'));

describe('flights', () => {
  it('get sends the identifiers in the path and the rest in the query', async () => {
    const mock = mockFetch(() => json(200, flight));
    const result = await client(mock.fetch).flights.get({
      carrier: 'TK',
      flightNumber: '1848',
      date: '2026-09-08',
      origin: 'IST',
      destination: 'CDG',
      flightId: '1407084032',
      refresh: true,
    });
    const { method, url } = mock.last();
    expect(method).toBe('GET');
    expect(url.pathname).toBe('/v1/flights/TK/1848/2026-09-08');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      origin: 'IST',
      destination: 'CDG',
      flightId: '1407084032',
      refresh: 'true',
    });
    expect(result).toEqual(flight);
  });

  it('get sends no query when nothing optional is set', async () => {
    const mock = mockFetch(() => json(200, flight));
    await client(mock.fetch).flights.get({ carrier: 'TK', flightNumber: '1848', date: '2026-09-08', refresh: false });
    expect(mock.last().url.search).toBe('');
  });

  it('timeline reads the history', async () => {
    const body = { flightKey: 'TK1848:2026-09-08', count: 1, data: flight.timeline };
    const mock = mockFetch(() => json(200, body));
    const result = await client(mock.fetch).flights.timeline({
      carrier: 'TK',
      flightNumber: '1848',
      date: '2026-09-08',
      origin: 'IST',
    });
    expect(mock.last().url.pathname).toBe('/v1/flights/TK/1848/2026-09-08/timeline');
    expect(mock.last().url.search).toBe('?origin=IST');
    expect(result.count).toBe(1);
    expect(result.data[0]?.title).toBe('Time Adjustment');
  });
});

describe('subscriptions', () => {
  it('create posts the body and the idempotency key, and masks the secret', async () => {
    const { secretHint: _hint, ...withoutHint } = subscription;
    const reply = { ...withoutHint, secret: 'whsec_AbCdEfGhIjKlMnOpQrStUvwxyz', reused: false, flight };
    const mock = mockFetch(() => json(201, reply));
    const created = await client(mock.fetch).subscriptions.create(
      {
        carrier: 'TK',
        flightNumber: '1848',
        date: '2026-09-08',
        webhookUrl: 'https://example.com/hooks/flights',
        origin: 'IST',
        events: ['flight.departed', 'departure.gate.changed'],
        delayThresholdMinutes: 10,
        headers: { 'x-team': 'ops' },
        metadata: { booking: '42' },
      },
      { idempotencyKey: 'booking-42' },
    );
    const { method, url, headers, body } = mock.last();
    expect(method).toBe('POST');
    expect(url.pathname).toBe('/v1/subscriptions');
    expect(headers.get('idempotency-key')).toBe('booking-42');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(body!)).toEqual({
      carrier: 'TK',
      flightNumber: '1848',
      date: '2026-09-08',
      webhookUrl: 'https://example.com/hooks/flights',
      origin: 'IST',
      events: ['flight.departed', 'departure.gate.changed'],
      delayThresholdMinutes: 10,
      headers: { 'x-team': 'ops' },
      metadata: { booking: '42' },
    });
    expect(created.secretHint).toBe('whsec_AbCdE...wxyz');
    expect(created.reused).toBe(false);
    expect(created.flight?.flightKey).toBe('TK1848:2026-09-08');
  });

  it('create sends only what was set, including a zero', async () => {
    const mock = mockFetch(() => json(201, { id: 'sub_1', secret: 's' }));
    await client(mock.fetch).subscriptions.create({
      carrier: 'TK',
      flightNumber: '1848',
      date: '2026-09-08',
      webhookUrl: 'https://example.com/h',
      delayThresholdMinutes: 0,
    });
    expect(mock.last().body).toBe(
      '{"carrier":"TK","flightNumber":"1848","date":"2026-09-08","webhookUrl":"https://example.com/h","delayThresholdMinutes":0}',
    );
    expect(mock.last().headers.has('idempotency-key')).toBe(false);
  });

  it('list sends the filters', async () => {
    const mock = mockFetch(() => json(200, { total: 1, limit: 5, offset: 10, data: [subscription] }));
    const page = await client(mock.fetch).subscriptions.list({
      status: 'active',
      carrier: 'TK',
      flightNumber: '1848',
      date: '2026-09-08',
      limit: 5,
      offset: 10,
    });
    expect(Object.fromEntries(mock.last().url.searchParams)).toEqual({
      status: 'active',
      carrier: 'TK',
      flightNumber: '1848',
      date: '2026-09-08',
      limit: '5',
      offset: '10',
    });
    expect(page.data).toHaveLength(1);
  });

  describe('listAll', () => {
    const pages = (total: number) =>
      mockFetch(({ url }) => {
        const limit = Number(url.searchParams.get('limit'));
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const data = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
          id: `sub_${offset + i}`,
        }));
        return json(200, { total, limit, offset, data });
      });

    const collect = async (iterable: AsyncIterable<Subscription>) => {
      const ids: string[] = [];
      for await (const sub of iterable) ids.push(sub.id);
      return ids;
    };

    it('walks every page', async () => {
      const mock = pages(5);
      const ids = await collect(client(mock.fetch).subscriptions.listAll({ pageSize: 2, status: 'active' }));
      expect(ids).toEqual(['sub_0', 'sub_1', 'sub_2', 'sub_3', 'sub_4']);
      expect(mock.calls).toHaveLength(3);
      expect(Object.fromEntries(mock.last().url.searchParams)).toEqual({ status: 'active', limit: '2', offset: '4' });
    });

    it('stops fetching when the loop breaks', async () => {
      const mock = pages(5);
      for await (const _sub of client(mock.fetch).subscriptions.listAll({ pageSize: 2 })) break;
      expect(mock.calls).toHaveLength(1);
    });

    it('uses 200 a page by default', async () => {
      const mock = pages(0);
      await collect(client(mock.fetch).subscriptions.listAll());
      expect(mock.last().url.searchParams.get('limit')).toBe('200');
    });

    it('ends on an error', async () => {
      const mock = mockFetch(() => json(500, { statusCode: 500, message: 'boom' }));
      await expect(collect(client(mock.fetch).subscriptions.listAll())).rejects.toBeInstanceOf(ServerError);
    });
  });

  const actions: Array<{
    name: string;
    reply: unknown;
    call: (c: FlightByte) => Promise<unknown>;
    method: string;
    path: string;
    search?: string;
    body?: string;
    result?: unknown;
  }> = [
    {
      name: 'get',
      reply: subscription,
      call: (c) => c.subscriptions.get('sub_1'),
      method: 'GET',
      path: '/v1/subscriptions/sub_1',
      result: subscription,
    },
    {
      name: 'update',
      reply: subscription,
      call: (c) =>
        c.subscriptions.update('sub_1', {
          webhookUrl: 'https://example.com/new',
          events: ['flight.cancelled'],
          delayThresholdMinutes: 30,
        }),
      method: 'PATCH',
      path: '/v1/subscriptions/sub_1',
      body: '{"webhookUrl":"https://example.com/new","events":["flight.cancelled"],"delayThresholdMinutes":30}',
    },
    {
      name: 'update with nothing',
      reply: subscription,
      call: (c) => c.subscriptions.update('sub_1', {}),
      method: 'PATCH',
      path: '/v1/subscriptions/sub_1',
      body: '{}',
    },
    {
      name: 'delete',
      reply: null,
      call: (c) => c.subscriptions.delete('sub_1'),
      method: 'DELETE',
      path: '/v1/subscriptions/sub_1',
      result: undefined,
    },
    { name: 'pause', reply: subscription, call: (c) => c.subscriptions.pause('sub_1'), method: 'POST', path: '/v1/subscriptions/sub_1/pause' },
    { name: 'resume', reply: subscription, call: (c) => c.subscriptions.resume('sub_1'), method: 'POST', path: '/v1/subscriptions/sub_1/resume' },
    {
      name: 'sendTest',
      reply: { eventId: 'evt_1' },
      call: (c) => c.subscriptions.sendTest('sub_1'),
      method: 'POST',
      path: '/v1/subscriptions/sub_1/test',
      result: 'evt_1',
    },
    {
      name: 'deliveries',
      reply: {
        count: 1,
        data: [
          {
            eventId: 'evt_1',
            attempt: 2,
            status: 'failed',
            httpStatus: 500,
            error: 'HTTP 500',
            durationMs: 120,
            at: '2026-09-08T09:10:00.000Z',
            changeTypes: ['departure.gate.changed'],
          },
        ],
      },
      call: (c) => c.subscriptions.deliveries('sub_1', { limit: 10 }),
      method: 'GET',
      path: '/v1/subscriptions/sub_1/deliveries',
      search: '?limit=10',
    },
    {
      name: 'events',
      reply: { count: 1, data: [JSON.parse(fixture('webhook_flight_updated.json'))] },
      call: (c) => c.subscriptions.events('sub_1'),
      method: 'GET',
      path: '/v1/subscriptions/sub_1/events',
      result: [JSON.parse(fixture('webhook_flight_updated.json'))],
    },
    {
      name: 'secret',
      reply: { secret: 'whsec_x' },
      call: (c) => c.subscriptions.secret('sub_1'),
      method: 'GET',
      path: '/v1/subscriptions/sub_1/secret',
      result: 'whsec_x',
    },
    {
      name: 'rotateSecret',
      reply: { secret: 'whsec_y' },
      call: (c) => c.subscriptions.rotateSecret('sub_1'),
      method: 'POST',
      path: '/v1/subscriptions/sub_1/secret/rotate',
      result: 'whsec_y',
    },
  ];

  it.each(actions)('$name', async ({ reply, call, method, path, search = '', body, result }) => {
    const mock = mockFetch(() => (reply === null ? new Response(null, { status: 204 }) : json(201, reply)));
    const value = await call(client(mock.fetch));
    const sent = mock.last();
    expect(sent.method).toBe(method);
    expect(sent.url.pathname).toBe(path);
    expect(sent.url.search).toBe(search);
    expect(sent.body).toBe(body);
    if (result !== undefined || reply === null) expect(value).toEqual(result);
  });
});

describe('countries', () => {
  const tr = {
    code: 'TR',
    alpha2: 'TR',
    name: 'Türkiye',
    emoji: '🇹🇷',
    hasFlag: true,
    flagSvg: 'https://api.flightbyte.dev/v1/flags/tr.svg',
    flagSvgSquare: 'https://api.flightbyte.dev/v1/flags/tr.svg?shape=1x1',
  };

  it('list unwraps the data', async () => {
    const mock = mockFetch(() => json(200, { count: 1, data: [tr] }));
    expect(await client(mock.fetch).countries.list({ lang: 'tr' })).toEqual([tr]);
    expect(mock.last().url.pathname).toBe('/v1/countries');
    expect(mock.last().url.search).toBe('?lang=tr');
  });

  it('get reads one country', async () => {
    const mock = mockFetch(() => json(200, tr));
    expect(await client(mock.fetch).countries.get('TR')).toEqual(tr);
    expect(mock.last().url.pathname).toBe('/v1/countries/TR');
    expect(mock.last().url.search).toBe('');
  });

  it('flagUrl builds the URL without a request', () => {
    const mock = mockFetch();
    const c = client(mock.fetch);
    expect(c.countries.flagUrl('TR')).toBe('https://api.test/v1/flags/tr.svg');
    expect(c.countries.flagUrl('TR', { square: true })).toBe('https://api.test/v1/flags/tr.svg?shape=1x1');
    expect(mock.calls).toHaveLength(0);
  });
});
