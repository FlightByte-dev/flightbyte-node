/**
 * The official client for the FlightByte flight status API: look flights up,
 * watch them with signed webhooks and verify every delivery.
 *
 * @packageDocumentation
 */
export { FlightByte, type FlightByteOptions } from './client.js';
export {
  APIError,
  AuthenticationError,
  BadRequestError,
  ConnectionError,
  FlightByteError,
  NotFoundError,
  PaymentRequiredError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  UnexpectedStatusError,
  UpstreamError,
  WebhookSignatureError,
  type AmbiguousLeg,
} from './errors.js';
export * from './models.js';
export type { RateLimit, RateLimitWindow } from './rate-limit.js';
export type { QueryValue, RequestOptions } from './request.js';
export { Countries, type CountryOptions } from './resources/countries.js';
export { Flights } from './resources/flights.js';
export {
  maskSecret,
  Subscriptions,
  type CreateOptions,
  type HistoryOptions,
  type ListAllParams,
} from './resources/subscriptions.js';
export { VERSION } from './version.js';
export { Webhook, type FetchHandlerOptions, type VerifyOptions, type WebhookPayload } from './webhook.js';
