// Shared Context.dev client. Import this instead of constructing your own.
// Every call should go through `call()`: it enforces the team-wide concurrency cap and records
// telemetry ({listing_id, endpoint, started_at, ms, status, request_id}) for the fan-out drawer.
//
//   import { context, call } from './context.mjs';
//   const page = await call('web.scrape', () => context.web.scrape({...}), { listingId });
import { EventEmitter } from 'node:events';
import ContextDev from 'context.dev';
import pLimit from 'p-limit';

if (!process.env.CONTEXT_DEV_API_KEY) {
  throw new Error('Missing CONTEXT_DEV_API_KEY. Copy .env.example to .env and fill it in.');
}

export const context = new ContextDev();

// The account allows 50 concurrent requests. Live enrichment gets 30; batch backfill and monitors use the rest.
export const limit = pLimit(Number(process.env.CONTEXT_CONCURRENCY) || 30);

// Telemetry: server.mjs subscribes to forward these over SSE, and to persist them in `calls`.
export const telemetry = new EventEmitter();

let seq = 0;
/**
 * Run one Context.dev request under the shared limiter, emitting `call.start` and `call.end`.
 * @param {string} endpoint  label shown in the UI, e.g. 'web.scrape', 'parse.document', 'news.search'
 * @param {() => Promise<any>} fn
 * @param {{listingId?: string, label?: string}} [opts]
 */
export function call(endpoint, fn, { listingId = null, label = null } = {}) {
  const id = `${Date.now().toString(36)}-${++seq}`;
  const queued_at = new Date();
  return limit(async () => {
    const started_at = new Date();
    telemetry.emit('call.start', { id, listing_id: listingId, endpoint, label, queued_at, started_at });
    const t0 = performance.now();
    try {
      const res = await fn();
      const ms = Math.round(performance.now() - t0);
      telemetry.emit('call.end', { id, listing_id: listingId, endpoint, label, started_at, ms, status: 'ok', request_id: res?.request_id ?? null });
      return res;
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      telemetry.emit('call.end', { id, listing_id: listingId, endpoint, label, started_at, ms, status: 'error', http_status: err?.status ?? null, error: String(err?.message ?? err).slice(0, 300), request_id: err?.headers?.get?.('x-request-id') ?? null });
      throw err;
    }
  });
}

export default context;
