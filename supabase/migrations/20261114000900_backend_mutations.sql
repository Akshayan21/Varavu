create function public.delete_challan_draft(p_entity uuid,p_id uuid,p_version bigint) returns void
language plpgsql security definer set search_path='' as $$
declare ws uuid; d public.delivery_challans;
begin
  ws:=public.require_entity(p_entity);
  select * into strict d from public.delivery_challans where id=p_id and entity_id=p_entity and workspace_id=ws for update;
  if d.status<>'draft' or d.version<>p_version then raise exception 'Draft changed or already issued' using errcode='40001'; end if;
  delete from public.dc_items where dc_id=p_id;
  delete from public.delivery_challans where id=p_id;
end $$;

create function public.duplicate_invoice(p_entity uuid,p_id uuid,p_new_id uuid,p_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid; source public.invoices; payload jsonb; lines jsonb; result jsonb;
begin
  ws:=public.require_entity(p_entity,true);
  select * into strict source from public.invoices where id=p_id and entity_id=p_entity and workspace_id=ws for share;
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',i.sort_order,'description',i.particulars,
    'quantity',i.quantity::text,'rate',i.unit_rate::text,'style',i.style_number_snapshot,'printType',i.print_type_snapshot,
    'placement',i.placement_snapshot,'unitCode',u.code,'placementDetail',i.placement_detail,'hsnSacCode',i.hsn_sac_code,
    'discountCents',i.line_discount_amount*100,'adjustmentCents',i.line_adjustment_amount*100,'adjustmentReason',i.line_adjustment_reason,
    'taxProfileId',i.tax_profile_id)) order by i.sort_order) into lines
    from public.invoice_items i join public.units u on u.id=i.unit_id where i.invoice_id=p_id;
  payload:=jsonb_strip_nulls(jsonb_build_object('id',p_new_id,'customerId',source.customer_id,'date',p_date,
    'due',p_date+greatest(source.due_date-source.invoice_date,0),'reference',source.reference_number,'notes',source.notes,'terms',source.terms,
    'discountCents',source.invoice_discount_total*100,'lines',lines));
  if not exists(select 1 from public.invoice_items where invoice_id=p_id and tax_profile_id is not null) then
    payload:=payload||jsonb_build_object('taxBasisPoints',coalesce((select max(other_tax_rate)*100 from public.invoice_items where invoice_id=p_id),0));
  end if;
  result:=public.save_invoice_draft(p_entity,payload);
  return result;
end $$;

