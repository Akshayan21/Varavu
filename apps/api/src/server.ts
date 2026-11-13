import { z } from 'zod';
import { buildApp } from './build-app.js';

const env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  LOCAL_MVP: z.enum(['true', 'false']).default('false'),
  LOCAL_OWNER_EMAIL: z.email().optional(),
  LOCAL_OWNER_PASSWORD: z.string().min(1).optional(),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
}).parse(process.env);

const local = process.argv.includes('--allow-local-mvp') && env.LOCAL_MVP === 'true';
const origin = new URL(env.APP_ORIGIN);
if (local && (process.env.NODE_ENV === 'production' || env.HOST !== '127.0.0.1' ||
    !['localhost', '127.0.0.1'].includes(origin.hostname) ||
    !env.LOCAL_OWNER_EMAIL || !env.LOCAL_OWNER_PASSWORD || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error('Local MVP requires a loopback server and web origin, Supabase settings, and local owner credentials.');
}
const supabase = env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY
  ? {
      url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY,
      localOwner: local ? { origin: origin.origin, email: env.LOCAL_OWNER_EMAIL!, password: env.LOCAL_OWNER_PASSWORD! } : undefined,
    }
  : undefined;
const app = buildApp({ origin: env.APP_ORIGIN, logger: true, supabase });
try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}


