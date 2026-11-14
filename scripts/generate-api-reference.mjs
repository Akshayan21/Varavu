// Generates documentation from registered routes and isolated PostgreSQL fixtures.
// Run after building @billing/shared and @billing/api. Production data is never read.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { buildApp } from '../apps/api/dist/build-app.js';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
  create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
  create table storage.buckets(id text primary key,name text,public boolean);
  create table storage.objects(id uuid,bucket_id text,name text);`);
for (const name of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync('supabase/migrations/' + name, 'utf8'));
const owner = '11111111-1111-4111-8111-111111111111';
await db.query('insert into auth.users(id,email) values($1,$2)', [owner, 'owner@example.test']);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
async function rpc(name, args = []) {
  return (await db.query(`select to_jsonb(public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})) result`, args)).rows[0].result;
}
async function row(table, id) {
  return (await db.query(`select to_jsonb(t) result from public.${table} t ${id ? 'where id=$1' : ''} limit 1`, id ? [id] : [])).rows[0]?.result;
}
const initialized = await rpc('initialize_workspace');
const ws = initialized.id;
const entityId = '22222222-2222-4222-8222-222222222222';
const customerId = '44444444-4444-4444-8444-444444444444';
const invoiceId = '33333333-3333-4333-8333-333333333333';
await db.query("insert into public.billing_entities(id,workspace_id,entity_code,legal_name,billing_address,phone) values($1,$2,'DEMO','Example Printing Company','{\"line1\":\"10 Sample Road\",\"city\":\"Tiruppur\"}','9876543210')", [entityId, ws]);
await db.query("insert into public.customers(id,workspace_id,entity_id,legal_name,billing_address,phone,contact_name,contact_phone) values($1,$2,$3,'Example Customer','{\"line1\":\"20 Customer Road\"}','9876543210','Customer contact','9876543211')", [customerId, ws, entityId]);
const draftBody = {
  id: invoiceId, customerId, date: '2026-11-14', due: '2026-12-14', reference: 'PO-100', notes: 'Example printing work',
  discountCents: 0, taxBasisPoints: 500,
  lines: [{ id: 1, description: 'Front print', quantity: '100', rate: '12.50', style: 'ST-001', printType: 'DTF', placement: 'Front', unitCode: 'PCS' }],
};
const draft = await rpc('save_invoice_draft', [entityId, JSON.stringify(draftBody)]);
const preview = await rpc('preview_invoice', [entityId, JSON.stringify({ ...draftBody, id: '99999999-9999-4999-8999-999999999999' })]);
const issued = await rpc('issue_invoice', [entityId, invoiceId, draft.version]);
const receiptBody = { date: '2026-11-14', cents: 50000, method: 'bank_transfer', reference: 'BANK-100', notes: 'Partial payment' };
const paid = await rpc('record_payment', [entityId, invoiceId, JSON.stringify(receiptBody), 'example-payment-1']);
const payment = await row('payments');
const reversed = await rpc('reverse_payment', [entityId, invoiceId, payment.id, 'Incorrect entry']);
const cancelled = await rpc('cancel_invoice', [entityId, invoiceId, 'Corrected invoice needed']);
const duplicateBody = { id: '55555555-5555-4555-8555-555555555555', date: '2026-11-14' };
const duplicate = await rpc('duplicate_invoice', [entityId, invoiceId, duplicateBody.id, duplicateBody.date]);
const challanId = '66666666-6666-4666-8666-666666666666';
const challanBody = { id: challanId, recipient: 'Example Customer', date: '2026-11-14', from: '10 Sample Road, Tiruppur', to: '20 Customer Road', notes: 'Delivery example', items: [{ description: 'Printed garments', quantity: '100', unit: 'Pieces', remarks: 'Packed' }] };
const dcDraft = await rpc('save_challan_draft', [entityId, JSON.stringify(challanBody)]);
const dcIssued = await rpc('issue_challan', [entityId, challanId, dcDraft.version]);
const ackBody = { receivedBy: 'Receiving contact', receivedAt: new Date().toISOString(), notes: 'Received in good condition' };
const dcAcknowledged = await rpc('acknowledge_delivery', [entityId, challanId, JSON.stringify(ackBody)]);
const dcCancelled = await rpc('cancel_challan', [entityId, challanId, 'Example cancellation']);
const style = await row('styles');
const printType = await row('print_types');
const placement = await row('placements');
const unit = await row('units');
const tax = await rpc('save_tax_profile', [entityId, JSON.stringify({ name: 'Other tax 5%', tax_mode: 'other', other_tax_rate: 5 })]);
const template = await row('document_templates');
const published = await rpc('publish_template', [entityId, 'invoice', JSON.stringify({ accent: '#123456', preset: 'minimal' })]);
const preferenceBody = { lastEntityId: entityId, skipEntitySelector: false, preferences: { compactTables: false } };
const preferences = await rpc('save_preferences', [JSON.stringify(preferenceBody)]);
const entity = await row('billing_entities', entityId);
const customer = await row('customers', customerId);
const workspace = await row('workspaces', ws);
const dashboard = await rpc('dashboard_data', [[entityId], '2026-11-01', '2026-11-30']);
const summary = await rpc('customer_summary', [entityId, customerId, '2026-11-01', '2026-11-30']);
const reports = {};
for (const type of ['billing', 'collections', 'outstanding', 'customers', 'monthly', 'print-type', 'challans', 'cancelled', 'companies']) {
  reports[type] = await rpc('filtered_report_data', [[entityId], type, '2026-11-01', '2026-11-30']);
}
const exportJob = await rpc('request_filtered_export', [[entityId], 'billing', '2026-11-01', '2026-11-30', 'csv']);
const file = await row('document_files');
const audit = await row('audit_logs');
const sequence = (await db.query('select to_jsonb(t) result from public.document_sequences t limit 1')).rows[0].result;
const catalog = {};
for (const table of ['print_types', 'placements', 'units', 'tax_profiles', 'document_templates']) {
  catalog[table] = (await db.query(`select to_jsonb(t) result from public.${table} t where entity_id=$1 order by id`, [entityId])).rows.map(r => r.result);
}
const documents = await rpc('workspace_documents', [1]);
const invoiceList = await rpc('list_documents', [entityId, 'invoices', JSON.stringify({ page: 1, pageSize: 25 })]);
const challanList = await rpc('list_documents', [entityId, 'challans', JSON.stringify({ page: 1, pageSize: 25 })]);
const list = value => ({ data: [value], page: 1, pageSize: 25, total: 1 });
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const exportStatus = pick(exportJob, ['id', 'report_type', 'format', 'status', 'attempt_count', 'last_error', 'generated_at', 'expires_at']);
const exportList = list(pick(exportJob, ['id', 'report_type', 'entity_ids', 'filters_json', 'format', 'status', 'attempt_count', 'last_error', 'generated_at', 'expires_at', 'created_at']));
const samples = {
  Health: { status: 'ok' }, Readiness: { status: 'ok', schemaVersion: '20261114001200' },
  Session: { user: { id: owner, email: 'owner@example.test' } },
  Initialized: { user: { id: owner, email: 'owner@example.test' }, workspace: initialized },
  Workspace: workspace, Preferences: preferences, PreferencesDefault: { last_entity_id: null, skip_entity_selector: false, preferences_json: {} },
  Entity: entity, EntityList: list(entity), Customer: customer, CustomerList: list(customer),
  InvoiceDraft: draft, InvoicePreview: preview, InvoiceIssued: issued, InvoicePaid: paid, InvoiceReversed: reversed,
  InvoiceCancelled: cancelled, InvoiceDuplicate: duplicate, InvoiceList: invoiceList, Receipts: { data: paid.receipts },
  ChallanDraft: dcDraft, ChallanIssued: dcIssued, ChallanAcknowledged: dcAcknowledged, ChallanCancelled: dcCancelled, ChallanList: challanList,
  Style: style, StyleSearch: { data: [style] }, StyleList: list(style), Catalog: catalog,
  PrintType: printType, Placement: placement, Unit: unit, TaxProfile: tax, Template: template, TemplatePublished: published, TemplateList: list(template),
  Payment: payment, PaymentList: list(payment), File: file, FileList: list(file), AuditList: list(audit), SequenceList: list(sequence),
  Dashboard: dashboard, CustomerSummary: summary, Documents: documents,
  ExportCreated: { id: exportJob.id }, ExportStatus: exportStatus, ExportList: exportList, ExportRetry: { id: exportJob.id, status: 'pending' },
  DeleteCompatibility: { ok: true },
  Asset: { path: `${ws}/${entityId}/logo/example.png` },
  AssetUrl: { url: 'https://your-project.supabase.co/storage/v1/object/sign/billing-assets/example.png?token=SHORT_LIVED_TOKEN' },
};
// Capture state-changing variants separately so cancellation/archive/edit examples
// show the state the action produces, rather than a generic unchanged record.
samples.EntityArchived = await rpc('archive_directory_record', [entityId, 'billing_entities', entityId, entity.version, false]);
samples.EntityRestored = await rpc('archive_directory_record', [entityId, 'billing_entities', entityId, samples.EntityArchived.version, true]);
samples.CustomerArchived = await rpc('archive_directory_record', [entityId, 'customers', customerId, customer.version, false]);
samples.CustomerRestored = await rpc('archive_directory_record', [entityId, 'customers', customerId, samples.CustomerArchived.version, true]);
samples.EntityUpdated = (await db.query("update public.billing_entities set legal_name='Updated example name' where id=$1 returning to_jsonb(billing_entities.*) result", [entityId])).rows[0].result;
samples.CustomerUpdated = (await db.query("update public.customers set legal_name='Updated example name' where id=$1 returning to_jsonb(customers.*) result", [customerId])).rows[0].result;
samples.EntitySettings = await rpc('configure_entity', [entityId, samples.EntityUpdated.version, JSON.stringify({ roundingIncrement: 0, defaultTerms: 'Payment due in 30 days' })]);
for (const [table, key, changes] of [
  ['styles', 'Style', { description: 'Reusable garment print', is_active: true }],
  ['print_types', 'PrintType', { label: 'Updated print type', is_active: true }],
  ['placements', 'Placement', { label: 'Updated placement', is_active: true }],
  ['units', 'Unit', { label: 'Updated unit', is_active: true }],
  ['tax_profiles', 'TaxProfile', { name: 'Updated tax profile', is_active: true }],
]) samples[key + 'Updated'] = await rpc('configure_catalog', [entityId, table, samples[key].id, samples[key].version, JSON.stringify(changes)]);
for(const [table,key] of [['print_types','PrintType'],['placements','Placement'],['units','Unit']]) {
  samples[key+'Created'] = await rpc('configure_catalog',[entityId,table,null,null,JSON.stringify({code:'EXAMPLE',label:'Example option',sort_order:10})]);
}
for (const [type, report] of Object.entries(reports)) samples['Report_' + type] = report;

const prefix = '/api/v1';
const e = '/entities/{entityId}';
const endpoints = [];
function add(method, path, group, title, response, body = undefined, query = {}, status = 200, notes = '') {
  endpoints.push({ method, path: prefix + path, group, title, response, body, query, status, notes });
}
add('GET', '/health', 'Workspace', 'Process health', 'Health');
add('GET', '/health/ready', 'Workspace', 'Database readiness', 'Readiness');
add('GET', '/auth/session', 'Workspace', 'Verify caller session', 'Session');
add('POST', '/workspace/initialize', 'Workspace', 'Initialize workspace', 'Initialized');
add('GET', '/workspace', 'Workspace', 'Read workspace', 'Workspace');
add('PATCH', '/workspace', 'Workspace', 'Update workspace', 'Workspace', { name: 'Billing Workspace', timezone: 'Asia/Kolkata' });
add('GET', '/preferences', 'Workspace', 'Read preferences', 'Preferences', undefined, {}, 200, 'Before the first save, the response is PreferencesDefault instead.');
add('POST', '/preferences', 'Workspace', 'Save preferences', 'Preferences', preferenceBody);
add('GET', '/workspace/documents', 'Workspace', 'Compatibility document feed', 'Documents', undefined, { page: 1 });
const companyCreate = { legal_name: 'Example Printing Company', entity_code: 'DEMO', billing_address: { line1: '10 Sample Road', city: 'Tiruppur' }, phone:'9876543210' };
const customerCreate = { legal_name: 'Example Customer', billing_address: { line1: '20 Customer Road' }, phone: '9876543210', contact_name: 'Customer contact', contact_phone: '9876543211' };
for (const [path, name, input, rowName] of [['/entities','Company',companyCreate,'Entity'],[e+'/customers','Customer',customerCreate,'Customer']]) {
  add('GET',path,'Directories','List '+name.toLowerCase()+' records',rowName+'List',undefined,{page:1,pageSize:25,active:'true',search:''});
  add('POST',path,'Directories','Create '+name.toLowerCase(),rowName,input,{},201);
  const idPath=path+'/{id}';
  add('GET',idPath,'Directories','Read '+name.toLowerCase(),rowName);
  add('PATCH',idPath,'Directories','Update '+name.toLowerCase(),rowName+'Updated',{legal_name:'Updated example name'}, {},200,'Optional If-Match header contains the current record version.');
}
for(const action of ['archive','restore']) {
  add('POST',e+'/'+action,'Directories',action+' company',action==='archive'?'EntityArchived':'EntityRestored',{version:action==='archive'?entity.version:samples.EntityArchived.version});
  add('POST',e+'/customers/{id}/'+action,'Directories',action+' customer',action==='archive'?'CustomerArchived':'CustomerRestored',{version:action==='archive'?customer.version:samples.CustomerArchived.version});
}
add('PATCH',e+'/settings','Directories','Update company defaults','EntitySettings',{version:samples.EntityUpdated.version,changes:{roundingIncrement:0,defaultTerms:'Payment due in 30 days'}});
add('GET',e+'/customers/{id}/summary','Analytics','Customer summary','CustomerSummary',undefined,{from:'2026-11-01',asOf:'2026-11-30'});
for(const [kind, request, draftName, issuedName] of [['invoices',draftBody,'InvoiceDraft','InvoiceIssued'],['challans',challanBody,'ChallanDraft','ChallanIssued']]) {
  add('GET',e+'/'+kind,'Documents','List '+kind,kind==='invoices'?'InvoiceList':'ChallanList',undefined,{page:1,pageSize:25});
  add('GET',e+'/'+kind+'/{id}','Documents','Read '+kind,kind==='invoices'?'InvoiceIssued':'ChallanIssued');
  add('POST',e+'/'+kind,'Documents','Save '+kind+' draft',draftName,request,{},200,'Current implementation returns 200, including first creation. Reuse the creation UUID on retry.');
  const {id,...editable}=request;
  add('PATCH',e+'/'+kind+'/{id}','Documents','Replace '+kind+' draft',draftName,{...editable,version:kind==='invoices'?draft.version:dcDraft.version}, {},200,'Supply the complete editable draft, not a partial field patch.');
  add('DELETE',e+'/'+kind+'/{id}','Documents','Delete '+kind+' draft',null,undefined,{version:kind==='invoices'?draft.version:dcDraft.version},204);
  add('POST',e+'/'+kind+'/{id}/issue','Documents','Issue '+kind,issuedName,{version:kind==='invoices'?draft.version:dcDraft.version});
  add('POST',e+'/'+kind+'/{id}/cancel','Documents','Cancel '+kind,kind==='invoices'?'InvoiceCancelled':'ChallanCancelled',{reason:'Corrected document needed'});
  add('GET',e+'/'+kind+'/{id}/pdf','Files','Download '+kind+' PDF','PDF',undefined,{},200,'Binary PDF response. Requires issued/cancelled document and working Chromium/private Storage.');
}
add('POST',e+'/invoices/{id}/delete','Documents','Compatibility draft deletion','DeleteCompatibility',{version:draft.version});
add('POST',e+'/invoices/preview','Documents','Calculate without saving','InvoicePreview',draftBody);
add('POST',e+'/invoices/{id}/duplicate','Documents','Duplicate into new draft','InvoiceDuplicate',duplicateBody);
add('GET',e+'/invoices/{id}/payments','Payments','Invoice receipt history','Receipts');
add('POST',e+'/invoices/{id}/payments','Payments','Record payment','InvoicePaid',receiptBody,{},200,'Required Idempotency-Key header. The result is the complete updated invoice, not an isolated receipt.');
add('POST',e+'/invoices/{id}/payments/{paymentId}/reverse','Payments','Reverse payment','InvoiceReversed',{reason:'Incorrect entry'}, {},200,'The result is the complete updated invoice.');
add('POST',e+'/challans/{id}/acknowledge','Documents','Acknowledge delivery','ChallanAcknowledged',ackBody);
add('GET',e+'/styles','Catalogs','Search active styles','StyleSearch',undefined,{search:'ST'});
add('POST',e+'/styles/resolve','Catalogs','Resolve or create style','Style',{number:'ST-001'}, {},200,'Both an existing match and a new insertion return 200 with a full style row.');
add('GET',e+'/catalog','Catalogs','Read company catalogs','Catalog');
add('POST',e+'/catalog','Catalogs','Compatibility catalog update','StyleUpdated',{table:'styles',id:style.id,data:{description:'Reusable garment print'}}, {},200,'Legacy shape. Prefer versioned PATCH for new clients.');
add('POST',e+'/templates','Catalogs','Publish immutable template','TemplatePublished',{type:'invoice',settings:{accent:'#123456',preset:'minimal'}});
add('POST',e+'/tax-profiles','Catalogs','Create tax profile','TaxProfile',{name:'Other tax 5%',tax_mode:'other',other_tax_rate:5});
for(const [path, response] of [['print-types','PrintType'],['placements','Placement'],['units','Unit']]) {
  add('POST',e+'/'+path,'Catalogs','Create '+path,response+'Created',{code:'EXAMPLE',label:'Example option',sort_order:10},{},201);
}
for(const [path,response,changes] of [
  ['styles','Style',{description:'Reusable garment print',is_active:true}],
  ['print-types','PrintType',{label:'Updated print type',is_active:true}],['placements','Placement',{label:'Updated placement',is_active:true}],
  ['units','Unit',{label:'Updated unit',is_active:true}],['tax-profiles','TaxProfile',{name:'Updated tax profile',is_active:true}],
]) {
  add('GET',e+'/'+path+'/{id}','Catalogs','Read '+path,response);
  add('PATCH',e+'/'+path+'/{id}','Catalogs','Update '+path,response+'Updated',{version:samples[response].version,changes});
}
add('GET',e+'/templates/{id}','Catalogs','Read template version','Template');
for(const [path, response] of [['payments','PaymentList'],['audit','AuditList'],['templates','TemplateList'],['styles/directory','StyleList'],['files','FileList'],['sequences','SequenceList']]) {
  add('GET',e+'/'+path,path==='payments'?'Payments':path==='files'?'Files':'Catalogs','List '+path,response,undefined,{page:1,pageSize:25});
}
add('GET',e+'/payments/{id}','Payments','Read payment row','Payment');
add('GET',e+'/files/{id}','Files','Read file job','File');
add('POST',e+'/files/{id}/retry','Files','Retry file job','File',undefined,{},202,'Returns the full file row. Ready files remain ready. Failed/expired-lease jobs become pending.');
add('POST',e+'/assets','Files','Upload company image','Asset',{kind:'logo',base64:'{{imageBase64}}'}, {},200,'Supply complete PNG/JPEG base64, up to 512 KB decoded. The placeholder is not an image.');
add('GET',e+'/assets/url','Files','Get signed company image URL','AssetUrl',undefined,{path:'{{assetPath}}'});
add('GET',e+'/dashboard','Analytics','Company dashboard','Dashboard',undefined,{from:'2026-11-01',asOf:'2026-11-30'});
add('GET','/analytics/central','Analytics','Consolidated dashboard','Dashboard',undefined,{entities:'{{entityId}}',from:'2026-11-01',asOf:'2026-11-30'});
for(const type of Object.keys(reports)) {
  add('GET','/reports/'+type,'Reports','Read '+type+' report','Report_'+type,undefined,{entities:'{{entityId}}',from:'2026-11-01',asOf:'2026-11-30'});
  add('POST','/reports/'+type+'/exports','Reports','Request '+type+' export','ExportCreated',{entities:['{{entityId}}'],from:'2026-11-01',asOf:'2026-11-30',format:'csv'}, {},201);
}
add('GET','/exports','Files','List exports','ExportList',undefined,{page:1,pageSize:25});
add('GET','/exports/{id}/status','Files','Read export status','ExportStatus');
add('GET','/exports/{id}','Files','Download PDF/CSV export','EXPORT',undefined,{},200,'application/pdf or text/csv; charset=utf-8 according to the requested export format.');
add('POST','/exports/{id}/retry','Files','Retry export','ExportRetry',undefined,{},202,'A ready export returns status ready instead of pending. Expired exports require a new request.');

// Compare expanded documentation against every registered application route.
const routes = [];
const app = buildApp({origin:'http://localhost:5173',onRoute(options) {
  for(const method of Array.isArray(options.method)?options.method:[options.method]) {
    if(!['HEAD','OPTIONS'].includes(method)) routes.push({method,path:options.url});
  }
}});
await app.ready();
const canonical = path => path.replace(/\{[^}]+\}|:[^/]+/g,':param');
const matched = new Set();
for(const endpoint of endpoints) {
  const implemented = routes.find(route => route.method===endpoint.method && canonical(route.path)===canonical(endpoint.path))
    ?? routes.find(route => route.method===endpoint.method && route.path.endsWith('/:kind/:id/pdf') && /\/(invoices|challans)\/\{id\}\/pdf$/.test(endpoint.path))
    ?? routes.find(route => route.method===endpoint.method && route.path.startsWith('/api/v1/reports/:type') && endpoint.path.startsWith('/api/v1/reports/'));
  if(!implemented) throw new Error('Documented route not implemented: '+endpoint.method+' '+endpoint.path);
  matched.add(implemented.method+' '+implemented.path);
}
for(const route of routes) if(!matched.has(route.method+' '+route.path)) throw new Error('Missing endpoint documentation: '+route.method+' '+route.path);
await app.close();

const output='docs/api';
mkdirSync(output,{recursive:true});
const stringify=value=>JSON.stringify(value,null,2);
writeFileSync(output+'/response-examples.json',stringify(samples)+'\n');
writeFileSync(output+'/endpoint-manifest.json',stringify({registeredRouteCount:routes.length,expandedExampleCount:endpoints.length,endpoints})+'\n');

const variables = {baseUrl:'http://127.0.0.1:3001',token:'',entityId:'',customerId:'',invoiceId:'',challanId:'',styleId:'',paymentId:'',templateId:'',taxProfileId:'',printTypeId:'',placementId:'',unitId:'',fileId:'',exportId:'',newDraftId:'',imageBase64:'',assetPath:'',version:'1'};
function idVariable(endpoint) {
  const path=endpoint.path;
  if(path.includes('/customers/'))return 'customerId';
  if(path.includes('/invoices/'))return 'invoiceId';
  if(path.includes('/challans/'))return 'challanId';
  if(path.includes('/styles/'))return 'styleId';
  if(path.includes('/templates/'))return 'templateId';
  if(path.includes('/tax-profiles/'))return 'taxProfileId';
  if(path.includes('/print-types/'))return 'printTypeId';
  if(path.includes('/placements/'))return 'placementId';
  if(path.includes('/units/'))return 'unitId';
  if(path.includes('/files/'))return 'fileId';
  if(path.includes('/payments/'))return 'paymentId';
  if(path.includes('/exports/'))return 'exportId';
  return 'entityId';
}
function substitute(value,endpoint) {
  if(Array.isArray(value))return value.map(v=>substitute(v,endpoint));
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,key==='version'?'{{version}}':substitute(v,endpoint)]));
  if(typeof value==='string')return value===entityId?'{{entityId}}':value===customerId?'{{customerId}}':value===invoiceId?'{{invoiceId}}'
    :value===challanId?'{{challanId}}':value===duplicateBody.id?'{{newDraftId}}':value===style.id?'{{styleId}}':value;
  return value;
}
function requestFor(endpoint) {
  const path=endpoint.path.replace('{entityId}','{{entityId}}').replace('{paymentId}','{{paymentId}}').replace('{id}','{{'+idVariable(endpoint)+'}}');
  const query=Object.entries(endpoint.query).map(([key,value])=>({key,value:key==='version'?'{{version}}':String(value)}));
  const raw='{{baseUrl}}'+path+(query.length?'?'+query.map(q=>q.key+'='+q.value).join('&'):'');
  const header=endpoint.body? [{key:'Content-Type',value:'application/json'}]:[];
  if(endpoint.path.endsWith('/payments') && endpoint.method==='POST')header.push({key:'Idempotency-Key',value:'{{$guid}}',description:'For retries, replace this with the SAME fixed key used for the original request.'});
  let body=endpoint.body===undefined?undefined:stringify(substitute(endpoint.body,endpoint));
  // Postman variables are strings; replace version placeholders outside JSON quotes.
  if(body)body=body.replaceAll('"{{version}}"','{{version}}');
  return {method:endpoint.method,header,url:{raw,host:['{{baseUrl}}'],path:path.slice(1).split('/'),query},
    ...(body?{body:{mode:'raw',raw:body,options:{raw:{language:'json'}}}}:{}),
    ...(endpoint.path==='/api/v1/health'?{auth:{type:'noauth'}}:{})};
}
const collection={info:{name:'Thogai local backend API',schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  description:'All application endpoints. Set baseUrl, Supabase token, record IDs and current version. Example responses come from isolated PostgreSQL fixtures. Do not run all requests in bulk: mutations include issuance, payment reversal, archival, and cancellation.'},
  auth:{type:'bearer',bearer:[{key:'token',value:'{{token}}',type:'string'}]},variable:Object.entries(variables).map(([key,value])=>({key,value})),item:[]};
for(const group of [...new Set(endpoints.map(e=>e.group))]) {
  collection.item.push({name:group,item:endpoints.filter(e=>e.group===group).map(endpoint=>{
    const request=requestFor(endpoint);
    const binary=['PDF','EXPORT'].includes(endpoint.response);
    return {name:endpoint.title,request:{...request,description:`Expected HTTP ${endpoint.status}. ${endpoint.notes}\nSee API_REQUEST_RESPONSE.md for required fields and response contracts.`},
      response:[{name:`${endpoint.status} example`,originalRequest:request,status:endpoint.status===201?'Created':endpoint.status===202?'Accepted':endpoint.status===204?'No Content':'OK',code:endpoint.status,
        header:endpoint.status===204?[]:[{key:'Content-Type',value:binary?(endpoint.response==='PDF'?'application/pdf':'text/csv; charset=utf-8'):'application/json'}],
        body:endpoint.status===204?'':binary?'[Binary response body; use Send and Download]':stringify(samples[endpoint.response])}]};
  })});
}
writeFileSync(output+'/Thogai.postman_collection.json',stringify(collection)+'\n');

const lines=[
  '# Thogai API Request and Response Reference','',
  `Generated from ${routes.length} registered application method/path pairs, expanded into ${endpoints.length} testable examples, including all nine report types and both PDF routes. HEAD/OPTIONS are framework-generated and omitted.`, '',
  '## Confidence and limitations','',
  'The examples below are complete JSON objects captured from synthetic fixtures executed through the actual PostgreSQL migrations, plus the HTTP wrappers defined in the API handlers. They show exact current field names and types. UUIDs, timestamps, version numbers, document sequences, totals, array lengths, and signed URLs depend on your data and request. They are examples, not fixed values to compare byte-for-byte. Storage URL and file-download examples describe their transport contract because they require a live Storage service.', '',
  'The document generator verifies that every registered application route is represented. This checks documentation coverage, not successful live execution of every authenticated endpoint. Automated tests and hosted rollback checks validate selected flows. Local credentialed Auth/Storage/PDF testing and load/failure testing remain necessary before relying on the system in production.', '',
  '## Test locally','',
  'Follow [LOCAL_TESTING.md](LOCAL_TESTING.md) to start the API and obtain an owner token. Import [Thogai.postman_collection.json](Thogai.postman_collection.json) into Postman. Set its collection variables. The collection sends requests only when you select Send. It includes destructive lifecycle actions, so use a dedicated test company and avoid running the entire collection blindly.', '',
  '- `baseUrl` defaults to `http://127.0.0.1:3001`.',
  '- All paths below include `/api/v1`.',
  '- Protected calls require `Authorization: Bearer <owner-access-token>`.',
  '- JSON bodies require `Content-Type: application/json`.',
  '- Paise fields end in `Cents`; report/dashboard/database money fields are decimal INR.',
  '- Take IDs and current versions from your own responses. Seed example UUIDs are not your database IDs.',
  '- Preserve the same payment idempotency key and request body when retrying.',
  '- Request examples show minimal useful fields. Complete validation rules and filter catalogs are in [BACKEND_API.md](../../BACKEND_API.md).', '',
  '## Endpoint index','', '| # | Method | Endpoint | Success | Response example |','|---|---|---|---|---|',
];
endpoints.forEach((endpoint,index)=>lines.push(`| ${index+1} | ${endpoint.method} | \`${endpoint.path}\` | ${endpoint.status} | ${endpoint.response ?? 'Empty body'} |`));
lines.push('', '## Error response variants','',
  'Current handlers have several error envelopes. Clients should always read `error` and treat `issues`, `code`, and `requestId` as optional. The table describes current behavior instead of implying a uniform envelope.', '',
  '| Status | Meaning | Example |', '|---|---|---|',
  '| 400 | Request validation | `{"error":"Invalid record.","issues":[{"code":"too_small","path":["legal_name"],"message":"Too small: expected string to have >=1 characters"}]}` |',
  '| 401 | Missing session | `{"error":"Sign in to continue."}` |',
  '| 401 | Invalid/expired session | `{"error":"Your session is invalid or has expired."}` |',
  '| 403 | Unauthorized database scope | `{"error":"Company selection is unavailable","code":"42501","requestId":"req-1"}` |',
  '| 404 | Scoped document missing | `{"error":"Record not found.","code":"P0002","requestId":"req-2"}` |',
  '| 404 | Direct record lookup missing | `{"error":"Record not found."}` |',
  '| 409 | Stale version | `{"error":"Catalog record changed. Reload it.","code":"40001","requestId":"req-3"}` |',
  '| 409 | Payment key reused with different body | `{"error":"Request key reused with different payment","code":"23505","requestId":"req-4"}` |',
  '| 409 | Live file generation claim | `{"error":"PDF generation is already running. Retry shortly.","code":"55P03","requestId":"req-5"}` |',
  '| 500 | Unhandled internal error | `{"error":"The request could not be completed.","requestId":"req-6"}` |',
  '| 503 | Temporary database failure | `{"error":"Database operation unavailable. Please retry.","code":"<database-code>","requestId":"req-7"}` |',
  '| 503 | PDF rendering/storage failure | `{"error":"Could not generate the PDF. Retry the download."}` |', '',
  'Domain-rule failures generally use 400 with SQL code `23514`. For example, attempting to pay above the invoice balance returns an error containing `Receipt exceeds balance or invoice is ineligible`. A stale DELETE can return 400 or 409 according to the invoice/challan function. Directory constraint errors use their own shorter messages. Validation issue arrays depend on which fields fail and the installed Zod version.', '',
  '## Endpoint requests and success contracts','');
