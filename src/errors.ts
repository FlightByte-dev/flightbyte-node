/** Base class of every error this package throws. */
export class FlightByteError extends Error {
  override readonly name: string = 'FlightByteError';
}

/**
 * A request got no HTTP response: no network, a DNS failure, a refused
 * connection, or the timeout ran out. A request you cancel yourself with an
 * `AbortSignal` rejects with that signal's reason instead, as `fetch` does.
 */
export class ConnectionError extends FlightByteError {
  override readonly name: string = 'ConnectionError';
  /** Whether the client's own timeout ran out. */
  readonly timedOut: boolean;

  /** @internal */
  constructor(message: string, options: { cause: unknown; timedOut?: boolean }) {
    super(message, { cause: options.cause });
    this.timedOut = options.timedOut ?? false;
  }
}

/** One of the legs listed by an ambiguous-flight {@link BadRequestError}. */
export interface AmbiguousLeg {
  /** Origin IATA code. */
  origin: string;
  /** Destination IATA code. */
  destination: string;
  /** Operating carrier. */
  carrier?: string;
  /** Scheduled local departure, `HH:mm`. */
  scheduledDepartureLocal?: string;
  /** Upstream flight id. */
  flightId?: string;
}

/**
 * The API answered with a non-2xx status. The fields mirror the API's error
 * body. Branch on the subclass with `instanceof`:
 *
 * ```ts
 * try {
 *   await client.flights.get({ carrier: 'TK', flightNumber: '1', date: '2026-09-08' });
 * } catch (err) {
 *   if (err instanceof NotFoundError) console.log('No such flight that day');
 *   else if (err instanceof RateLimitError) await sleep(err.retryAfterSeconds * 1000);
 *   else throw err;
 * }
 * ```
 */
export class APIError extends FlightByteError {
  override readonly name: string = 'APIError';
  /** The HTTP status. */
  readonly status: number;
  /** Every message the API sent. Validation errors send one per field. */
  readonly messages: string[];
  /** The decoded error body; empty when it was not a JSON object. */
  readonly body: Record<string, unknown>;
  /** The body exactly as received. */
  readonly rawBody: string;
  /** The response headers. */
  readonly headers: Headers;

  /** @internal */
  constructor(status: number, statusText: string, rawBody: string, headers: Headers) {
    const body = decodeBody(rawBody);
    const messages = readMessages(body);
    const requestId = stringField(body, 'requestId') ?? headers.get('x-request-id') ?? undefined;
    // HTTP/2 and some runtimes leave statusText empty; the API's own phrase fills in.
    const phrase = statusText || stringField(body, 'error') || '';
    const label = [status, phrase].filter(Boolean).join(' ');
    let message = messages.length > 0 ? `${label}: ${messages.join('; ')}` : label;
    if (requestId) message += ` (request ${requestId})`;
    super(message);
    this.status = status;
    this.messages = messages;
    this.body = body;
    this.rawBody = rawBody;
    this.headers = headers;
  }

  /**
   * A machine-readable reason, when the API sends one, for example
   * `watched_flight_limit` or `account_suspended`.
   */
  get code(): string | undefined {
    return stringField(this.body, 'code');
  }

  /** Identifies the request; quote it when contacting support. */
  get requestId(): string | undefined {
    return stringField(this.body, 'requestId') ?? this.headers.get('x-request-id') ?? undefined;
  }

  /** @internal Builds the subclass for `status`. */
  static from(status: number, statusText: string, rawBody: string, headers: Headers): APIError {
    const Type = errorClassFor(status);
    return new Type(status, statusText, rawBody, headers);
  }
}

/**
 * 400: the request was invalid. When a flight number flies several legs that
 * day and no `origin` chose one, {@link BadRequestError.legs} lists them.
 */
export class BadRequestError extends APIError {
  override readonly name: string = 'BadRequestError';

  /** The legs to choose from; pass one's `origin` or `flightId` and try again. */
  get legs(): AmbiguousLeg[] {
    const legs = this.body['legs'];
    if (!Array.isArray(legs)) return [];
    return legs.flatMap((item: unknown) => {
      if (!isObject(item)) return [];
      const leg: AmbiguousLeg = {
        origin: stringField(item, 'origin') ?? '',
        destination: stringField(item, 'destination') ?? '',
      };
      const carrier = stringField(item, 'carrier');
      const departure = stringField(item, 'scheduledDepartureLocal');
      const flightId = stringField(item, 'flightId');
      if (carrier !== undefined) leg.carrier = carrier;
      if (departure !== undefined) leg.scheduledDepartureLocal = departure;
      if (flightId !== undefined) leg.flightId = flightId;
      return [leg];
    });
  }
}

