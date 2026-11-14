/**
 * The shapes the FlightByte API answers with. Responses are returned exactly
 * as the API sent them: timestamps stay ISO 8601 strings, and nothing is
 * renamed or dropped. Type names follow the API's OpenAPI document.
 *
 * Fields the API may leave out are optional, and fields it may send as `null`
 * include `null`, so `delayMinutes: 0` and "no delay reading" stay apart.
 */

/**
 * A string enum the API may extend. The known values autocomplete; a value
 * added after this release is still a valid `string`, so nothing breaks.
 */
export type Open<T extends string> = T | (string & {});

/** Every flight phase this version knows, in the API's order. */
export const FLIGHT_PHASES = [
  'scheduled',
  'boarding',
  'departed',
  'en_route',
  'landed',
  'arrived',
  'cancelled',
  'diverted',
  'redirected',
  'unknown',
] as const;

/** The coarse lifecycle bucket of a flight. */
export type FlightPhase = Open<(typeof FLIGHT_PHASES)[number]>;

/** Whether the flight is finished: arrived, cancelled, diverted or redirected. */
export function isTerminalPhase(phase: FlightPhase): boolean {
  return phase === 'arrived' || phase === 'cancelled' || phase === 'diverted' || phase === 'redirected';
}

/** Every subscription status this version knows. */
export const SUBSCRIPTION_STATUSES = ['active', 'pending', 'paused', 'completed', 'suspended'] as const;

/**
 * The lifecycle of a subscription: `active` polls and delivers, `pending`
 * waits for the flight to be published upstream, `paused` was paused by you,
 * `completed` finished after the flight did, `suspended` was disabled by the
 * API, for example after repeated delivery failures.
 */
export type SubscriptionStatus = Open<(typeof SUBSCRIPTION_STATUSES)[number]>;

/** Every flight change type this version knows, in the API's order. */
export const FLIGHT_CHANGE_TYPES = [
  'status.changed',
  'flight.departed',
  'flight.arrived',
  'flight.cancelled',
  'flight.diverted',
  'flight.reinstated',
  'departure.gate.changed',
  'departure.terminal.changed',
  'arrival.gate.changed',
  'arrival.terminal.changed',
  'arrival.baggage.changed',
  'departure.scheduled.changed',
  'departure.estimated.changed',
  'departure.actual.changed',
  'arrival.scheduled.changed',
  'arrival.estimated.changed',
  'arrival.actual.changed',
  'delay.increased',
  'delay.decreased',
  'aircraft.changed',
  'aircraft.tail.changed',
  'route.changed',
  'codeshares.changed',
] as const;

/**
 * The kind of change a `flight.updated` webhook reports, and what a
 * subscription's `events` filter is made of.
 */
export type FlightChangeType = Open<(typeof FLIGHT_CHANGE_TYPES)[number]>;

/** Every webhook event type this version knows. */
export const WEBHOOK_EVENT_TYPES = [
  'subscription.created',
  'subscription.activated',
  'subscription.test',
  'subscription.completed',
  'subscription.suspended',
  'flight.updated',
] as const;

/** The type of a webhook event. */
export type WebhookEventType = Open<(typeof WEBHOOK_EVENT_TYPES)[number]>;

/** Every delivery status this version knows. */
export const DELIVERY_STATUSES = ['delivered', 'failed'] as const;

/** The outcome of one webhook delivery attempt. */
export type DeliveryStatus = Open<(typeof DELIVERY_STATUSES)[number]>;

/** A country as it appears inside an airport. */
export interface CountryRef {
  /** ISO 3166-1 alpha-2 code, for example `TR`. */
  code: string;
  /** Country name. */
  name: string;
  /** Flag emoji. */
  emoji: string;
  /** Absolute URL of the 4:3 SVG flag. */
  flagSvg: string;
  /** Absolute URL of the 1:1 SVG flag. */
  flagSvgSquare: string;
}

