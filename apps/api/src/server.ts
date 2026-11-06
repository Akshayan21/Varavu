import { z } from 'zod';
import { buildApp } from './app.js';

const env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
}).parse(process.env);

const supabase = env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY
  ? { url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY }
  : undefined;
const app = buildApp({ origin: env.APP_ORIGIN, logger: true, supabase });
try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
