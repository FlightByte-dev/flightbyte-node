/**
 * Redirects, against real local servers and the runtime's real fetch: the API
 * key is sent with every request, so a redirect this client followed to
 * another origin would hand the key to that origin.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { FlightByte, UnexpectedStatusError } from '../src/index.js';
import { client, json, mockFetch } from './helpers/mock.js';

interface TestServer {
  url: string;
  seen: Array<{ method: string; path: string; key: string | undefined }>;
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

async function start(handle: (req: IncomingMessage, res: ServerResponse, self: TestServer) => void): Promise<TestServer> {
  const self: TestServer = { url: '', seen: [] };
  const server = createServer((req, res) => {
    self.seen.push({ method: req.method ?? '', path: req.url ?? '', key: req.headers['x-api-key'] as string | undefined });
    handle(req, res, self);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  self.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return self;
}

function redirect(res: ServerResponse, location: string, status = 302) {
  res.writeHead(status, { location }).end();
}

function ok(res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"count":1,"data":[{"code":"TR"}]}');
}

describe('redirects', () => {
  it('does not follow one to another origin, so the key stays home', async () => {
    const other = await start((_req, res) => ok(res));
    const api = await start((_req, res) => redirect(res, `${other.url}/steal`));
    const c = new FlightByte({ apiKey: 'frk_secret', baseUrl: `${api.url}/v1` });

    const error = await c.countries.list().catch((e: unknown) => e);
    expect(other.seen).toEqual([]);
    expect(error).toBeInstanceOf(UnexpectedStatusError);
    expect((error as UnexpectedStatusError).status).toBe(302);
    expect((error as UnexpectedStatusError).location).toBe(`${other.url}/steal`);
  });

  it('follows one within the origin, key and all', async () => {
    const api = await start((req, res) => (req.url === '/v1/countries' ? redirect(res, '/v1/moved', 301) : ok(res)));
    const c = new FlightByte({ apiKey: 'frk_secret', baseUrl: `${api.url}/v1` });

    expect(await c.countries.list()).toEqual([{ code: 'TR' }]);
    expect(api.seen).toEqual([
      { method: 'GET', path: '/v1/countries', key: 'frk_secret' },
      { method: 'GET', path: '/v1/moved', key: 'frk_secret' },
    ]);
  });

  it('does not follow one for a request other than GET or HEAD', async () => {
    const api = await start((_req, res) => redirect(res, '/v1/elsewhere', 307));
    const c = new FlightByte({ apiKey: 'k', baseUrl: `${api.url}/v1` });

    await expect(c.subscriptions.pause('sub_1')).rejects.toBeInstanceOf(UnexpectedStatusError);
    expect(api.seen).toHaveLength(1);
  });

  it('gives up on a loop after five hops', async () => {
    const api = await start((req, res) => redirect(res, req.url ?? '/'));
    const c = new FlightByte({ apiKey: 'k', baseUrl: `${api.url}/v1` });

    const error = await c.countries.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnexpectedStatusError);
    expect(api.seen).toHaveLength(6);
  });

  it('does not follow https to http on the same host', async () => {
    const mock = mockFetch(({ url }) =>
      url.protocol === 'https:'
        ? new Response(null, { status: 302, headers: { location: 'http://api.test/v1/countries' } })
        : json(200, { count: 0, data: [] }),
    );
    await expect(client(mock.fetch).countries.list()).rejects.toBeInstanceOf(UnexpectedStatusError);
    expect(mock.calls).toHaveLength(1);
  });

  it('asks fetch not to follow anything on its own', async () => {
    let mode: RequestRedirect | undefined;
    const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      mode = init?.redirect;
      return json(200, { count: 0, data: [] });
    }) as typeof globalThis.fetch;
    await client(fetch).countries.list();
    expect(mode).toBe('manual');
  });
});
