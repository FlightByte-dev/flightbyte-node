import { describe, expect, it } from 'vitest';
import { FlightByteError, Webhook, WebhookSignatureError, type WebhookEvent } from '../src/index.js';
import { parseSignature } from '../src/webhook.js';
import { fixture } from './helpers/mock.js';

/** Signatures made by tool/webhook_vectors.mjs with Node's createHmac, exactly as the API signs. */
const vectors = JSON.parse(fixture('webhook_vectors.json')) as {
  secret: string;
  timestamp: number;
  cases: Array<{ file: string; signature: string }>;
};
const at = vectors.timestamp * 1000;
const updated = vectors.cases[1]!;
const payload = fixture(updated.file);
const sig = updated.signature.split(',v1=')[1]!;

describe('Webhook.verify against the API signer', () => {
  it.each(vectors.cases)('$file', async ({ file, signature }) => {
    const body = fixture(file);
    await expect(Webhook.verify(body, signature, vectors.secret, { now: at })).resolves.toBeUndefined();
    await expect(Webhook.verify(new TextEncoder().encode(body), signature, vectors.secret, { now: at })).resolves.toBeUndefined();
    expect(await Webhook.sign(body, vectors.secret, { timestamp: at })).toBe(signature);
    const event = await Webhook.constructEvent(body, signature, vectors.secret, { now: at });
    expect(event.subscriptionId).toBe('sub_1');
  });
});

