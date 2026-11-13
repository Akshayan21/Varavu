-- Materialize the report result at request time so retries reproduce the same export.
alter table public.report_exports add column data_snapshot jsonb not null default '{}';

create function public.report_data(p_entities uuid[],p_type text,p_from date,p_as_of date,p_recorded_through timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid; zone text; boundary timestamptz; headers jsonb; rows jsonb;
begin
  select id,timezone into ws,zone from public.workspaces where owner_user_id=auth.uid();
  if ws is null or p_entities is null or cardinality(p_entities)=0 or exists(select 1 from unnest(p_entities) q(entity_id) where q.entity_id is null or not exists(
    select 1 from public.billing_entities e where e.id=q.entity_id and e.workspace_id=ws)) then raise exception 'Invalid report scope' using errcode='42501'; end if;
  if p_from>p_as_of then raise exception 'Invalid report period' using errcode='23514'; end if;
  boundary:=(p_as_of+1)::timestamp at time zone zone;
  if p_type='challans' then
    headers:='["Challan","Recipient","Date","Items"]';
    select coalesce(jsonb_agg(jsonb_build_array(d.document_number,d.recipient_name,d.dc_date,
      (select string_agg(i.particulars,', ' order by i.sort_order) from public.dc_items i where i.dc_id=d.id)) order by d.dc_date,d.id),'[]') into rows
    from public.delivery_challans d where d.workspace_id=ws and d.entity_id=any(p_entities) and d.dc_date between p_from and p_as_of
      and d.issued_at<=p_recorded_through and not(coalesce(d.cancelled_at<boundary and d.cancelled_at<=p_recorded_through,false));
  elsif p_type='cancelled' then
    headers:='["Bill","Customer","Cancelled on","Reason","Original amount"]';
    select coalesce(jsonb_agg(jsonb_build_array(b.document_number,b.customer_snapshot->>'legal_name',b.cancelled_at,b.cancel_reason,b.grand_total) order by b.cancelled_at,b.id),'[]') into rows
    from public.invoices b where b.workspace_id=ws and b.entity_id=any(p_entities) and b.cancelled_at<=p_recorded_through
      and (b.cancelled_at at time zone zone)::date between p_from and p_as_of;
  elsif p_type='collections' then
    headers:='["Bill","Date","Method","Amount"]';
    select coalesce(jsonb_agg(jsonb_build_array(b.document_number,p.payment_date,p.method,p.amount) order by p.payment_date,p.id),'[]') into rows
    from public.payments p join public.invoices b on b.id=p.invoice_id
    where p.workspace_id=ws and p.entity_id=any(p_entities) and p.payment_date between p_from and p_as_of
      and p.posted_at<=p_recorded_through and not(coalesce(p.reversed_at<boundary and p.reversed_at<=p_recorded_through,false));
  elsif p_type in ('billing','outstanding','customers','monthly','print-type','companies') then
    with eligible as (
      select b.*,
        coalesce((select sum(p.amount) from public.payments p where p.invoice_id=b.id and p.payment_date<=p_as_of and p.posted_at<=p_recorded_through
          and not(coalesce(p.reversed_at<boundary and p.reversed_at<=p_recorded_through,false))),0) paid
      from public.invoices b where b.workspace_id=ws and b.entity_id=any(p_entities) and b.invoice_date<=p_as_of and b.issued_at<=p_recorded_through
        and not(coalesce(b.cancelled_at<boundary and b.cancelled_at<=p_recorded_through,false))
    ), grouped as (
      select case when p_type='customers' then b.entity_id::text||':'||b.customer_id::text when p_type='monthly' then to_char(b.invoice_date,'YYYY-MM')
        else b.entity_id::text end grouping_key,
        min(case when p_type='customers' then (b.seller_snapshot->>'legal_name')||' · '||(b.customer_snapshot->>'legal_name')
          when p_type='monthly' then to_char(b.invoice_date,'YYYY-MM') else b.seller_snapshot->>'legal_name' end) label,
        sum(b.grand_total) total
      from eligible b where b.invoice_date>=p_from group by 1
    ), print_groups as (
      select coalesce(i.print_type_snapshot,'Unspecified') label,sum(i.line_total) total
        from eligible b join public.invoice_items i on i.invoice_id=b.id where b.invoice_date>=p_from group by 1
      union all
      select 'Round off',sum(b.round_off) from eligible b where b.invoice_date>=p_from having sum(b.round_off)<>0
    )
    select case when p_type='billing' then coalesce((select jsonb_agg(jsonb_build_array(b.document_number,b.customer_snapshot->>'legal_name',b.invoice_date,b.grand_total) order by b.invoice_date,b.id) from eligible b where b.invoice_date>=p_from),'[]')
      when p_type='outstanding' then coalesce((select jsonb_agg(jsonb_build_array(b.document_number,b.customer_snapshot->>'legal_name',b.due_date,b.grand_total-b.paid) order by b.due_date,b.id) from eligible b where b.grand_total>b.paid),'[]')
      when p_type='print-type' then coalesce((select jsonb_agg(jsonb_build_array(label,total) order by label) from print_groups),'[]')
      else coalesce((select jsonb_agg(jsonb_build_array(label,total) order by label) from grouped),'[]') end into rows;
    headers:=case when p_type='billing' then '["Bill","Customer","Date","Amount"]'::jsonb
      when p_type='outstanding' then '["Bill","Customer","Due date","Outstanding"]'::jsonb
      else '["Group","Amount"]'::jsonb end;
  else raise exception 'Unknown report' using errcode='23514'; end if;
  return jsonb_build_object('headers',headers,'rows',rows,'from',p_from,'asOf',p_as_of,'recordedThrough',p_recorded_through,'timezone',zone,'definitionVersion','v1');
end $$;

create function public.request_report_export(p_entities uuid[],p_type text,p_from date,p_as_of date,p_format text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare dataset jsonb; ws uuid; result public.report_exports; names jsonb;
begin
  dataset:=public.report_data(p_entities,p_type,p_from,p_as_of,clock_timestamp());
  select id into strict ws from public.workspaces where owner_user_id=auth.uid();
  select jsonb_agg(jsonb_build_object('id',id,'name',legal_name) order by legal_name) into names from public.billing_entities where id=any(p_entities) and workspace_id=ws;
  insert into public.report_exports(workspace_id,requested_by,report_type,entity_ids,filters_json,as_of_date,recorded_through,business_timezone,
    title_snapshot,entity_names_snapshot,format,data_snapshot,expires_at)
    values(ws,auth.uid(),p_type,p_entities,jsonb_build_object('from',p_from,'asOf',p_as_of),p_as_of,(dataset->>'recordedThrough')::timestamptz,
      dataset->>'timezone',initcap(replace(p_type,'-',' '))||' report',names,p_format,dataset,clock_timestamp()+interval '7 days') returning * into result;
  insert into public.audit_logs(workspace_id,actor_user_id,action,resource_type,resource_id,metadata_json)
    values(ws,auth.uid(),'export_requested','report_exports',result.id,jsonb_build_object('type',p_type,'entities',p_entities));
  return to_jsonb(result);
end $$;

create function public.claim_report_export(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.report_exports;
begin
  select r.* into strict result from public.report_exports r join public.workspaces w on w.id=r.workspace_id where r.id=p_id and w.owner_user_id=auth.uid() for update of r;
  if result.expires_at<clock_timestamp() then raise exception 'Export expired. Request a new report.' using errcode='23514'; end if;
  if result.status='ready' then return to_jsonb(result); end if;
  if result.status='processing' and result.lease_expires_at>clock_timestamp() then raise exception 'Export is being generated' using errcode='55P03'; end if;
  update public.report_exports set status='processing',attempt_count=attempt_count+1,claim_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '2 minutes'
    where id=p_id returning * into result;
  return to_jsonb(result);
end $$;

create function public.finish_report_export(p_id uuid,p_token uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare ws uuid; first_entity uuid;
begin
  select r.workspace_id,r.entity_ids[1] into ws,first_entity from public.report_exports r join public.workspaces w on w.id=r.workspace_id where r.id=p_id and w.owner_user_id=auth.uid();
  if ws is null or (p_result ? 'path' and p_result->>'path' not like ws::text||'/'||first_entity::text||'/%') then raise exception 'Invalid export' using errcode='42501'; end if;
  update public.report_exports set status=case when p_result ? 'error' then 'failed' else 'ready' end,
    object_path=p_result->>'path',sha256=p_result->>'sha256',byte_size=(p_result->>'size')::bigint,
    last_error=p_result->>'error',generated_at=case when not(p_result ? 'error') then clock_timestamp() end,lease_expires_at=null,updated_at=now()
    where id=p_id and status='processing' and claim_token=p_token;
  if not found then raise exception 'Export claim expired' using errcode='40001'; end if;
end $$;

revoke all on function public.report_data(uuid[],text,date,date,timestamptz),public.request_report_export(uuid[],text,date,date,text),public.claim_report_export(uuid),public.finish_report_export(uuid,uuid,jsonb) from public,anon;
grant execute on function public.report_data(uuid[],text,date,date,timestamptz),public.request_report_export(uuid[],text,date,date,text),public.claim_report_export(uuid),public.finish_report_export(uuid,uuid,jsonb) to authenticated;
