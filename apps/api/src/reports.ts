import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, type SupabaseConfig } from './workspace.js';
import { renderPdf, reportHtml } from './pdf.js';

const types=z.enum(['billing','collections','outstanding','customers','monthly','print-type','challans','cancelled','companies']);
const period=z.object({entities:z.array(z.uuid()).min(1).max(100),from:z.iso.date(),asOf:z.iso.date()});

export function registerReports(app:FastifyInstance,config?:SupabaseConfig) {
  app.get('/api/v1/reports/:type',async(request,reply)=>{
    const auth=await authenticate(request,reply,config);if(!auth)return reply;
    const type=types.safeParse((request.params as {type:string}).type);
    const query=z.object({entities:z.string(),from:z.iso.date(),asOf:z.iso.date()}).safeParse(request.query);
    const input=query.success?period.safeParse({...query.data,entities:query.data.entities.split(',')}):null;
    if(!type.success || !input?.success) return reply.code(400).send({error:'Invalid report filters.'});
    const {data,error}=await auth.supabase.rpc('report_data',{p_entities:input.data.entities,p_type:type.data,p_from:input.data.from,p_as_of:input.data.asOf});
    return error?reply.code(error.code==='42501'?403:400).send({error:error.message}):data;
  });
  app.post('/api/v1/reports/:type/exports',async(request,reply)=>{
    const auth=await authenticate(request,reply,config);if(!auth)return reply;
    const type=types.safeParse((request.params as {type:string}).type);
    const input=period.extend({format:z.enum(['pdf','csv'])}).safeParse(request.body);
    if(!type.success || !input.success) return reply.code(400).send({error:'Invalid report filters.'});
    const {data,error}=await auth.supabase.rpc('request_report_export',{p_entities:input.data.entities,p_type:type.data,
      p_from:input.data.from,p_as_of:input.data.asOf,p_format:input.data.format});
    return error?reply.code(error.code==='42501'?403:400).send({error:error.message}):{id:data.id};
  });
  app.get('/api/v1/exports/:id',async(request,reply)=>{
    const auth=await authenticate(request,reply,config);if(!auth)return reply;
    const id=z.uuid().safeParse((request.params as {id:string}).id);
    if(!id.success)return reply.code(400).send({error:'Invalid export ID.'});
    const {data:job,error}=await auth.supabase.rpc('claim_report_export',{p_id:id.data});
    if(error)return reply.code(error.code==='42501'||error.code==='P0002'?404:409).send({error:error.message});
    const mime=job.format==='pdf'?'application/pdf':'text/csv; charset=utf-8';
    try {
      if(job.status!=='ready') {
        const dataset=job.data_snapshot as {headers:string[];rows:unknown[][]};
        let bytes:Buffer;
        if(job.format==='pdf') bytes=await renderPdf(reportHtml(job));
        else {
          // Quote every CSV cell and neutralize spreadsheet formulas in textual inputs.
          const cell=(value:unknown)=>{
            let text=String(value ?? '');
            if(typeof value==='string' && /^[\s]*[=+@-]/.test(text))text="'"+text;
            return '"'+text.replaceAll('"','""')+'"';
          };
          bytes=Buffer.from('\uFEFF'+[
            [job.title_snapshot],['Generated',new Date().toISOString()],['Companies',job.entity_names_snapshot.map((row:{name:string})=>row.name).join(', ')],
            ['From',job.filters_json.from,'As of',job.as_of_date,'Recorded through',job.recorded_through],
            dataset.headers,...dataset.rows,
          ].map(row=>row.map(cell).join(',')).join('\r\n'));
        }
        const path=`${job.workspace_id}/${job.entity_ids[0]}/${job.id}/${job.claim_token}.${job.format}`;
        const {error:uploadError}=await auth.supabase.storage.from(job.bucket_id).upload(path,bytes,{contentType:mime,upsert:false});
        if(uploadError)throw new Error('Export upload failed.');
        const {error:finishError}=await auth.supabase.rpc('finish_report_export',{p_id:job.id,p_token:job.claim_token,
          p_result:{path,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length}});
        if(finishError)throw new Error('Export claim expired.');
        job.object_path=path;
      }
      const {data,error:downloadError}=await auth.supabase.storage.from(job.bucket_id).download(job.object_path);
      if(downloadError || !data)throw new Error('Export download failed.');
      return reply.type(mime).header('Content-Disposition',`attachment; filename="${job.report_type}-${job.id}.${job.format}"`).send(Buffer.from(await data.arrayBuffer()));
    } catch(err) {
      if(job.status!=='ready')await auth.supabase.rpc('finish_report_export',{p_id:job.id,p_token:job.claim_token,p_result:{error:'Export failed. Retry download.'}});
      request.log.warn({message:err instanceof Error?err.message:'Export failed'},'Report export failed');
      return reply.code(503).send({error:'Could not generate the export. Retry the download.'});
    }
  });
}
