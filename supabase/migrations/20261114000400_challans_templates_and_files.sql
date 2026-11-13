create function public.challan_payload(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',d.id,'version',d.version,'entityId',d.entity_id,'number',d.document_number,'date',d.dc_date,
   'status',initcap(d.status),'recipient',d.recipient_name,'customerId',d.customer_id,
   'from',d.from_address->>'text','to',d.to_address->>'text','notes',coalesce(d.notes,''),'billId',d.related_invoice_id,
   'billNumber',(select document_number from public.invoices where id=d.related_invoice_id),
   'seller',d.sender_snapshot,'template',d.template_snapshot,'cancellation',case when d.status='cancelled' then jsonb_build_object('reason',d.cancel_reason,'date',d.cancelled_at) end,
   'acknowledgement',(select to_jsonb(a) from public.delivery_acknowledgements a where a.dc_id=d.id),
   'items',coalesce((select jsonb_agg(jsonb_build_object('description',i.particulars,'quantity',i.quantity::text,'unit',i.unit_snapshot,'remarks',i.remarks)
     order by i.sort_order) from public.dc_items i where i.dc_id=d.id),'[]'))
 from public.delivery_challans d join public.workspaces w on w.id=d.workspace_id where d.id=p_id and w.owner_user_id=auth.uid()
$$;

