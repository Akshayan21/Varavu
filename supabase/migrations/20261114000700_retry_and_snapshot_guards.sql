-- Keep the original calculation engine private and require versions on subsequent edits.
alter function public.save_invoice_draft(uuid,jsonb) rename to save_invoice_draft_internal;
revoke all on function public.save_invoice_draft_internal(uuid,jsonb) from public,anon,authenticated;

create function public.save_invoice_draft(p_entity uuid,p_bill jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid; inv public.invoices; prior public.idempotency_keys; result jsonb;
  input_id uuid:=(p_bill->>'id')::uuid; fingerprint text:=md5(p_bill::text);
begin
  ws:=public.require_entity(p_entity,true);
  if input_id is null then raise exception 'A draft ID is required' using errcode='23514'; end if;
  select * into inv from public.invoices where id=input_id and workspace_id=ws and entity_id=p_entity for update;
  if inv.id is not null and not(p_bill ? 'version') then
    select * into prior from public.idempotency_keys where workspace_id=ws and actor_user_id=auth.uid()
      and operation='draft_create' and key=input_id::text;
    if prior.request_hash=fingerprint then return public.invoice_payload(input_id); end if;
    raise exception 'Provide the current draft version before editing' using errcode='40001';
  end if;
  result:=public.save_invoice_draft_internal(p_entity,p_bill);
  if nullif(p_bill->>'replacementForInvoiceId','') is not null then
    perform 1 from public.invoices where id=(p_bill->>'replacementForInvoiceId')::uuid and workspace_id=ws and entity_id=p_entity
      and customer_id=(p_bill->>'customerId')::uuid and status='cancelled' for share;
    if not found then raise exception 'Replacement must reference a cancelled invoice for this customer' using errcode='23514'; end if;
    update public.invoices set replacement_for_invoice_id=(p_bill->>'replacementForInvoiceId')::uuid where id=input_id;
  end if;
  result:=public.invoice_payload(input_id);
  if inv.id is null then
    insert into public.idempotency_keys(workspace_id,actor_user_id,operation,key,request_hash,resource_id,response_json)
      values(ws,auth.uid(),'draft_create',input_id::text,fingerprint,input_id,result);
  end if;
  return result;
end $$;

alter function public.save_challan_draft(uuid,jsonb) rename to save_challan_draft_internal;
revoke all on function public.save_challan_draft_internal(uuid,jsonb) from public,anon,authenticated;
create function public.save_challan_draft(p_entity uuid,p_challan jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid; d public.delivery_challans; prior public.idempotency_keys; result jsonb;
  input_id uuid:=(p_challan->>'id')::uuid;fingerprint text:=md5(p_challan::text);
begin
  ws:=public.require_entity(p_entity,true);
  if input_id is null then raise exception 'A challan ID is required' using errcode='23514'; end if;
  select * into d from public.delivery_challans where id=input_id and workspace_id=ws and entity_id=p_entity for update;
  if d.id is not null and not(p_challan ? 'version') then
    select * into prior from public.idempotency_keys where workspace_id=ws and actor_user_id=auth.uid()
      and operation='challan_create' and key=input_id::text;
    if prior.request_hash=fingerprint then return public.challan_payload(input_id); end if;
    raise exception 'Provide the current challan version before editing' using errcode='40001';
  end if;
  result:=public.save_challan_draft_internal(p_entity,p_challan);
  if d.id is null then
    insert into public.idempotency_keys(workspace_id,actor_user_id,operation,key,request_hash,resource_id,response_json)
      values(ws,auth.uid(),'challan_create',input_id::text,fingerprint,input_id,result);
  end if;
  return result;
end $$;

-- Include event times for historical dashboard balances, while retaining the UI payload contract.
create or replace function public.invoice_payload(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',b.id,'version',b.version,'seller',b.seller_snapshot||coalesce(b.payment_details_snapshot,'{}'),'customer',b.customer_snapshot,
    'date',b.invoice_date,'due',b.due_date,'reference',coalesce(b.reference_number,''),'notes',coalesce(b.notes,''),
    'terms',b.terms,'status',initcap(b.status),'number',b.document_number,'currency',b.currency,
    'issuedAt',b.issued_at,'cancelledAt',b.cancelled_at,'replacementForInvoiceId',b.replacement_for_invoice_id,
    'discountCents',b.invoice_discount_total*100,'taxBasisPoints',coalesce((select max(other_tax_rate)*100 from public.invoice_items where invoice_id=b.id),0),
    'totalCents',b.grand_total*100,'subtotalCents',b.subtotal*100,'taxCents',b.tax_total*100,
    'taxableCents',b.taxable_total*100,'roundOffCents',b.round_off*100,
    'accent',b.template_snapshot->'settings_json'->>'accent','templatePreset',b.template_snapshot->'settings_json'->>'preset',
    'cancellation',case when b.status='cancelled' then jsonb_build_object('date',(b.cancelled_at at time zone w.timezone)::date,'reason',b.cancel_reason) end,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('id',i.sort_order,'databaseId',i.id,'description',i.particulars,
      'quantity',i.quantity::text,'rate',rtrim(rtrim(i.unit_rate::text,'0'),'.'),'style',i.style_number_snapshot,'styleId',i.style_id,
      'printType',i.print_type_snapshot,'placement',i.placement_snapshot,'unit',i.unit_snapshot,
      'amountCents',i.line_total*100,'taxableCents',i.taxable_amount*100,'taxCents',i.tax_amount*100)
      order by i.sort_order) from public.invoice_items i where i.invoice_id=b.id),'[]'),
    'receipts',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'date',p.payment_date,'cents',p.amount*100,
      'method',p.method,'reference',coalesce(p.reference_number,''),'status',p.status,'postedAt',p.posted_at,'reversedAt',p.reversed_at,
      'reversalReason',p.reversal_reason) order by p.posted_at) from public.payments p where p.invoice_id=b.id),'[]')
  ) from public.invoices b join public.workspaces w on w.id=b.workspace_id where b.id=p_id and w.owner_user_id=auth.uid()