/** A country from the `/countries` endpoints. */
export interface Country extends CountryRef {
  /** ISO 3166-1 alpha-2 code. */
  alpha2: string;
  /** Whether a flag image exists for the country. */
  hasFlag: boolean;
}

/** An airport. */
export interface AirportRef {
  /** IATA code, for example `IST`. */
  iata: string;
  /** ICAO code, for example `LTFM`. */
  icao?: string | null;
  /** The upstream's own airport code; it may differ from `iata`. */
  code?: string | null;
  /** Airport name. */
  name: string;
  /** City. */
  city?: string | null;
  /** State or region. */
  state?: string | null;
  /** Country. */
  country: CountryRef;
  /** IANA time zone, for example `Europe/Istanbul`. */
  timezone?: string | null;
}

/** A point in time, in UTC and in the airport's local time. */
export interface FlightTime {
  /** The instant, ISO 8601 in UTC. */
  utc: string;
  /**
   * Airport-local wall time without an offset, for example
   * `2026-09-08T12:10:00.000`. Pair it with the airport's time zone.
   */
  local?: string | null;
  /** Time zone abbreviation, for example `EEST`. */
  timezone?: string | null;
}

/** The gate and runway times of a departure or an arrival. */
export interface EndpointTimes {
  /** Scheduled gate time. */
  scheduledGate?: FlightTime | null;
  /** Estimated gate time. */
  estimatedGate?: FlightTime | null;
  /** Actual gate time. */
  actualGate?: FlightTime | null;
  /** Scheduled runway time. */
  scheduledRunway?: FlightTime | null;
  /** Estimated runway time. */
  estimatedRunway?: FlightTime | null;
  /** Actual runway time. */
  actualRunway?: FlightTime | null;
}

/** The best known gate time: actual, else estimated, else scheduled. */
export function bestGateTime(times: EndpointTimes): FlightTime | null {
  return times.actualGate ?? times.estimatedGate ?? times.scheduledGate ?? null;
}

/** The departure or arrival side of a flight. */
export interface FlightEndpoint {
  /** The airport. */
  airport: AirportRef;
  /** Terminal. */
  terminal?: string | null;
  /** Gate. */
  gate?: string | null;
  /** Baggage carousel, on arrival. */
  baggage?: string | null;
  /** Gate and runway times. */
  times: EndpointTimes;
  /** Best known time in UTC: actual, else estimated, else scheduled. */
  bestTimeUtc?: string | null;
  /** Gate delay in minutes; negative when early. */
  delayMinutes?: number | null;
}

/** The marketing carrier. */
export interface CarrierRef {
  /** IATA code, for example `TK`. */
  iata: string;
  /** ICAO code, for example `THY`. */
  icao?: string | null;
  /** Airline name. */
  name: string;
}

/** A codeshare flight number sold on the same flight. */
export interface CodeshareRef {
  /** Carrier code. */
  carrier: string;
  /** Carrier name. */
  name: string;
  /** Flight number. */
  flightNumber: string;
}

/** The status of a flight. */
export interface FlightStatusInfo {
  /** Upstream status code: `S`, `A`, `L`, `C`, `D`, `R`, `U` or `NO`. */
  code: string;
  /** Human-readable status, for example `Arrived`. */
  label: string;
  /** Longer description, for example `On time`. */
  description?: string | null;
  /** Suggested color, for example `green`. */
  color?: string | null;
  /** The lifecycle phase. */
  phase: FlightPhase;
  /** Whether the flight is delayed. */
  delayed: boolean;
  /** Whether the flight is cancelled. */
  cancelled: boolean;
  /** Whether the flight is diverted. */
  diverted: boolean;
  /** Departure gate delay in minutes. */
  departureGateDelayMinutes?: number | null;
  /** Arrival gate delay in minutes. */
  arrivalGateDelayMinutes?: number | null;
}

