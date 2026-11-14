-- Read services authorize workspace/entity selections independently of RLS.
create function public.authorize_report_entities(p_entities uuid[]) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare ws uuid;
begin
  select id into ws from public.workspaces where owner_user_id=auth.uid();
  if ws is null or p_entities is null or cardinality(p_entities)=0 or cardinality(p_entities)>100
    or cardinality(p_entities)<>(select count(distinct x) from unnest(p_entities) x)
    or exists(select 1 from unnest(p_entities) q(id) where q.id is null or not exists(
      select 1 from public.billing_entities e where e.id=q.id and e.workspace_id=ws)) then
    raise exception 'Company selection is unavailable' using errcode='42501';
  end if;
  return ws;
end $$;

create function public.list_documents(p_entity uuid,p_kind text,p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid; result jsonb; total bigint; n integer:=coalesce((p_filters->>'page')::integer,1);
  size integer:=coalesce((p_filters->>'pageSize')::integer,25); search text:=coalesce(p_filters->>'search','');
  as_of date:=coalesce((p_filters->>'asOf')::date,current_date); cutoff timestamptz:=now();
begin
  ws:=public.authorize_report_entities(array[p_entity]);
  if n<1 or n>100000 or size not between 1 and 100 or p_kind not in ('invoices','challans') then
    raise exception 'Invalid document filters' using errcode='23514';
  end if;
  if p_kind='invoices' then
    with candidates as (
      select b.id,b.invoice_date,b.created_at,b.grand_total,b.status,b.due_date,
        b.grand_total-coalesce((select sum(p.amount) from public.payments p where p.invoice_id=b.id and p.status='posted'),0) balance
      from public.invoices b where b.workspace_id=ws and b.entity_id=p_entity
        and (not(p_filters ? 'status') or b.status=p_filters->>'status')
        and (not(p_filters ? 'customerId') or b.customer_id=(p_filters->>'customerId')::uuid)
        and (not(p_filters ? 'from') or b.invoice_date>=(p_filters->>'from')::date)
        and (not(p_filters ? 'to') or b.invoice_date<=(p_filters->>'to')::date)
        and (not(p_filters ? 'minAmount') or b.grand_total>=(p_filters->>'minAmount')::numeric)
        and (not(p_filters ? 'maxAmount') or b.grand_total<=(p_filters->>'maxAmount')::numeric)
        and (search='' or strpos(lower(coalesce(b.document_number,'')||' '||coalesce(b.reference_number,'')||' '||coalesce(b.customer_snapshot->>'legal_name','')),lower(search))>0)
    ), filtered as (
      select * from candidates c where
        (not(p_filters ? 'paymentStatus') or exists(select 1 from public.invoices b where b.id=c.id and b.status='issued') and
          case when c.balance=0 then 'paid' when c.balance=c.grand_total then 'unpaid' else 'partially_paid' end=p_filters->>'paymentStatus')
        and (not(p_filters ? 'overdue') or (c.status='issued' and c.due_date<as_of and c.balance>0)=(p_filters->>'overdue')::boolean)
    ), paged as (
      select * from filtered order by
        case when p_filters->>'sort'='oldest' then invoice_date end asc,
        case when p_filters->>'sort'='amount_desc' then grand_total end desc,
        invoice_date desc,created_at desc,id limit size offset (n-1)*size
    )
    select (select count(*) from filtered),coalesce((select jsonb_agg(public.invoice_payload(id)||jsonb_build_object('outstanding',balance)
      order by case when p_filters->>'sort'='oldest' then invoice_date end asc,
      case when p_filters->>'sort'='amount_desc' then grand_total end desc,invoice_date desc,created_at desc,id) from paged),'[]') into total,result;
  else
    with filtered as (
      select d.* from public.delivery_challans d where d.workspace_id=ws and d.entity_id=p_entity
        and (not(p_filters ? 'status') or d.status=p_filters->>'status')
        and (not(p_filters ? 'customerId') or d.customer_id=(p_filters->>'customerId')::uuid)
        and (not(p_filters ? 'invoiceId') or d.related_invoice_id=(p_filters->>'invoiceId')::uuid)
        and (not(p_filters ? 'from') or d.dc_date>=(p_filters->>'from')::date)
        and (not(p_filters ? 'to') or d.dc_date<=(p_filters->>'to')::date)
        and (search='' or strpos(lower(coalesce(d.document_number,'')||' '||d.recipient_name),lower(search))>0)
    ), paged as (
      select * from filtered order by case when p_filters->>'sort'='oldest' then dc_date end asc,dc_date desc,created_at desc,id limit size offset (n-1)*size
    ) select (select count(*) from filtered),coalesce((select jsonb_agg(public.challan_payload(id) order by
      case when p_filters->>'sort'='oldest' then dc_date end asc,dc_date desc,created_at desc,id) from paged),'[]') into total,result;
  end if;
  return jsonb_build_object('data',result,'page',n,'pageSize',size,'total',total,'asOf',as_of,'recordedThrough',cutoff);
end $$;

create function public.dashboard_data(p_entities uuid[],p_from date,p_as_of date,p_recorded timestamptz default now(),p_customer uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid; zone text; boundary timestamptz; result jsonb;
begin
  ws:=public.authorize_report_entities(p_entities);
  select timezone into zone from public.workspaces where id=ws;
  if p_from is null or p_as_of is null or p_from>p_as_of or p_as_of-p_from>3660 or p_recorded is null or p_recorded>clock_timestamp() then
    raise exception 'Use a report period up to ten years and a valid recorded cutoff' using errcode='23514';
  end if;
  if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and workspace_id=ws and entity_id=any(p_entities)) then
    raise exception 'Customer not found' using errcode='42501';
  end if;
  boundary:=(p_as_of+1)::timestamp at time zone zone;
  with eligible as (
    select b.*,coalesce((select sum(p.amount) from public.payments p where p.invoice_id=b.id and p.payment_date<=p_as_of and p.posted_at<=p_recorded
      and not coalesce(p.reversed_at<boundary and p.reversed_at<=p_recorded,false)),0) paid
    from public.invoices b where b.workspace_id=ws and b.entity_id=any(p_entities) and (p_customer is null or b.customer_id=p_customer)
      and b.invoice_date<=p_as_of and b.issued_at<=p_recorded
      and not coalesce(b.cancelled_at<boundary and b.cancelled_at<=p_recorded,false)
  ), period_bills as (select * from eligible where invoice_date>=p_from), receipts as (
    select p.* from public.payments p join public.invoices b on b.id=p.invoice_id
    where p.workspace_id=ws and p.entity_id=any(p_entities) and (p_customer is null or b.customer_id=p_customer)
      and p.payment_date between p_from and p_as_of and p.posted_at<=p_recorded
      and not coalesce(p.reversed_at<boundary and p.reversed_at<=p_recorded,false)
  ), customer_totals as (
    select e.entity_id,e.customer_id,max(e.customer_snapshot->>'legal_name') name,
      coalesce(sum(e.grand_total) filter(where e.invoice_date>=p_from),0) billed,
      sum(e.grand_total-e.paid) outstanding,count(*) filter(where e.invoice_date>=p_from) invoice_count,
      max(e.invoice_date) last_invoice_date from eligible e group by e.entity_id,e.customer_id
  ), month_series as (
    select generate_series(date_trunc('month',p_from::timestamp),date_trunc('month',p_as_of::timestamp),interval '1 month')::date as month_start
  ), printing as (
    select coalesce(i.print_type_snapshot,'Unspecified') label,sum(i.line_total) amount
      from period_bills b join public.invoice_items i on i.invoice_id=b.id group by 1
    union all select 'Round off',sum(round_off) from period_bills having sum(round_off)<>0
  ), quantities as (
    select coalesce(i.print_type_snapshot,'Unspecified') print_type,i.unit_snapshot unit,sum(i.quantity) quantity
      from period_bills b join public.invoice_items i on i.invoice_id=b.id group by 1,2
  ), totals as (
    select coalesce(sum(grand_total),0) billed,count(*) invoice_count from period_bills
  ) select jsonb_build_object(
    'currency','INR','from',p_from,'asOf',p_as_of,'recordedThrough',p_recorded,'timezone',zone,
    'billed',(select billed from totals),'invoiceCount',(select invoice_count from totals),
    'averageInvoiceValue',(select case when invoice_count=0 then 0 else round(billed/invoice_count,2) end from totals),
    'collected',(select coalesce(sum(amount),0) from receipts),
    'outstanding',(select coalesce(sum(grand_total-paid),0) from eligible),
    'overdue',(select coalesce(sum(grand_total-paid),0) from eligible where due_date<p_as_of),
    'cancelled',(select jsonb_build_object('count',count(*),'amount',coalesce(sum(grand_total),0)) from public.invoices
      where workspace_id=ws and entity_id=any(p_entities) and (p_customer is null or customer_id=p_customer)
        and cancelled_at<=p_recorded and (cancelled_at at time zone zone)::date between p_from and p_as_of),
    'challanCount',(select count(*) from public.delivery_challans where workspace_id=ws and entity_id=any(p_entities)
      and (p_customer is null or customer_id=p_customer) and dc_date between p_from and p_as_of and issued_at<=p_recorded
      and not coalesce(cancelled_at<boundary and cancelled_at<=p_recorded,false)),
    'entities',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.legal_name,
      'billed',(select coalesce(sum(grand_total),0) from period_bills where entity_id=c.id),
      'collected',(select coalesce(sum(amount),0) from receipts where entity_id=c.id),
      'outstanding',(select coalesce(sum(grand_total-paid),0) from eligible where entity_id=c.id),
      'invoiceCount',(select count(*) from period_bills where entity_id=c.id)) order by c.legal_name,c.id),'[]')
      from public.billing_entities c where c.id=any(p_entities)),
    'monthly',(select coalesce(jsonb_agg(jsonb_build_object('month',to_char(m.month_start,'YYYY-MM'),
      'billed',(select coalesce(sum(grand_total),0) from period_bills where date_trunc('month',invoice_date::timestamp)::date=m.month_start),
      'collected',(select coalesce(sum(amount),0) from receipts where date_trunc('month',payment_date::timestamp)::date=m.month_start)) order by m.month_start),'[]') from month_series m),
    'entityMonthly',(select coalesce(jsonb_agg(jsonb_build_object('entityId',e.id,'month',to_char(m.month_start,'YYYY-MM'),
      'billed',(select coalesce(sum(grand_total),0) from period_bills where entity_id=e.id and date_trunc('month',invoice_date::timestamp)::date=m.month_start),
      'collected',(select coalesce(sum(amount),0) from receipts where entity_id=e.id and date_trunc('month',payment_date::timestamp)::date=m.month_start)) order by e.id,m.month_start),'[]')
      from month_series m cross join public.billing_entities e where e.id=any(p_entities)),
    'aging',(select jsonb_build_object(
      'notDue',coalesce(sum(grand_total-paid) filter(where due_date>=p_as_of),0),
      'days1to30',coalesce(sum(grand_total-paid) filter(where p_as_of-due_date between 1 and 30),0),
      'days31to60',coalesce(sum(grand_total-paid) filter(where p_as_of-due_date between 31 and 60),0),
      'days61to90',coalesce(sum(grand_total-paid) filter(where p_as_of-due_date between 61 and 90),0),
      'days91plus',coalesce(sum(grand_total-paid) filter(where p_as_of-due_date>90),0)) from eligible),
    'paymentStatuses',(select jsonb_build_object('paid',count(*) filter(where grand_total=paid),
      'partiallyPaid',count(*) filter(where paid>0 and paid<grand_total),'unpaid',count(*) filter(where paid=0 and grand_total>0)) from eligible),
    'topCustomers',(select coalesce(jsonb_agg(to_jsonb(c) order by billed desc,entity_id,customer_id),'[]') from
      (select * from customer_totals order by billed desc,entity_id,customer_id limit 10) c),
    'printTypes',(select coalesce(jsonb_agg(to_jsonb(p) order by label),'[]') from printing p),
    'quantities',(select coalesce(jsonb_agg(to_jsonb(q) order by print_type,unit),'[]') from quantities q),
    'recentInvoices',(select coalesce(jsonb_agg(public.invoice_payload(b.id) order by invoice_date desc,id),'[]') from
      (select id,invoice_date from period_bills order by invoice_date desc,id limit 5) b)
  ) into result;
  return result;
