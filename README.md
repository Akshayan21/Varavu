# Thogai

Thogai follows [THOGAI_PROJECT_SCOPE.md](THOGAI_PROJECT_SCOPE.md). Database mode uses Supabase Auth, PostgreSQL, private Storage, and the Fastify API.

## Run the application

Use Node.js 24 and pnpm 11.25.0. Copy the API and web `.env.example` files to `.env` in their respective packages and fill in the Supabase URL and publishable key. Keep both packages pointed at the same Supabase project.

Set `VITE_DATA_MODE=database` and `VITE_API_URL=http://127.0.0.1:3001/api/v1` in `apps/web/.env`. Database mode is the default. Sign in using an existing registered owner account.

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm dev
```

Open http://localhost:5173. The development command starts the web application and API. The API reads `apps/api/.env`. Production builds require the web variables at build time and the API variables at runtime. Set `APP_ORIGIN` to the web application's origin. The API host must support Playwright Chromium for server-generated PDFs.

Set `VITE_DATA_MODE=mock` to use the isolated browser-local sample application. Mock data is kept separate from database records. Existing browser-local documents require an explicit reviewed import before appearing in database mode.

## Database migrations

The seven `20261114...` migrations add the complete 22-table application schema to the four existing directory tables. They have been applied to the linked Sree_Saraswathi Supabase project. Subsequent environments can apply the migration files in chronological order.

```powershell
pnpm exec supabase db push --remote --dry-run
pnpm exec supabase db push --remote --yes
```

Check the CLI's displayed project before applying migrations. See [DATABASE_SCHEMA_PROPOSED.md](DATABASE_SCHEMA_PROPOSED.md) for the domain design and the SQL migrations for authoritative constraints. The earlier [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) captures the original four-table baseline.

Customers with a legacy null `entity_id` remain hidden and require explicit administrator assignment. The catalog migration validates and makes `entity_id` mandatory automatically when no unassigned records remain.

## Billing persistence

The bill editor searches styles within the selected company. Committing a nonblank style field reuses the existing normalized number or creates a new style. Draft saving resolves every style again inside the save transaction. Case and outer spaces are ignored, while punctuation and leading zeros are preserved. Archived matching styles require restoration through the catalog API.

Invoices and challans use database-controlled issuance, separate company/year number counters, immutable issued contents, and retained cancellation records. Receipts support partial payment, retry identifiers, balance checks, and audited reversal. Published template versions and company assets are retained for historical documents.

PDF jobs are queued on issuance and processed on authorized download requests. A failed generation can be retried without issuing another document. All nine report types use authorized database queries. PDF/CSV export requests materialize their report data and filters before rendering.

## Verification

```powershell
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
pnpm test:e2e:database
```

The unit suite executes all migrations in an isolated PostgreSQL runtime and checks styles, invoice calculations, immutable documents, numbering, receipts, challans, reports, and access restrictions. The standard browser suite exercises mock mode. The database browser suite tests the actual database-mode frontend against intercepted API fixtures, including style creation and reload after issuance.

An optional hosted smoke test creates fixtures and rolls back all writes.

```powershell
pnpm exec supabase db query --remote --file tests/database/hosted-smoke.sql --yes
```

## API

All operational routes start with `/api/v1` and require the owner's Supabase Bearer token. The server derives workspace scope from that verified identity. Initialize the workspace through `POST /workspace/initialize`.

- Company and customer directories use `/entities` and `/entities/:entityId/customers`.
- Style lookup and creation use `GET /entities/:entityId/styles` and `POST /entities/:entityId/styles/resolve`.
- Invoice draft saving, issuance, cancellation, PDF download, receipts, and reversal use `/entities/:entityId/invoices` and its document subroutes.
- Challan saving, issuance, cancellation, acknowledgement, and PDF download use `/entities/:entityId/challans` and its document subroutes.
- Catalog configuration, tax profiles, published templates, and images use the entity's `/catalog`, `/tax-profiles`, `/templates`, and `/assets` routes.
- Reports and materialized exports use `/reports/:type`, `/reports/:type/exports`, and `/exports/:id`.

Draft updates require the saved version. Payment posts require an `Idempotency-Key` header. Image uploads accept PNG/JPEG files up to 512 KB. Downloads recheck company ownership and use private storage.

Advanced template layout customization, a browser-local data import interface, dedicated operator roles, and scheduled background job processing require additional application work. The implemented template UI configures presets, accent color, logo, and signature.
