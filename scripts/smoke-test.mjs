// Checks Context.dev and MongoDB connectivity. Costs 0 credits (monitor limits endpoint is free).
import { context, call } from '../lib/context.mjs';
import { getDb, client } from '../lib/db.mjs';

const limits = await call('monitors.getLimits', () => context.monitors.getLimits());
console.log('context.dev ok, monitors:', limits.monitors_used, '/', limits.monitors_limit);
const db = await getDb();
console.log('mongo ok, db:', db.databaseName, 'collections:', (await db.listCollections().toArray()).map((c) => c.name));
await client.close();
