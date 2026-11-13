create function public.invoice_payload(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',b.id,'version',b.version,'seller',b.seller_snapshot||coalesce(b.payment_details_snapshot,'{}'),'customer',b.customer_snapshot,
    'date',b.invoice_date,'due',b.due_date,'reference',coalesce(b.reference_number,''),'notes',coalesce(b.notes,''),
    'terms',b.terms,'status',initcap(b.status),'number',b.document_number,'currency',b.currency,
    'discountCents',b.invoice_discount_total*100,'taxBasisPoints',coalesce((select max(other_tax_rate)*100 from public.invoice_items where invoice_id=b.id),0),
    'totalCents',b.grand_total*100,'subtotalCents',b.subtotal*100,'taxCents',b.tax_total*100,
    'taxableCents',b.taxable_total*100,'roundOffCents',b.round_off*100,
    'accent',b.template_snapshot->'settings_json'->>'accent',
    'cancellation',case when b.status='cancelled' then jsonb_build_object('date',(b.cancelled_at at time zone w.timezone)::date,'reason',b.cancel_reason) end,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('id',i.sort_order,'databaseId',i.id,'description',i.particulars,
      'quantity',i.quantity::text,'rate',rtrim(rtrim(i.unit_rate::text,'0'),'.'),'style',i.style_number_snapshot,'styleId',i.style_id,
      'printType',i.print_type_snapshot,'placement',i.placement_snapshot,'unit',i.unit_snapshot,
      'amountCents',i.line_total*100,'taxableCents',i.taxable_amount*100,'taxCents',i.tax_amount*100)
      order by i.sort_order) from public.invoice_items i where i.invoice_id=b.id),'[]'),
    'receipts',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'date',p.payment_date,'cents',p.amount*100,
      'method',p.method,'reference',coalesce(p.reference_number,''),'status',p.status,'reversedAt',p.reversed_at,
      'reversalReason',p.reversal_reason) order by p.posted_at) from public.payments p where p.invoice_id=b.id),'[]')
  ) from public.invoices b join public.workspaces w on w.id=b.workspace_id where b.id=p_id and w.owner_user_id=auth.uid()
$$;

