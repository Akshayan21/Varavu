import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate, type SupabaseConfig } from './workspace.js';
import { documentHtml, renderPdf } from './pdf.js';
import { createHash, randomUUID } from 'node:crypto';

const uuid = z.uuid();
const date = z.iso.date();
const text = z.string().max(2000);
const decimal = z.string().regex(/^\d{1,8}(?:\.\d{1,4})?$/);
const line = z.object({
  id: z.number().int().positive(), description: z.string().trim().min(1).max(300),
  quantity: z.string().regex(/^\d{1,6}(?:\.\d{1,3})?$/), rate: decimal,
  style: z.string().trim().max(100).optional(), styleId: uuid.nullable().optional(),
  printType: z.string().max(100).optional(), placement: z.string().max(100).optional(),
  unitCode: z.string().max(40).optional(), placementDetail: text.optional(),
  discountCents: z.number().int().nonnegative().optional(), adjustmentCents: z.number().int().optional(),
  adjustmentReason: text.optional(), taxProfileId: uuid.optional(),
});
const draft = z.object({
  id: uuid, version: z.number().int().positive().optional(), customerId: uuid,
  replacementForInvoiceId: uuid.optional(),
  date, due: date, reference: z.string().max(100).optional(), notes: text.optional(), terms: text.optional(),
  bank: z.record(z.string(),z.string().max(300)).optional(), upi: z.string().max(200).optional(),
  discountCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  taxBasisPoints: z.number().int().min(0).max(10000).optional(), lines: z.array(line).min(1).max(100),
}).strict();
const challan = z.object({
  id: uuid, version: z.number().int().positive().optional(), customerId: uuid.nullable().optional(),
  recipient: z.string().trim().min(1).max(200), date,
  from: z.string().trim().min(1).max(2000), to: z.string().trim().min(1).max(2000),
  notes: text.optional(), billId: z.union([uuid,z.literal('')]).nullable().optional(),
  items: z.array(z.object({ description: z.string().trim().min(1).max(300), quantity: decimal,
    unit: z.string().min(1).max(100), remarks: text.optional() })).min(1).max(100),
}).strict();

function databaseError(reply: FastifyReply, error: { code: string; message: string }) {
  const status = ({ '42501':403, '23505':409, '40001':409, '55P03':409, 'P0002':404,
    '23514':400, '23502':400, '23503':400, '22P02':400, '22003':400, '22007':400 } as Record<string,number>)[error.code] ?? 503;
  return reply.code(status).send({ error: status === 503 ? 'Database operation unavailable. Please retry.' : error.message });
}