/** 401: the API key is missing, invalid, revoked or expired. */
export class AuthenticationError extends APIError {
  override readonly name: string = 'AuthenticationError';
}

/**
 * 402: no watched flights are left. `code` says why:
 * `watched_flight_limit` (the plan's cap), `overage_cap_reached` (the
 * account's overage cap) or `credits_exhausted` (prepaid credits used up).
 */
export class PaymentRequiredError extends APIError {
  override readonly name: string = 'PaymentRequiredError';

  /** Watched flights the usage period allows. Not with `credits_exhausted`. */
  get limit(): number | undefined {
    return numberField(this.body, 'limit');
  }
  /** Watched flights created this usage period. Not with `credits_exhausted`. */
  get used(): number | undefined {
    return numberField(this.body, 'used');
  }
  /** When the usage period, and so the count, resets, ISO 8601. */
  get resetsAt(): string | undefined {
    return stringField(this.body, 'resetsAt');
  }
  /** The overage cap in US cents; only with `overage_cap_reached`. */
  get capCents(): number | undefined {
    return numberField(this.body, 'capCents');
  }
  /** Prepaid credits left; only with `credits_exhausted`. */
  get balance(): number | undefined {
    return numberField(this.body, 'balance');
  }
  /** When the credits expire or expired, ISO 8601; only with `credits_exhausted`. */
  get expiresAt(): string | undefined {
    return stringField(this.body, 'expiresAt');
  }
}

/**
 * 403: the account is suspended (`code: account_suspended`) or a token lacks
 * the scope (`code: insufficient_scope`).
 */
export class PermissionDeniedError extends APIError {
  override readonly name: string = 'PermissionDeniedError';
}

/** 404: the flight did not operate that day, or no such subscription. */
export class NotFoundError extends APIError {
  override readonly name: string = 'NotFoundError';
}

/** 429: a minute, day or month quota is used up. */
export class RateLimitError extends APIError {
  override readonly name: string = 'RateLimitError';

  /** The window that ran out: `minute`, `day` or `month`. */
  get window(): string | undefined {
    return stringField(this.body, 'window');
  }

  /** How long to wait before retrying, from the body or the `Retry-After` header. */
  get retryAfterSeconds(): number | undefined {
    const fromBody = numberField(this.body, 'retryAfterSeconds');
    if (fromBody !== undefined) return fromBody;
    const header = Number.parseInt(this.headers.get('retry-after') ?? '', 10);
    return Number.isFinite(header) ? header : undefined;
  }
}

/** 5xx: the API failed. `requestId` is what support asks for. */
export class ServerError extends APIError {
  override readonly name: string = 'ServerError';
}

/**
 * 502: the upstream flight data provider failed. Safe to retry after a short
 * wait. It is also a {@link ServerError}.
 */
export class UpstreamError extends ServerError {
  override readonly name: string = 'UpstreamError';
}

/**
 * Any other non-2xx status, including a redirect this client does not follow:
 * one to another origin, or one for a request other than GET or HEAD. The
 * target is in `location`.
 */
export class UnexpectedStatusError extends APIError {
  override readonly name: string = 'UnexpectedStatusError';

  /** Where a 3xx pointed, when it did. */
  get location(): string | undefined {
    return this.headers.get('location') ?? undefined;
  }
}

/** The webhook signature did not verify. */
export class WebhookSignatureError extends FlightByteError {
  override readonly name: string = 'WebhookSignatureError';
}

type ErrorClass = new (status: number, statusText: string, rawBody: string, headers: Headers) => APIError;

function errorClassFor(status: number): ErrorClass {
  switch (status) {
    case 400:
      return BadRequestError;
    case 401:
      return AuthenticationError;
    case 402:
      return PaymentRequiredError;
    case 403:
      return PermissionDeniedError;
    case 404:
      return NotFoundError;
    case 429:
      return RateLimitError;
    case 502:
      return UpstreamError;
  }
  return status >= 500 && status <= 599 ? ServerError : UnexpectedStatusError;
}

function decodeBody(rawBody: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readMessages(body: Record<string, unknown>): string[] {
  const message = body['message'];
  if (typeof message === 'string') return [message];
  if (Array.isArray(message)) return message.map((m) => String(m));
  return [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  return typeof value === 'string' ? value : undefined;
}

function numberField(object: Record<string, unknown>, key: string): number | undefined {
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
