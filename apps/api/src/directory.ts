import { billingEntityInput, customerInput } from '@billing/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate, type SupabaseConfig } from './workspace.js';

const filters = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  active: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
}).strict();
const recordId = z.object({ id: z.uuid() });

function databaseError(reply: FastifyReply, code: string) {
  if (code === '23505') return reply.code(409).send({ error: 'A record with that code already exists.' });
  if (code === '23514') return reply.code(400).send({ error: 'The record does not satisfy the directory rules. GST registration requires a GSTIN.' });
  if (code === '42501') return reply.code(403).send({ error: 'Access denied.' });
  return reply.code(503).send({ error: 'Directory temporarily unavailable.' });
}

export function registerDirectory(app: FastifyInstance, config?: SupabaseConfig) {
  const resources = [
    { path: 'entities', table: 'billing_entities', schema: billingEntityInput },
    { path: 'customers', table: 'customers', schema: customerInput },
  ] as const;

  for (const { path, table, schema } of resources) {
    const base = '/api/v1/' + path;
    const patch = schema.partial();
    app.route({
      method: ['GET', 'POST'],
      url: base,
      handler: directoryHandler,
    });
    app.route({
      method: ['GET', 'PATCH'],
      url: base + '/:id',
      handler: directoryHandler,
    });

    async function directoryHandler(request: Parameters<typeof authenticate>[0], reply: FastifyReply) {
      const auth = await authenticate(request, reply, config);
      if (!auth) return reply;
      const { supabase, user } = auth;
      const { data: workspace, error: workspaceError } = await supabase.from('workspaces')
        .select('id').eq('owner_user_id', user.id).maybeSingle();
      if (workspaceError) return databaseError(reply, workspaceError.code);
      if (!workspace) return reply.code(409).send({ error: 'Initialize your workspace first.' });

      const workspaceId = workspace.id;
      if (request.method === 'POST') {
        const input = schema.safeParse(request.body);
        if (!input.success) return reply.code(400).send({ error: 'Invalid record.', issues: input.error.issues });
        const { data, error } = await supabase.from(table).insert({ ...input.data, workspace_id: workspaceId })
          .select().single();
        return error ? databaseError(reply, error.code) : reply.code(201).send(data);
      }

      const params = request.params as { id?: string };
      if (params.id !== undefined) {
        const id = recordId.safeParse(params);
        if (!id.success) return reply.code(400).send({ error: 'Invalid record ID.' });
        if (request.method === 'PATCH') {
          const input = patch.safeParse(request.body);
          if (!input.success || Object.keys(input.data).length === 0) {
            return reply.code(400).send({ error: 'Provide valid fields to update.', issues: input.error?.issues });
          }
          const { data, error } = await supabase.from(table).update(input.data)
            .eq('workspace_id', workspaceId).eq('id', id.data.id).select().maybeSingle();
          if (error) return databaseError(reply, error.code);
          return data ?? reply.code(404).send({ error: 'Record not found.' });
        }
        const { data, error } = await supabase.from(table).select()
          .eq('workspace_id', workspaceId).eq('id', id.data.id).maybeSingle();
        if (error) return databaseError(reply, error.code);
        return data ?? reply.code(404).send({ error: 'Record not found.' });
      }

      const parsed = filters.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid list filters.' });
      const { page, pageSize, active, search } = parsed.data;
      let query = supabase.from(table).select('*', { count: 'exact' }).eq('workspace_id', workspaceId);
      if (active !== undefined) query = query.eq('is_active', active === 'true');
      if (search) {
        const literal = search.replace(/[\\%_]/g, (character) => '\\' + character);
        query = query.ilike('legal_name', '%' + literal + '%');
      }
      const offset = (page - 1) * pageSize;
      const { data, error, count } = await query.order('legal_name').order('id').range(offset, offset + pageSize - 1);
      if (error) return databaseError(reply, error.code);
      return { data, page, pageSize, total: count ?? 0 };
    }
  }
}