$$;

alter table public.invoices
  add constraint safe_client_amounts check(subtotal<=90071992547409.91 and grand_total<=90071992547409.91),
  add constraint complete_issue_metadata check(status='draft' or (sequence_number is not null and numbering_mode_snapshot is not null
    and ((numbering_mode_snapshot='continuous' and period_start_snapshot is null and period_end_snapshot is null)
      or (numbering_mode_snapshot='financial_year' and period_start_snapshot is not null and period_end_snapshot>=period_start_snapshot)))),
  add constraint complete_cancel_metadata check(status<>'cancelled' or (cancelled_at is not null and cancel_reason is not null));
alter table public.delivery_challans
  add constraint complete_dc_issue_metadata check(status='draft' or (sequence_number is not null and period_key is not null and renderer_version is not null)),
  add constraint complete_dc_cancel_metadata check(status<>'cancelled' or (cancelled_at is not null and cancel_reason is not null));
alter table public.payments
  add constraint complete_reversal_metadata check(status<>'reversed' or (reversed_at is not null and reversal_reason is not null));

revoke all on function public.save_invoice_draft(uuid,jsonb),public.save_challan_draft(uuid,jsonb) from public,anon;
grant execute on function public.save_invoice_draft(uuid,jsonb),public.save_challan_draft(uuid,jsonb) to authenticated;

create function public.set_entity_asset(p_entity uuid,p_kind text,p_path text) returns void
language plpgsql security definer set search_path='' as $$
declare ws uuid;
begin
  ws:=public.require_entity(p_entity,true);
  if p_kind not in ('logo','signature') or left(p_path,length(ws::text||'/'||p_entity::text||'/'))<>ws::text||'/'||p_entity::text||'/'
    or not exists(select 1 from storage.objects where bucket_id='billing-assets' and name=p_path) then
    raise exception 'Invalid company asset' using errcode='23514';
  end if;
  if p_kind='logo' then update public.billing_entities set logo_path=p_path where id=p_entity;
  else update public.billing_entities set signature_path=p_path where id=p_entity; end if;
end $$;
revoke all on function public.set_entity_asset(uuid,text,text) from public,anon;
grant execute on function public.set_entity_asset(uuid,text,text) to authenticated;