/** The aircraft. */
export interface EquipmentInfo {
  /** Registration, for example `TC-LTP`. */
  tailNumber?: string | null;
  /** IATA aircraft type, for example `32Q`. */
  iata?: string | null;
  /** Aircraft name, for example `Airbus A321neo`. */
  name?: string | null;
  /** Where the data came from, for example `Actual`. */
  source?: string | null;
}

/** Block times in minutes. */
export interface DurationInfo {
  /** Scheduled duration. */
  scheduledMinutes?: number | null;
  /** Estimated duration. */
  estimatedMinutes?: number | null;
  /** Actual duration. */
  actualMinutes?: number | null;
}

/** One entry of a flight's upstream history. */
export interface TimelineEntry {
  /** When it happened, ISO 8601. */
  occurredAt: string;
  /** Title, for example `Time Adjustment`. */
  title: string;
  /** Source, for example `Airline`. */
  source?: string | null;
  /** What changed, as sentences. */
  events: string[];
}

/**
 * A leg flown under the same flight number on the same date. Flight numbers
 * are not unique per day, so the API lists every leg and marks the one the
 * snapshot describes with `selected`.
 */
export interface FlightLegRef {
  /** Upstream flight id; pass it as `flightId` to select this leg. */
  providerFlightId?: string | null;
  /** Operating carrier code. */
  carrier?: string | null;
  /** Origin IATA code. */
  departureIata: string;
  /** Destination IATA code. */
  arrivalIata: string;
  /** Scheduled local departure, `HH:mm`. */
  scheduledDepartureLocal?: string | null;
  /** Scheduled local arrival, `HH:mm`. */
  scheduledArrivalLocal?: string | null;
  /** Whether this is the leg the snapshot describes. */
  selected: boolean;
}

/** Everything known about one flight leg at one moment. */
export interface FlightSnapshot {
  /** Stable key, for example `TK1848:2026-09-08` or `TK1:2026-09-08@IST-JFK`. */
  flightKey: string;
  /** Carrier code from the request, for example `TK`. */
  carrierCode: string;
  /** Flight number without leading zeros, for example `1848`. */
  flightNumber: string;
  /** Local departure date at the origin, `YYYY-MM-DD`. */
  date: string;
  /** Upstream flight id. */
  providerFlightId?: string | null;
  /** When the API fetched this data from upstream, ISO 8601. */
  fetchedAt: string;
  /** Marketing carrier. */
  carrier: CarrierRef;
  /** Operating carrier name, when different. */
  operatedBy?: string | null;
  /** Codeshare flight numbers. */
  codeshares: CodeshareRef[];
  /** Departure side. */
  departure: FlightEndpoint;
  /** Arrival side. */
  arrival: FlightEndpoint;
  /** Where the flight actually went, when diverted. */
  diverted?: FlightEndpoint | null;
  /** Status. */
  status: FlightStatusInfo;
  /** Aircraft. */
  equipment: EquipmentInfo;
  /** Block times. */
  duration: DurationInfo;
  /** Upstream history, newest first. */
  timeline: TimelineEntry[];
  /** Every leg flown under this flight number on this date. */
  alternates: FlightLegRef[];
  /** Hash over the change-relevant fields. */
  fingerprint: string;
  /**
   * Whether a lookup was answered from the API's cache. Sent with lookups,
   * not inside webhook events.
   */
  cached?: boolean;
}

/** The response of `flights.timeline`. */
export interface FlightTimeline {
  /** The flight's key. */
  flightKey: string;
  /** The number of entries. */
  count: number;
  /** History entries, newest first. */
  data: TimelineEntry[];
}

/**
 * A watched flight: the API polls it and posts a signed webhook to
 * `webhookUrl` whenever something about it changes.
 */