end $$;

create function public.customer_summary(p_entity uuid,p_customer uuid,p_from date,p_as_of date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid; customer jsonb;
begin
  ws:=public.authorize_report_entities(array[p_entity]);
  select to_jsonb(c) into customer from public.customers c where id=p_customer and workspace_id=ws and entity_id=p_entity;
  if customer is null then raise exception 'Customer not found' using errcode='P0002'; end if;
  return jsonb_build_object('customer',customer,'summary',public.dashboard_data(array[p_entity],p_from,p_as_of,now(),p_customer));
end $$;

create function public.document_detail(p_entity uuid,p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid; result jsonb;
begin
  ws:=public.authorize_report_entities(array[p_entity]);
  if p_kind='invoices' then
    if exists(select 1 from public.invoices where id=p_id and workspace_id=ws and entity_id=p_entity) then result:=public.invoice_payload(p_id); end if;
  elsif p_kind='challans' then
    if exists(select 1 from public.delivery_challans where id=p_id and workspace_id=ws and entity_id=p_entity) then result:=public.challan_payload(p_id); end if;
  else raise exception 'Invalid document type' using errcode='23514'; end if;
  if result is null then raise exception 'Document not found' using errcode='P0002'; end if;
  return result;
end $$;

-- Read payloads include all editable line data so a subsequent save preserves it.
alter function public.invoice_payload(uuid) rename to invoice_payload_base;
revoke all on function public.invoice_payload_base(uuid) from public,anon,authenticated;
create function public.invoice_payload(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select public.invoice_payload_base(p_id)||jsonb_build_object(
    'terms',b.terms,'placeOfSupplyStateCode',b.place_of_supply_state_code,'taxTreatment',b.tax_treatment,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('id',i.sort_order,'databaseId',i.id,'description',i.particulars,
      'quantity',i.quantity::text,'rate',rtrim(rtrim(i.unit_rate::text,'0'),'.'),'style',i.style_number_snapshot,'styleId',i.style_id,
      'printType',i.print_type_snapshot,'placement',i.placement_snapshot,'unit',i.unit_snapshot,'unitCode',u.code,
      'discountCents',i.line_discount_amount*100,'adjustmentCents',i.line_adjustment_amount*100,'adjustmentReason',i.line_adjustment_reason,
      'placementDetail',i.placement_detail,'hsnSacCode',i.hsn_sac_code,'taxProfileId',i.tax_profile_id,
      'taxMode',i.tax_mode_snapshot,'cgstRate',i.cgst_rate,'sgstRate',i.sgst_rate,'igstRate',i.igst_rate,'otherTaxRate',i.other_tax_rate,
      'amountCents',i.line_total*100,'taxableCents',i.taxable_amount*100,'taxCents',i.tax_amount*100)
      order by i.sort_order) from public.invoice_items i join public.units u on u.id=i.unit_id where i.invoice_id=b.id),'[]'))
  from public.invoices b join public.workspaces w on w.id=b.workspace_id where b.id=p_id and w.owner_user_id=auth.uid()
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('authorize_report_entities','list_documents','dashboard_data','customer_summary','document_detail','invoice_payload') loop
    execute format('revoke all on function %s from public,anon',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
