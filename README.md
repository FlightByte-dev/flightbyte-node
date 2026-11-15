<p align="center">
  <a href="https://flightbyte.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
      <img src="assets/logo-light.svg" alt="FlightByte" width="340">
    </picture>
  </a>
</p>

<h3 align="center">FlightByte for Node.js</h3>

<p align="center">
  The official Node.js and TypeScript client for the FlightByte flight status API.<br>
  Look flights up, watch them with signed webhooks and verify every delivery,<br>
  on Node, Bun, Deno and the edge.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/flightbyte"><img src="https://img.shields.io/npm/v/flightbyte?style=flat-square&color=EF6A1A&label=npm" alt="npm version"></a>
  <img src="https://img.shields.io/badge/Node-20.19%2B-121212?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node 20.19+">
  <img src="https://img.shields.io/badge/runs_on-Node_%7C_Bun_%7C_Deno_%7C_Workers-121212?style=flat-square" alt="Runs on Node, Bun, Deno and Workers">
  <img src="https://img.shields.io/badge/dependencies-none-EF6A1A?style=flat-square" alt="No dependencies">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-121212?style=flat-square" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://flightbyte.dev/docs"><b>Docs</b></a> ·
  <a href="https://app.flightbyte.dev/signup?utm_source=npm&utm_medium=readme&utm_campaign=node-sdk"><b>Get a free key</b></a> ·
  <a href="https://flightbyte.dev/docs/reference"><b>API reference</b></a> ·
  <a href="https://flightbyte.dev/docs/webhooks"><b>Webhook docs</b></a> ·
  <a href="https://t.me/flightbyte"><b>Support</b></a>
</p>

---

## Quick start

