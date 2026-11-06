# Billing Workspace

The Phase 1 foundation for the dual-entity billing system in [PROJECT_SCOPE.md](PROJECT_SCOPE.md).

## Run the app

Use Node.js 24 and pnpm 11.25.0.

```powershell
corepack pnpm install
Copy-Item apps/web/.env.example apps/web/.env
Copy-Item apps/api/.env.example apps/api/.env
npm run dev
```

From the project root, use `npm run dev:web` for the frontend or `npm run dev:api` for the backend. To run them separately at the same time, use two terminals.

Open http://localhost:5173. The API listens at http://127.0.0.1:3001/api/v1. Both environment templates target the existing Supabase project, smpekyqhzyjfjxxiogfl. Copy its publishable key into VITE_SUPABASE_PUBLISHABLE_KEY and SUPABASE_PUBLISHABLE_KEY. The workspace flow uses the caller's access token with the publishable key. Keep secret keys and database credentials out of the web app.

## Hosted Supabase setup

1. Sign in with `pnpm exec supabase login` and link with `pnpm exec supabase link --project-ref smpekyqhzyjfjxxiogfl`.
2. Check the target and pending migrations with `pnpm exec supabase db push --remote --dry-run`, then apply with `pnpm exec supabase db push --remote`. The foundation migration creates workspaces, memberships, owner read policies, the initialization function, and two private buckets. Client access to bucket contents is reserved for a later phase.
3. Keep email sign-in enabled and disable public signup and anonymous sign-in in Supabase.
4. Create a confirmed owner under Authentication > Users in Supabase. The first sign-in initializes that account's workspace.
5. Start the app, sign in, and check that Overview shows the signed-in email. Reload to check session restoration. Sign out and check that visiting the root redirects to sign-in.

For Docker-backed local development, run `pnpm exec supabase start` and `pnpm exec supabase status`. Override the Supabase URL and publishable key in both app environments with the values for the local instance.

## Verification

```sh
pnpm typecheck
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

The automated tests check the API health endpoint, authentication boundary, and signed-out browser flow. Verify a real sign-in separately with the intended Supabase project.

## Directory API

The signed-in owner can use GET and POST at /api/v1/entities and /api/v1/customers, and GET and PATCH at the corresponding /:id endpoints. Send the Supabase access token as a Bearer token. Initialize the workspace before using these routes.

List requests accept page, pageSize, active (true or false), and search (legal name). Create a billing entity with legal_name and entity_code, or a customer with legal_name. Archive or restore a record with PATCH and is_active. The API derives the workspace from the verified session and rejects workspace IDs in request bodies.
