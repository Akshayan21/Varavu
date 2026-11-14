import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

describe('PostgreSQL migrations and billing transactions',()=>{
  let db:PGlite;
  let workspace:string;
  let entity:string;
  let otherEntity:string;
  let customer:string;
  let invoice:any;
  const owner=randomUUID();
  const bill=()=>({id:randomUUID(),customerId:customer,date:'2026-11-01',due:'2026-12-01',
    discountCents:1250,taxBasisPoints:1000,lines:[
      {id:1,description:'Front print',quantity:'3',rate:'112.50',style:' ST-001 ',printType:'DTF'},
      {id:2,description:'Back print',quantity:'2.5',rate:'10'},
    ]});
  async function call(name:string,args:unknown[]=[]) {
    const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');
    return (await db.query<{result:any}>(`select to_jsonb(public.${name}(${placeholders})) result`,args)).rows[0].result;
  }
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`create role anon; create role authenticated;
      create schema auth;create schema storage;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
      create table storage.buckets(id text primary key,name text,public boolean);
      create table storage.objects(id uuid,bucket_id text,name text);
      grant usage on schema public,auth to authenticated;`);
    for(const name of readdirSync('supabase/migrations').sort()) {
      await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
    }
    await db.query('insert into auth.users(id,email) values($1,$2)',[owner,'owner@example.test']);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    workspace=(await call('initialize_workspace')).id;
    entity=(await db.query<{id:string}>("insert into public.billing_entities(workspace_id,entity_code,legal_name) values($1,'A','Company A') returning id",[workspace])).rows[0].id;
    otherEntity=(await db.query<{id:string}>("insert into public.billing_entities(workspace_id,entity_code,legal_name) values($1,'B','Company B') returning id",[workspace])).rows[0].id;
    customer=(await db.query<{id:string}>("insert into public.customers(workspace_id,entity_id,legal_name) values($1,$2,'Buyer') returning id",[workspace,entity])).rows[0].id;
  },30000);
  afterAll(async()=>{await db?.close();});

  test('creates all 22 application tables and seeds both company catalogs',async()=>{
    const result=await db.query<{count:number}>("select count(*)::int count from pg_tables where schemaname='public'");
    expect(result.rows[0].count).toBe(22);
    expect((await db.query('select * from public.print_types where entity_id=$1',[entity])).rows).toHaveLength(8);
  });
  test('normalizes styles, preserves leading zeros, and isolates companies',async()=>{
    const first=await call('resolve_style',[entity,' ST-001 ']);
    const repeat=await call('resolve_style',[entity,'st-001']);
    const separate=await call('resolve_style',[otherEntity,'ST-001']);
    expect(repeat.id).toBe(first.id);
    expect(first.style_number).toBe('ST-001');
    expect(separate.id).not.toBe(first.id);
    await expect(call('resolve_style',[entity,'   '])).rejects.toThrow();
  });
  test('saves exact totals and rejects cross-company customers and stale edits',async()=>{
    const input=bill();
    invoice=await call('save_invoice_draft',[entity,JSON.stringify(input)]);
    expect(invoice.totalCents).toBe(38500);
    expect(invoice.lines[0].styleId).toBeTruthy();
    await expect(call('save_invoice_draft',[otherEntity,JSON.stringify(bill())])).rejects.toThrow();
    await expect(call('save_invoice_draft',[entity,JSON.stringify({...input,version:invoice.version-1})])).rejects.toThrow(/Reload/);
  });
  test('issues only once, freezes content, and queues only one original PDF',async()=>{
    invoice=await call('issue_invoice',[entity,invoice.id,invoice.version]);
    expect(invoice.number).toBe('A/26-27/0001');
    expect((await call('issue_invoice',[entity,invoice.id,1])).number).toBe(invoice.number);
    expect((await db.query('select * from public.document_files where invoice_id=$1',[invoice.id])).rows).toHaveLength(1);
    await expect(db.query('update public.invoice_items set quantity=4 where invoice_id=$1',[invoice.id])).rejects.toThrow(/draft/);
    await db.query("update public.customers set legal_name='New name' where id=$1",[customer]);
    expect((await call('invoice_payload',[invoice.id])).customer.legal_name).toBe('Buyer');
  });
  test('deduplicates payment retries and prevents overpayment and cancellation with receipts',async()=>{
    const receipt=JSON.stringify({date:'2026-11-02',cents:10000,method:'cash'});
    const paid=await call('record_payment',[entity,invoice.id,receipt,'receipt-1']);
    const repeated=await call('record_payment',[entity,invoice.id,receipt,'receipt-1']);
    expect(paid.receipts).toHaveLength(1);
    expect(repeated.receipts).toHaveLength(1);
    await expect(call('record_payment',[entity,invoice.id,JSON.stringify({date:'2026-11-02',cents:50000,method:'cash'}),'receipt-2'])).rejects.toThrow(/balance/);
    await expect(call('record_payment',[entity,invoice.id,JSON.stringify({date:'2026-11-02',cents:200,method:'cash'}),'receipt-1'])).rejects.toThrow(/different/);
    await expect(call('cancel_invoice',[entity,invoice.id,'Correction'])).rejects.toThrow(/Reverse/);
    invoice=paid;
  });
  test('reverses receipts without deletion and never reuses a cancelled number',async()=>{
    await call('reverse_payment',[entity,invoice.id,invoice.receipts[0].id,'Entered incorrectly']);
    const cancelled=await call('cancel_invoice',[entity,invoice.id,'Replacement required']);
    expect(cancelled.status).toBe('Cancelled');
    expect(cancelled.receipts[0].status).toBe('reversed');
    const next=await call('save_invoice_draft',[entity,JSON.stringify(bill())]);
    const issued=await call('issue_invoice',[entity,next.id,next.version]);
    expect(issued.number).toBe('A/26-27/0002');
    await expect(db.query('delete from public.invoices where id=$1',[invoice.id])).rejects.toThrow(/cannot be deleted/);
    invoice=issued;
  });
  test('supports standalone challans and links only to the same company invoice',async()=>{
    const input={id:randomUUID(),date:'2026-11-03',recipient:'Walk-in recipient',from:'Company address',to:'Delivery address',
      items:[{description:'Printed garments',quantity:'10',unit:'Pieces'}]};
    const draft=await call('save_challan_draft',[entity,JSON.stringify(input)]);
    const issued=await call('issue_challan',[entity,draft.id,draft.version]);
    expect(issued.number).toBe('A/DC/26-27/0001');
    expect(issued.customerId).toBeNull();
    await expect(call('save_challan_draft',[otherEntity,JSON.stringify({...input,id:randomUUID(),billId:invoice.id})])).rejects.toThrow();
    const linked=await call('save_challan_draft',[entity,JSON.stringify({...input,id:randomUUID(),billId:invoice.id})]);
    expect(linked.customerId).toBe(customer);
    const acknowledgement=await call('acknowledge_delivery',[entity,issued.id,JSON.stringify({receivedBy:'Receiver',receivedAt:new Date().toISOString()})]);
    expect(acknowledgement.acknowledgement.received_by).toBe('Receiver');
  });
  test('publishes immutable template versions and returns all nine report types',async()=>{
    const template=await call('publish_template',[entity,'invoice',JSON.stringify({accent:'#123456',preset:'minimal'})]);
    expect(template.version_number).toBe(2);
    await expect(db.query("update public.document_templates set settings_json='{}' where id=$1",[template.id])).rejects.toThrow(/immutable/);
    for(const type of ['billing','collections','outstanding','customers','monthly','print-type','challans','cancelled','companies']) {
      const report=await call('report_data',[[entity],type,'2026-01-01','2026-12-31']);
      expect(Array.isArray(report.headers)).toBe(true);
      expect(Array.isArray(report.rows)).toBe(true);
    }
    const job=await call('request_report_export',[[entity],'billing','2026-01-01','2026-12-31','csv']);
    expect(job.data_snapshot.rows).toHaveLength(1);
    const claimed=await call('claim_report_export',[job.id]);
    expect(claimed.claim_token).toBeTruthy();
    await expect(call('claim_report_export',[job.id])).rejects.toThrow(/being generated/);
  });
  test('denies cross-workspace access and direct authenticated financial writes',async()=>{
    const stranger=randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)',[stranger,'stranger@example.test']);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[stranger]);
    await expect(call('resolve_style',[entity,'HIDDEN'])).rejects.toThrow(/not found/);
    expect(await call('invoice_payload',[invoice.id])).toBeNull();
    await db.exec('set role authenticated');
    expect((await db.query('select * from public.invoices')).rows).toHaveLength(0);
    await expect(db.query('update public.invoices set notes=$1 where id=$2',['tampered',invoice.id])).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  });
  test('lists scoped documents, reports dashboard balances, and returns customer history',async()=>{
    const documents=await call('list_documents',[entity,'invoices',JSON.stringify({page:1,pageSize:1,status:'issued',search:'A/'})]);
    expect(documents.data).toHaveLength(1);
    expect(documents.total).toBe(1);
    const summary=await call('dashboard_data',[[entity,otherEntity],'2026-01-01','2026-12-31']);
    expect(Number(summary.billed)).toBe(385);
    expect(Number(summary.outstanding)).toBe(385);
    expect(summary.entities).toHaveLength(2);
    expect(summary.monthly).toHaveLength(12);
    const buyer=await call('customer_summary',[entity,customer,'2026-01-01','2026-12-31']);
    expect(buyer.customer.id).toBe(customer);
    await expect(call('document_detail',[otherEntity,'invoices',invoice.id])).rejects.toThrow(/not found/);
  });
  test('preview computes totals while rolling back draft, style, and audit writes',async()=>{
    const input=bill();input.lines[0].style='PREVIEW-ONLY';
    const preview=await call('preview_invoice',[entity,JSON.stringify(input)]);
    expect(preview.totalCents).toBe(38500);
    expect((await db.query('select id from public.invoices where id=$1',[input.id])).rows).toHaveLength(0);
    expect((await db.query("select id from public.styles where style_number='PREVIEW-ONLY'")).rows).toHaveLength(0);
  });
  test('duplicates an invoice as an unnumbered draft and deletes drafts with version guards',async()=>{
    const duplicated=await call('duplicate_invoice',[entity,invoice.id,randomUUID(),'2026-11-10']);
    expect(duplicated.status).toBe('Draft');
    expect(duplicated.number).toBeNull();
    expect(duplicated.totalCents).toBe(invoice.totalCents);
    await expect(call('delete_invoice_draft',[entity,duplicated.id,duplicated.version-1])).rejects.toThrow();
    await call('delete_invoice_draft',[entity,duplicated.id,duplicated.version]);
    const d=await call('save_challan_draft',[entity,JSON.stringify({id:randomUUID(),date:'2026-11-10',recipient:'Draft recipient',from:'A',to:'B',items:[{description:'Print',quantity:'1',unit:'Pieces'}]})]);
    await call('delete_challan_draft',[entity,d.id,d.version]);
    expect((await db.query('select id from public.dc_items where dc_id=$1',[d.id])).rows).toHaveLength(0);
  });
  test('catalog updates require current versions and permit scoped style defaults',async()=>{
    const unit=await call('configure_catalog',[entity,'units',null,null,JSON.stringify({code:'PACK','label':'Packs'})]);
    const style=await call('resolve_style',[entity,'ST-001']);
    const changed=await call('configure_catalog',[entity,'styles',style.id,style.version,JSON.stringify({defaultUnitId:unit.id,description:'Reusable style'})]);
    expect(changed.default_unit_id).toBe(unit.id);
    await expect(call('configure_catalog',[entity,'styles',style.id,style.version,JSON.stringify({is_active:false})])).rejects.toThrow(/changed/);
    const updated=await call('update_workspace',[JSON.stringify({name:'Production workspace',timezone:'Asia/Kolkata'})]);
    expect(updated.name).toBe('Production workspace');
    await expect(call('update_workspace',[JSON.stringify({timezone:'Invalid/Timezone'})])).rejects.toThrow(/timezone/);
  });
  test('filters reports by customer and materializes the same export filters',async()=>{
    const report=await call('filtered_report_data',[[entity],'billing','2026-01-01','2026-12-31',new Date().toISOString(),customer]);
    expect(report.rows).toHaveLength(1);
    expect(report.customerId).toBe(customer);
    const job=await call('request_filtered_export',[[entity],'billing','2026-01-01','2026-12-31','csv',customer]);
    expect(job.filters_json.customerId).toBe(customer);
    expect(job.data_snapshot.rows).toHaveLength(1);
    await expect(call('filtered_report_data',[[entity,entity],'billing','2026-01-01','2026-12-31'])).rejects.toThrow(/selection/);
  });
  test('retains tax context, adjustments, and HSN details in editable payloads',async()=>{
    const input={...bill(),placeOfSupplyStateCode:'33',taxTreatment:'other'};
    input.lines[0]={...input.lines[0],hsnSacCode:'9988',adjustmentCents:100,adjustmentReason:'Extra setup'} as any;
    const saved=await call('save_invoice_draft',[entity,JSON.stringify(input)]);
    expect(saved.placeOfSupplyStateCode).toBe('33');
    expect(saved.lines[0].hsnSacCode).toBe('9988');
    expect(saved.lines[0].adjustmentCents).toBe(100);
    const invalid={...bill(),taxBasisPoints:0.5};
    await expect(call('save_invoice_draft',[entity,JSON.stringify(invalid)])).rejects.toThrow(/precision/);
    await expect(db.query("update public.audit_logs set action='edited' where resource_id=$1",[saved.id])).rejects.toThrow(/Historical/);
  });
  test('reports company and customer counts, collections, and balances without multiplying line joins',async()=>{
    const summary=await call('filtered_report_data',[[entity],'customers','2026-01-01','2026-12-31',new Date().toISOString(),customer]);
    expect(summary.headers).toHaveLength(7);
    expect(summary.rows[0][2]).toBe(1);
    expect(Number(summary.rows[0][3])).toBe(385);
    expect(Number(summary.rows[0][5])).toBe(385);
    const companies=await call('filtered_report_data',[[entity,otherEntity],'companies','2026-01-01','2026-12-31']);
    expect(companies.rows).toHaveLength(2);
    expect(companies.headers).toHaveLength(5);
  });
  test('rejects fractional receipt paise and stale PDF completion tokens',async()=>{
    await expect(call('record_payment',[entity,invoice.id,JSON.stringify({date:'2026-11-02',cents:100.5,method:'cash'}),'fractional'])).rejects.toThrow(/integer paise/);
    const job=await call('claim_document_file',[entity,'invoice',invoice.id]);
    expect(job.status).toBe('processing');
    await expect(call('retry_document_file',[entity,job.id])).rejects.toThrow(/running/);
    await expect(call('finish_document_file',[entity,job.id,randomUUID(),JSON.stringify({error:'Retry'})])).rejects.toThrow(/expired/);
    await call('finish_document_file',[entity,job.id,job.claim_token,JSON.stringify({error:'Temporary renderer failure'})]);
    const retried=await call('retry_document_file',[entity,job.id]);
    expect(retried.status).toBe('pending');
    const claimed=await call('claim_document_file',[entity,'invoice',invoice.id]);
    expect(claimed.claim_token).not.toBe(job.claim_token);
  });
  test('archive and restore preserve history while blocking new drafts',async()=>{
    const e=(await db.query<any>('select * from public.billing_entities where id=$1',[otherEntity])).rows[0];
    const archived=await call('archive_directory_record',[otherEntity,'billing_entities',otherEntity,e.version,false]);
    expect(archived.is_active).toBe(false);
    await expect(call('resolve_style',[otherEntity,'BLOCKED'])).rejects.toThrow(/archived/);
    const restored=await call('archive_directory_record',[otherEntity,'billing_entities',otherEntity,archived.version,true]);
    expect(restored.is_active).toBe(true);
  });
  test('expired export claims cannot complete and can be safely requeued',async()=>{
    const job=await call('request_filtered_export',[[entity],'billing','2026-01-01','2026-12-31','csv',null]);
    const claimed=await call('claim_report_export',[job.id]);
    await db.query("update public.report_exports set lease_expires_at=clock_timestamp()-interval '1 minute' where id=$1",[job.id]);
    await expect(call('finish_report_export',[job.id,claimed.claim_token,JSON.stringify({error:'Stale worker'})])).rejects.toThrow(/expired/);
    expect((await call('retry_report_export',[job.id])).status).toBe('pending');
  });
});