describe('Webhook.verify rejects', () => {
  const cases: Array<[string, string, string | null | undefined, string, number, RegExp]> = [
    ['the wrong secret', payload, updated.signature, `${vectors.secret}x`, at, /does not match/],
    ['a changed body', payload.replace('A22', 'A23'), updated.signature, vectors.secret, at, /does not match/],
    ['a re-encoded body', JSON.stringify(JSON.parse(payload), null, 2), updated.signature, vectors.secret, at, /does not match/],
    ['a missing header', payload, undefined, vectors.secret, at, /missing/],
    ['a null header', payload, null, vectors.secret, at, /missing/],
    ['no timestamp', payload, `v1=${sig}`, vectors.secret, at, /no valid timestamp/],
    ['a timestamp that is not a number', payload, `t=soon,v1=${sig}`, vectors.secret, at, /no valid timestamp/],
    ['a negative timestamp', payload, `t=-1,v1=${sig}`, vectors.secret, at, /no valid timestamp/],
    ['a huge timestamp', payload, `t=9223372036854775807,v1=${sig}`, vectors.secret, at, /no valid timestamp/],
    ['no signature', payload, `t=${vectors.timestamp}`, vectors.secret, at, /no v1 signature/],
    ['another scheme only', payload, `t=${vectors.timestamp},v0=${sig}`, vectors.secret, at, /no v1 signature/],
    ['a signature that is not hex', payload, `t=${vectors.timestamp},v1=${'z'.repeat(64)}`, vectors.secret, at, /does not match/],
    ['a short signature', payload, `t=${vectors.timestamp},v1=${sig.slice(0, 10)}`, vectors.secret, at, /does not match/],
    ['an old signature', payload, updated.signature, vectors.secret, at + 301_000, /tolerance/],
    ['a signature from the future', payload, updated.signature, vectors.secret, at - 301_000, /tolerance/],
  ];

  it.each(cases)('%s', async (_name, body, signature, secret, now, reason) => {
    const error = await Webhook.verify(body, signature, secret, { now }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebhookSignatureError);
    expect((error as Error).message).toMatch(reason);
    expect(await Webhook.isValid(body, signature, secret, { now })).toBe(false);
    await expect(Webhook.constructEvent(body, signature, secret, { now })).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('a tighter tolerance', async () => {
    await expect(
      Webhook.verify(payload, updated.signature, vectors.secret, { now: at + 60_000, toleranceSeconds: 30 }),
    ).rejects.toThrow(/tolerance/);
  });
});

describe('Webhook.verify accepts', () => {
  const t = `t=${vectors.timestamp}`;
  const v1 = `v1=${sig}`;
  it.each([
    ['at the edge of the window', updated.signature, at + 300_000, undefined],
    ['any time with the check off', updated.signature, at + 86_400_000, 0],
    ['two v1, the second right', `${t},v1=${'0'.repeat(64)},${v1}`, at, undefined],
    ['upper-case hex', `${t},v1=${sig.toUpperCase()}`, at, undefined],
    ['spaces around parts', ` ${t} , ${v1} `, at, undefined],
    ['an unknown scheme as well', `${t},v0=abc,${v1}`, at, undefined],
    ['a part without an equal sign', `${t},junk,${v1}`, at, undefined],
  ])('%s', async (_name, signature, now, toleranceSeconds) => {
    const options = toleranceSeconds === undefined ? { now } : { now, toleranceSeconds };
    await expect(Webhook.verify(payload, signature, vectors.secret, options)).resolves.toBeUndefined();
    expect(await Webhook.isValid(payload, signature, vectors.secret, options)).toBe(true);
  });

  it('a fresh signature with the real clock', async () => {
    const body = '{"id":"evt_9","type":"subscription.test"}';
    const signature = await Webhook.sign(body, 'whsec_roundtrip');
    await expect(Webhook.verify(body, signature, 'whsec_roundtrip')).resolves.toBeUndefined();
  });
});

describe('Webhook.constructEvent', () => {
  it('decodes the event', async () => {
    const event = await Webhook.constructEvent(payload, updated.signature, vectors.secret, { now: at });
    expect(event.type).toBe('flight.updated');
    expect(event.changes[0]).toMatchObject({ type: 'departure.gate.changed', from: 'A11', to: 'A22' });
    expect(event.changes[0]?.message).toContain('İstanbul');
  });

  it.each([
    ['not JSON', 'not json', /not JSON/],
    ['an array', '[1,2]', /not a FlightByte event/],
    ['an object without an id', '{"type":"x"}', /not a FlightByte event/],
  ])('rejects a signed body that is %s', async (_name, body, message) => {
    const signature = await Webhook.sign(body, 's');
    const error = await Webhook.constructEvent(body, signature, 's').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FlightByteError);
    expect(error).not.toBeInstanceOf(WebhookSignatureError);
    expect((error as Error).message).toMatch(message);
  });
});

describe('Webhook.fetchHandler', () => {
  const secret = 'whsec_handler';

  async function deliver(
    init: { method?: string; body?: BodyInit | null; signature?: string; headers?: Record<string, string> },
    handle: (event: WebhookEvent) => unknown = () => undefined,
  ) {
    let received: WebhookEvent | undefined;
    const handler = Webhook.fetchHandler(secret, (event) => {
      received = event;
      return handle(event);
    });
    const headers = new Headers(init.headers);
    if (init.signature) headers.set('x-flightbyte-signature', init.signature);
    const request = new Request('https://receiver.test/hooks', {
      method: init.method ?? 'POST',
      body: init.body ?? null,
      headers,
      ...(init.body instanceof ReadableStream ? { duplex: 'half' } : {}),
    } as RequestInit);
    const response = await handler(request);
    return { status: response.status, text: await response.text(), received };
  }

  it('answers 200 and hands over the event', async () => {
    const result = await deliver({ body: payload, signature: await Webhook.sign(payload, secret) });
    expect(result.status).toBe(200);
    expect(result.received?.id).toBe('evt_2');
  });

  it('answers 500 when the handler throws, so the API retries', async () => {
    const result = await deliver({ body: payload, signature: await Webhook.sign(payload, secret) }, () => {
      throw new Error('db down');
    });
    expect(result.status).toBe(500);
  });

  it('answers 500 when the handler rejects', async () => {
    const result = await deliver({ body: payload, signature: await Webhook.sign(payload, secret) }, () =>
      Promise.reject(new Error('db down')),
    );
    expect(result.status).toBe(500);
  });

  it.each([
    ['a bad signature', async () => Webhook.sign(payload, 'other')],
    ['no signature', async () => undefined],
    ['a stale signature', async () => Webhook.sign(payload, secret, { timestamp: Date.now() - 3_600_000 })],
  ])('answers 401 for %s without calling the handler', async (_name, sign) => {
    const result = await deliver({ body: payload, signature: await sign() });
    expect(result.status).toBe(401);
    expect(result.received).toBeUndefined();
  });

  it('answers 400 for a signed body that is not an event', async () => {
    const result = await deliver({ body: '[1,2]', signature: await Webhook.sign('[1,2]', secret) });
    expect(result.status).toBe(400);
  });

  it('answers 405 to anything but POST', async () => {
    const result = await deliver({ method: 'GET' });
    expect(result.status).toBe(405);
  });

  it('answers 413 to a body over the limit, declared or streamed', async () => {
    const big = 'a'.repeat(Webhook.MAX_BODY_BYTES + 1);
    expect((await deliver({ body: big, signature: 't=1,v1=00' })).status).toBe(413);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new Uint8Array(256 * 1024);
        for (let i = 0; i < 5; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    expect((await deliver({ body: stream, signature: 't=1,v1=00' })).status).toBe(413);
  });
});

describe('parseSignature', () => {
  it('never throws anything but a WebhookSignatureError', () => {
    const inputs = ['', ',,,=,t=,v1=', 't=1', '=1', 't==1,v1==', 't=1,v1=a,v1=b', '\u0000', 't=1'.repeat(1000)];
    for (let i = 0; i < 500; i++) {
      inputs.push(Array.from({ length: 20 }, () => String.fromCharCode(32 + Math.floor(Math.random() * 95))).join(''));
    }
    for (const input of inputs) {
      try {
        const parsed = parseSignature(input);
        expect(parsed.signatures.length).toBeGreaterThan(0);
      } catch (error) {
        expect(error).toBeInstanceOf(WebhookSignatureError);
      }
    }
  });
});
