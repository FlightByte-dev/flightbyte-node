## 1.0.0

- First release.
- `FlightByte` with `flights` (`get`, `timeline`), `subscriptions` (`create`, `list`, `listAll`, `get`, `update`, `delete`, `pause`, `resume`, `sendTest`, `deliveries`, `events`, `secret`, `rotateSecret`) and `countries` (`list`, `get`, `flagUrl`).
- Types for every response, checked against the API's OpenAPI document. Responses come back exactly as the API sent them.
- `FlightByteError` and a subclass for each error status, including the `credits_exhausted` reason of a 402 with its `balance` and `expiresAt`.
- `Webhook.verify`, `Webhook.constructEvent`, `Webhook.sign` and `Webhook.fetchHandler` for `x-flightbyte-signature` webhook signatures, on Web Crypto.
- An empty webhook signing secret is refused with a `TypeError`, by `Webhook.fetchHandler` as soon as it is built, since anyone can sign with an empty key. `Webhook.fetchHandler` reports what your function throws to `console.error`, or to its `onError` option.
- `client.lastRateLimit` from the `X-RateLimit-*` headers.
- Redirects to another origin, or from https to http, are never followed, so the API key stays with the API.
- No dependencies. Runs on Node 20.19 and later, Bun, Deno, Cloudflare Workers and Vercel Edge.
