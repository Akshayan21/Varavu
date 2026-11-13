create function public.workspace_documents(p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid; bills jsonb; challans jsonb; size constant integer:=100;
begin
  select id into ws from public.workspaces where owner_user_id=auth.uid();
  if ws is null then raise exception 'Initialize your workspace first' using errcode='42501'; end if;
  if p_page<1 or p_page>100000 then raise exception 'Invalid page' using errcode='23514'; end if;
  select coalesce(jsonb_agg(public.invoice_payload(b.id)),'[]') into bills from (
    select id from public.invoices where workspace_id=ws order by created_at,id limit size offset (p_page-1)*size) b;
  select coalesce(jsonb_agg(public.challan_payload(d.id)),'[]') into challans from (
    select id from public.delivery_challans where workspace_id=ws order by created_at,id limit size offset (p_page-1)*size) d;
  return jsonb_build_object('bills',bills,'challans',challans,'hasMore',
    exists(select 1 from public.invoices where workspace_id=ws offset p_page*size)
    or exists(select 1 from public.delivery_challans where workspace_id=ws offset p_page*size));
end $$;

-- A deferred check validates the final transaction state, allowing multi-step draft saves.
create function public.verify_invoice_totals() returns trigger language plpgsql security definer set search_path='' as $$
declare bid uuid; inv public.invoices; s record;
begin
  bid:=case when tg_table_name='invoices' then coalesce(new.id,old.id)
    else coalesce((to_jsonb(new)->>'invoice_id')::uuid,(to_jsonb(old)->>'invoice_id')::uuid) end;
  select * into inv from public.invoices where id=bid;
  if inv.id is null then return null; end if;
  select count(*) n,coalesce(sum(gross_amount),0) gross,coalesce(sum(line_adjustment_amount),0) adjustment,
    coalesce(sum(line_discount_amount),0) discounts,coalesce(sum(invoice_discount_share),0) header_discount,
    coalesce(sum(taxable_amount),0) taxable,coalesce(sum(cgst_amount),0) cgst,coalesce(sum(sgst_amount),0) sgst,
    coalesce(sum(igst_amount),0) igst,coalesce(sum(other_tax_amount),0) other_tax,coalesce(sum(tax_amount),0) tax
    into s from public.invoice_items where invoice_id=bid;
  if (inv.subtotal,inv.line_adjustment_total,inv.line_discount_total,inv.invoice_discount_total,inv.taxable_total,
      inv.cgst_total,inv.sgst_total,inv.igst_total,inv.other_tax_total,inv.tax_total)
    is distinct from (s.gross,s.adjustment,s.discounts,s.header_discount,s.taxable,s.cgst,s.sgst,s.igst,s.other_tax,s.tax)
    or (inv.status<>'draft' and s.n=0) then
    raise exception 'Invoice totals must reconcile to its items' using errcode='23514';
  end if;
  return null;
end $$;
create constraint trigger invoice_totals_check after insert or update on public.invoices
  deferrable initially deferred for each row execute function public.verify_invoice_totals();
create constraint trigger item_totals_check after insert or update or delete on public.invoice_items
  deferrable initially deferred for each row execute function public.verify_invoice_totals();

create function public.guard_invoice_cancellation() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='cancelled' and old.status='issued' and exists(select 1 from public.payments where invoice_id=old.id and status='posted') then
    raise exception 'Reverse receipts before cancellation' using errcode='23514';
  end if;
  return new;
end $$;
create trigger cancellation_balance_check before update on public.invoices for each row execute function public.guard_invoice_cancellation();

create function public.guard_entity_settings() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.numbering_mode,new.financial_year_start_month) is distinct from (old.numbering_mode,old.financial_year_start_month)
    and exists(select 1 from public.document_sequences where entity_id=old.id and next_number>1) then
    raise exception 'Numbering mode and financial year are fixed after first issuance. Use an administrator migration for a period transition.' using errcode='23514';
  end if;
  if new.default_invoice_template_id is not null and not exists(select 1 from public.document_templates where id=new.default_invoice_template_id and entity_id=new.id and document_type='invoice' and status='published') then
    raise exception 'Choose a published invoice template from this company' using errcode='23514';
  end if;
  if new.default_dc_template_id is not null and not exists(select 1 from public.document_templates where id=new.default_dc_template_id and entity_id=new.id and document_type='delivery_challan' and status='published') then
    raise exception 'Choose a published challan template from this company' using errcode='23514';
  end if;
  return new;
