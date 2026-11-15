import { FlightByteError, WebhookSignatureError } from './errors.js';
import type { WebhookEvent } from './models.js';

/** Options for {@link Webhook.verify} and the functions built on it. */
export interface VerifyOptions {
  /**
   * How far the signing time may be from now, in seconds. `0` skips the
   * check. Defaults to 300, as on the API.
   */
  toleranceSeconds?: number;
  /** The time to check against instead of now. Useful in tests. */
  now?: Date | number;
}

/** Options for {@link Webhook.fetchHandler}. */
export interface FetchHandlerOptions extends VerifyOptions {
  /**
   * Called with what `handle` threw, after the handler answered 500 so the
   * API retries the delivery. Defaults to `console.error`.
   */
  onError?: (error: unknown, event: WebhookEvent, request: Request) => void;
}

/** The payload as received: the raw body, before any JSON parsing. */
export type WebhookPayload = string | Uint8Array;

/**
 * Verifies and decodes the webhooks FlightByte posts to your receiver.
 *
 * Each delivery carries an `x-flightbyte-signature` header of the form
 * `t=<unix seconds>,v1=<hex>`, where the hex is HMAC-SHA256 of
 * `"<t>.<raw body>"` keyed with the subscription's signing secret.
 *
 * It uses Web Crypto, so it runs on Node, Bun, Deno and edge runtimes, and
 * its methods are async. Keep the signing secret on your server.
 */
export class Webhook {
  /** Header carrying the signature. */
  static readonly SIGNATURE_HEADER = 'x-flightbyte-signature';
  /** Header carrying the signing time, in unix seconds. */
  static readonly TIMESTAMP_HEADER = 'x-flightbyte-timestamp';
  /** Header carrying the event id. */
  static readonly EVENT_ID_HEADER = 'x-flightbyte-event-id';
  /** Header carrying the event type. */
  static readonly EVENT_TYPE_HEADER = 'x-flightbyte-event-type';
  /** Header carrying the subscription id. */
  static readonly SUBSCRIPTION_ID_HEADER = 'x-flightbyte-subscription-id';
  /** Header carrying the delivery attempt number, starting at 1. */
  static readonly DELIVERY_ATTEMPT_HEADER = 'x-flightbyte-delivery-attempt';
  /** How far the signing time may be from now by default: 5 minutes. */
  static readonly DEFAULT_TOLERANCE_SECONDS = 300;
  /** The largest body {@link Webhook.fetchHandler} reads: 1 MiB. */
  static readonly MAX_BODY_BYTES = 1024 * 1024;

  private constructor() {}

  /**
   * Checks `signature` (the `x-flightbyte-signature` header) against the raw
   * body `payload` and the subscription's `secret`.
   *
   * `payload` must be the body exactly as received. With Express that means
   * `express.raw({ type: 'application/json' })`, not `express.json()`.
   *
   * @throws {@link WebhookSignatureError} when the signature does not verify.
   * @throws `TypeError` when `secret` is empty: anyone can sign with an empty
   * key, so it usually means the secret was not configured.
   */
  static async verify(
    payload: WebhookPayload,
    signature: string | null | undefined,
    secret: string,
    options: VerifyOptions = {},
  ): Promise<void> {
    checkSecret(secret);
    const { timestamp, signatures } = parseSignature(signature);

    const tolerance = options.toleranceSeconds ?? Webhook.DEFAULT_TOLERANCE_SECONDS;
    if (tolerance > 0) {
      const now = Math.floor(toMillis(options.now ?? Date.now()) / 1000);
      // Compared against both edges, so an extreme timestamp cannot slip through.
      if (Number(timestamp) < now - tolerance || Number(timestamp) > now + tolerance) {
        throw new WebhookSignatureError('The signature timestamp is outside the tolerance window.');
      }
    }

    const key = await hmacKey(secret);
    const message = signedMessage(timestamp, payload);
    for (const candidate of signatures) {
      const bytes = hexToBytes(candidate);
      // crypto.subtle.verify compares in constant time.
      if (bytes && (await crypto.subtle.verify('HMAC', key, bytes, message))) return;
    }
    throw new WebhookSignatureError('The signature does not match the payload.');
  }

  /** Whether `signature` verifies; see {@link Webhook.verify}. */
  static async isValid(
    payload: WebhookPayload,
    signature: string | null | undefined,
    secret: string,
    options?: VerifyOptions,
  ): Promise<boolean> {
    try {
      await Webhook.verify(payload, signature, secret, options);
      return true;
    } catch (error) {
      if (error instanceof WebhookSignatureError) return false;
      throw error;
    }
  }

  /**
   * Verifies the signature, then decodes the event.
   *
   * @throws {@link WebhookSignatureError} when the signature does not verify.
   * @throws {@link FlightByteError} when the verified body is not a webhook event.
   */
  static async constructEvent(
    payload: WebhookPayload,
    signature: string | null | undefined,
    secret: string,
    options?: VerifyOptions,
  ): Promise<WebhookEvent> {
    await Webhook.verify(payload, signature, secret, options);
    const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
    let event: unknown;
    try {
      event = JSON.parse(text);
    } catch (error) {
      throw new FlightByteError('The webhook body is not JSON.', { cause: error });
    }
    if (!isEvent(event)) throw new FlightByteError('The webhook body is not a FlightByte event.');
    return event;
  }