export interface Subscription {
  /** Id, for example `sub_7Kd91mQx0Zb2c3d4e5f6`. */
  id: string;
  /** Lifecycle status. */
  status: SubscriptionStatus;
  /** The watched flight's key, for example `TK1848:2026-09-08`. */
  flightKey: string;
  /** Carrier code. */
  carrier: string;
  /** Flight number. */
  flightNumber: string;
  /** Local departure date at the origin, `YYYY-MM-DD`. */
  date: string;
  /** Where webhooks are posted. */
  webhookUrl: string;
  /** The masked signing secret, for example `whsec_AbCdE...wxyz`. */
  secretHint?: string;
  /**
   * The full signing secret. Only the creation response carries it; read it
   * again with `subscriptions.secret`.
   */
  secret?: string;
  /** Extra headers sent with every delivery. */
  headers?: Record<string, string> | null;
  /** The change types that trigger a webhook. */
  events: FlightChangeType[];
  /** Delay swings smaller than this many minutes are ignored. */
  delayThresholdMinutes: number;
  /** Your own data, echoed back in every webhook. */
  metadata?: Record<string, string> | null;
  /** When it was created, ISO 8601. */
  createdAt: string;
  /** When it last changed, ISO 8601. */
  updatedAt: string;
  /** When the flight was last polled, ISO 8601. */
  lastPolledAt?: string | null;
  /** When a change was last detected, ISO 8601. */
  lastChangeAt?: string | null;
  /** When a webhook was last delivered, ISO 8601. */
  lastDeliveryAt?: string | null;
  /** Webhooks delivered. */
  deliveredCount: number;
  /** Webhook attempts that failed. */
  failedCount: number;
  /** `false` while the flight is not found upstream yet. */
  flightResolved: boolean;
  /** Why the subscription was suspended or completed. */
  statusReason?: string | null;
}

/** The response of `subscriptions.create`. */
export interface CreatedSubscription extends Subscription {
  /**
   * The full webhook signing secret. Returned in full only here and from
   * `subscriptions.secret`; store it where your webhook receiver can read it.
   */
  secret: string;
  /** The masked signing secret. */
  secretHint: string;
  /**
   * `true` when an earlier request with the same idempotency key, within 24
   * hours, was replayed: the original subscription is returned and nothing
   * new is created or billed.
   */
  reused: boolean;
  /** The flight as first seen, when it was found. Absent when `reused`. */
  flight?: FlightSnapshot | null;
}

/** One page of `subscriptions.list`. */
export interface SubscriptionPage {
  /** The number of subscriptions matching the filters. */
  total: number;
  /** The page size used. */
  limit: number;
  /** The number of subscriptions skipped. */
  offset: number;
  /** The subscriptions on this page, newest first. */
  data: Subscription[];
}

/** One webhook delivery attempt. */
export interface DeliveryRecord {
  /** The delivered event's id. */
  eventId: string;
  /** Attempt number, starting at 1. */
  attempt: number;
  /** The outcome. */
  status: DeliveryStatus;
  /** The receiver's HTTP status, when it answered. */
  httpStatus?: number | null;
  /** What went wrong, when the attempt failed. */
  error?: string | null;
  /** How long the attempt took, in milliseconds. */
  durationMs: number;
  /** When the attempt was made, ISO 8601. */
  at: string;
  /** The change types the event carried. */
  changeTypes: FlightChangeType[];
}

/** One change inside a `flight.updated` event. */
export interface FlightChange {
  /** What changed. */
  type: FlightChangeType;
  /** Dotted path into the snapshot, for example `departure.gate`. */
  path: string;
  /** The old value. Times are ISO 8601 UTC strings. */
  from: string | number | boolean | null;
  /** The new value. Times are ISO 8601 UTC strings. */
  to: string | number | boolean | null;
  /** A sentence describing the change. */
  message: string;
  /** Signed minute delta, for time changes. */
  deltaMinutes?: number | null;
}

