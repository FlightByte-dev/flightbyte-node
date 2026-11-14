import { describe, expect, it } from 'vitest';
import {
  bestGateTime,
  DELIVERY_STATUSES,
  FLIGHT_CHANGE_TYPES,
  FLIGHT_PHASES,
  isTerminalPhase,
  maskSecret,
  SUBSCRIPTION_STATUSES,
  WEBHOOK_EVENT_TYPES,
  type FlightSnapshot,
  type Subscription,
  type WebhookEvent,
} from '../src/index.js';
import flightFixture from './fixtures/flight.json' with { type: 'json' };
import subscriptionFixture from './fixtures/subscription.json' with { type: 'json' };
import testEventFixture from './fixtures/webhook_test.json' with { type: 'json' };
import updatedEventFixture from './fixtures/webhook_flight_updated.json' with { type: 'json' };

// The fixtures are shaped like the API's JSON. These assignments are checked
// by `npm run typecheck`: a fixture field the types reject fails the build.
const flight: FlightSnapshot = flightFixture;
const subscription: Subscription = subscriptionFixture;
const events: WebhookEvent[] = [testEventFixture, updatedEventFixture];

describe('the fixtures fit the types', () => {
  it('flight', () => {
    expect(flight.flightKey).toBe('TK1848:2026-09-08');
    expect(flight.departure.delayMinutes).toBe(15);
    expect(flight.arrival.delayMinutes).toBe(-5);
    expect(flight.arrival.gate).toBeNull();
    expect(flight.arrival.airport.code).toBeUndefined();
    expect(flight.status.arrivalGateDelayMinutes).toBeNull();
    expect(flight.cached).toBe(true);
  });

  it('subscription, with a change type newer than this release', () => {
    expect(subscription.events).toContain('some.future.type');
    expect(subscription.lastChangeAt).toBeNull();
  });

  it('webhook events', () => {
    expect(events.map((e) => e.type)).toEqual(['subscription.test', 'flight.updated']);
  });
});

describe('helpers', () => {
  it('isTerminalPhase', () => {
    expect(FLIGHT_PHASES.filter(isTerminalPhase)).toEqual(['arrived', 'cancelled', 'diverted', 'redirected']);
    expect(isTerminalPhase('later')).toBe(false);
  });

  it('bestGateTime prefers actual, then estimated, then scheduled', () => {
    expect(bestGateTime(flight.departure.times)?.local).toBe('2026-09-08T12:25:00.000');
    expect(bestGateTime(flight.arrival.times)?.timezone).toBe('CEST');
    expect(bestGateTime({})).toBeNull();
  });

  it('maskSecret', () => {
    expect(maskSecret('whsec_AbCdEfGhIjKlMnOpQrStUvwxyz')).toBe('whsec_AbCdE...wxyz');
    expect(maskSecret('short')).toBe('short');
  });

  it('the value lists have no duplicates', () => {
    for (const list of [FLIGHT_PHASES, SUBSCRIPTION_STATUSES, FLIGHT_CHANGE_TYPES, WEBHOOK_EVENT_TYPES, DELIVERY_STATUSES]) {
      expect(new Set(list).size).toBe(list.length);
    }
    expect(FLIGHT_CHANGE_TYPES).toHaveLength(23);
  });
});