create function public.update_workspace(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws public.workspaces;
begin
  select * into strict ws from public.workspaces where owner_user_id=auth.uid() for update;
  if (p_data ? 'timezone') and not exists(select 1 from pg_timezone_names where name=p_data->>'timezone') then
    raise exception 'Unknown timezone' using errcode='23514';
  end if;
  if (p_data ? 'name') and coalesce(length(btrim(p_data->>'name')),0) not between 1 and 200 then raise exception 'Enter a workspace name' using errcode='23514'; end if;
  update public.workspaces set name=coalesce(btrim(p_data->>'name'),name),timezone=coalesce(p_data->>'timezone',timezone),updated_at=now()
    where id=ws.id returning * into ws;
  insert into public.audit_logs(workspace_id,actor_user_id,action,resource_type,resource_id,metadata_json)
    values(ws.id,auth.uid(),'settings_updated','workspaces',ws.id,p_data);
  return to_jsonb(ws);
end $$;

create function public.configure_catalog(p_entity uuid,p_table text,p_id uuid,p_version bigint,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid; result jsonb; oldrow jsonb; record_id uuid:=coalesce(p_id,gen_random_uuid());
begin
  ws:=public.require_entity(p_entity,true);
  if p_table not in ('styles','print_types','placements','units','tax_profiles') then raise exception 'Unknown catalog' using errcode='23514'; end if;
  if p_id is not null then
    execute format('select to_jsonb(r) from public.%I r where id=$1 and workspace_id=$2 and entity_id=$3 for update',p_table)
      into oldrow using p_id,ws,p_entity;
    if oldrow is null then raise exception 'Catalog record not found' using errcode='P0002'; end if;
    if p_version is null or p_version<>(oldrow->>'version')::bigint then raise exception 'Catalog record changed. Reload it.' using errcode='40001'; end if;
  end if;
  if p_table='styles' then
    if p_id is null then raise exception 'Use style resolution to create a style' using errcode='23514'; end if;
    update public.styles set
      name=case when p_data ? 'name' then p_data->>'name' else name end,
      description=case when p_data ? 'description' then p_data->>'description' else description end,
      default_print_type_id=case when p_data ? 'defaultPrintTypeId' then (p_data->>'defaultPrintTypeId')::uuid else default_print_type_id end,
      default_placement_id=case when p_data ? 'defaultPlacementId' then (p_data->>'defaultPlacementId')::uuid else default_placement_id end,
      default_unit_id=case when p_data ? 'defaultUnitId' then (p_data->>'defaultUnitId')::uuid else default_unit_id end,
      is_active=coalesce((p_data->>'is_active')::boolean,is_active) where id=p_id returning to_jsonb(styles.*) into result;
  elsif p_table='tax_profiles' then
    if p_id is null then
      insert into public.tax_profiles(id,workspace_id,entity_id,name,tax_mode,cgst_rate,sgst_rate,igst_rate,other_tax_rate)
        values(record_id,ws,p_entity,p_data->>'name',p_data->>'tax_mode',coalesce((p_data->>'cgst_rate')::numeric,0),
        coalesce((p_data->>'sgst_rate')::numeric,0),coalesce((p_data->>'igst_rate')::numeric,0),coalesce((p_data->>'other_tax_rate')::numeric,0))
        returning to_jsonb(tax_profiles.*) into result;
    else
      update public.tax_profiles set name=coalesce(p_data->>'name',name),tax_mode=coalesce(p_data->>'tax_mode',tax_mode),
        cgst_rate=coalesce((p_data->>'cgst_rate')::numeric,cgst_rate),sgst_rate=coalesce((p_data->>'sgst_rate')::numeric,sgst_rate),
        igst_rate=coalesce((p_data->>'igst_rate')::numeric,igst_rate),other_tax_rate=coalesce((p_data->>'other_tax_rate')::numeric,other_tax_rate),
        is_active=coalesce((p_data->>'is_active')::boolean,is_active) where id=p_id returning to_jsonb(tax_profiles.*) into result;
    end if;
  elsif p_id is null then
    execute format('insert into public.%I(id,workspace_id,entity_id,code,label,sort_order) values($1,$2,$3,$4,$5,$6) returning to_jsonb(%I.*)',p_table,p_table)
      into result using record_id,ws,p_entity,upper(btrim(p_data->>'code')),btrim(p_data->>'label'),coalesce((p_data->>'sort_order')::integer,0);
  else
    execute format('update public.%I set label=coalesce($1,label),is_active=coalesce($2,is_active),sort_order=coalesce($3,sort_order) where id=$4 returning to_jsonb(%I.*)',p_table,p_table)
      into result using p_data->>'label',(p_data->>'is_active')::boolean,(p_data->>'sort_order')::integer,p_id;
  end if;
  return result;
end $$;

create function public.configure_entity(p_entity uuid,p_version bigint,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid; e public.billing_entities;
begin
  ws:=public.require_entity(p_entity,true);
  select * into strict e from public.billing_entities where id=p_entity for update;
  if e.version<>p_version then raise exception 'Company settings changed' using errcode='40001'; end if;
  update public.billing_entities set
    default_tax_profile_id=case when p_data ? 'defaultTaxProfileId' then (p_data->>'defaultTaxProfileId')::uuid else default_tax_profile_id end,
    default_invoice_template_id=case when p_data ? 'defaultInvoiceTemplateId' then (p_data->>'defaultInvoiceTemplateId')::uuid else default_invoice_template_id end,
    default_dc_template_id=case when p_data ? 'defaultDcTemplateId' then (p_data->>'defaultDcTemplateId')::uuid else default_dc_template_id end,
    rounding_increment=coalesce((p_data->>'roundingIncrement')::numeric,rounding_increment),
    default_terms=case when p_data ? 'defaultTerms' then p_data->>'defaultTerms' else default_terms end
    where id=p_entity returning * into e;
  if e.default_tax_profile_id is not null and not exists(select 1 from public.tax_profiles where id=e.default_tax_profile_id and is_active) then
    raise exception 'Default tax profile is archived' using errcode='23514';
  end if;
  return to_jsonb(e);
end $$;

-- Validate monetary precision before casts into scale-constrained table columns.
alter function public.save_invoice_draft(uuid,jsonb) rename to save_invoice_draft_versioned;
revoke all on function public.save_invoice_draft_versioned(uuid,jsonb) from public,anon,authenticated;
create function public.save_invoice_draft(p_entity uuid,p_bill jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; key text; amount numeric; result jsonb; bid uuid:=(p_bill->>'id')::uuid;
begin
  perform public.require_entity(p_entity,true);
  if jsonb_typeof(p_bill->'lines') is distinct from 'array' or jsonb_array_length(p_bill->'lines') not between 1 and 100 then
    raise exception 'Add between 1 and 100 items' using errcode='23514';
  end if;
  if (p_bill ? 'taxBasisPoints') and ((p_bill->>'taxBasisPoints')::numeric<>trunc((p_bill->>'taxBasisPoints')::numeric)
    or (p_bill->>'taxBasisPoints')::numeric not between 0 and 10000) then raise exception 'Invalid tax rate precision' using errcode='23514'; end if;
  for item in select value from jsonb_array_elements(p_bill->'lines') loop
    foreach key in array array['discountCents','adjustmentCents'] loop
      if item ? key then
        amount:=(item->>key)::numeric;
        if amount is null or amount<>trunc(amount) or amount not between -9007199254740991 and 9007199254740991 then
          raise exception 'Use integer paise for adjustments and discounts' using errcode='23514';
        end if;
      end if;
    end loop;
    if nullif(item->>'taxProfileId','') is not null and p_bill ? 'taxBasisPoints' then
      raise exception 'Choose either per-line tax profiles or a bill-wide tax rate' using errcode='23514';
    end if;
  end loop;
  result:=public.save_invoice_draft_versioned(p_entity,p_bill);
  -- Updating only drafts also ensures an issuance retry never modifies issued snapshots.
  if exists(select 1 from public.invoices where id=bid and status='draft') then
    update public.invoices set place_of_supply_state_code=p_bill->>'placeOfSupplyStateCode',tax_treatment=p_bill->>'taxTreatment'
      where id=bid;
    update public.invoice_items i set hsn_sac_code=x.value->>'hsnSacCode'
      from jsonb_array_elements(p_bill->'lines') with ordinality x(value,n) where i.invoice_id=bid and i.sort_order=x.n;
    result:=public.invoice_payload(bid);
  end if;
  return result;
end $$;

-- Publication timestamps and acknowledgements are immutable evidence.
create or replace function public.guard_catalog_history() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Archive catalog records instead of deleting' using errcode='23514'; end if;
  if tg_table_name='document_templates' then
    if old.status='published' then raise exception 'Published templates are immutable' using errcode='23514'; end if;
  elsif tg_table_name='styles' then
    if new.style_number<>old.style_number and exists(select 1 from public.invoice_items i join public.invoices b on b.id=i.invoice_id
      where i.style_id=old.id and b.status<>'draft') then raise exception 'Issued style numbers are immutable' using errcode='23514'; end if;
  end if;
  return new;
end $$;

create function public.guard_append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Historical evidence cannot be changed or deleted' using errcode='23514'; end $$;
create trigger audit_append_only before update or delete on public.audit_logs for each row execute function public.guard_append_only();
create trigger acknowledgement_append_only before update or delete on public.delivery_acknowledgements for each row execute function public.guard_append_only();

do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('delete_challan_draft','duplicate_invoice','update_workspace','configure_catalog','configure_entity','save_invoice_draft') loop
    execute format('revoke all on function %s from public,anon',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
revoke all on function public.guard_append_only() from public,anon,authenticated;

create function public.preview_invoice(p_entity uuid,p_bill jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  -- Exception subtransactions undo every catalog/draft/audit write while retaining local variables.
  begin
    result:=public.save_invoice_draft(p_entity,p_bill);
    raise exception using errcode='ZP001',message='Preview complete';
  exception when sqlstate 'ZP001' then null;
  end;
  return result;
end $$;
revoke all on function public.preview_invoice(uuid,jsonb) from public,anon;
grant execute on function public.preview_invoice(uuid,jsonb) to authenticated;

create function public.archive_directory_record(p_entity uuid,p_table text,p_id uuid,p_version bigint,p_active boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid; result jsonb; current_version bigint;
begin
  ws:=public.require_entity(p_entity);
  if p_table='billing_entities' and p_id=p_entity then
    select version into current_version from public.billing_entities where id=p_id and workspace_id=ws for update;
    if current_version is distinct from p_version then raise exception 'Company changed. Reload it.' using errcode='40001'; end if;
    update public.billing_entities set is_active=p_active where id=p_id returning to_jsonb(billing_entities.*) into result;
  elsif p_table='customers' then
    select version into current_version from public.customers where id=p_id and workspace_id=ws and entity_id=p_entity for update;
    if current_version is null then raise exception 'Customer not found' using errcode='P0002'; end if;
    if current_version<>p_version then raise exception 'Customer changed. Reload it.' using errcode='40001'; end if;
    update public.customers set is_active=p_active where id=p_id returning to_jsonb(customers.*) into result;
  else raise exception 'Invalid directory operation' using errcode='23514'; end if;
  return result;
end $$;
revoke all on function public.archive_directory_record(uuid,text,uuid,bigint,boolean) from public,anon;
grant execute on function public.archive_directory_record(uuid,text,uuid,bigint,boolean) to authenticated;
