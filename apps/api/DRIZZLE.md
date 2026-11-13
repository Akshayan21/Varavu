# Drizzle database schema

`src/db/schema.ts` maps all 22 deployed public tables and their 414 columns, defaults, primary keys, and unique constraints. It exports inferred select and insert types for each table. Monetary numeric columns use strings and bigint columns use JavaScript bigint to preserve precision. Timestamp values use strings.

`src/db/client.ts` exposes `connectDatabase()` for server-side tooling. It returns a typed `db` and a `close()` function. Prepared statements are disabled for Supabase pooler compatibility. Direct database credentials determine the connection's privileges; this connection does not inherit the signed-in HTTP user's Supabase JWT. Existing customer and billing endpoints continue to use their authenticated Supabase clients.

Run these commands from `apps/api` after setting `DATABASE_URL` in its local `.env`. Use the PostgreSQL connection string from the Supabase Connect dialog and URL-encode special characters in its password. For environments without direct IPv6 connectivity, use the session pooler connection string.

```powershell
npm run db:pull
```

The pull command introspects the existing public schema into `drizzle/schema.ts` and `drizzle/relations.ts`. Review the generated files against the checked-in SQL migrations before copying them into `src/db`. Supabase manages the `auth` and `storage` schemas. The committed typed mappings are not a complete declarative replacement for the SQL migrations: foreign keys, checks, indexes, policies, custom domains, triggers, and privileges are owned by those SQL files.

The existing `supabase/migrations` SQL files and GitHub Actions workflow remain the schema deployment path. They include database functions, triggers, grants, custom domains, and row-level security rules. Drizzle introspection is for typed query definitions. Review any generated SQL before adding it as a new Supabase migration.

`DATABASE_URL` is a server-side database credential. Configure it only in local API tooling or a backend environment that explicitly uses Drizzle. The current HTTP API authenticates callers through Supabase and preserves their row-level security context.
