import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

/** Server-side tooling connection. Call close() when the operation completes. */
export function connectDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required for a direct PostgreSQL connection.');
  const connection = postgres(url, { prepare: false, max: 1 });
  return {
    db: drizzle(connection, { schema }),
    close: () => connection.end(),
  };
}