end $$;
create trigger settings_guard before update on public.billing_entities for each row execute function public.guard_entity_settings();

create function public.verify_export_scope() returns trigger language plpgsql set search_path='' as $$
begin
  if cardinality(new.entity_ids)<>(select count(distinct x) from unnest(new.entity_ids) x)
    or exists(select 1 from unnest(new.entity_ids) x where x is null or not exists(select 1 from public.billing_entities e where e.id=x and e.workspace_id=new.workspace_id)) then
    raise exception 'Export contains an invalid company selection' using errcode='23514';
  end if;
  return new;
end $$;
create trigger export_scope before insert or update on public.report_exports for each row execute function public.verify_export_scope();

-- Prefer a current seller/customer identity at issue while retaining explicitly saved bank overrides.
create function public.freeze_invoice_identity() returns trigger language plpgsql security definer set search_path='' as $$
declare seller public.billing_entities; buyer public.customers;
begin
  if old.status='draft' and new.status='issued' then
    select * into strict seller from public.billing_entities where id=new.entity_id;
    select * into strict buyer from public.customers where id=new.customer_id;
    new.seller_snapshot:=to_jsonb(seller)||coalesce(new.payment_details_snapshot,'{}');
    new.customer_snapshot:=to_jsonb(buyer);
    update public.invoice_items i set style_number_snapshot=s.style_number from public.styles s where i.invoice_id=new.id and i.style_id=s.id;
  end if;
  return new;
end $$;
-- Executes before document_guard, while item guards still observe the draft parent.
create trigger a_freeze_identity before update on public.invoices for each row execute function public.freeze_invoice_identity();

alter table public.invoice_items add constraint tax_modes_check check(
  (tax_mode_snapshot='none' and cgst_rate+sgst_rate+igst_rate+other_tax_rate=0)
  or (tax_mode_snapshot='intra_state' and igst_rate=0 and other_tax_rate=0)
  or (tax_mode_snapshot='inter_state' and cgst_rate=0 and sgst_rate=0 and other_tax_rate=0)
  or (tax_mode_snapshot='other' and cgst_rate=0 and sgst_rate=0 and igst_rate=0));

-- Scoped profile configuration remains available through a controlled operation.
create function public.save_tax_profile(p_entity uuid,p_profile jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid; result jsonb;
begin
  ws:=public.require_entity(p_entity,true);
  insert into public.tax_profiles(workspace_id,entity_id,name,tax_mode,cgst_rate,sgst_rate,igst_rate,other_tax_rate,created_by,updated_by)
    values(ws,p_entity,p_profile->>'name',p_profile->>'tax_mode',coalesce((p_profile->>'cgst_rate')::numeric,0),
      coalesce((p_profile->>'sgst_rate')::numeric,0),coalesce((p_profile->>'igst_rate')::numeric,0),
      coalesce((p_profile->>'other_tax_rate')::numeric,0),auth.uid(),auth.uid()) returning to_jsonb(tax_profiles.*) into result;
  return result;
end $$;

revoke all on function public.workspace_documents(integer),public.save_tax_profile(uuid,jsonb) from public,anon;
grant execute on function public.workspace_documents(integer),public.save_tax_profile(uuid,jsonb) to authenticated;
revoke all on function public.verify_invoice_totals(),public.guard_invoice_cancellation(),public.guard_entity_settings(),public.verify_export_scope(),public.freeze_invoice_identity() from public,anon,authenticated;
