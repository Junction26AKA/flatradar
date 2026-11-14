// In-process event bus. Everything that should reach the dashboard goes through `publish()`;
// server.mjs forwards every message to SSE clients. Event types: docs/contracts.md §5.
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

/** @param {string} type  e.g. 'listing.new', 'listing.updated', 'listing.price_drop', 'alert.sent' */
export function publish(type, data) {
  bus.emit('message', { type, data });
}