create function public.save_challan_draft(p_entity uuid,p_challan jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid; did uuid:=coalesce((p_challan->>'id')::uuid,gen_random_uuid()); d public.delivery_challans;
  seller public.billing_entities; template public.document_templates; linked public.invoices; item jsonb; n integer; unit_row public.units; customer uuid;
begin
  ws:=public.require_entity(p_entity,true);
  select * into strict seller from public.billing_entities where id=p_entity;
  customer:=nullif(p_challan->>'customerId','')::uuid;
  if nullif(p_challan->>'billId','') is not null then
    select * into linked from public.invoices where id=(p_challan->>'billId')::uuid and entity_id=p_entity and workspace_id=ws and status='issued' for share;
    if linked.id is null then raise exception 'Choose an issued invoice from this company' using errcode='23514'; end if;
    customer:=linked.customer_id;
  end if;
  if customer is not null then
    perform 1 from public.customers where id=customer and workspace_id=ws and entity_id=p_entity and is_active for share;
    if not found then raise exception 'Customer is archived or belongs to another company' using errcode='23514'; end if;
  end if;
  select * into strict template from public.document_templates where id=seller.default_dc_template_id and entity_id=p_entity and document_type='delivery_challan' and status='published';
  if jsonb_array_length(p_challan->'items') not between 1 and 100 then raise exception 'Add between 1 and 100 items' using errcode='23514'; end if;
  insert into public.delivery_challans(id,workspace_id,entity_id,recipient_name,dc_date,from_address,to_address)
    values(did,ws,p_entity,btrim(p_challan->>'recipient'),(p_challan->>'date')::date,jsonb_build_object('text',p_challan->>'from'),jsonb_build_object('text',p_challan->>'to'))
    on conflict(id) do nothing;
  select * into strict d from public.delivery_challans where id=did and workspace_id=ws and entity_id=p_entity for update;
  if d.status<>'draft' or (p_challan ? 'version' and d.version<>(p_challan->>'version')::bigint) then raise exception 'Draft changed or already issued' using errcode='40001'; end if;
  delete from public.dc_items where dc_id=did;
  for item,n in select value,ordinality::integer from jsonb_array_elements(p_challan->'items') with ordinality loop
    select * into unit_row from public.units where entity_id=p_entity and is_active and label=item->>'unit' for share;
    if unit_row.id is null then raise exception 'Choose an active delivery unit' using errcode='23514'; end if;
    insert into public.dc_items(workspace_id,entity_id,dc_id,sort_order,particulars,quantity,unit_id,unit_snapshot,remarks)
      values(ws,p_entity,did,n,btrim(item->>'description'),(item->>'quantity')::numeric,unit_row.id,unit_row.label,item->>'remarks');
  end loop;
  if coalesce(length(btrim(p_challan->>'from')),0)=0 or coalesce(length(btrim(p_challan->>'to')),0)=0 then raise exception 'Enter both delivery addresses' using errcode='23514'; end if;
  update public.delivery_challans set customer_id=customer,recipient_name=btrim(p_challan->>'recipient'),dc_date=(p_challan->>'date')::date,
    related_invoice_id=linked.id,from_address=jsonb_build_object('text',p_challan->>'from'),to_address=jsonb_build_object('text',p_challan->>'to'),
    sender_snapshot=to_jsonb(seller),recipient_snapshot=jsonb_build_object('name',p_challan->>'recipient','address',p_challan->>'to'),
    template_id=template.id,template_snapshot=to_jsonb(template),renderer_version=template.renderer_version,notes=p_challan->>'notes' where id=did;
  return public.challan_payload(did);
end $$;

create function public.issue_challan(p_entity uuid,p_id uuid,p_version bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid; d public.delivery_challans; num jsonb;
begin
  ws:=public.require_entity(p_entity,true);
  select * into strict d from public.delivery_challans where id=p_id and workspace_id=ws and entity_id=p_entity for update;
  if d.status<>'draft' then return public.challan_payload(p_id); end if;
  if d.version<>p_version then raise exception 'Draft changed. Reload before issuing.' using errcode='40001'; end if;
  if d.related_invoice_id is not null then
    perform 1 from public.invoices where id=d.related_invoice_id and status='issued' for share;
    if not found then raise exception 'Related invoice was cancelled' using errcode='23514'; end if;
  end if;
  num:=public.allocate_document_number(p_entity,'delivery_challan',d.dc_date);
  update public.delivery_challans set status='issued',document_number=num->>'number',period_key=num->>'period',sequence_number=(num->>'sequence')::bigint,
    number_prefix_snapshot=num->>'prefix',numbering_mode_snapshot=num->>'mode',period_start_snapshot=(num->>'start')::date,
    period_end_snapshot=(num->>'end')::date,issued_at=clock_timestamp(),issued_by=auth.uid() where id=p_id;
  insert into public.document_files(workspace_id,entity_id,dc_id,template_id,variant) values(ws,p_entity,p_id,d.template_id,'original');
  return public.challan_payload(p_id);
end $$;

create function public.cancel_challan(p_entity uuid,p_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid; d public.delivery_challans;
begin
  ws:=public.require_entity(p_entity);
  select * into strict d from public.delivery_challans where id=p_id and entity_id=p_entity and workspace_id=ws for update;
  if d.status='cancelled' then return public.challan_payload(p_id); end if;
  if d.status<>'issued' or coalesce(length(btrim(p_reason)),0)=0 then raise exception 'Enter a reason for cancelling an issued challan' using errcode='23514'; end if;
  update public.delivery_challans set status='cancelled',cancelled_at=clock_timestamp(),cancelled_by=auth.uid(),cancel_reason=btrim(p_reason) where id=p_id;
  insert into public.document_files(workspace_id,entity_id,dc_id,template_id,variant) values(ws,p_entity,p_id,d.template_id,'cancelled');
  return public.challan_payload(p_id);
end $$;

create function public.acknowledge_delivery(p_entity uuid,p_id uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid; result jsonb;
begin
  ws:=public.require_entity(p_entity);
  perform 1 from public.delivery_challans where id=p_id and workspace_id=ws and entity_id=p_entity and status='issued' for update;
  if not found then raise exception 'An issued challan is required' using errcode='23514'; end if;
  insert into public.delivery_acknowledgements(workspace_id,entity_id,dc_id,received_by,received_at,notes,recorded_by)
    values(ws,p_entity,p_id,p_data->>'receivedBy',(p_data->>'receivedAt')::timestamptz,p_data->>'notes',auth.uid())
    on conflict(dc_id) do nothing;
  return public.challan_payload(p_id);
end $$;

create function public.publish_template(p_entity uuid,p_type text,p_settings jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid; template public.document_templates; next_version integer;
begin
  ws:=public.require_entity(p_entity,true);
  -- Serializes publishes without lock upgrades on the company row.
  perform pg_advisory_xact_lock(hashtextextended(p_entity::text||p_type,0));
  if p_type not in ('invoice','delivery_challan') or jsonb_typeof(p_settings)<>'object'
    or coalesce(p_settings->>'accent','') !~ '^#[0-9a-fA-F]{6}$' or coalesce(p_settings->>'preset','structured') not in ('structured','minimal') then
    raise exception 'Invalid template settings' using errcode='23514';
  end if;
  select coalesce(max(version_number),0)+1 into next_version from public.document_templates where entity_id=p_entity and document_type=p_type and name='Default';
  insert into public.document_templates(workspace_id,entity_id,document_type,name,version_number,status,settings_json,published_at,created_by,updated_by)
    values(ws,p_entity,p_type,'Default',next_version,'published',p_settings,clock_timestamp(),auth.uid(),auth.uid()) returning * into template;
  if p_type='invoice' then update public.billing_entities set default_invoice_template_id=template.id where id=p_entity;
  else update public.billing_entities set default_dc_template_id=template.id where id=p_entity; end if;
  return to_jsonb(template);
end $$;

create function public.update_catalog(p_entity uuid,p_table text,p_id uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid; result jsonb;
begin
  ws:=public.require_entity(p_entity,true);
  if p_table='styles' then
    update public.styles set is_active=coalesce((p_data->>'is_active')::boolean,is_active),name=coalesce(p_data->>'name',name),description=coalesce(p_data->>'description',description)
      where id=p_id and workspace_id=ws and entity_id=p_entity returning to_jsonb(styles.*) into result;
  elsif p_table in ('print_types','placements','units') then
    if p_id is null then
      execute format('insert into public.%I(workspace_id,entity_id,code,label) values($1,$2,$3,$4) returning to_jsonb(%I.*)',p_table,p_table)
        into result using ws,p_entity,upper(btrim(p_data->>'code')),btrim(p_data->>'label');
    else
      execute format('update public.%I set label=coalesce($1,label),is_active=coalesce($2,is_active) where id=$3 and workspace_id=$4 and entity_id=$5 returning to_jsonb(%I.*)',p_table,p_table)
        into result using p_data->>'label',(p_data->>'is_active')::boolean,p_id,ws,p_entity;
    end if;
  else raise exception 'Invalid catalog' using errcode='23514'; end if;
  if result is null then raise exception 'Record not found' using errcode='42501'; end if;
  return result;
end $$;

create function public.save_preferences(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid; result jsonb;
begin
  select id into strict ws from public.workspaces where owner_user_id=auth.uid();
  insert into public.user_preferences(workspace_id,user_id,last_entity_id,skip_entity_selector,preferences_json)
    values(ws,auth.uid(),(p_data->>'lastEntityId')::uuid,coalesce((p_data->>'skipEntitySelector')::boolean,false),coalesce(p_data->'preferences','{}'))
    on conflict(workspace_id,user_id) do update set last_entity_id=excluded.last_entity_id,skip_entity_selector=excluded.skip_entity_selector,
      preferences_json=excluded.preferences_json,updated_at=now() returning to_jsonb(user_preferences.*) into result;
  return result;
end $$;

create function public.claim_document_file(p_entity uuid,p_type text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid; file public.document_files; variant_value text; state text;
begin
  ws:=public.require_entity(p_entity);
  if p_type='invoice' then select status into state from public.invoices where id=p_id and entity_id=p_entity and workspace_id=ws for share;
  elsif p_type='delivery_challan' then select status into state from public.delivery_challans where id=p_id and entity_id=p_entity and workspace_id=ws for share;
  else raise exception 'Invalid document type' using errcode='23514'; end if;
  if state is null or state='draft' then raise exception 'Issue the document before generating a PDF' using errcode='23514'; end if;
  variant_value:=case when state='cancelled' then 'cancelled' else 'original' end;
  select * into strict file from public.document_files where entity_id=p_entity and variant=variant_value
    and (case when p_type='invoice' then invoice_id=p_id else dc_id=p_id end) for update;
  if file.status='ready' then return to_jsonb(file); end if;
  if file.status='processing' and file.lease_expires_at>clock_timestamp() then raise exception 'PDF generation is already running. Retry shortly.' using errcode='55P03'; end if;
  update public.document_files set status='processing',attempt_count=attempt_count+1,claim_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '2 minutes',updated_at=now()
    where id=file.id returning * into file;
  return to_jsonb(file);
end $$;

create function public.finish_document_file(p_entity uuid,p_id uuid,p_token uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare ws uuid;
begin
  ws:=public.require_entity(p_entity);
  if p_result->>'path' is not null and p_result->>'path' not like ws::text||'/'||p_entity::text||'/%' then raise exception 'Invalid storage path' using errcode='42501'; end if;
  update public.document_files set status=case when p_result ? 'error' then 'failed' else 'ready' end,
    object_path=p_result->>'path',sha256=p_result->>'sha256',byte_size=(p_result->>'size')::bigint,
    last_error=p_result->>'error',generated_at=case when not(p_result ? 'error') then clock_timestamp() end,
    lease_expires_at=null,updated_at=now() where id=p_id and workspace_id=ws and entity_id=p_entity and claim_token=p_token and status='processing';
  if not found then raise exception 'PDF claim expired' using errcode='40001'; end if;
end $$;

insert into storage.buckets(id,name,public) values('report-exports','report-exports',false) on conflict do nothing;

-- Upload paths are workspace/entity/...; existing immutable objects cannot be overwritten.
create policy billing_private_read on storage.objects for select to authenticated using (
  bucket_id in ('billing-assets','invoice-pdfs','report-exports') and exists(
    select 1 from public.billing_entities e join public.workspaces w on w.id=e.workspace_id where w.owner_user_id=auth.uid()
      and split_part(name,'/',1)=w.id::text and split_part(name,'/',2)=e.id::text));
create policy billing_private_insert on storage.objects for insert to authenticated with check (
  bucket_id in ('billing-assets','invoice-pdfs','report-exports') and exists(
    select 1 from public.billing_entities e join public.workspaces w on w.id=e.workspace_id where w.owner_user_id=auth.uid()
      and split_part(name,'/',1)=w.id::text and split_part(name,'/',2)=e.id::text));

do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('challan_payload','save_challan_draft','issue_challan','cancel_challan','acknowledge_delivery','publish_template','update_catalog','save_preferences','claim_document_file','finish_document_file') loop
    execute format('revoke all on function %s from public,anon',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
