import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { draft, challan } from './billing.js';
import { databaseError } from './http.js';
import { authenticate, type SupabaseConfig } from './workspace.js';

const uuid = z.uuid();
const page = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const period = z.object({
  from: z.iso.date(), asOf: z.iso.date(), recordedThrough: z.iso.datetime({ offset: true }).optional(),
});
const nonempty = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict().refine(value => Object.keys(value).length > 0);

export function registerOperations(app: FastifyInstance, config?: SupabaseConfig) {
  const base = '/api/v1/entities/:entityId';

  async function entitySession(request: FastifyRequest, reply: FastifyReply) {
    const auth = await authenticate(request, reply, config);
    if (!auth) return;
    const params = z.object({ entityId: uuid, id: uuid.optional() }).safeParse(request.params);
    if (!params.success) { reply.code(400).send({ error: 'Invalid company or record ID.' }); return; }
    const { data: company, error } = await auth.supabase.from('billing_entities')
      .select('id,workspace_id').eq('id', params.data.entityId).maybeSingle();
    if (error) { databaseError(reply, error); return; }
    if (!company) { reply.code(404).send({ error: 'Company not found.' }); return; }
    return { ...auth, company, params: params.data };
  }

  const documentFilters = page.extend({
    search: z.string().trim().max(100).optional(), status: z.enum(['draft', 'issued', 'cancelled']).optional(),
    customerId: uuid.optional(), invoiceId: uuid.optional(), from: z.iso.date().optional(), to: z.iso.date().optional(),
    asOf: z.iso.date().optional(), paymentStatus: z.enum(['paid', 'partially_paid', 'unpaid']).optional(),
    overdue: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
    minAmount: z.coerce.number().finite().nonnegative().optional(), maxAmount: z.coerce.number().finite().nonnegative().optional(),
    sort: z.enum(['newest', 'oldest', 'amount_desc']).default('newest'),
  }).strict().refine(value => !value.from || !value.to || value.from <= value.to, 'Invalid date range')
    .refine(value => value.minAmount === undefined || value.maxAmount === undefined || value.minAmount <= value.maxAmount, 'Invalid amount range');

  for (const kind of ['invoices', 'challans'] as const) {
    app.get(base + '/' + kind, async (request, reply) => {
      const auth = await entitySession(request, reply); if (!auth) return reply;
      const filters = documentFilters.safeParse(request.query);
      if (!filters.success) return reply.code(400).send({ error: 'Invalid document filters.', issues: filters.error.issues });
      if (kind === 'challans' && ['minAmount', 'maxAmount', 'overdue', 'paymentStatus'].some(key => key in filters.data)) {
        return reply.code(400).send({ error: 'Financial filters apply to invoices.' });
      }
      const { data, error } = await auth.supabase.rpc('list_documents', {
        p_entity: auth.company.id, p_kind: kind, p_filters: filters.data,
      });
      return error ? databaseError(reply, error) : data;
    });
    app.get(base + '/' + kind + '/:id', async (request, reply) => {
      const auth = await entitySession(request, reply); if (!auth) return reply;
      const { data, error } = await auth.supabase.rpc('document_detail', {
        p_entity: auth.company.id, p_kind: kind, p_id: auth.params.id,
      });
      return error ? databaseError(reply, error) : data;
    });
    app.patch(base + '/' + kind + '/:id', async (request, reply) => {
      const auth = await entitySession(request, reply); if (!auth) return reply;
      const schema = kind === 'invoices' ? draft.omit({ id: true }).extend({ version: z.number().int().positive() })
        : challan.omit({ id: true }).extend({ version: z.number().int().positive() });
      const input = schema.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: 'Submit the complete draft and its current version.', issues: input.error.issues });
      const payload = { ...input.data, id: auth.params.id };
      const { data, error } = await auth.supabase.rpc(kind === 'invoices' ? 'save_invoice_draft' : 'save_challan_draft', {
        p_entity: auth.company.id, [kind === 'invoices' ? 'p_bill' : 'p_challan']: payload,
      });
      return error ? databaseError(reply, error) : data;
    });
    app.delete(base + '/' + kind + '/:id', async (request, reply) => {
      const auth = await entitySession(request, reply); if (!auth) return reply;
      const input = z.object({ version: z.coerce.number().int().positive() }).strict().safeParse(request.query);
      if (!input.success) return reply.code(400).send({ error: 'Supply the current draft version.' });
      const { error } = await auth.supabase.rpc(kind === 'invoices' ? 'delete_invoice_draft' : 'delete_challan_draft', {
        p_entity: auth.company.id, p_id: auth.params.id, p_version: input.data.version,
      });
      return error ? databaseError(reply, error) : reply.code(204).send();
    });
  }

  app.post(base + '/invoices/:id/duplicate', async (request, reply) => {
    const auth = await entitySession(request, reply); if (!auth) return reply;
    const input = z.object({ id: uuid, date: z.iso.date() }).strict().safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Provide a new draft ID and invoice date.' });
    const { data, error } = await auth.supabase.rpc('duplicate_invoice', {
      p_entity: auth.company.id, p_id: auth.params.id, p_new_id: input.data.id, p_date: input.data.date,
    });
    return error ? databaseError(reply, error) : reply.code(201).send(data);
  });
  app.post(base + '/invoices/preview', async (request, reply) => {
    const auth = await entitySession(request, reply); if (!auth) return reply;
    const input = draft.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Invalid preview input.', issues: input.error.issues });
    const { data, error } = await auth.supabase.rpc('preview_invoice', { p_entity: auth.company.id, p_bill: input.data });
    return error ? databaseError(reply, error) : data;
  });

  app.get(base + '/dashboard', async (request, reply) => {
    const auth = await entitySession(request, reply); if (!auth) return reply;
    const input = period.strict().safeParse(request.query);
    if (!input.success) return reply.code(400).send({ error: 'Provide from and asOf dates.' });
    const { data, error } = await auth.supabase.rpc('dashboard_data', {
      p_entities: [auth.company.id], p_from: input.data.from, p_as_of: input.data.asOf,
      ...(input.data.recordedThrough ? { p_recorded: input.data.recordedThrough } : {}),
    });
    return error ? databaseError(reply, error) : data;
  });
  app.get('/api/v1/analytics/central', async (request, reply) => {
    const auth = await authenticate(request, reply, config); if (!auth) return reply;
    const input = period.extend({ entities: z.string().transform(value => value.split(',')).pipe(z.array(uuid).min(1).max(100)) }).strict().safeParse(request.query);
    if (!input.success) return reply.code(400).send({ error: 'Provide authorized company IDs and period dates.' });
    const { data, error } = await auth.supabase.rpc('dashboard_data', {
      p_entities: input.data.entities, p_from: input.data.from, p_as_of: input.data.asOf,
      ...(input.data.recordedThrough ? { p_recorded: input.data.recordedThrough } : {}),
    });
    return error ? databaseError(reply, error) : data;
  });
  app.get(base + '/customers/:id/summary', async (request, reply) => {
    const auth = await entitySession(request, reply); if (!auth) return reply;
    const input = period.omit({ recordedThrough: true }).strict().safeParse(request.query);
    if (!input.success) return reply.code(400).send({ error: 'Provide from and asOf dates.' });
    const { data, error } = await auth.supabase.rpc('customer_summary', {
      p_entity: auth.company.id, p_customer: auth.params.id, p_from: input.data.from, p_as_of: input.data.asOf,
    });
    return error ? databaseError(reply, error) : data;
  });

  // Bounded read endpoints expose records using the caller's RLS-protected client.
  const resources = [
    { path: 'payments', table: 'payments', order: 'posted_at' },
    { path: 'audit', table: 'audit_logs', order: 'occurred_at' },
    { path: 'templates', table: 'document_templates', order: 'created_at' },
    { path: 'styles/directory', table: 'styles', order: 'normalized_style_number' },
    { path: 'files', table: 'document_files', order: 'created_at' },
    { path: 'sequences', table: 'document_sequences', order: 'updated_at' },
  ];
  for (const resource of resources) {
    app.get(base + '/' + resource.path, async (request, reply) => {
      const auth = await entitySession(request, reply); if (!auth) return reply;
      const input = page.extend({ invoiceId: uuid.optional(), customerId: uuid.optional(), active: z.enum(['true', 'false']).optional(),
        status: z.string().max(40).optional(), from: z.iso.date().optional(), to: z.iso.date().optional(),
        resourceId: uuid.optional(), type: z.string().max(40).optional(), search: z.string().trim().max(100).optional() }).strict().safeParse(request.query);
      if (!input.success) return reply.code(400).send({ error: 'Invalid list filters.' });
      const filters = input.data;
      if (filters.from && filters.to && filters.from>filters.to) return reply.code(400).send({error:'Invalid date range.'});
      const statusValues: Record<string,string[]> = {
        payments: ['posted','reversed'], document_templates: ['draft','published'], document_files: ['pending','processing','ready','failed'],
      };
      if (filters.status && !statusValues[resource.table]?.includes(filters.status)) return reply.code(400).send({error:'Invalid resource status.'});
      if (filters.type && !['invoice','delivery_challan'].includes(filters.type)) return reply.code(400).send({error:'Invalid document type.'});
      const supported: Record<string, string[]> = {
        payments: ['invoiceId','customerId','status','from','to'],
        audit_logs: ['resourceId','from','to'],
        document_templates: ['status','type','from','to'],
        styles: ['active','search'],
        document_files: ['invoiceId','status','from','to'],
        document_sequences: ['type','from','to'],
      };
      if (Object.keys(filters).some(key => !['page','pageSize',...supported[resource.table]].includes(key))) {
        return reply.code(400).send({ error: 'A filter is unsupported for this resource.' });
      }
      const selection = resource.table === 'payments' && filters.customerId ? '*,invoices!inner(customer_id)' : '*';
      let query = auth.supabase.from(resource.table).select(selection, { count: 'exact' })
        .eq('workspace_id', auth.company.workspace_id).eq('entity_id', auth.company.id);
      if (filters.invoiceId && ['payments', 'document_files'].includes(resource.table)) query = query.eq('invoice_id', filters.invoiceId);
      if (filters.customerId && resource.table === 'payments') query = query.eq('invoices.customer_id',filters.customerId);
      if (filters.resourceId && resource.table === 'audit_logs') query = query.eq('resource_id', filters.resourceId);
      if (filters.active && resource.table === 'styles') query = query.eq('is_active', filters.active === 'true');
      if (filters.status && ['payments', 'document_files', 'document_templates'].includes(resource.table)) query = query.eq('status', filters.status);
      if (filters.type && ['document_templates', 'document_sequences'].includes(resource.table)) query = query.eq('document_type', filters.type);
      const dateColumn = resource.table === 'payments' ? 'payment_date' : resource.order;
      if (filters.from) query = query.gte(dateColumn, filters.from);
      if (filters.to) query = resource.table === 'payments' ? query.lte(dateColumn,filters.to)
        : query.lt(dateColumn, new Date(Date.parse(filters.to) + 86400000).toISOString());
      if (filters.search && resource.table === 'styles') query = query.ilike('normalized_style_number', filters.search.replace(/[\\%_]/g, char => '\\' + char) + '%');
      const offset = (filters.page - 1) * filters.pageSize;
      const { data, error, count } = await query.order(resource.order, { ascending: resource.table === 'styles' })
        .order(resource.table === 'document_sequences' ? 'period_key' : 'id').range(offset, offset + filters.pageSize - 1);
      return error ? databaseError(reply, error) : { data, page: filters.page, pageSize: filters.pageSize, total: count ?? 0 };
    });
  }

  for (const resource of [
    { path: 'styles', table: 'styles' }, { path: 'templates', table: 'document_templates' },
    { path: 'tax-profiles', table: 'tax_profiles' }, { path: 'print-types', table: 'print_types' },
    { path: 'placements', table: 'placements' }, { path: 'units', table: 'units' },
    { path: 'files', table: 'document_files' }, { path: 'payments', table: 'payments' },
  ]) {
    app.get(base + '/' + resource.path + '/:id', async (request,reply) => {
      const auth = await entitySession(request,reply); if (!auth) return reply;
      const { data,error } = await auth.supabase.from(resource.table).select('*').eq('workspace_id',auth.company.workspace_id)
        .eq('entity_id',auth.company.id).eq('id',auth.params.id!).maybeSingle();
      return error ? databaseError(reply,error) : data ?? reply.code(404).send({ error: 'Record not found.' });
    });
  }

  app.get(base + '/invoices/:id/payments',async(request,reply) => {
    const auth = await entitySession(request,reply); if(!auth) return reply;
    const {data,error} = await auth.supabase.rpc('document_detail',{p_entity:auth.company.id,p_kind:'invoices',p_id:auth.params.id});
    return error ? databaseError(reply,error) : {data:data.receipts};
  });

  for (const action of ['archive','restore']) {
    for (const resource of [{path:'',table:'billing_entities'},{path:'/customers/:id',table:'customers'}]) {
      app.post(base + resource.path + '/' + action, async(request,reply) => {
        const auth = await entitySession(request,reply); if(!auth) return reply;
        const input = z.object({version:z.number().int().positive()}).strict().safeParse(request.body);
        if(!input.success) return reply.code(400).send({error:'Provide the current record version.'});
        const {data,error} = await auth.supabase.rpc('archive_directory_record',{
          p_entity:auth.company.id,p_table:resource.table,p_id:resource.table==='billing_entities'?auth.company.id:auth.params.id,
          p_version:input.data.version,p_active:action==='restore',
        });
        return error ? databaseError(reply,error) : data;
      });
    }
  }

  app.get('/api/v1/exports',async(request,reply) => {
    const auth = await authenticate(request,reply,config); if(!auth) return reply;
    const filters = page.strict().safeParse(request.query);
    if(!filters.success) return reply.code(400).send({error:'Invalid pagination.'});
    const offset = (filters.data.page-1)*filters.data.pageSize;
    const {data,error,count} = await auth.supabase.from('report_exports')
      .select('id,report_type,entity_ids,filters_json,format,status,attempt_count,last_error,generated_at,expires_at,created_at',{count:'exact'})
      .order('created_at',{ascending:false}).order('id').range(offset,offset+filters.data.pageSize-1);
    return error ? databaseError(reply,error) : {data,...filters.data,total:count ?? 0};
  });
  app.get('/api/v1/exports/:id/status',async(request,reply) => {
    const auth = await authenticate(request,reply,config); if(!auth) return reply;
    const id = uuid.safeParse((request.params as {id:string}).id);
    if(!id.success) return reply.code(400).send({error:'Invalid export ID.'});
    const {data,error} = await auth.supabase.from('report_exports')
      .select('id,report_type,format,status,attempt_count,last_error,generated_at,expires_at').eq('id',id.data).maybeSingle();
    return error ? databaseError(reply,error) : data ?? reply.code(404).send({error:'Export not found.'});
  });

  const optionInput = z.object({ code: z.string().regex(/^[A-Z0-9_-]{1,40}$/), label: z.string().trim().min(1).max(100), sort_order: z.number().int().min(0).optional() }).strict();
  const taxInput = z.object({ name: z.string().trim().min(1).max(100), tax_mode: z.enum(['none','intra_state','inter_state','other']),
    cgst_rate: z.number().min(0).max(100).default(0), sgst_rate: z.number().min(0).max(100).default(0),
    igst_rate: z.number().min(0).max(100).default(0), other_tax_rate: z.number().min(0).max(100).default(0) }).strict();
  for (const table of ['print_types', 'placements', 'units', 'tax_profiles', 'styles']) {
    const path = table.replaceAll('_', '-');
    const editable = table === 'styles' ? nonempty({ name: z.string().max(200).nullable().optional(), description: z.string().max(2000).nullable().optional(),
      defaultPrintTypeId: uuid.nullable().optional(), defaultPlacementId: uuid.nullable().optional(), defaultUnitId: uuid.nullable().optional(), is_active: z.boolean().optional() })
      : table === 'tax_profiles' ? taxInput.partial().extend({ is_active: z.boolean().optional() })
      : optionInput.omit({ code: true }).partial().extend({ is_active: z.boolean().optional() });
    app.patch(base + '/' + path + '/:id', async (request, reply) => {
      const auth = await entitySession(request, reply); if (!auth) return reply;
      const input = z.object({ version: z.number().int().positive(), changes: editable }).strict().safeParse(request.body);
      if (!input.success || !Object.keys(input.data.changes).length) return reply.code(400).send({ error: 'Provide changes and the current catalog version.' });
      const { data, error } = await auth.supabase.rpc('configure_catalog', { p_entity: auth.company.id, p_table: table,
        p_id: auth.params.id, p_version: input.data.version, p_data: input.data.changes });
      return error ? databaseError(reply, error) : data;
    });
    if (table !== 'styles' && table !== 'tax_profiles') app.post(base + '/' + path, async (request, reply) => {
      const auth = await entitySession(request, reply); if (!auth) return reply;
      const input = optionInput.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: 'Provide a valid code and label.' });
      const { data, error } = await auth.supabase.rpc('configure_catalog', { p_entity: auth.company.id, p_table: table, p_id: null, p_version: null, p_data: input.data });
      return error ? databaseError(reply, error) : reply.code(201).send(data);
    });
  }

  app.patch(base + '/settings', async (request, reply) => {
    const auth = await entitySession(request, reply); if (!auth) return reply;
    const input = z.object({ version: z.number().int().positive(), changes: nonempty({
      defaultTaxProfileId: uuid.nullable().optional(), defaultInvoiceTemplateId: uuid.optional(), defaultDcTemplateId: uuid.optional(),
      roundingIncrement: z.union([z.literal(0), z.literal(0.01), z.literal(1)]).optional(), defaultTerms: z.string().max(2000).nullable().optional(),
    }) }).strict().safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Provide settings changes and the current company version.' });
    const { data, error } = await auth.supabase.rpc('configure_entity', { p_entity: auth.company.id, p_version: input.data.version, p_data: input.data.changes });
    return error ? databaseError(reply, error) : data;
  });

  app.patch('/api/v1/workspace', async (request, reply) => {
    const auth = await authenticate(request, reply, config); if (!auth) return reply;
    const input = nonempty({ name: z.string().trim().min(1).max(200).optional(), timezone: z.string().max(100).optional() }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Provide a valid workspace name or timezone.' });
    const { data, error } = await auth.supabase.rpc('update_workspace', { p_data: input.data });
    return error ? databaseError(reply, error) : data;
  });
  app.get('/api/v1/workspace', async (request, reply) => {
    const auth = await authenticate(request, reply, config); if (!auth) return reply;
    const { data, error } = await auth.supabase.from('workspaces').select('*').eq('owner_user_id', auth.user.id).maybeSingle();
    return error ? databaseError(reply, error) : data ?? reply.code(404).send({ error: 'Workspace not initialized.' });
  });
  app.get('/api/v1/preferences', async (request, reply) => {
    const auth = await authenticate(request, reply, config); if (!auth) return reply;
    const { data, error } = await auth.supabase.from('user_preferences').select('*').eq('user_id', auth.user.id).maybeSingle();
    return error ? databaseError(reply, error) : data ?? { last_entity_id: null, skip_entity_selector: false, preferences_json: {} };
  });
  app.get('/api/v1/auth/session', async (request, reply) => {
    const auth = await authenticate(request, reply, config); if (!auth) return reply;
    return { user: auth.user };
  });
  app.get('/api/v1/health/ready',async(request,reply) => {
    const auth = await authenticate(request,reply,config);if(!auth) return reply;
    const {data,error} = await auth.supabase.rpc('health_database');
    return error ? databaseError(reply,error) : data;
  });
  app.post(base + '/files/:id/retry',async(request,reply) => {
    const auth = await entitySession(request,reply);if(!auth) return reply;
    const {data,error} = await auth.supabase.rpc('retry_document_file',{p_entity:auth.company.id,p_id:auth.params.id});
    return error ? databaseError(reply,error) : reply.code(202).send(data);
  });
  app.post('/api/v1/exports/:id/retry',async(request,reply) => {
    const auth = await authenticate(request,reply,config);if(!auth) return reply;
    const id = uuid.safeParse((request.params as {id:string}).id);
    if(!id.success) return reply.code(400).send({error:'Invalid export ID.'});
    const {data,error} = await auth.supabase.rpc('retry_report_export',{p_id:id.data});
    return error ? databaseError(reply,error) : reply.code(202).send(data);
  });
}
