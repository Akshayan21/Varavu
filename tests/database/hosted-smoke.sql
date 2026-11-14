-- Integration verification against Supabase PostgreSQL. All fixture writes roll back.
begin;
do $$
declare
  actor uuid:=gen_random_uuid(); ws uuid; company uuid; buyer uuid;
  style_a public.styles;style_b public.styles;draft jsonb;issued jsonb;paid jsonb;dc jsonb;
begin
  insert into auth.users(id,email) values(actor,actor::text||'@schema-test.invalid');
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','is_anonymous',false)::text,true);
  select id into ws from public.initialize_workspace();
  insert into public.billing_entities(workspace_id,entity_code,legal_name)
    values(ws,'SCHEMA_TEST','Schema verification fixture') returning id into company;
  insert into public.customers(workspace_id,entity_id,legal_name)
    values(ws,company,'Schema verification buyer') returning id into buyer;
  style_a:=public.resolve_style(company,' ST-001 ');
  style_b:=public.resolve_style(company,'st-001');
  if style_a.id<>style_b.id then raise exception 'Style deduplication failed';end if;
  draft:=public.save_invoice_draft(company,jsonb_build_object('id',gen_random_uuid(),'customerId',buyer,'date','2026-11-01','due','2026-12-01',
    'discountCents',1250,'taxBasisPoints',1000,'lines',jsonb_build_array(
      jsonb_build_object('id',1,'description','Printing','quantity','3','rate','112.50','style','ST-001'),
      jsonb_build_object('id',2,'description','Back print','quantity','2.5','rate','10'))));
  if (draft->>'totalCents')::numeric<>38500 then raise exception 'Incorrect draft total';end if;
  issued:=public.issue_invoice(company,(draft->>'id')::uuid,(draft->>'version')::bigint);
  if issued->>'number'<>'SCHEMA_TEST/26-27/0001' then raise exception 'Incorrect invoice number';end if;
  paid:=public.record_payment(company,(issued->>'id')::uuid,'{"date":"2026-11-02","cents":10000,"method":"cash"}','schema-test');
  paid:=public.record_payment(company,(issued->>'id')::uuid,'{"date":"2026-11-02","cents":10000,"method":"cash"}','schema-test');
  if jsonb_array_length(paid->'receipts')<>1 then raise exception 'Duplicate payment';end if;
  perform public.reverse_payment(company,(issued->>'id')::uuid,(paid->'receipts'->0->>'id')::uuid,'Test reversal');
  perform public.cancel_invoice(company,(issued->>'id')::uuid,'Test cancellation');
  dc:=public.save_challan_draft(company,jsonb_build_object('id',gen_random_uuid(),'recipient','Standalone recipient','date','2026-11-03',
    'from','Test sender','to','Test destination','items',jsonb_build_array(jsonb_build_object('description','Printed garments','quantity','10','unit','Pieces'))));
  perform public.issue_challan(company,(dc->>'id')::uuid,(dc->>'version')::bigint);
  perform public.report_data(array[company],'billing','2026-01-01','2026-12-31');
  perform public.list_documents(company,'invoices','{"page":1,"pageSize":10}');
  perform public.document_detail(company,'invoices',(issued->>'id')::uuid);
  perform public.dashboard_data(array[company],'2026-01-01','2026-12-31');
  perform public.customer_summary(company,buyer,'2026-01-01','2026-12-31');
  perform public.filtered_report_data(array[company],'customers','2026-01-01','2026-12-31',now(),buyer);
  perform public.request_filtered_export(array[company],'companies','2026-01-01','2026-12-31','csv',null);
  draft:=public.preview_invoice(company,jsonb_build_object('id',gen_random_uuid(),'customerId',buyer,'date','2026-11-01','due','2026-12-01',
    'lines',jsonb_build_array(jsonb_build_object('description','Preview','quantity','1','rate','10','style','PREVIEW-ONLY'))));
  if exists(select 1 from public.styles where entity_id=company and style_number='PREVIEW-ONLY') then raise exception 'Preview retained a style';end if;
  if has_function_privilege('anon','public.resolve_style(uuid,text)','execute') then raise exception 'Anonymous style mutation allowed';end if;
  if has_table_privilege('authenticated','public.invoices','insert') then raise exception 'Direct invoice writes allowed';end if;
  raise notice 'PASS hosted styles, totals, issuance, receipts, challans, scoped queries, dashboard, customer summaries, reports, preview rollback, and privileges';
end $$;
set constraints all immediate;
rollback;
