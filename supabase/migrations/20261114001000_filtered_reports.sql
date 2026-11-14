create function public.filtered_report_data(p_entities uuid[],p_type text,p_from date,p_as_of date,p_recorded_through timestamptz default now(),p_customer uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid; zone text; boundary timestamptz; headers jsonb; rows jsonb; summary jsonb;
begin
  ws:=public.authorize_report_entities(p_entities);
  select timezone into zone from public.workspaces where id=ws;
  if p_from is null or p_as_of is null or p_from>p_as_of or p_as_of-p_from>3660 or p_recorded_through is null or p_recorded_through>clock_timestamp() then
    raise exception 'Use a valid report period up to ten years' using errcode='23514';
  end if;
  if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and workspace_id=ws and entity_id=any(p_entities)) then
    raise exception 'Customer not found' using errcode='42501';
  end if;
  boundary:=(p_as_of+1)::timestamp at time zone zone;
  if p_type in ('customers','companies') then
    summary:=public.dashboard_data(p_entities,p_from,p_as_of,p_recorded_through,p_customer);
    if p_type='companies' then
      headers:='["Company","Billed","Collected","Outstanding","Invoice count"]';
      select coalesce(jsonb_agg(jsonb_build_array(x->>'name',(x->>'billed')::numeric,(x->>'collected')::numeric,
        (x->>'outstanding')::numeric,(x->>'invoiceCount')::bigint)),'[]') into rows from jsonb_array_elements(summary->'entities') x;
    else
      headers:='["Company","Customer","Invoice count","Billed","Collected","Outstanding","Latest invoice"]';
      with eligible as (
        select b.*,coalesce((select sum(p.amount) from public.payments p where p.invoice_id=b.id and p.payment_date<=p_as_of and p.posted_at<=p_recorded_through
          and not coalesce(p.reversed_at<boundary and p.reversed_at<=p_recorded_through,false)),0) paid
        from public.invoices b where b.workspace_id=ws and b.entity_id=any(p_entities) and b.invoice_date<=p_as_of and b.issued_at<=p_recorded_through
          and (p_customer is null or b.customer_id=p_customer) and not coalesce(b.cancelled_at<boundary and b.cancelled_at<=p_recorded_through,false)
      ), customers as (
        select b.entity_id,b.customer_id,max(b.seller_snapshot->>'legal_name') company,max(b.customer_snapshot->>'legal_name') customer,
          count(*) filter(where b.invoice_date>=p_from) n,coalesce(sum(b.grand_total) filter(where b.invoice_date>=p_from),0) billed,
          sum(b.grand_total-b.paid) outstanding,max(b.invoice_date) latest from eligible b group by b.entity_id,b.customer_id
      ) select coalesce(jsonb_agg(jsonb_build_array(c.company,c.customer,c.n,c.billed,
        coalesce((select sum(p.amount) from public.payments p join public.invoices b on b.id=p.invoice_id
          where b.entity_id=c.entity_id and b.customer_id=c.customer_id and p.payment_date between p_from and p_as_of and p.posted_at<=p_recorded_through
            and not coalesce(p.reversed_at<boundary and p.reversed_at<=p_recorded_through,false)),0),c.outstanding,c.latest)
        order by c.billed desc,c.entity_id,c.customer_id),'[]') into rows from customers c;
    end if;
    return jsonb_build_object('headers',headers,'rows',rows,'from',p_from,'asOf',p_as_of,'recordedThrough',p_recorded_through,
      'timezone',zone,'definitionVersion','v2','customerId',p_customer);
  end if;
  if p_type='challans' then
    headers:='["Challan","Recipient","Date","Items"]';
    select coalesce(jsonb_agg(jsonb_build_array(d.document_number,d.recipient_name,d.dc_date,
      (select string_agg(i.particulars,', ' order by i.sort_order) from public.dc_items i where i.dc_id=d.id)) order by d.dc_date,d.id),'[]') into rows
    from public.delivery_challans d where d.workspace_id=ws and d.entity_id=any(p_entities) and (p_customer is null or d.customer_id=p_customer) and d.dc_date between p_from and p_as_of
      and d.issued_at<=p_recorded_through and not(coalesce(d.cancelled_at<boundary and d.cancelled_at<=p_recorded_through,false));
  elsif p_type='cancelled' then
    headers:='["Bill","Customer","Cancelled on","Reason","Original amount"]';
    select coalesce(jsonb_agg(jsonb_build_array(b.document_number,b.customer_snapshot->>'legal_name',b.cancelled_at,b.cancel_reason,b.grand_total) order by b.cancelled_at,b.id),'[]') into rows
    from public.invoices b where b.workspace_id=ws and b.entity_id=any(p_entities) and (p_customer is null or b.customer_id=p_customer) and b.cancelled_at<=p_recorded_through
      and (b.cancelled_at at time zone zone)::date between p_from and p_as_of;
  elsif p_type='collections' then
    headers:='["Bill","Date","Method","Amount"]';
    select coalesce(jsonb_agg(jsonb_build_array(b.document_number,p.payment_date,p.method,p.amount) order by p.payment_date,p.id),'[]') into rows
    from public.payments p join public.invoices b on b.id=p.invoice_id
    where p.workspace_id=ws and p.entity_id=any(p_entities) and (p_customer is null or b.customer_id=p_customer) and p.payment_date between p_from and p_as_of
      and p.posted_at<=p_recorded_through and not(coalesce(p.reversed_at<boundary and p.reversed_at<=p_recorded_through,false));
  elsif p_type in ('billing','outstanding','customers','monthly','print-type','companies') then
    with eligible as (
      select b.*,
        coalesce((select sum(p.amount) from public.payments p where p.invoice_id=b.id and p.payment_date<=p_as_of and p.posted_at<=p_recorded_through
          and not(coalesce(p.reversed_at<boundary and p.reversed_at<=p_recorded_through,false))),0) paid
      from public.invoices b where b.workspace_id=ws and b.entity_id=any(p_entities) and (p_customer is null or b.customer_id=p_customer) and b.invoice_date<=p_as_of and b.issued_at<=p_recorded_through
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
  return jsonb_build_object('headers',headers,'rows',rows,'from',p_from,'asOf',p_as_of,'recordedThrough',p_recorded_through,'timezone',zone,'definitionVersion','v2','customerId',p_customer);
end $$;

create function public.request_filtered_export(p_entities uuid[],p_type text,p_from date,p_as_of date,p_format text,p_customer uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare dataset jsonb; ws uuid; result public.report_exports; names jsonb;
begin
  dataset:=public.filtered_report_data(p_entities,p_type,p_from,p_as_of,clock_timestamp(),p_customer);
  select id into strict ws from public.workspaces where owner_user_id=auth.uid();
  select jsonb_agg(jsonb_build_object('id',id,'name',legal_name) order by legal_name) into names from public.billing_entities where id=any(p_entities) and workspace_id=ws;
  insert into public.report_exports(workspace_id,requested_by,report_type,entity_ids,filters_json,as_of_date,recorded_through,business_timezone,
    title_snapshot,entity_names_snapshot,format,data_snapshot,expires_at,report_definition_version)
    values(ws,auth.uid(),p_type,p_entities,jsonb_build_object('from',p_from,'asOf',p_as_of,'customerId',p_customer),p_as_of,(dataset->>'recordedThrough')::timestamptz,
      dataset->>'timezone',initcap(replace(p_type,'-',' '))||' report',names,p_format,dataset,clock_timestamp()+interval '7 days','v2') returning * into result;
  insert into public.audit_logs(workspace_id,actor_user_id,action,resource_type,resource_id,metadata_json)
    values(ws,auth.uid(),'export_requested','report_exports',result.id,jsonb_build_object('type',p_type,'entities',p_entities));
  return to_jsonb(result);
end $$;


revoke all on function public.filtered_report_data(uuid[],text,date,date,timestamptz,uuid),public.request_filtered_export(uuid[],text,date,date,text,uuid) from public,anon;
grant execute on function public.filtered_report_data(uuid[],text,date,date,timestamptz,uuid),public.request_filtered_export(uuid[],text,date,date,text,uuid) to authenticated;
