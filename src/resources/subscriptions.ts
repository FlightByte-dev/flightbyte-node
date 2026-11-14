import type {
  CreatedSubscription,
  CreateSubscriptionParams,
  DeliveryRecord,
  ListSubscriptionsParams,
  Subscription,
  SubscriptionPage,
  UpdateSubscriptionParams,
  WebhookEvent,
} from '../models.js';
import { required, type RequestOptions, type Transport } from '../request.js';

/** Options for `subscriptions.create`. */
export interface CreateOptions extends RequestOptions {
  /**
   * Makes retries safe: repeating the request with the same key within 24
   * hours returns the original subscription with `reused: true`, instead of
   * creating and billing a second one.
   */
  idempotencyKey?: string;
}

/** Options for `subscriptions.deliveries` and `subscriptions.events`. */
export interface HistoryOptions extends RequestOptions {
  /** How many to return, 1 to 100; the API's default is 25. */
  limit?: number;
}

/** Options for `subscriptions.listAll`. */
export interface ListAllParams extends Omit<ListSubscriptionsParams, 'limit'> {
  /** Page size, 1 to 200; the default is 200. */
  pageSize?: number;
}

/**
 * Watched flights and their webhooks. Reach it as `client.subscriptions`.
 * Every subscription is a billable watched flight.
 */
export class Subscriptions {
  /** @internal */
  constructor(private readonly transport: Transport) {}

  /**
   * Starts watching a flight. The API posts a signed webhook to `webhookUrl`
   * each time something about it changes.
   *
   * @throws {@link PaymentRequiredError} when no watched flights are left.
   * @throws {@link BadRequestError} with `legs` set, when the flight number
   * flies several legs that day and neither `origin` nor `flightId` chose one.
   */
  async create(params: CreateSubscriptionParams, options: CreateOptions = {}): Promise<CreatedSubscription> {
    required('carrier', params.carrier);
    required('flightNumber', params.flightNumber);
    required('date', params.date);
    required('webhookUrl', params.webhookUrl);
    const { idempotencyKey, ...request } = options;
    const created = await this.transport.send<CreatedSubscription>('POST', ['subscriptions'], {
      ...request,
      body: params,
      headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
    });
    if (!created.secretHint && created.secret) created.secretHint = maskSecret(created.secret);
    return created;
  }

  /** One page of your subscriptions, newest first. */
  async list(params: ListSubscriptionsParams = {}, options?: RequestOptions): Promise<SubscriptionPage> {
    return this.transport.send<SubscriptionPage>('GET', ['subscriptions'], {
      ...options,
      query: {
        status: params.status,
        carrier: params.carrier,
        flightNumber: params.flightNumber,
        date: params.date,
        limit: params.limit,
        offset: params.offset,
      },
    });
  }

  /**
   * Every subscription matching the filters, fetched page by page as you
   * iterate. Stop early with `break`; nothing more is fetched.
   *
   * ```ts
   * for await (const sub of client.subscriptions.listAll({ status: 'active' })) {
   *   console.log(sub.flightKey);
   * }
   * ```
   */
  async *listAll(params: ListAllParams = {}, options?: RequestOptions): AsyncGenerator<Subscription, void, undefined> {
    const { pageSize = 200, ...filters } = params;
    let offset = filters.offset ?? 0;
    for (;;) {
      const page = await this.list({ ...filters, limit: pageSize, offset }, options);
      yield* page.data;
      const next = page.offset + page.data.length;
      if (page.data.length === 0 || next >= page.total) return;
      offset = next;
    }
  }

  /**
   * One subscription.
   *
   * @throws {@link NotFoundError} when it does not exist or belongs to another key.
   */
  async get(id: string, options?: RequestOptions): Promise<Subscription> {
    return this.transport.send<Subscription>('GET', ['subscriptions', required('id', id)], options);
  }

  /** Changes a subscription. Only the fields you set change. */
  async update(id: string, params: UpdateSubscriptionParams, options?: RequestOptions): Promise<Subscription> {
    return this.transport.send<Subscription>('PATCH', ['subscriptions', required('id', id)], {
      ...options,
      body: params,
    });
  }

  /** Stops watching the flight and deletes the subscription for good. */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.transport.send<undefined>('DELETE', ['subscriptions', required('id', id)], options);
  }

  /** Pauses polling and deliveries; `resume` picks up where it left off. */
  async pause(id: string, options?: RequestOptions): Promise<Subscription> {
    return this.transport.send<Subscription>('POST', ['subscriptions', required('id', id), 'pause'], options);
  }

  /**
   * Resumes a paused or suspended subscription. A completed one cannot be
   * resumed and gives a {@link BadRequestError}.
   */
  async resume(id: string, options?: RequestOptions): Promise<Subscription> {
    return this.transport.send<Subscription>('POST', ['subscriptions', required('id', id), 'resume'], options);
  }

  /** Sends a signed `subscription.test` webhook and returns its event id. */
  async sendTest(id: string, options?: RequestOptions): Promise<string> {
    const result = await this.transport.send<{ eventId: string }>(
      'POST',
      ['subscriptions', required('id', id), 'test'],
      options,
    );
    return result.eventId;
  }

  /** The latest delivery attempts, newest first. */
  async deliveries(id: string, options: HistoryOptions = {}): Promise<DeliveryRecord[]> {
    const { limit, ...request } = options;
    const result = await this.transport.send<{ count: number; data: DeliveryRecord[] }>(
      'GET',
      ['subscriptions', required('id', id), 'deliveries'],
      { ...request, query: { limit } },
    );
    return result.data;
  }

  /** The latest events, exactly as they were posted, newest first. */
  async events(id: string, options: HistoryOptions = {}): Promise<WebhookEvent[]> {
    const { limit, ...request } = options;
    const result = await this.transport.send<{ count: number; data: WebhookEvent[] }>(
      'GET',
      ['subscriptions', required('id', id), 'events'],
      { ...request, query: { limit } },
    );
    return result.data;
  }

  /** The full webhook signing secret. */
  async secret(id: string, options?: RequestOptions): Promise<string> {
    const result = await this.transport.send<{ secret: string }>(
      'GET',
      ['subscriptions', required('id', id), 'secret'],
      options,
    );
    return result.secret;
  }

  /**
   * Replaces the webhook signing secret and returns the new one. Deliveries
   * are signed with it from now on, so update your receiver right away.
   */
  async rotateSecret(id: string, options?: RequestOptions): Promise<string> {
    const result = await this.transport.send<{ secret: string }>(
      'POST',
      ['subscriptions', required('id', id), 'secret', 'rotate'],
      options,
    );
    return result.secret;
  }
}

/**
 * Masks a signing secret the way the API does: the first 11 characters,
 * `...`, and the last 4. Short secrets are returned as they are.
 */
export function maskSecret(secret: string): string {
  return secret.length <= 15 ? secret : `${secret.slice(0, 11)}...${secret.slice(-4)}`;
}