create function public.save_invoice_draft(p_entity uuid,p_bill jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid; bid uuid:=(p_bill->>'id')::uuid; inv public.invoices; seller public.billing_entities; buyer public.customers;
  item jsonb; ordinal integer; style public.styles; unit_row public.units; pt public.print_types; place public.placements;
  tax public.tax_profiles; qty numeric; rate numeric; gross numeric; discount numeric; adjustment numeric;
  header_discount numeric:=coalesce((p_bill->>'discountCents')::numeric,0)/100;
  template public.document_templates; base numeric; shared_tax numeric;
begin
  ws:=public.require_entity(p_entity,true);
  select * into strict seller from public.billing_entities where id=p_entity;
  select * into buyer from public.customers where id=(p_bill->>'customerId')::uuid
    and workspace_id=ws and entity_id=p_entity and is_active for share;
  if buyer.id is null then raise exception 'Choose an active customer from this company' using errcode='23514'; end if;
  if bid is null then bid:=gen_random_uuid(); end if;
  insert into public.invoices(id,workspace_id,entity_id,customer_id,invoice_date,due_date)
    values(bid,ws,p_entity,buyer.id,(p_bill->>'date')::date,(p_bill->>'due')::date) on conflict(id) do nothing;
  select * into strict inv from public.invoices where id=bid and workspace_id=ws and entity_id=p_entity for update;
  if inv.status<>'draft' then raise exception 'Only drafts can be edited' using errcode='23514'; end if;
  if p_bill ? 'version' and inv.version<>(p_bill->>'version')::bigint then
    raise exception 'This draft changed. Reload before saving.' using errcode='40001';
  end if;
  if jsonb_typeof(p_bill->'lines')<>'array' or jsonb_array_length(p_bill->'lines') not between 1 and 100 then
    raise exception 'Add between 1 and 100 items' using errcode='23514';
  end if;
  select * into template from public.document_templates where id=seller.default_invoice_template_id
    and entity_id=p_entity and document_type='invoice' and status='published';
  if template.id is null then raise exception 'Publish an invoice template first' using errcode='23514'; end if;
  delete from public.invoice_items where invoice_id=bid;
  -- Resolve in normalized style order so multiple-line saves use a stable lock order.
  for item,ordinal in select value, ordinality::integer from jsonb_array_elements(p_bill->'lines') with ordinality
    order by upper(btrim(coalesce(value->>'style',''))),ordinality loop
    style:=null; pt:=null; place:=null; tax:=null;
    if nullif(btrim(item->>'style'),'') is not null then style:=public.resolve_style(p_entity,item->>'style'); end if;
    select * into unit_row from public.units where entity_id=p_entity and is_active
      and code=coalesce(nullif(item->>'unitCode',''),'PCS') for share;
    if unit_row.id is null then raise exception 'Unknown or archived unit' using errcode='23514'; end if;
    if nullif(item->>'printType','') is not null then
      select * into pt from public.print_types where entity_id=p_entity and is_active and label=item->>'printType' for share;
      if pt.id is null then raise exception 'Unknown or archived print type' using errcode='23514'; end if;
    end if;
    if nullif(item->>'placement','') is not null then
      select * into place from public.placements where entity_id=p_entity and is_active and label=item->>'placement' for share;
      if place.id is null then raise exception 'Unknown or archived placement' using errcode='23514'; end if;
    end if;
    qty:=(item->>'quantity')::numeric; rate:=(item->>'rate')::numeric;
    if qty<>round(qty,3) or rate<>round(rate,4) then raise exception 'Quantity or rate precision exceeded' using errcode='23514'; end if;
    gross:=round(qty*rate,2); discount:=coalesce((item->>'discountCents')::numeric,0)/100;
    adjustment:=coalesce((item->>'adjustmentCents')::numeric,0)/100;
    if item ? 'taxProfileId' or seller.default_tax_profile_id is not null then
      select * into tax from public.tax_profiles where id=coalesce((item->>'taxProfileId')::uuid,seller.default_tax_profile_id)
        and entity_id=p_entity and is_active for share;
      if tax.id is null then raise exception 'Unknown or archived tax profile' using errcode='23514'; end if;
    end if;
    shared_tax:=case when p_bill ? 'taxBasisPoints' then (p_bill->>'taxBasisPoints')::numeric/100 else coalesce(tax.other_tax_rate,0) end;
    insert into public.invoice_items(workspace_id,entity_id,invoice_id,sort_order,style_id,style_number_snapshot,
      print_type_id,placement_id,unit_id,print_type_snapshot,placement_snapshot,unit_snapshot,placement_detail,
      particulars,quantity,unit_rate,gross_amount,line_discount_amount,line_adjustment_amount,line_adjustment_reason,
      taxable_amount,line_total,tax_profile_id,tax_mode_snapshot,cgst_rate,sgst_rate,igst_rate,other_tax_rate)
    values(ws,p_entity,bid,ordinal,style.id,style.style_number,pt.id,place.id,unit_row.id,pt.label,place.label,unit_row.label,item->>'placementDetail',
      btrim(item->>'description'),qty,rate,gross,discount,adjustment,item->>'adjustmentReason',gross+adjustment-discount,gross+adjustment-discount,
      tax.id,case when p_bill ? 'taxBasisPoints' then case when shared_tax>0 then 'other' else 'none' end else coalesce(tax.tax_mode,'none') end,
      0,0,0,0);
    -- Rates and rounded components are set together to preserve item checks.
    update public.invoice_items set
      cgst_rate=case when p_bill ? 'taxBasisPoints' then 0 else coalesce(tax.cgst_rate,0) end,
      sgst_rate=case when p_bill ? 'taxBasisPoints' then 0 else coalesce(tax.sgst_rate,0) end,
      igst_rate=case when p_bill ? 'taxBasisPoints' then 0 else coalesce(tax.igst_rate,0) end,
      other_tax_rate=shared_tax,
      cgst_amount=round(taxable_amount*case when p_bill ? 'taxBasisPoints' then 0 else coalesce(tax.cgst_rate,0) end/100,2),
      sgst_amount=round(taxable_amount*case when p_bill ? 'taxBasisPoints' then 0 else coalesce(tax.sgst_rate,0) end/100,2),
      igst_amount=round(taxable_amount*case when p_bill ? 'taxBasisPoints' then 0 else coalesce(tax.igst_rate,0) end/100,2),
      other_tax_amount=round(taxable_amount*shared_tax/100,2),
      tax_amount=round(taxable_amount*case when p_bill ? 'taxBasisPoints' then 0 else coalesce(tax.cgst_rate,0) end/100,2)
        +round(taxable_amount*case when p_bill ? 'taxBasisPoints' then 0 else coalesce(tax.sgst_rate,0) end/100,2)
        +round(taxable_amount*case when p_bill ? 'taxBasisPoints' then 0 else coalesce(tax.igst_rate,0) end/100,2)+round(taxable_amount*shared_tax/100,2),
      line_total=taxable_amount+round(taxable_amount*case when p_bill ? 'taxBasisPoints' then 0 else coalesce(tax.cgst_rate,0) end/100,2)
        +round(taxable_amount*case when p_bill ? 'taxBasisPoints' then 0 else coalesce(tax.sgst_rate,0) end/100,2)
        +round(taxable_amount*case when p_bill ? 'taxBasisPoints' then 0 else coalesce(tax.igst_rate,0) end/100,2)+round(taxable_amount*shared_tax/100,2)
      where invoice_id=bid and sort_order=ordinal;
  end loop;
  select sum(taxable_amount) into base from public.invoice_items where invoice_id=bid;
  if header_discount<0 or header_discount>base or header_discount<>round(header_discount,2) then
    raise exception 'Discount exceeds subtotal' using errcode='23514';
  end if;
  if header_discount>0 then
    with shares as (
      select id,sort_order,header_discount*100*taxable_amount/base raw from public.invoice_items where invoice_id=bid
    ), ranked as (
      select *,row_number() over(order by raw-floor(raw) desc,sort_order) rank,
        header_discount*100-sum(floor(raw)) over() remainder from shares
    ), amounts as (
      select id,(floor(raw)+case when rank<=remainder then 1 else 0 end)/100 share from ranked
    ), recalculated as (
      select i.id,a.share,i.taxable_amount-a.share taxable from public.invoice_items i join amounts a on a.id=i.id
    )
    update public.invoice_items i set invoice_discount_share=r.share,taxable_amount=r.taxable,
      cgst_amount=round(r.taxable*cgst_rate/100,2),sgst_amount=round(r.taxable*sgst_rate/100,2),
      igst_amount=round(r.taxable*igst_rate/100,2),other_tax_amount=round(r.taxable*other_tax_rate/100,2),
      tax_amount=round(r.taxable*cgst_rate/100,2)+round(r.taxable*sgst_rate/100,2)+round(r.taxable*igst_rate/100,2)+round(r.taxable*other_tax_rate/100,2),
      line_total=r.taxable+round(r.taxable*cgst_rate/100,2)+round(r.taxable*sgst_rate/100,2)+round(r.taxable*igst_rate/100,2)+round(r.taxable*other_tax_rate/100,2)
    from recalculated r where i.id=r.id;
  end if;
  update public.invoices b set customer_id=buyer.id,invoice_date=(p_bill->>'date')::date,due_date=(p_bill->>'due')::date,
    reference_number=p_bill->>'reference',notes=p_bill->>'notes',terms=coalesce(p_bill->>'terms',seller.default_terms),
    seller_snapshot=to_jsonb(seller),customer_snapshot=to_jsonb(buyer),
    payment_details_snapshot=jsonb_build_object('bank_details',coalesce(p_bill->'bank',seller.bank_details),'upi_id',coalesce(p_bill->>'upi',seller.upi_id)),
    template_id=template.id,template_snapshot=to_jsonb(template),renderer_version=template.renderer_version,
    rounding_increment_snapshot=seller.rounding_increment,
    subtotal=s.gross,line_adjustment_total=s.adjustment,line_discount_total=s.discounts,invoice_discount_total=header_discount,
    taxable_total=s.taxable,cgst_total=s.cgst,sgst_total=s.sgst,igst_total=s.igst,other_tax_total=s.other,tax_total=s.tax,
    round_off=case when seller.rounding_increment>0 then round((s.taxable+s.tax)/seller.rounding_increment)*seller.rounding_increment-(s.taxable+s.tax) else 0 end,
    grand_total=case when seller.rounding_increment>0 then round((s.taxable+s.tax)/seller.rounding_increment)*seller.rounding_increment else s.taxable+s.tax end
    from (select sum(gross_amount) gross,sum(line_adjustment_amount) adjustment,sum(line_discount_amount) discounts,
      sum(taxable_amount) taxable,sum(cgst_amount) cgst,sum(sgst_amount) sgst,sum(igst_amount) igst,sum(other_tax_amount) other,sum(tax_amount) tax
      from public.invoice_items where invoice_id=bid) s where b.id=bid;
  return public.invoice_payload(bid);
end $$;

create function public.allocate_document_number(p_entity uuid,p_type text,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.billing_entities; ws uuid; start_year integer; starts date; ends date; period text; prefix text; serial bigint;
begin
  ws:=public.require_entity(p_entity,true);
  select * into strict e from public.billing_entities where id=p_entity;
  if p_type not in ('invoice','delivery_challan') then raise exception 'Invalid document type'; end if;
  prefix:=case when p_type='invoice' then coalesce(nullif(btrim(e.invoice_prefix),''),e.entity_code)
    else coalesce(nullif(btrim(e.dc_prefix),''),e.entity_code||'/DC') end;
  if e.numbering_mode='continuous' then period:='CONTINUOUS';
  else
    start_year:=extract(year from p_date)::integer-case when extract(month from p_date)<e.financial_year_start_month then 1 else 0 end;
    starts:=make_date(start_year,e.financial_year_start_month,1);ends:=(starts+interval '1 year'-interval '1 day')::date;
    period:=right(start_year::text,2)||'-'||right((start_year+1)::text,2);
  end if;
  insert into public.document_sequences(workspace_id,entity_id,document_type,period_key,period_start,period_end)
    values(ws,p_entity,p_type,period,starts,ends) on conflict do nothing;
  update public.document_sequences set next_number=next_number+1,updated_at=now()
    where workspace_id=ws and entity_id=p_entity and document_type=p_type and period_key=period returning next_number-1 into serial;
  return jsonb_build_object('number',prefix||'/'||case when period='CONTINUOUS' then '' else period||'/' end||lpad(serial::text,greatest(4,length(serial::text)),'0'),
    'period',period,'sequence',serial,'prefix',prefix,'mode',e.numbering_mode,'start',starts,'end',ends);
end $$;

create function public.issue_invoice(p_entity uuid,p_id uuid,p_version bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid; inv public.invoices; number jsonb; buyer public.customers;
begin
  ws:=public.require_entity(p_entity,true);
  select * into strict inv from public.invoices where id=p_id and workspace_id=ws and entity_id=p_entity for update;
  if inv.status<>'draft' then return public.invoice_payload(p_id); end if;
  if inv.version<>p_version then raise exception 'Draft changed. Reload before issuing.' using errcode='40001'; end if;
  select * into buyer from public.customers where id=inv.customer_id and is_active for share;
  if buyer.id is null then raise exception 'Customer is archived' using errcode='23514'; end if;
  perform 1 from public.styles s join public.invoice_items i on i.style_id=s.id where i.invoice_id=p_id order by s.id for share of s;
  if exists(select 1 from public.invoice_items i join public.styles s on s.id=i.style_id where i.invoice_id=p_id and not s.is_active) then
    raise exception 'A style on this draft is archived' using errcode='23514';
  end if;
  number:=public.allocate_document_number(p_entity,'invoice',inv.invoice_date);
  update public.invoices set status='issued',document_number=number->>'number',period_key=number->>'period',sequence_number=(number->>'sequence')::bigint,
    number_prefix_snapshot=number->>'prefix',numbering_mode_snapshot=number->>'mode',period_start_snapshot=(number->>'start')::date,
    period_end_snapshot=(number->>'end')::date,issued_at=clock_timestamp(),issued_by=auth.uid() where id=p_id;
  insert into public.document_files(workspace_id,entity_id,invoice_id,template_id,variant) values(ws,p_entity,p_id,inv.template_id,'original');
  return public.invoice_payload(p_id);
end $$;

create function public.cancel_invoice(p_entity uuid,p_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid; inv public.invoices;
begin
  ws:=public.require_entity(p_entity);
  select * into strict inv from public.invoices where id=p_id and workspace_id=ws and entity_id=p_entity for update;
  if inv.status='cancelled' then return public.invoice_payload(p_id); end if;
  if inv.status<>'issued' or coalesce(length(btrim(p_reason)),0)=0 then raise exception 'An issued invoice and cancellation reason are required' using errcode='23514'; end if;
  if exists(select 1 from public.payments where invoice_id=p_id and status='posted') then raise exception 'Reverse receipts before cancelling' using errcode='23514'; end if;
  update public.invoices set status='cancelled',cancelled_at=clock_timestamp(),cancelled_by=auth.uid(),cancel_reason=btrim(p_reason) where id=p_id;
  insert into public.document_files(workspace_id,entity_id,invoice_id,template_id,variant) values(ws,p_entity,p_id,inv.template_id,'cancelled');
  return public.invoice_payload(p_id);
end $$;

create function public.record_payment(p_entity uuid,p_id uuid,p_receipt jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid; previous public.idempotency_keys; inv public.invoices; result jsonb; fingerprint text:=md5(p_id::text||p_receipt::text);
begin
  ws:=public.require_entity(p_entity);
  insert into public.idempotency_keys(workspace_id,actor_user_id,operation,key,request_hash)
    values(ws,auth.uid(),'payment',p_key,fingerprint) on conflict do nothing;
  select * into strict previous from public.idempotency_keys where workspace_id=ws and actor_user_id=auth.uid() and operation='payment' and key=p_key for update;
  if previous.request_hash<>fingerprint then raise exception 'Request key reused with different payment' using errcode='23505'; end if;
  if previous.response_json is not null then return previous.response_json; end if;
  select * into strict inv from public.invoices where id=p_id and workspace_id=ws and entity_id=p_entity for update;
  insert into public.payments(workspace_id,entity_id,invoice_id,payment_date,amount,method,reference_number,notes,posted_by)
    values(ws,p_entity,p_id,(p_receipt->>'date')::date,(p_receipt->>'cents')::numeric/100,p_receipt->>'method',p_receipt->>'reference',p_receipt->>'notes',auth.uid());
  result:=public.invoice_payload(p_id);
  update public.idempotency_keys set resource_id=p_id,response_json=result where workspace_id=ws and actor_user_id=auth.uid() and operation='payment' and key=p_key;
  return result;
end $$;

create function public.reverse_payment(p_entity uuid,p_id uuid,p_payment uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid;
begin
  ws:=public.require_entity(p_entity);
  perform 1 from public.invoices where id=p_id and workspace_id=ws and entity_id=p_entity for update;
  if not found then raise exception 'Invoice not found' using errcode='42501'; end if;
  if coalesce(length(btrim(p_reason)),0)=0 then raise exception 'Enter a reversal reason' using errcode='23514'; end if;
  update public.payments set status='reversed',reversed_at=clock_timestamp(),reversed_by=auth.uid(),reversal_reason=btrim(p_reason)
    where id=p_payment and invoice_id=p_id and status='posted';
  if not found and not exists(select 1 from public.payments where id=p_payment and invoice_id=p_id) then raise exception 'Receipt not found' using errcode='42501'; end if;
  return public.invoice_payload(p_id);
end $$;

create function public.delete_invoice_draft(p_entity uuid,p_id uuid,p_version bigint) returns void
language plpgsql security definer set search_path='' as $$
declare ws uuid; inv public.invoices;
begin
  ws:=public.require_entity(p_entity);
  select * into strict inv from public.invoices where id=p_id and entity_id=p_entity and workspace_id=ws for update;
  if inv.status<>'draft' or inv.version<>p_version then raise exception 'Draft changed or already issued' using errcode='23514'; end if;
  delete from public.invoice_items where invoice_id=p_id;
  delete from public.invoices where id=p_id;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('invoice_payload','save_invoice_draft','allocate_document_number','issue_invoice','cancel_invoice','record_payment','reverse_payment','delete_invoice_draft') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if f.signature::text not like '%allocate_document_number%' then execute format('grant execute on function %s to authenticated',f.signature); end if;
  end loop;
end $$;