  /**
   * Signs `payload` the way the API does and returns the
   * `x-flightbyte-signature` header value. Useful for testing your receiver.
   */
  static async sign(payload: WebhookPayload, secret: string, options: { timestamp?: Date | number } = {}): Promise<string> {
    checkSecret(secret);
    const timestamp = String(Math.floor(toMillis(options.timestamp ?? Date.now()) / 1000));
    const key = await hmacKey(secret);
    const mac = await crypto.subtle.sign('HMAC', key, signedMessage(timestamp, payload));
    return `t=${timestamp},v1=${bytesToHex(new Uint8Array(mac))}`;
  }

  /**
   * A receiver for runtimes built on `Request` and `Response`: Cloudflare
   * Workers, `Bun.serve`, `Deno.serve`, Next.js route handlers, Hono and the
   * like. It reads up to {@link Webhook.MAX_BODY_BYTES}, verifies the
   * signature, decodes the event and calls `handle`.
   *
   * It answers 401 when the signature does not verify, 400 when the body is
   * not an event, 500 when `handle` throws (so FlightByte retries) and 200
   * otherwise. Retries carry the same event id: deduplicate on `event.id`.
   * What `handle` throws goes to `options.onError`, by default
   * `console.error`.
   *
   * It throws a `TypeError` right away when `secret` is empty, so an unset
   * environment variable fails at startup instead of accepting forged events.
   *
   * ```ts
   * // Next.js App Router: app/api/flightbyte/route.ts
   * export const POST = Webhook.fetchHandler(process.env.FLIGHTBYTE_WEBHOOK_SECRET!, async (event) => {
   *   console.log(event.type, event.flightKey);
   * });
   * ```
   */
  static fetchHandler(
    secret: string,
    handle: (event: WebhookEvent, request: Request) => unknown,
    options: FetchHandlerOptions = {},
  ): (request: Request) => Promise<Response> {
    checkSecret(secret);
    if (typeof handle !== 'function') throw new TypeError('flightbyte: fetchHandler needs a handle function.');
    const { onError = reportHandlerError, ...verifyOptions } = options;
    return async (request) => {
      if (request.method !== 'POST') {
        return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
      }
      let payload: Uint8Array;
      try {
        payload = await readLimited(request, Webhook.MAX_BODY_BYTES);
      } catch (error) {
        return error instanceof BodyTooLarge
          ? new Response('body too large', { status: 413 })
          : new Response('could not read the body', { status: 400 });
      }
      let event: WebhookEvent;
      try {
        event = await Webhook.constructEvent(
          payload,
          request.headers.get(Webhook.SIGNATURE_HEADER),
          secret,
          verifyOptions,
        );
      } catch (error) {
        return error instanceof WebhookSignatureError
          ? new Response('invalid signature', { status: 401 })
          : new Response('invalid event', { status: 400 });
      }
      try {
        await handle(event, request);
      } catch (error) {
        try {
          onError(error, event, request);
        } catch {
          // A failing reporter must not change the answer.
        }
        return new Response('handler failed', { status: 500 });
      }
      return new Response('ok', { status: 200 });
    };
  }
}

/** Splits `t=<seconds>,v1=<hex>[,v1=<hex>...]`. */
export function parseSignature(header: string | null | undefined): { timestamp: string; signatures: string[] } {
  if (typeof header !== 'string' || header.trim() === '') {
    throw new WebhookSignatureError('The signature header is missing.');
  }
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value.toLowerCase());
  }
  if (timestamp === undefined || !/^\d{1,15}$/.test(timestamp)) {
    throw new WebhookSignatureError('The signature header has no valid timestamp.');
  }
  if (signatures.length === 0) {
    throw new WebhookSignatureError('The signature header has no v1 signature.');
  }
  return { timestamp, signatures };
}

const encoder = new TextEncoder();

function checkSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new TypeError(
      'flightbyte: the webhook signing secret is empty. Anyone can sign with an empty key; set the subscription\'s secret.',
    );
  }
}

function reportHandlerError(error: unknown, event: WebhookEvent): void {
  console.error(`flightbyte: the webhook handler failed for event ${event.id} (${event.type}):`, error);
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** `"<t>." + payload`, as bytes backed by a plain ArrayBuffer. */
function signedMessage(timestamp: string, payload: WebhookPayload): Uint8Array<ArrayBuffer> {
  const prefix = encoder.encode(`${timestamp}.`);
  const body = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix, 0);
  message.set(body, prefix.length);
  return message;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[0-9a-f]{64}$/.test(hex)) return undefined;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toMillis(time: Date | number): number {
  return typeof time === 'number' ? time : time.getTime();
}

function isEvent(value: unknown): value is WebhookEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event['id'] === 'string' && typeof event['type'] === 'string';
}

class BodyTooLarge extends Error {}

async function readLimited(request: Request, max: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new BodyTooLarge();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
