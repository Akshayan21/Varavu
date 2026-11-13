import { workspaceProfileSchema } from '@billing/shared';
import { createClient } from '@supabase/supabase-js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

type LocalOwner = { origin: string; email: string; password: string };
export type SupabaseConfig = { url: string; key: string; localOwner?: LocalOwner };
const clientOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const localSessions = new WeakMap<SupabaseConfig, Promise<LocalSession>>();
type LocalSession = { token: string; expiresAt: number; user: { id: string; email: string } };

async function localSession(config: SupabaseConfig, owner: LocalOwner): Promise<LocalSession> {
  const pending = localSessions.get(config);
  if (pending) {
    const cached = await pending;
    if (cached.expiresAt > Date.now() + 60_000) return cached;
    if (localSessions.get(config) !== pending) return localSession(config, owner);
  }
  const client = createClient(config.url, config.key, { auth: clientOptions });
  const next = client.auth.signInWithPassword({ email: owner.email, password: owner.password }).then(({ data, error }) => {
    if (error || !data.session?.expires_at || !data.user?.email) throw new Error('Local owner unavailable');
    return { token: data.session.access_token, expiresAt: data.session.expires_at * 1000,
      user: { id: data.user.id, email: data.user.email } };
  });
  localSessions.set(config, next);
  try {
    return await next;
  } catch (error) {
    if (localSessions.get(config) === next) localSessions.delete(config);
    throw error;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply, config?: SupabaseConfig) {
  reply.header('Cache-Control', 'no-store');
  let token = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')?.[1];
  let localUser: LocalSession['user'] | undefined;
  const owner = config?.localOwner;
  if (!request.headers.authorization && config && owner &&
      request.ip === '127.0.0.1' && request.headers.origin === owner.origin) {
    try {
      const session = await localSession(config, owner);
      token = session.token;
      localUser = session.user;
    } catch {
      return void reply.code(503).send({ error: 'The local workspace is unavailable.' });
    }
  }
  if (!token) return void reply.code(401).send({ error: 'Sign in to continue.' });
  if (!config) return void reply.code(503).send({ error: 'Supabase is not configured.' });

  const supabase = createClient(config.url, config.key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: clientOptions,
  });
  if (localUser) return { supabase, user: localUser };
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