export function registerBilling(app: FastifyInstance, config?: SupabaseConfig) {
  const base = '/api/v1/entities/:entityId';
  // Database functions perform ownership checks as well as HTTP authentication.
  function mutation<T extends z.ZodType>(path: string, schema: T, rpc: string,
    argumentsFor: (entity: string, params: Record<string,string>, data: z.output<T>, key?: string) => Record<string,unknown>, method: 'POST' | 'DELETE' = 'POST') {
    app.route({ method, url: base + path, handler: async (request,reply) => {
      const auth = await authenticate(request,reply,config);
      if (!auth) return reply;
      const params = request.params as Record<string,string>;
      if (!uuid.safeParse(params.entityId).success || params.id && !uuid.safeParse(params.id).success || params.paymentId && !uuid.safeParse(params.paymentId).success) {
        return reply.code(400).send({error:'Invalid record ID.'});
      }
      const input = schema.safeParse(request.body);
      if (!input.success) return reply.code(400).send({error:'Check the submitted fields.',issues:input.error.issues});
      const key = request.headers['idempotency-key'];
      if (rpc === 'record_payment' && (typeof key !== 'string' || key.length < 1 || key.length > 200)) {
        return reply.code(400).send({error:'A payment request identifier is required.'});
      }
      const operation = auth.supabase.rpc(rpc,argumentsFor(params.entityId,params,input.data,typeof key === 'string' ? key : undefined));
      const {data,error} = await (rpc==='resolve_style'?operation.single():operation);
      return error ? databaseError(reply,error) : data ?? {ok:true};
    }});
  }
  mutation('/styles/resolve',z.object({number:z.string().trim().min(1).max(100)}).strict(),'resolve_style',(entity,_,data)=>({p_entity:entity,p_number:data.number}));
  mutation('/invoices',draft,'save_invoice_draft',(entity,_,data)=>({p_entity:entity,p_bill:data}));
  mutation('/invoices/:id/issue',z.object({version:z.number().int().positive()}).strict(),'issue_invoice',(entity,params,data)=>({p_entity:entity,p_id:params.id,p_version:data.version}));
  mutation('/invoices/:id/cancel',z.object({reason:z.string().trim().min(1).max(2000)}).strict(),'cancel_invoice',(entity,params,data)=>({p_entity:entity,p_id:params.id,p_reason:data.reason}));
  mutation('/invoices/:id/delete',z.object({version:z.number().int().positive()}).strict(),'delete_invoice_draft',(entity,params,data)=>({p_entity:entity,p_id:params.id,p_version:data.version}));
  mutation('/invoices/:id/payments',z.object({date,cents:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    method:z.enum(['bank_transfer','upi','cash','cheque','other']),reference:text.optional(),notes:text.optional()}).strict(),
    'record_payment',(entity,params,data,key)=>({p_entity:entity,p_id:params.id,p_receipt:data,p_key:key}));
  mutation('/invoices/:id/payments/:paymentId/reverse',z.object({reason:z.string().trim().min(1).max(2000)}).strict(),
    'reverse_payment',(entity,params,data)=>({p_entity:entity,p_id:params.id,p_payment:params.paymentId,p_reason:data.reason}));
  mutation('/challans',challan,'save_challan_draft',(entity,_,data)=>({p_entity:entity,p_challan:data}));
  mutation('/challans/:id/issue',z.object({version:z.number().int().positive()}).strict(),'issue_challan',(entity,params,data)=>({p_entity:entity,p_id:params.id,p_version:data.version}));
  mutation('/challans/:id/cancel',z.object({reason:z.string().trim().min(1).max(2000)}).strict(),'cancel_challan',(entity,params,data)=>({p_entity:entity,p_id:params.id,p_reason:data.reason}));
  mutation('/challans/:id/acknowledge',z.object({receivedBy:z.string().trim().min(1).max(200),receivedAt:z.iso.datetime(),notes:text.optional()}).strict(),
    'acknowledge_delivery',(entity,params,data)=>({p_entity:entity,p_id:params.id,p_data:data}));
  mutation('/templates',z.object({type:z.enum(['invoice','delivery_challan']),settings:z.object({accent:z.string().regex(/^#[0-9a-fA-F]{6}$/),preset:z.enum(['structured','minimal'])})}).strict(),
    'publish_template',(entity,_,data)=>({p_entity:entity,p_type:data.type,p_settings:data.settings}));
  mutation('/catalog',z.object({table:z.enum(['styles','print_types','placements','units']),id:uuid.nullable(),
    data:z.object({code:z.string().regex(/^[A-Z0-9_-]{1,40}$/).optional(),label:z.string().trim().min(1).max(100).optional(),is_active:z.boolean().optional(),name:text.optional(),description:text.optional()}).strict()}).strict(),
    'update_catalog',(entity,_,data)=>({p_entity:entity,p_table:data.table,p_id:data.id,p_data:data.data}));
  mutation('/tax-profiles',z.object({name:z.string().trim().min(1).max(100),tax_mode:z.enum(['none','intra_state','inter_state','other']),
    cgst_rate:z.number().min(0).max(100).default(0),sgst_rate:z.number().min(0).max(100).default(0),
    igst_rate:z.number().min(0).max(100).default(0),other_tax_rate:z.number().min(0).max(100).default(0)}).strict(),
    'save_tax_profile',(entity,_,data)=>({p_entity:entity,p_profile:data}));

  app.post('/api/v1/preferences',async(request,reply)=>{
    const auth=await authenticate(request,reply,config);if(!auth)return reply;
    const input=z.object({lastEntityId:uuid.nullable(),skipEntitySelector:z.boolean(),preferences:z.record(z.string(),z.unknown()).optional()}).strict().safeParse(request.body);
    if(!input.success)return reply.code(400).send({error:'Invalid preferences.'});
    const {data,error}=await auth.supabase.rpc('save_preferences',{p_data:input.data});
    return error?databaseError(reply,error):data;
  });

  app.get(base+'/catalog',async(request,reply)=>{
    const auth = await authenticate(request,reply,config); if(!auth) return reply;
    const parsed=uuid.safeParse((request.params as {entityId:string}).entityId);
    if(!parsed.success) return reply.code(400).send({error:'Invalid company ID.'});
    const catalog:Record<string,unknown>={};
    for(const table of ['print_types','placements','units','tax_profiles','document_templates']) {
      const {data,error}=await auth.supabase.from(table).select('*').eq('entity_id',parsed.data);
      if(error) return databaseError(reply,error);
      catalog[table]=data;
    }
    return catalog;
  });
  app.post(base+'/assets',async(request,reply)=>{
    const auth=await authenticate(request,reply,config);if(!auth)return reply;
    const entity=uuid.safeParse((request.params as {entityId:string}).entityId);
    const input=z.object({kind:z.enum(['logo','signature']),base64:z.string().min(1).max(700000).regex(/^[A-Za-z0-9+/]*={0,2}$/)}).strict().safeParse(request.body);
    if(!entity.success||!input.success)return reply.code(400).send({error:'Choose a PNG or JPEG image smaller than 512 KB.'});
    const {data:company,error}=await auth.supabase.from('billing_entities').select('workspace_id').eq('id',entity.data).eq('is_active',true).maybeSingle();
    if(error)return databaseError(reply,error);
    if(!company)return reply.code(404).send({error:'Active company not found.'});
    const bytes=Buffer.from(input.data.base64,'base64');
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(bytes.length>512*1024 || (!png&&!jpeg))return reply.code(400).send({error:'Choose a PNG or JPEG image smaller than 512 KB.'});
    const path=`${company.workspace_id}/${entity.data}/${input.data.kind}/${randomUUID()}.${png?'png':'jpg'}`;
    const {error:uploadError}=await auth.supabase.storage.from('billing-assets').upload(path,bytes,{contentType:png?'image/png':'image/jpeg',upsert:false});
    if(uploadError)return reply.code(503).send({error:'Image upload failed.'});
    const {error:saveError}=await auth.supabase.rpc('set_entity_asset',{p_entity:entity.data,p_kind:input.data.kind,p_path:path});
    return saveError?databaseError(reply,saveError):{path};
  });
  app.get(base+'/assets/url',async(request,reply)=>{
    const auth=await authenticate(request,reply,config);if(!auth)return reply;
    const query=z.object({path:z.string().max(1000)}).safeParse(request.query);
    const entity=uuid.safeParse((request.params as {entityId:string}).entityId);
    if(!query.success||!entity.success)return reply.code(400).send({error:'Invalid image path.'});
    const {data:company}=await auth.supabase.from('billing_entities').select('workspace_id').eq('id',entity.data).maybeSingle();
    if(!company||!query.data.path.startsWith(`${company.workspace_id}/${entity.data}/`))return reply.code(404).send({error:'Image not found.'});
    const {data,error}=await auth.supabase.storage.from('billing-assets').createSignedUrl(query.data.path,600);
    return error?reply.code(404).send({error:'Image not found.'}):{url:data.signedUrl};
  });
  app.get(base+'/styles',async(request,reply)=>{
    const auth = await authenticate(request,reply,config); if(!auth) return reply;
    const entity=uuid.safeParse((request.params as {entityId:string}).entityId);
    const query=z.object({search:z.string().max(100).default('')}).safeParse(request.query);
    if(!entity.success || !query.success) return reply.code(400).send({error:'Invalid style search.'});
    const escaped=query.data.search.trim().replace(/[\\%_]/g,c=>'\\'+c);
    const {data,error}=await auth.supabase.from('styles').select('*').eq('entity_id',entity.data)
      .eq('is_active',true).ilike('normalized_style_number',escaped+'%').order('normalized_style_number').limit(20);
    return error ? databaseError(reply,error) : {data};
  });
  app.get('/api/v1/workspace/documents',async(request,reply)=>{
    const auth=await authenticate(request,reply,config); if(!auth) return reply;
    const query=z.object({page:z.coerce.number().int().min(1).max(100000).default(1)}).safeParse(request.query);
    if(!query.success) return reply.code(400).send({error:'Invalid page.'});
    const {data,error}=await auth.supabase.rpc('workspace_documents',{p_page:query.data.page});
    return error ? databaseError(reply,error) : data;
  });

  app.get(base+'/:kind/:id/pdf',async(request,reply)=>{
    const auth=await authenticate(request,reply,config); if(!auth) return reply;
    const params=z.object({entityId:uuid,id:uuid,kind:z.enum(['invoices','challans'])}).safeParse(request.params);
    if(!params.success) return reply.code(400).send({error:'Invalid document.'});
    const {entityId,id,kind}=params.data;
    const {data:file,error}=await auth.supabase.rpc('claim_document_file',{p_entity:entityId,p_type:kind==='invoices'?'invoice':'delivery_challan',p_id:id});
    if(error) return databaseError(reply,error);
    try {
      if(file.status!=='ready') {
        const {data:document,error:loadError}=await auth.supabase.rpc(kind==='invoices'?'invoice_payload':'challan_payload',{p_id:id});
        if(loadError || !document) throw new Error('Document could not be loaded.');
        if(file.variant==='original') {document.status='Issued';document.cancellation=null;}
        for(const field of ['logo_path','signature_path']) {
          const path=document.seller?.[field];
          if(typeof path==='string' && path.startsWith(`${file.workspace_id}/${entityId}/`)) {
            const {data:asset}=await auth.supabase.storage.from('billing-assets').download(path);
            if(asset && ['image/png','image/jpeg'].includes(asset.type)) {
              document.seller[field+'_data']='data:'+asset.type+';base64,'+Buffer.from(await asset.arrayBuffer()).toString('base64');
            }
          }
        }
        const bytes=await renderPdf(documentHtml(document,kind));
        const path=`${file.workspace_id}/${entityId}/${file.id}/${file.claim_token}.pdf`;
        const {error:uploadError}=await auth.supabase.storage.from(file.bucket_id).upload(path,bytes,{contentType:'application/pdf',upsert:false});
        if(uploadError) throw new Error('PDF upload failed.');
        const {error:finishError}=await auth.supabase.rpc('finish_document_file',{p_entity:entityId,p_id:file.id,p_token:file.claim_token,
          p_result:{path,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length}});
        if(finishError) throw new Error('PDF claim expired. Retry download.');
        file.object_path=path;
      }
      const {data:pdf,error:downloadError}=await auth.supabase.storage.from(file.bucket_id).download(file.object_path);
      if(downloadError || !pdf) throw new Error('PDF download failed.');
      return reply.type('application/pdf').header('Content-Disposition',`attachment; filename="${kind}-${id}.pdf"`).send(Buffer.from(await pdf.arrayBuffer()));
    } catch(error) {
      if(file.status!=='ready') await auth.supabase.rpc('finish_document_file',{p_entity:entityId,p_id:file.id,p_token:file.claim_token,p_result:{error:'PDF generation failed. Retry download.'}});
      request.log.warn({error:error instanceof Error ? error.message : 'Unknown PDF error'},'PDF generation failed');
      return reply.code(503).send({error:'Could not generate the PDF. Retry the download.'});
    }
  });
}
