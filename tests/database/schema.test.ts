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
});
