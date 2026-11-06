import { workspaceProfileSchema } from '@billing/shared';
import { createClient } from '@supabase/supabase-js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export type SupabaseConfig = { url: string; key: string };

export async function authenticate(request: FastifyRequest, reply: FastifyReply, config?: SupabaseConfig) {
  reply.header('Cache-Control', 'no-store');
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')?.[1];
  if (!token) return void reply.code(401).send({ error: 'Sign in to continue.' });
  if (!config) return void reply.code(503).send({ error: 'Supabase is not configured.' });

  const supabase = createClient(config.url, config.key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError && (!authError.status || authError.status >= 500)) {
    request.log.warn({ name: authError.name, status: authError.status }, 'Supabase Auth unavailable');
    return void reply.code(503).send({ error: 'Sign-in verification is temporarily unavailable.' });
  }
  if (!user?.email || user.is_anonymous) {
    return void reply.code(401).send({ error: 'Your session is invalid or has expired.' });
  }

  return { supabase, user: { id: user.id, email: user.email } };
}

export function registerWorkspace(app: FastifyInstance, config?: SupabaseConfig) {
  app.post('/api/v1/workspace/initialize', async (request, reply) => {
    const auth = await authenticate(request, reply, config);
    if (!auth) return reply;
    const { supabase, user } = auth;
    const { data, error } = await supabase.rpc('initialize_workspace').single();
    if (error) {
      request.log.error({ code: error.code }, 'Workspace initialization failed');
      return reply.code(503).send({ error: 'Could not load your workspace. Try again shortly.' });
    }
    return workspaceProfileSchema.parse({ user: { id: user.id, email: user.email }, workspace: data });
  });
}


