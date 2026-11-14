import { describe, expect, it } from 'vitest';
import {
  APIError,
  AuthenticationError,
  BadRequestError,
  FlightByteError,
  NotFoundError,
  PaymentRequiredError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  UnexpectedStatusError,
  UpstreamError,
} from '../src/index.js';
import { client, json, mockFetch } from './helpers/mock.js';

async function failWith(status: number, body: unknown, headers: Record<string, string> = {}): Promise<APIError> {
  const mock = mockFetch(() => json(status, body, headers));
  const error = await client(mock.fetch)
    .subscriptions.get('sub_1')
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(APIError);
  return error as APIError;
}

describe('status mapping', () => {
  it.each([
    [400, BadRequestError],
    [401, AuthenticationError],
    [402, PaymentRequiredError],
    [403, PermissionDeniedError],
    [404, NotFoundError],
    [409, UnexpectedStatusError],
    [422, UnexpectedStatusError],
    [429, RateLimitError],
    [500, ServerError],
    [502, UpstreamError],
    [503, ServerError],
  ])('%i is a %o', async (status, Type) => {
    const error = await failWith(status, { statusCode: status, message: 'x' });
    expect(error).toBeInstanceOf(Type);
    expect(error).toBeInstanceOf(FlightByteError);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(status);
    expect(error.name).toBe(Type.name);
  });

  it('counts a 502 as a server error too', async () => {
    expect(await failWith(502, {})).toBeInstanceOf(ServerError);
  });
});

describe('error bodies', () => {
  it('reads every message and the request id', async () => {
    const error = await failWith(400, {
      statusCode: 400,
      error: 'Bad Request',
      message: ['carrier must be 2 or 3 characters', 'date must be YYYY-MM-DD'],
      requestId: 'req_123',
    });
    expect(error.messages).toEqual(['carrier must be 2 or 3 characters', 'date must be YYYY-MM-DD']);
    expect(error.requestId).toBe('req_123');
    expect(error.body['error']).toBe('Bad Request');
    expect(error.message).toBe(
      '400 Bad Request: carrier must be 2 or 3 characters; date must be YYYY-MM-DD (request req_123)',
    );
  });

  it('lists the legs of an ambiguous flight', async () => {
    const error = (await failWith(400, {
      statusCode: 400,
      message: 'TK1 flies 2 legs on 2026-09-08; pass origin to choose one.',
      legs: [
        { origin: 'IST', destination: 'JFK', carrier: 'TK', scheduledDepartureLocal: '07:00', flightId: '1' },
        { origin: 'JFK', destination: 'IST', scheduledDepartureLocal: '21:00' },
        'junk',
      ],
    })) as BadRequestError;
    expect(error.legs).toEqual([
      { origin: 'IST', destination: 'JFK', carrier: 'TK', scheduledDepartureLocal: '07:00', flightId: '1' },
      { origin: 'JFK', destination: 'IST', scheduledDepartureLocal: '21:00' },
    ]);
  });

  it('reads the reason a watched flight was refused', async () => {
    const capped = (await failWith(402, {
      statusCode: 402,
      code: 'overage_cap_reached',
      message: 'No watched flights left.',
      limit: 10,
      used: 10,
      resetsAt: '2026-10-01T00:00:00.000Z',
      capCents: 500,
    })) as PaymentRequiredError;
    expect(capped.code).toBe('overage_cap_reached');
    expect([capped.limit, capped.used, capped.resetsAt, capped.capCents]).toEqual([
      10,
      10,
      '2026-10-01T00:00:00.000Z',
      500,
    ]);
    expect(capped.balance).toBeUndefined();

    const credits = (await failWith(402, {
      statusCode: 402,
      code: 'credits_exhausted',
      message: 'No credits left.',
      balance: 0,
      expiresAt: '2027-01-01T00:00:00.000Z',
    })) as PaymentRequiredError;
    expect(credits.code).toBe('credits_exhausted');
    expect(credits.balance).toBe(0);
    expect(credits.expiresAt).toBe('2027-01-01T00:00:00.000Z');
    expect(credits.limit).toBeUndefined();
  });

  it('reads how long to wait, from the body or the Retry-After header', async () => {
    const fromBody = (await failWith(429, { window: 'minute', retryAfterSeconds: 12 })) as RateLimitError;
    expect(fromBody.window).toBe('minute');
    expect(fromBody.retryAfterSeconds).toBe(12);
    const fromHeader = (await failWith(429, { message: 'slow down' }, { 'retry-after': '30' })) as RateLimitError;
    expect(fromHeader.retryAfterSeconds).toBe(30);
    const unknown = (await failWith(429, {})) as RateLimitError;
    expect(unknown.retryAfterSeconds).toBeUndefined();
  });

  it('copes with a body that is not JSON', async () => {
    const mock = mockFetch(
      () =>
        new Response('<html>Service Unavailable</html>', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'x-request-id': 'req_from_header' },
        }),
    );
    const error = (await client(mock.fetch)
      .countries.list()
      .catch((e: unknown) => e)) as ServerError;
    expect(error).toBeInstanceOf(ServerError);
    expect(error.messages).toEqual([]);
    expect(error.body).toEqual({});
    expect(error.rawBody).toBe('<html>Service Unavailable</html>');
    expect(error.requestId).toBe('req_from_header');
    expect(error.message).toBe('503 Service Unavailable (request req_from_header)');
  });

  it('carries the code of a suspended account', async () => {
    const error = await failWith(403, { message: 'This account is suspended.', code: 'account_suspended' });
    expect(error).toBeInstanceOf(PermissionDeniedError);
    expect(error.code).toBe('account_suspended');
  });
});