/** A webhook event, as posted to your receiver and as listed by `subscriptions.events`. */
export interface WebhookEvent {
  /** Event id, `evt_<uuid>`. The same across delivery retries: deduplicate on it. */
  id: string;
  /** The event type. */
  type: WebhookEventType;
  /** When the event was created, ISO 8601. */
  createdAt: string;
  /** The subscription it belongs to. */
  subscriptionId: string;
  /** The flight's key. */
  flightKey: string;
  /** The flight after the change. Missing on some lifecycle events. */
  flight?: FlightSnapshot | null;
  /** What changed. Empty except on `flight.updated`. */
  changes: FlightChange[];
  /** When the previous snapshot was fetched, on `flight.updated`. */
  previousFetchedAt?: string | null;
  /** The subscription's metadata. */
  metadata?: Record<string, string> | null;
}

/** Identifies a flight leg for `flights.get`. */
export interface FlightParams {
  /** IATA or ICAO carrier code, for example `TK`. */
  carrier: string;
  /** Flight number, for example `1848`. */
  flightNumber: string;
  /** Local departure date at the origin, `YYYY-MM-DD`; see `FlightByte.formatDate`. */
  date: string;
  /** Selects a leg by its origin IATA code, when the number flies several that day. */
  origin?: string;
  /** Narrows the leg further by its destination IATA code. */
  destination?: string;
  /** Selects a leg by its upstream id, from `alternates`. */
  flightId?: string;
  /** Skips the API's cache and asks upstream. */
  refresh?: boolean;
}

/** Identifies a flight leg for `flights.timeline`. */
export type TimelineParams = Omit<FlightParams, 'flightId' | 'refresh'>;

/** A flight to watch, for `subscriptions.create`. */
export interface CreateSubscriptionParams {
  /** Carrier code, for example `TK`. */
  carrier: string;
  /** Flight number, for example `1848`. */
  flightNumber: string;
  /** Local departure date at the origin, `YYYY-MM-DD`. */
  date: string;
  /** Where webhooks are posted. A public HTTPS URL. */
  webhookUrl: string;
  /** Selects a leg, when the flight number flies several that day. */
  origin?: string;
  /** Narrows the leg further. */
  destination?: string;
  /** Selects a leg by its upstream id. */
  flightId?: string;
  /**
   * The webhook signing secret. By default the API generates one, returned
   * once as `secret`. Setting the same secret on every subscription lets one
   * receiver verify them all.
   */
  secret?: string;
  /** Change types that trigger a webhook. By default every type does. */
  events?: FlightChangeType[];
  /** Ignore delay swings smaller than this many minutes, 1 to 240. */
  delayThresholdMinutes?: number;
  /** Extra headers sent with every delivery. */
  headers?: Record<string, string>;
  /** Your own data, echoed back in every webhook. */
  metadata?: Record<string, string>;
}

/**
 * Changes to a subscription, for `subscriptions.update`. Only the fields you
 * set change. `headers` and `metadata` replace the existing maps; the API
 * cannot clear them, so an empty map leaves them as they are.
 */
export interface UpdateSubscriptionParams {
  /** Moves deliveries to another URL. */
  webhookUrl?: string;
  /** Replaces the change type filter. */
  events?: FlightChangeType[];
  /** Replaces the delay threshold. */
  delayThresholdMinutes?: number;
  /** Replaces the delivery headers. */
  headers?: Record<string, string>;
  /** Replaces the metadata. */
  metadata?: Record<string, string>;
}

/** Filters for `subscriptions.list` and `subscriptions.listAll`. */
export interface ListSubscriptionsParams {
  /** Keeps subscriptions in this status. */
  status?: SubscriptionStatus;
  /** Keeps subscriptions for this carrier. */
  carrier?: string;
  /** Keeps subscriptions for this flight number. */
  flightNumber?: string;
  /** Keeps subscriptions for this date, `YYYY-MM-DD`. */
  date?: string;
  /** Page size; the API clamps it to 1 to 200 and defaults to 25. */
  limit?: number;
  /** The number of subscriptions to skip. */
  offset?: number;
}
