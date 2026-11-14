import { registerDirectory } from './directory.js';
import { registerBilling } from './billing.js';
import { registerReports } from './reports.js';
import cors from '@fastify/cors';
import { healthSchema } from '@billing/shared';
import Fastify from 'fastify';
import type { onRouteHookHandler } from 'fastify';
import { registerWorkspace, type SupabaseConfig } from './workspace.js';
import { registerOperations } from './operations.js';

export function buildApp({ origin, logger = false, supabase, onRoute }: { origin: string; logger?: boolean; supabase?: SupabaseConfig; onRoute?: onRouteHookHandler }) {
  const app = Fastify({ logger });
  if (onRoute) app.addHook('onRoute', onRoute);
  app.setErrorHandler((error, request, reply) => {
    const failure: Error & { statusCode?: number } = error instanceof Error ? error : new Error('Unknown request failure');
    const status = failure.statusCode && failure.statusCode >= 400 && failure.statusCode < 500 ? failure.statusCode : 500;
    request.log.error({ err: error, requestId: request.id }, 'Request failed');
    return reply.code(status).send({ error: status === 500 ? 'The request could not be completed.' : failure.message, requestId: request.id });
  });
  app.register(cors, {
    origin,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'Idempotency-Key'],
    exposedHeaders: ['Content-Disposition', 'Retry-After'],
  });
  app.get('/api/v1/health', async () => healthSchema.parse({ status: 'ok' }));
  registerWorkspace(app, supabase);
  registerDirectory(app, supabase);
  registerBilling(app, supabase);
  registerReports(app, supabase);
  registerOperations(app, supabase);
  return app;
}
