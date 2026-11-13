# Thogai

The mock MVP follows [THOGAI_PROJECT_SCOPE.md](THOGAI_PROJECT_SCOPE.md).

## Run the MVP

Use Node.js 24 and pnpm 11.25.0.

```powershell
corepack pnpm install
npm run dev
```

Open http://localhost:5173. The dev command starts only the web app. The company selector starts with two sample companies and separate customers. Company and customer edits are stored in the current browser. Bill previews use the selected company's mock records.

The Fastify and Supabase implementation is parked for a later integration phase.

## Verification

```sh
pnpm typecheck
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

The browser test checks that the mock workspace opens without a backend, retains changes after reload, and keeps customers separate by company. The API unit tests exercise the parked backend independently.

## Parked directory API

The signed-in owner can use GET and POST at /api/v1/entities and /api/v1/entities/:entityId/customers, and GET and PATCH at the corresponding /:id endpoints. Send the Supabase access token as a Bearer token. Initialize the workspace before using these routes.

List requests accept page, pageSize, active (true or false), and search (legal name). Create a billing entity with legal_name and entity_code, or a customer with legal_name. Archive or restore a record with PATCH and is_active. The API derives the workspace from the verified session and scopes customers to the active company in the URL. Existing shared customers in other installations require an explicit administrator assignment before they appear in a company directory.

## Supabase client configuration

The web package already includes `@supabase/supabase-js`. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `apps/web/.env` (ignored by Git), then restart Vite. Import the configured client from `apps/web/src/utils/supabase.ts` when implementing a live data feature. This follows the Supabase React quickstart: https://supabase.com/docs/guides/getting-started/quickstarts/reactjs.

The existing screens and central dashboard preview remain mock-only. Configuring this client does not enable live authentication or replace local records. The generic `todos` example is not part of Thogai's schema.
