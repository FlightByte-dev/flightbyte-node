/**
 * Drift check: the client and its types must line up with the vendored
 * OpenAPI document (spec/openapi.json). Refresh the copy with
 * `npm run sync:openapi`; if the API added, renamed or moved anything, these
 * tests say what.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  FLIGHT_CHANGE_TYPES,
  FLIGHT_PHASES,
  PaymentRequiredError,
  SUBSCRIPTION_STATUSES,
  type FlightByte,
} from '../src/index.js';
import { client, json, mockFetch } from './helpers/mock.js';

interface Schema {
  $ref?: string;
  type?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: string[];
}
interface Operation {
  operationId: string;
}
const spec = JSON.parse(readFileSync(new URL('../spec/openapi.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};

const operations = new Map<string, { method: string; path: string }>();
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (op && typeof op === 'object' && 'operationId' in op) {
      operations.set(op.operationId, { method: method.toUpperCase(), path });
    }
  }
}

/** Operations without a method of their own, and why. */
const NOT_EXPOSED: Record<string, string> = {
  'search-flights': 'the same lookup as get-flight, with the identifiers in the query string',
  'get-flag': 'returns an SVG image; countries.flagUrl builds its URL',
};

const leg = { carrier: 'TK', flightNumber: '1848', date: '2026-09-08' };
const CALLS: Record<string, (c: FlightByte) => Promise<unknown>> = {
  'list-countries': (c) => c.countries.list(),
  'get-country': (c) => c.countries.get('TR'),
  'get-flight': (c) => c.flights.get(leg),
  'flight-timeline': (c) => c.flights.timeline(leg),
  'create-subscription': (c) => c.subscriptions.create({ ...leg, webhookUrl: 'https://example.com/h' }),
  'list-subscriptions': (c) => c.subscriptions.list(),
  'get-subscription': (c) => c.subscriptions.get('sub_1'),
  'update-subscription': (c) => c.subscriptions.update('sub_1', {}),
  'delete-subscription': (c) => c.subscriptions.delete('sub_1'),
  'pause-subscription': (c) => c.subscriptions.pause('sub_1'),
  'resume-subscription': (c) => c.subscriptions.resume('sub_1'),
  'send-test-event': (c) => c.subscriptions.sendTest('sub_1'),
  'list-deliveries': (c) => c.subscriptions.deliveries('sub_1'),
  'list-events': (c) => c.subscriptions.events('sub_1'),
  'reveal-secret': (c) => c.subscriptions.secret('sub_1'),
  'rotate-secret': (c) => c.subscriptions.rotateSecret('sub_1'),
};

function pathPattern(template: string): RegExp {
  return new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`);
}

describe('every operation in the document has a method', () => {
  it('and nothing is left unaccounted for', () => {
    const covered = new Set([...Object.keys(CALLS), ...Object.keys(NOT_EXPOSED)]);
    expect([...operations.keys()].filter((id) => !covered.has(id))).toEqual([]);
    expect([...covered].filter((id) => !operations.has(id))).toEqual([]);
  });

  it.each(Object.entries(CALLS))('%s', async (operationId, call) => {
    const expected = operations.get(operationId)!;
    const mock = mockFetch(() => json(200, { data: [], secret: 's', eventId: 'e' }));
    await call(client(mock.fetch));
    const sent = mock.last();
    expect(sent.method).toBe(expected.method);
    expect(sent.url.pathname).toMatch(pathPattern(expected.path));
  });

  it('get-flag, through flagUrl', () => {
    const url = new URL(client(mockFetch().fetch).countries.flagUrl('TR'));
    expect(url.pathname).toMatch(pathPattern(operations.get('get-flag')!.path));
  });
});

// The interfaces in src/models.ts, read with the TypeScript compiler.
const program = ts.createProgram([new URL('../src/models.ts', import.meta.url).pathname], {
  strict: true,
  noEmit: true,
});
const checker = program.getTypeChecker();
const modelsFile = program.getSourceFile(new URL('../src/models.ts', import.meta.url).pathname)!;
const interfaces = new Map<string, Map<string, { optional: boolean }>>();
ts.forEachChild(modelsFile, (node) => {
  if (!ts.isInterfaceDeclaration(node)) return;
  const members = new Map<string, { optional: boolean }>();
  for (const symbol of checker.getPropertiesOfType(checker.getTypeAtLocation(node.name))) {
    members.set(symbol.name, { optional: (symbol.flags & ts.SymbolFlags.Optional) !== 0 });
  }
  interfaces.set(node.name.text, members);
});

/** Schema names that map to a differently named interface. */
const RENAMED: Record<string, string> = {
  CreateSubscriptionDto: 'CreateSubscriptionParams',
  UpdateSubscriptionDto: 'UpdateSubscriptionParams',
};
/** Schemas that are an error body rather than a model; checked below. */
const ERROR_BODIES = new Set(['WatchedFlightsUsedUp']);

/** Fields the API sends that the document leaves out, and why the types have them. */
const UNDOCUMENTED_FIELDS: Record<string, string> = {
  'FlightSnapshot.cached': 'lookups say whether the cache answered; the document leaves it out',
  'Subscription.secretHint': 'every response but the creation one carries the masked secret',
};
/** Fields the document marks required that the types keep optional, and why. */
const LOOSER_THAN_DOCUMENTED: Record<string, string> = {
  'Subscription.secret': 'only the creation response carries the full secret',
};

const modelSchemas = Object.entries(spec.components.schemas).filter(([name]) => !ERROR_BODIES.has(name));

describe('every schema in the document has a type', () => {
  it.each(modelSchemas)('%s', (schemaName, schema) => {
    const typeName = RENAMED[schemaName] ?? schemaName;
    const members = interfaces.get(typeName);
    expect(members, `src/models.ts has no interface ${typeName}`).toBeDefined();

    const documented = Object.keys(schema.properties ?? {});
    const missing = documented.filter((field) => !members!.has(field));
    expect(missing, `${typeName} lacks fields the API documents`).toEqual([]);

    const extra = [...members!.keys()].filter(
      (field) => !documented.includes(field) && !(`${schemaName}.${field}` in UNDOCUMENTED_FIELDS),
    );
    expect(extra, `${typeName} has fields the document does not list`).toEqual([]);

    const tooLoose = (schema.required ?? []).filter(
      (field) => members!.get(field)?.optional && !(`${schemaName}.${field}` in LOOSER_THAN_DOCUMENTED),
    );
    expect(tooLoose, `${typeName} makes required fields optional`).toEqual([]);
  });

  it('the 402 body, through PaymentRequiredError', () => {
    const body = spec.components.schemas['WatchedFlightsUsedUp']!;
    const base = new Set(['statusCode', 'error', 'message', 'code']);
    const getters = new Set(Object.getOwnPropertyNames(PaymentRequiredError.prototype));
    const missing = Object.keys(body.properties ?? {}).filter((field) => !base.has(field) && !getters.has(field));
    expect(missing).toEqual([]);
  });
});

describe('the value lists match the document', () => {
  const schemas = spec.components.schemas;
  it('phases', () => {
    expect([...FLIGHT_PHASES]).toEqual(schemas['FlightStatusInfo']!.properties!['phase']!.enum);
  });
  it('subscription statuses', () => {
    expect([...SUBSCRIPTION_STATUSES]).toEqual(schemas['Subscription']!.properties!['status']!.enum);
  });
  it('change types', () => {
    expect([...FLIGHT_CHANGE_TYPES]).toEqual(schemas['CreateSubscriptionDto']!.properties!['events']!.items!.enum);
  });
});
