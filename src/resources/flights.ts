import type { FlightParams, FlightSnapshot, FlightTimeline, TimelineParams } from '../models.js';
import { required, type RequestOptions, type Transport } from '../request.js';

/** Flight lookups. Reach it as `client.flights`. */
export class Flights {
  /** @internal */
  constructor(private readonly transport: Transport) {}

  /**
   * Looks a flight up. The API upper-cases the carrier and strips leading
   * zeros from the flight number.
   *
   * A flight number can fly several legs on one date. The snapshot lists them
   * all in `alternates`; pass `origin` (and optionally `destination`) or a
   * leg's `flightId` to choose one.
   *
   * @throws {@link NotFoundError} when the flight did not operate that day.
   */
  async get(params: FlightParams, options?: RequestOptions): Promise<FlightSnapshot> {
    return this.transport.send<FlightSnapshot>('GET', flightPath(params), {
      ...options,
      query: {
        origin: params.origin,
        destination: params.destination,
        flightId: params.flightId,
        refresh: params.refresh ? 'true' : undefined,
      },
    });
  }

  /** The flight's change history as recorded by the API, newest first. */
  async timeline(params: TimelineParams, options?: RequestOptions): Promise<FlightTimeline> {
    return this.transport.send<FlightTimeline>('GET', [...flightPath(params), 'timeline'], {
      ...options,
      query: { origin: params.origin, destination: params.destination },
    });
  }
}

function flightPath(params: TimelineParams): string[] {
  return [
    'flights',
    required('carrier', params.carrier),
    required('flightNumber', params.flightNumber),
    required('date', params.date),
  ];
}
