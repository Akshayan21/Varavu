import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('Set DATABASE_URL in apps/api/.env to the Supabase PostgreSQL connection string.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['public'],
  dbCredentials: { url: process.env.DATABASE_URL },
});
