// Runs the built package (dist/) on whatever runtime starts it, to show it
// needs nothing Node-specific:
//
//   npm run build
//   node test/runtime/smoke.mjs
//   bun test/runtime/smoke.mjs
//   deno run --allow-read test/runtime/smoke.mjs
import { readFile } from 'node:fs/promises';
import { FlightByte, NotFoundError, Webhook } from '../../dist/index.js';

const runtime = globalThis.Deno
  ? `Deno ${Deno.version.deno}`
  : globalThis.Bun
    ? `Bun ${Bun.version}`
    : `Node ${process.versions.node}`;

const read = (name) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const check = (ok, what) => {
  if (!ok) throw new Error(`smoke test failed on ${runtime}: ${what}`);
};

// Webhook signatures made by the API's signer verify, and signing matches them.
const vectors = JSON.parse(await read('webhook_vectors.json'));
for (const { file, signature } of vectors.cases) {
  const body = await read(file);
  await Webhook.verify(body, signature, vectors.secret, { now: vectors.timestamp * 1000 });
  check((await Webhook.sign(body, vectors.secret, { timestamp: vectors.timestamp * 1000 })) === signature, `sign ${file}`);
}
check(!(await Webhook.isValid('{}', vectors.cases[0].signature, vectors.secret)), 'a wrong body is rejected');

// The client, through a fetch that answers like the API.
const flight = await read('flight.json');
const fetch = async (input, init) => {
  check(new Headers(init.headers).get('x-api-key') === 'k', 'the key is sent');
  if (new URL(String(input)).pathname.endsWith('/missing')) {
    return new Response('{"statusCode":404,"message":"Not found."}', { status: 404 });
  }
  return new Response(flight, {
    status: 200,
    headers: { 'x-ratelimit-limit-minute': '30', 'x-ratelimit-remaining-minute': '29' },
  });
};
const client = new FlightByte({ apiKey: 'k', baseUrl: 'https://api.test/v1', fetch });
const got = await client.flights.get({ carrier: 'TK', flightNumber: '1848', date: '2026-09-08' });
check(got.flightKey === 'TK1848:2026-09-08', 'a flight is read');
check(client.lastRateLimit?.minute?.remaining === 29, 'the quota is read');
const missing = await client.subscriptions.get('missing').catch((error) => error);
check(missing instanceof NotFoundError, 'a 404 is a NotFoundError');

// The Request/Response receiver.
const handler = Webhook.fetchHandler(vectors.secret, () => {}, { toleranceSeconds: 0 });
const response = await handler(
  new Request('https://receiver.test/hooks', {
    method: 'POST',
    body: await read(vectors.cases[0].file),
    headers: { 'x-flightbyte-signature': vectors.cases[0].signature },
  }),
);
check(response.status === 200, 'fetchHandler answers 200');

console.log(`flightbyte smoke test passed on ${runtime}`);