endpoints.forEach((endpoint,index)=>{
  lines.push(`### ${index+1}. ${endpoint.title}`,'',`\`${endpoint.method} ${endpoint.path}\``, '',`Success status is **${endpoint.status}**.`, '');
  const params=[...endpoint.path.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]);
  if(params.length) lines.push('Path values are '+params.map(p=>'`'+p+'`').join(', ')+'. UUID path values must be UUIDs from records accessible to your owner account.', '');
  if(Object.keys(endpoint.query).length)lines.push('Query example','', '```json',stringify(endpoint.query),'```','');
  if(endpoint.path.endsWith('/payments') && endpoint.method==='POST')lines.push('Also send `Idempotency-Key: local-payment-001`. Keep it fixed on retry.','');
  if(endpoint.body!==undefined)lines.push('Request JSON','', '```json',stringify(endpoint.body),'```','');
  else lines.push('Request body is empty.','');
  if(endpoint.notes)lines.push(endpoint.notes,'');
  if(endpoint.status===204)lines.push('Response body is empty. Do not parse it as JSON.','');
  else if(endpoint.response==='PDF')lines.push('Response headers include `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="<invoices-or-challans>-<document-id>.pdf"`. The response body contains PDF bytes beginning with `%PDF-`. Save it as a file.','');
  else if(endpoint.response==='EXPORT')lines.push('Response body contains PDF bytes for PDF exports or UTF-8 CSV with a BOM for CSV exports. `Content-Disposition` gives `<report-type>-<export-id>.<format>`. CSV includes title, generation date, company names, date filters, recorded cutoff, report headers, and data rows.','');
  else lines.push('Complete response example','', '```json',stringify(samples[endpoint.response]),'```','');
});
lines.push('## Reproduce these reference files','', '```powershell','pnpm --filter @billing/shared build','pnpm --filter @billing/api build','node scripts/generate-api-reference.mjs','```','',
  'Generation creates an isolated in-memory PostgreSQL database, applies migrations, inserts synthetic examples, and closes it. It does not connect to Supabase or retain production records.');