1. Get a free API key at [app.flightbyte.dev/signup](https://app.flightbyte.dev/signup?utm_source=npm&utm_medium=readme&utm_campaign=node-sdk).
2. Add the package:

   | | Command |
   | --- | --- |
   | **npm** | `npm install flightbyte` |
   | **pnpm** | `pnpm add flightbyte` |
   | **Yarn** | `yarn add flightbyte` |
   | **Bun** | `bun add flightbyte` |
   | **Deno** | `deno add npm:flightbyte` |

3. Look a flight up:

   ```ts
   import { FlightByte } from 'flightbyte';

   const client = new FlightByte({ apiKey: process.env.FLIGHTBYTE_API_KEY! });

   const flight = await client.flights.get({
     carrier: 'TK',
     flightNumber: '1848',
     date: '2026-09-08', // local departure date at the origin
   });

   console.log(flight.status.label);         // Scheduled
   console.log(flight.departure.gate);       // A11
   console.log(flight.departure.delayMinutes); // 15
   ```

Types come with the package, so every field autocompletes. `FlightByte.formatDate(new Date(), 'Europe/Istanbul')` gives the `YYYY-MM-DD` the API expects, in the origin airport's time zone. To try it from a terminal, run the example in this repository:

```bash
npm ci && npm run build
FLIGHTBYTE_API_KEY=frk_live_... node examples/lookup.mjs TK 1 2026-11-15
```

```text
TK1:2026-11-15@IST-JFK  IST → JFK
Status     Scheduled (scheduled)
Departure  2026-11-15T15:20:00.000 +03, gate D15
Arrival    2026-11-15T18:20:00.000 EST, baggage -
Quota      23 of 30 left this minute
```

## What you can do

| You want to | You call |
| --- | --- |
| *Show a passenger their gate and delay* | `client.flights.get(...)` returns the live snapshot: phase, gate, terminal, baggage belt, scheduled, estimated and actual times, delay, aircraft and codeshares. |
| *Look up TK1 tomorrow, which flies two legs* | Pass `origin: 'IST'`. Without it the snapshot lists every leg in `alternates`, and a subscription refuses to guess: the `BadRequestError` carries the `legs` to choose from. |
| *Be told when anything changes* | `client.subscriptions.create(...)` starts the watch and returns the signing secret, shown once. |
| *Find out why webhooks stopped arriving* | `client.subscriptions.get(id)` and `deliveries(id)` show the status and the HTTP code and error of every recent attempt. |
| *Trust a webhook on your server* | `Webhook.fetchHandler(secret, handle)` verifies the signature against the raw body, decodes the event and calls you. |

## API

**Flights**: read-only.

| Method | What it does |
| --- | --- |
| `flights.get` | Live status of one flight leg, and every leg the number flies that day.<br><sub>`GET /v1/flights/{carrier}/{flightNumber}/{date}`</sub> |
| `flights.timeline` | The airline's own change history for a leg, newest first.<br><sub>`GET /v1/flights/{carrier}/{flightNumber}/{date}/timeline`</sub> |

**Subscriptions**

| Method | What it does | Access |
| --- | --- | --- |
| `subscriptions.create` | Watch a flight and get a signed webhook for every change. Counts as a watched flight on your plan; pass `idempotencyKey` so a retry never counts twice.<br><sub>`POST /v1/subscriptions`</sub> | writes |
| `subscriptions.list` | One page of your subscriptions, filtered by status, carrier, number or date.<br><sub>`GET /v1/subscriptions`</sub> | read-only |
| `subscriptions.listAll` | Every matching subscription, fetched page by page as you `for await` over it.<br><sub>`GET /v1/subscriptions`</sub> | read-only |
| `subscriptions.get` | One subscription with its status and delivery counters.<br><sub>`GET /v1/subscriptions/{id}`</sub> | read-only |
| `subscriptions.update` | Change the webhook URL, event filter, delay threshold, headers or metadata.<br><sub>`PATCH /v1/subscriptions/{id}`</sub> | writes |
| `subscriptions.pause` | Stop polling and deliveries without losing anything.<br><sub>`POST /v1/subscriptions/{id}/pause`</sub> | writes |
| `subscriptions.resume` | Resume a paused or auto-suspended subscription.<br><sub>`POST /v1/subscriptions/{id}/resume`</sub> | writes |
| `subscriptions.delete` | Delete a subscription for good.<br><sub>`DELETE /v1/subscriptions/{id}`</sub> | **destructive** |
| `subscriptions.sendTest` | Send a signed `subscription.test` webhook to the subscription's URL.<br><sub>`POST /v1/subscriptions/{id}/test`</sub> | writes |
| `subscriptions.deliveries` | Recent delivery attempts with HTTP status and errors.<br><sub>`GET /v1/subscriptions/{id}/deliveries`</sub> | read-only |
| `subscriptions.events` | Recent events with the exact payloads that were sent.<br><sub>`GET /v1/subscriptions/{id}/events`</sub> | read-only |
| `subscriptions.secret` | Reveal the signing secret again.<br><sub>`GET /v1/subscriptions/{id}/secret`</sub> | read-only |
| `subscriptions.rotateSecret` | Generate a new signing secret. Previous signatures stop validating.<br><sub>`POST /v1/subscriptions/{id}/secret/rotate`</sub> | writes |

**Countries**: read-only.

| Method | What it does |
| --- | --- |
| `countries.list` | Every country with its name in any language, emoji and flag URLs.<br><sub>`GET /v1/countries`</sub> |
| `countries.get` | One country by its ISO 3166-1 alpha-2 code.<br><sub>`GET /v1/countries/{code}`</sub> |
| `countries.flagUrl` | The URL of a country's SVG flag, 4:3 or square. Needs no key, so it can go straight into an `<img>`.<br><sub>`GET /v1/flags/{code}.svg`</sub> |

Every method takes an optional last argument with a `signal` to cancel it and a `timeoutMs` of its own. Parameters carry the API's own names (`carrier`, `flightNumber`, `date`, `origin`, `webhookUrl`, …), and responses come back exactly as the API sent them: timestamps are ISO 8601 strings and no field is renamed or dropped. The full snapshot is documented under [Flights](https://flightbyte.dev/docs/flights).

## Watch a flight

```ts
const created = await client.subscriptions.create(
  {
    carrier: 'TK',
    flightNumber: '1848',
    date: '2026-09-08',
    webhookUrl: 'https://api.example.com/hooks/flights',
    events: ['departure.gate.changed', 'delay.increased', 'flight.departed'],
    metadata: { bookingId: 'BK-1042' },
  },
  { idempotencyKey: 'BK-1042' }, // safe to retry
);

// Shown in full only now: store it where your webhook receiver can read it.
const signingSecret = created.secret;
```

FlightByte only delivers to public HTTPS addresses. To receive on your machine, expose the port with a tunnel (`cloudflared tunnel --url http://localhost:8080` or `ngrok http 8080`) and use that URL. `subscriptions.sendTest(id)` sends a signed `subscription.test` whenever you want to see the path work.

## Receive webhooks

A receiver has to do four things, in this order: verify the signature against the **raw** body, deduplicate on the event id, answer `2xx` before doing the work, and branch on the event type.

`Webhook.fetchHandler` does the first and answers for you: `401` for a bad signature, `400` for a body that is not an event, `500` when your function throws (so FlightByte retries) and `200` otherwise. What your function throws goes to `console.error`, or to the `onError` option. An empty secret throws a `TypeError` right away, because anyone can sign with an empty key: an unset environment variable fails at startup instead of accepting forged events. It takes a `Request` and returns a `Response`, so it fits every runtime built on them:

```ts
import { Webhook } from 'flightbyte';

const receive = Webhook.fetchHandler(process.env.FLIGHTBYTE_WEBHOOK_SECRET!, async (event) => {
  // A retry carries the same id: answer it, but don't handle it twice.
  if (!(await markHandled(event.id))) return;
  // Answer first: FlightByte treats a delivery as failed after 10 seconds.
  queue.push(event);
});
```

<details>
<summary><b>Next.js, Hono, Cloudflare Workers, Bun and Deno</b></summary>

<br>

```ts
// Next.js App Router: app/api/flightbyte/route.ts
export const POST = receive;

// Hono
app.post('/hooks/flightbyte', (c) => receive(c.req.raw));

// Cloudflare Workers: the secret comes in with env
export default {
  fetch: (request: Request, env: Env) => Webhook.fetchHandler(env.FLIGHTBYTE_WEBHOOK_SECRET, handle)(request),
};

// Bun and Deno
Bun.serve({ fetch: receive });
Deno.serve(receive);
```

</details>

With Express, give the route the raw body with `express.raw`, not `express.json`: the signature covers the bytes as sent, and JSON parsed and serialised again no longer matches.

```ts
import express from 'express';
import { Webhook, WebhookSignatureError } from 'flightbyte';

app.post('/hooks/flightbyte', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = await Webhook.constructEvent(req.body, req.get(Webhook.SIGNATURE_HEADER), signingSecret);
  } catch (err) {
    return res.sendStatus(err instanceof WebhookSignatureError ? 401 : 400);
  }
  res.sendStatus(200);

  switch (event.type) {
    case 'flight.updated':
      for (const change of event.changes) console.log(`${event.flightKey} ${change.type}: ${change.message}`);
      break;
    case 'subscription.completed':
      console.log(`${event.flightKey} finished`);
      break;
  }
});
```

A receiver on Node's own `http` server, with no framework, is in [examples/webhook-node.mjs](examples/webhook-node.mjs).

<details>
<summary><b>How the signature works</b></summary>

<br>

```text
x-flightbyte-signature: t=1789305971,v1=5f1c9a...e3b2
v1 = HMAC-SHA256(secret, "<t>." + <raw body>)
```

`Webhook.verify` computes the HMAC over the body you received, compares it in constant time with Web Crypto's `crypto.subtle.verify`, accepts any of several `v1` values, and rejects a `t` more than five minutes from now. `Webhook.sign` produces the same header, for testing your receiver. The test suite checks both against signatures made by the API's own signer.

The reasons behind each step are in [Verifying webhook signatures](https://flightbyte.dev/guides/verifying-webhook-signatures), and reference receivers in Node.js, Python and Go are in [flightbyte-webhook-examples](https://github.com/FlightByte-dev/flightbyte-webhook-examples).

</details>

## Errors

Every failed request rejects with a subclass of `FlightByteError`, so you branch with `instanceof`.

| Error | Status | When, and what to do |
| --- | --- | --- |
| `BadRequestError` | `400` | Invalid input; `messages` has one line per field. For a number that flies twice, `legs` lists them: pass one's `origin`. |
| `AuthenticationError` | `401` | Missing, invalid, revoked or expired API key. |
| `PaymentRequiredError` | `402` | No watched flights left. `code` says why: `watched_flight_limit`, `overage_cap_reached` (see `resetsAt`) or `credits_exhausted` (see `balance` and `expiresAt`). |
| `PermissionDeniedError` | `403` | The account is suspended, or a token lacks the scope (`code`). |
| `NotFoundError` | `404` | The flight did not operate that day, or no such subscription. |
| `RateLimitError` | `429` | A minute, day or month quota is used up. Wait `retryAfterSeconds`. |
| `UpstreamError` | `502` | The flight data provider failed. Retry shortly. It is also a `ServerError`. |
| `ServerError`, `UnexpectedStatusError` | other | Anything else. `requestId` is what support asks for. |
| `ConnectionError` | none | No response at all: network error, or `timedOut` when the timeout ran out. |

```ts
import { BadRequestError, PaymentRequiredError, RateLimitError } from 'flightbyte';

try {
  await client.subscriptions.create(params);
} catch (err) {
  if (err instanceof BadRequestError && err.legs.length > 0) {
    console.log('Pick a leg:', err.legs.map((leg) => leg.origin).join(', '));
  } else if (err instanceof PaymentRequiredError) {
    console.log(`No watched flights left (${err.code}) until ${err.resetsAt}`);
  } else if (err instanceof RateLimitError) {
    await new Promise((resolve) => setTimeout(resolve, (err.retryAfterSeconds ?? 5) * 1000));
  } else {
    throw err;
  }
}
```

A request you cancel with your own `AbortSignal` rejects with that signal's reason, as `fetch` does. Every status is explained in the [errors docs](https://flightbyte.dev/docs/errors).

## Built for every JavaScript runtime

- **Node, Bun, Deno, Cloudflare Workers and Vercel Edge.** The package uses only `fetch`, Web Crypto and other web-standard APIs, and CI runs it on Node, Bun and Deno. ES modules, with `require()` working on Node 20.19 and later.
- **No dependencies.** Nothing to audit but this package.
- **Your key stays on your server.** An API key or a signing secret shipped inside a browser or mobile app can be pulled out of it by anyone who has the app. Flag images are the exception: `countries.flagUrl` needs no key.
- **Your key stays with the API.** The client follows a redirect only for a read, and only on the API's own origin, so a misdirected answer cannot carry the key elsewhere and a write is never sent twice.
- **New API values don't break old code.** A phase, status or change type added after this release is still a valid string. The tests check every method and every type against the API's OpenAPI document, so a field the API adds shows up as a failing test here first, not as a missing property in your code.
- **Zero stays apart from unknown.** Fields the API may leave out are optional and fields it may send as `null` include `null`, so a delay of `0` and no delay reading are different things.
- **Errors say what to do next.** A number that flies twice comes back with its legs, a `429` with how long to wait, a `402` with the reason and when the allowance resets.
- **Quotas are visible.** `client.lastRateLimit` holds the minute, day and month windows from the latest response's `X-RateLimit-*` headers.

## Configuration

```ts
const client = new FlightByte({
  apiKey: process.env.FLIGHTBYTE_API_KEY!,
  baseUrl: 'http://localhost:3000/v1',
  fetch: myFetch,
  timeoutMs: 10_000,
  userAgent: 'my-app/1.2',
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `apiKey` | required | Your API key, sent as `x-api-key`. |
| `baseUrl` | `https://api.flightbyte.dev/v1` | API base URL, e.g. `http://localhost:3000/v1` for a local API. |
| `fetch` | the global `fetch` | Bring your own for proxies, logging or tests. |
| `timeoutMs` | `30000` | Bounds each request, response body included. `0` leaves it to your `signal`. |
| `userAgent` | none | Put in front of `flightbyte-node/<version>` in the `user-agent` header. |

## Development

```bash
npm ci
npm run check            # typecheck, lint, test and build
npm run sync:openapi     # refresh spec/openapi.json, then run the tests against it
node tool/webhook_vectors.mjs
```

The tests never touch the real API and need no key. They cover every method's request mapping, the error class for each status, redirects against real local servers, the types against fixtures shaped like the API's JSON and against the API's OpenAPI document, and webhook verification against signatures made with Node's `createHmac` exactly as the API signs them. CI runs them on Node 22 and 24, and runs the built package on Node 20.19, Bun and Deno.

How to add a field, an enum value or an endpoint is in [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues by email, as [SECURITY.md](SECURITY.md) explains, never in a public issue.

<details>
<summary><b>Project layout</b></summary>

```text
src/
  index.ts                 public exports
  client.ts                FlightByte and its options
  request.ts               requests, headers, timeouts, redirects, error mapping
  resources/               flights, subscriptions, countries
  models.ts                the API's types and value lists
  errors.ts                FlightByteError and its subclasses
  webhook.ts               Webhook.verify, constructEvent, sign and fetchHandler
  rate-limit.ts            X-RateLimit-* headers
spec/openapi.json          the API document the tests check against
test/fixtures/             API-shaped JSON and signed webhook vectors
test/runtime/smoke.mjs     runs the built package on Node, Bun and Deno
examples/                  a lookup from the terminal and a receiver on node:http
scripts/sync-openapi.mjs   refreshes spec/openapi.json
tool/webhook_vectors.mjs   regenerates the signed vectors with Node, as the API signs
tool/release_notes.sh      a version's CHANGELOG.md section, for the GitHub release
```

</details>

<details>
<summary><b>Releasing</b></summary>

1. Set `version` in `package.json` and `VERSION` in `src/version.ts`; a test fails if they differ.
2. Give the version its own `## <version>` section in `CHANGELOG.md`.
3. Push a tag such as `v1.0.1`.

The release workflow checks that the tag, `package.json` and `src/version.ts` agree and that the changelog has the section, runs every check, publishes to npm with trusted publishing unless that version is already there, and creates the GitHub release from the changelog section. Run it by hand from the Actions tab to rehearse with `npm publish --dry-run`.

</details>

## License

[MIT](LICENSE)

<br>

<p align="center">
  <a href="https://flightbyte.dev"><img src="assets/icon.svg" alt="FlightByte" width="36"></a>
  <br>
  <sub><b>FlightByte</b> · Flight intelligence, byte by byte · <a href="https://flightbyte.dev">flightbyte.dev</a></sub>
</p>
