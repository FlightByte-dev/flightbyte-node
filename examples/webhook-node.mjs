// Receives FlightByte webhooks on Node's own http server and logs each change.
//
//   npm run build
//   FLIGHTBYTE_WEBHOOK_SECRET=whsec_... node examples/webhook-node.mjs
//
// It listens on :8080 (or $PORT) at POST /hooks/flightbyte. Point a
// subscription's webhookUrl there, through a tunnel when running locally.
import { createServer } from 'node:http';
import { Webhook, WebhookSignatureError } from 'flightbyte';

const secret = process.env.FLIGHTBYTE_WEBHOOK_SECRET;
if (!secret) {
  console.error("Set FLIGHTBYTE_WEBHOOK_SECRET to the subscription's signing secret.");
  process.exit(1);
}

// Retries carry the same event id. A real receiver keeps these in its database.
const seen = new Set();

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/hooks/flightbyte') {
    res.writeHead(404).end();
    return;
  }

  // The raw body, exactly as received: the signature covers these bytes.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const payload = Buffer.concat(chunks);

  let event;
  try {
    event = await Webhook.constructEvent(payload, req.headers[Webhook.SIGNATURE_HEADER], secret);
  } catch (error) {
    res.writeHead(error instanceof WebhookSignatureError ? 401 : 400).end();
    return;
  }

  // Answer first: FlightByte treats a delivery as failed after 10 seconds.
  res.writeHead(200).end('ok');

  if (seen.has(event.id)) return;
  seen.add(event.id);
  if (event.type === 'flight.updated') {
    for (const change of event.changes) console.log(`${event.flightKey} ${change.type}: ${change.message}`);
  } else {
    console.log(`${event.flightKey} ${event.type}`);
  }
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => console.log(`listening on :${port}/hooks/flightbyte`));
