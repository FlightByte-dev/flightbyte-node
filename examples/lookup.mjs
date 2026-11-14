// Looks a flight up and prints its status.
//
//   npm run build
//   FLIGHTBYTE_API_KEY=frk_live_... node examples/lookup.mjs TK 1848 2026-09-08
//
// FLIGHTBYTE_BASE_URL points it at another API root, for example a local one.
import { BadRequestError, bestGateTime, FlightByte, NotFoundError } from 'flightbyte';

const [carrier, flightNumber, date] = process.argv.slice(2);
if (!carrier || !flightNumber || !date) {
  console.error('usage: node examples/lookup.mjs <carrier> <flight number> <YYYY-MM-DD>');
  process.exit(1);
}

if (!process.env.FLIGHTBYTE_API_KEY) {
  console.error('Set FLIGHTBYTE_API_KEY to your API key.');
  process.exit(1);
}

const client = new FlightByte({
  apiKey: process.env.FLIGHTBYTE_API_KEY,
  baseUrl: process.env.FLIGHTBYTE_BASE_URL,
});

let flight;
try {
  flight = await client.flights.get({ carrier, flightNumber, date });
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error('No such flight on that date.');
  } else if (error instanceof BadRequestError && error.legs.length > 0) {
    console.error('This flight number flies several legs that day:');
    for (const leg of error.legs) console.error(`  ${leg.origin} → ${leg.destination} at ${leg.scheduledDepartureLocal}`);
  } else {
    console.error(error.message);
  }
  process.exit(1);
}

const dash = (value) => value ?? '-';
console.log(`${flight.flightKey}  ${flight.departure.airport.iata} → ${flight.arrival.airport.iata}`);
console.log(`Status     ${flight.status.label} (${flight.status.phase})`);
const departs = bestGateTime(flight.departure.times);
if (departs) console.log(`Departure  ${departs.local} ${dash(departs.timezone)}, gate ${dash(flight.departure.gate)}`);
const arrives = bestGateTime(flight.arrival.times);
if (arrives) console.log(`Arrival    ${arrives.local} ${dash(arrives.timezone)}, baggage ${dash(flight.arrival.baggage)}`);
if (flight.departure.delayMinutes) console.log(`Delay      ${flight.departure.delayMinutes} min`);
const minute = client.lastRateLimit?.minute;
if (minute) console.log(`Quota      ${minute.remaining} of ${minute.limit} left this minute`);
