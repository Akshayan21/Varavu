import { registerDirectory } from './directory.js';
import { registerBilling } from './billing.js';
import { registerReports } from './reports.js';
import cors from '@fastify/cors';
import { healthSchema } from '@billing/shared';
import Fastify from 'fastify';
import { registerWorkspace, type SupabaseConfig } from './workspace.js';

export function buildApp({ origin, logger = false, supabase }: { origin: string; logger?: boolean; supabase?: SupabaseConfig }) {
  const app = Fastify({ logger });
  app.register(cors, { origin });
  app.get('/api/v1/health', async () => healthSchema.parse({ status: 'ok' }));
  registerWorkspace(app, supabase);
  registerDirectory(app, supabase);
  registerBilling(app, supabase);
  registerReports(app, supabase);
  return app;
}
