// Shared MongoDB Atlas client. Import this instead of constructing your own MongoClient.
// Reads MONGODB_URI and MONGODB_DB (default "flatradar") from the environment.
import { MongoClient } from 'mongodb';

if (!process.env.MONGODB_URI) {
  throw new Error('Missing MONGODB_URI. Copy .env.example to .env and fill it in.');
}

export const client = new MongoClient(process.env.MONGODB_URI, { appName: 'flatradar' });

let connected;
/** Returns the app database, connecting once on first use. */
export async function getDb() {
  connected ??= client.connect();
  await connected;
  return client.db(process.env.MONGODB_DB || 'flatradar');
}

export default getDb;