writeFileSync(output+'/API_REQUEST_RESPONSE.md',lines.join('\n')+'\n');
// The HTML handbook uses catalog introspection for the implemented schema,
// including columns added by later migrations and composite relationships.
const tables=(await db.query(`select tablename name from pg_tables where schemaname='public' order by tablename`)).rows;
for(const table of tables) {
  table.columns=(await db.query(`select a.attname name,format_type(a.atttypid,a.atttypmod) type,
    not a.attnotnull nullable,pg_get_expr(d.adbin,d.adrelid) default_expression,
    a.attgenerated<>'' generated
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where n.nspname='public' and c.relname=$1 and a.attnum>0 and not a.attisdropped order by a.attnum`,[table.name])).rows;
  table.constraints=(await db.query(`select con.conname name,con.contype type,pg_get_constraintdef(con.oid) definition,con.convalidated validated
    from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=$1 order by con.contype,con.conname`,[table.name])).rows;
  table.indexes=(await db.query(`select indexname name,indexdef definition from pg_indexes where schemaname='public' and tablename=$1 order by indexname`,[table.name])).rows;
  table.policies=(await db.query(`select policyname name,cmd command,roles::text roles,qual using_expression,with_check check_expression
    from pg_policies where schemaname='public' and tablename=$1 order by policyname`,[table.name])).rows;
  table.triggers=(await db.query(`select t.tgname name,pg_get_triggerdef(t.oid) definition
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=$1 and not t.tgisinternal order by t.tgname`,[table.name])).rows;
}
const relationships=(await db.query(`select src.relname source_table,con.conname constraint_name,
  ns.nspname target_schema,dst.relname target_table,pg_get_constraintdef(con.oid) definition,
  (select jsonb_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(num,ord)
    join pg_attribute a on a.attrelid=src.oid and a.attnum=k.num) source_columns,
  (select jsonb_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(num,ord)
    join pg_attribute a on a.attrelid=dst.oid and a.attnum=k.num) target_columns
  from pg_constraint con join pg_class src on src.oid=con.conrelid join pg_namespace own on own.oid=src.relnamespace
  join pg_class dst on dst.oid=con.confrelid join pg_namespace ns on ns.oid=dst.relnamespace
  where own.nspname='public' and con.contype='f' order by src.relname,con.conname`)).rows;
const functions=(await db.query(`select p.proname name,pg_get_function_identity_arguments(p.oid) arguments,
  pg_get_function_result(p.oid) result,p.prosecdef security_definer,p.provolatile volatility,
  pg_get_functiondef(p.oid) definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' order by p.proname,pg_get_function_identity_arguments(p.oid)`)).rows;
writeFileSync(output+'/schema-catalog.json',stringify({
  source:'Isolated PostgreSQL catalog after applying repository migrations',tables,relationships,functions,
  migrations:readdirSync('supabase/migrations').sort().map(name=>({name,sql:readFileSync('supabase/migrations/'+name,'utf8')})),
})+'\n');
await db.close();
console.log(`Documented ${routes.length} registered method/path pairs with ${endpoints.length} expanded examples.`);
