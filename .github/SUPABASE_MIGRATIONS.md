# Automatic database migrations

The `Deploy Supabase migrations` workflow runs on every push to `main`. It can also be started from GitHub Actions with **Run workflow**, selecting `main`. Runs are serialized so two deployments cannot migrate the production database concurrently. The CLI version is pinned to 3.0.0, matching the locally verified version.

In your GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret** and add these three secrets.

| Secret | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | A Supabase personal access token from your account settings, scoped to this project. For the link command, grant Read access to Project Settings, API Keys, and API Key Secrets. |
| `SUPABASE_DB_PASSWORD` | The Supabase project's Postgres database password. |
| `SUPABASE_PROJECT_ID` | `smpekyqhzyjfjxxiogfl`, the production project reference. |

Commit new SQL files under `supabase/migrations` and push or merge to `main`. The workflow links the configured project, previews pending migrations, and applies them. Already-applied migrations are tracked by Supabase and skipped. Check the workflow log for the result. Edit schema changes through new migration files so the checked-in history matches the database.

Vercel deployments and this workflow run independently. An application deployment does not wait for database migration completion. Use compatible schema changes when shipping app code and migrations together.
