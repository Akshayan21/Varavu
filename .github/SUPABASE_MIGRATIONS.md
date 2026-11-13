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

## IPv4 runner connection

GitHub-hosted runners may not support the direct database endpoint's IPv6 address. Both migration steps therefore pass an explicit session-pooler URL to `--remote`, using `aws-0-ap-south-1.pooler.supabase.com:5432`, verified from this project's saved pooler connection. The URL uses `postgres.<project-ref>`, the existing database-password secret, and required SSL. The password is URL-encoded and the assembled URL is masked in Actions logs. No additional secret is needed.

If the project is moved, update `SUPABASE_DB_HOST` to the host shown under Supabase **Connect → Session pooler**, using port **5432**, not transaction-mode port 6543. Connection guidance: https://supabase.com/docs/guides/database/connecting-to-postgres.

After committing this fix, push it to `main` and start a **new** workflow run. Re-running the old failed job uses its original workflow revision. The preview must succeed before the apply step can run.
