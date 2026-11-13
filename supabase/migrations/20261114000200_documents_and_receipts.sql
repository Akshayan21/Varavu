create domain public.billing_money as numeric(18,2) check(value not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

create table public.document_sequences (
  workspace_id uuid not null,entity_id uuid not null,document_type text not null check(document_type in ('invoice','delivery_challan')),
  period_key text not null,period_start date,period_end date,next_number bigint not null default 1 check(next_number>0),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,entity_id,document_type,period_key),
  foreign key(workspace_id,entity_id) references public.billing_entities(workspace_id,id),
  check((period_key='CONTINUOUS' and period_start is null and period_end is null)
    or (period_key<>'CONTINUOUS' and period_start is not null and period_end>=period_start))
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null,entity_id uuid not null,customer_id uuid not null,
  status text not null default 'draft' check(status in ('draft','issued','cancelled')),
  document_number text,period_key text,sequence_number bigint,number_prefix_snapshot text,
  numbering_mode_snapshot text,period_start_snapshot date,period_end_snapshot date,
  invoice_date date not null,due_date date not null check(due_date>=invoice_date),issued_at timestamptz,issued_by uuid references auth.users(id),
  reference_number text,replacement_for_invoice_id uuid,currency text not null default 'INR' check(currency='INR'),
  subtotal public.billing_money not null default 0 check(subtotal>=0),line_adjustment_total public.billing_money not null default 0,
  line_discount_total public.billing_money not null default 0 check(line_discount_total>=0),
  invoice_discount_total public.billing_money not null default 0 check(invoice_discount_total>=0),
  taxable_total public.billing_money not null default 0 check(taxable_total>=0),
  cgst_total public.billing_money not null default 0 check(cgst_total>=0),sgst_total public.billing_money not null default 0 check(sgst_total>=0),
  igst_total public.billing_money not null default 0 check(igst_total>=0),other_tax_total public.billing_money not null default 0 check(other_tax_total>=0),
  tax_total public.billing_money not null default 0 check(tax_total>=0),round_off public.billing_money not null default 0,
  grand_total public.billing_money not null default 0 check(grand_total>=0),
  calculation_version text not null default 'line-v1',rounding_increment_snapshot numeric(18,2) not null default 0 check(rounding_increment_snapshot in (0,0.01,1)),
  place_of_supply_state_code text,tax_treatment text,
  notes text,terms text,internal_memo text,shipping_details jsonb,
  seller_snapshot jsonb,customer_snapshot jsonb,payment_details_snapshot jsonb,
  template_id uuid,template_snapshot jsonb,snapshot_schema_version integer not null default 1,renderer_version text,
  cancelled_at timestamptz,cancelled_by uuid references auth.users(id),cancel_reason text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version bigint not null default 1,
  created_by uuid references auth.users(id),updated_by uuid references auth.users(id),
  import_source text,import_external_id text,
  foreign key(workspace_id,entity_id) references public.billing_entities(workspace_id,id),
  foreign key(workspace_id,entity_id,customer_id) references public.customers(workspace_id,entity_id,id),
  foreign key(workspace_id,entity_id,template_id) references public.document_templates(workspace_id,entity_id,id),
  unique(workspace_id,entity_id,id),unique(workspace_id,entity_id,customer_id,id),
  unique(workspace_id,entity_id,document_number),unique(workspace_id,entity_id,period_key,sequence_number),
  foreign key(workspace_id,entity_id,replacement_for_invoice_id) references public.invoices(workspace_id,entity_id,id),
  check(replacement_for_invoice_id is distinct from id),
  check((import_source is null)=(import_external_id is null)),
  check(tax_total=cgst_total+sgst_total+igst_total+other_tax_total),
  check(taxable_total=subtotal+line_adjustment_total-line_discount_total-invoice_discount_total),
  check(grand_total=taxable_total+tax_total+round_off),
  check(abs(round_off)<=rounding_increment_snapshot/2),
  check((status='draft' and document_number is null and issued_at is null and issued_by is null)
    or (status<>'draft' and document_number is not null and issued_at is not null and issued_by is not null
      and sequence_number>0 and period_key is not null and seller_snapshot is not null and customer_snapshot is not null
      and payment_details_snapshot is not null and template_id is not null and template_snapshot is not null and renderer_version is not null)),
  check((status='cancelled' and cancelled_at>=issued_at and cancelled_by is not null and length(btrim(cancel_reason))>0)
    or (status<>'cancelled' and cancelled_at is null and cancelled_by is null and cancel_reason is null))
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null,entity_id uuid not null,invoice_id uuid not null,
  sort_order integer not null check(sort_order>0),style_id uuid,style_number_snapshot text,
  print_type_id uuid,placement_id uuid,unit_id uuid,
  print_type_snapshot text,placement_snapshot text,unit_snapshot text,placement_detail text,
  particulars text not null check(length(btrim(particulars)) between 1 and 300),hsn_sac_code text,
  quantity numeric(12,3) not null check(quantity>0 and quantity<1000000),
  unit_rate numeric(18,4) not null check(unit_rate>=0 and unit_rate<100000000),
  gross_amount public.billing_money not null check(gross_amount>=0),
  line_adjustment_amount public.billing_money not null default 0,line_adjustment_reason text,
  line_discount_amount public.billing_money not null default 0 check(line_discount_amount>=0),
  invoice_discount_share public.billing_money not null default 0 check(invoice_discount_share>=0),
  taxable_amount public.billing_money not null check(taxable_amount>=0),
  tax_profile_id uuid,tax_mode_snapshot text not null default 'none' check(tax_mode_snapshot in ('none','intra_state','inter_state','other')),
  cgst_rate numeric(7,4) not null default 0 check(cgst_rate between 0 and 100),
  sgst_rate numeric(7,4) not null default 0 check(sgst_rate between 0 and 100),
  igst_rate numeric(7,4) not null default 0 check(igst_rate between 0 and 100),
  other_tax_rate numeric(7,4) not null default 0 check(other_tax_rate between 0 and 100),
  cgst_amount public.billing_money not null default 0,sgst_amount public.billing_money not null default 0,
  igst_amount public.billing_money not null default 0,other_tax_amount public.billing_money not null default 0,
  tax_amount public.billing_money not null default 0,line_total public.billing_money not null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(workspace_id,entity_id,invoice_id) references public.invoices(workspace_id,entity_id,id),
  foreign key(workspace_id,entity_id,style_id) references public.styles(workspace_id,entity_id,id),
  foreign key(workspace_id,entity_id,print_type_id) references public.print_types(workspace_id,entity_id,id),
  foreign key(workspace_id,entity_id,placement_id) references public.placements(workspace_id,entity_id,id),
  foreign key(workspace_id,entity_id,unit_id) references public.units(workspace_id,entity_id,id),
  foreign key(workspace_id,entity_id,tax_profile_id) references public.tax_profiles(workspace_id,entity_id,id),
  unique(invoice_id,sort_order),
  check((style_id is null)=(style_number_snapshot is null)),
  check(line_adjustment_amount=0 or coalesce(length(btrim(line_adjustment_reason)),0)>0),
  check(gross_amount=round(quantity*unit_rate,2)),
  check(taxable_amount=gross_amount+line_adjustment_amount-line_discount_amount-invoice_discount_share),
  check(cgst_rate+sgst_rate+igst_rate+other_tax_rate<=100),
  check(cgst_amount=round(taxable_amount*cgst_rate/100,2) and sgst_amount=round(taxable_amount*sgst_rate/100,2)
    and igst_amount=round(taxable_amount*igst_rate/100,2) and other_tax_amount=round(taxable_amount*other_tax_rate/100,2)),
  check(tax_amount=cgst_amount+sgst_amount+igst_amount+other_tax_amount),check(line_total=taxable_amount+tax_amount)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null,entity_id uuid not null,invoice_id uuid not null,
  payment_date date not null,amount public.billing_money not null check(amount>0),currency text not null default 'INR' check(currency='INR'),
  method text not null check(method in ('bank_transfer','upi','cash','cheque','other')),reference_number text,notes text,
  status text not null default 'posted' check(status in ('posted','reversed')),
  posted_at timestamptz not null default now(),posted_by uuid not null references auth.users(id),
  reversed_at timestamptz,reversed_by uuid references auth.users(id),reversal_reason text,
  import_source text,import_external_id text,
  foreign key(workspace_id,entity_id,invoice_id) references public.invoices(workspace_id,entity_id,id),
  unique(workspace_id,entity_id,id),
  check((import_source is null)=(import_external_id is null)),
  check((status='posted' and reversed_at is null and reversed_by is null and reversal_reason is null)
    or (status='reversed' and reversed_at>=posted_at and reversed_by is not null and length(btrim(reversal_reason))>0))
);

create table public.delivery_challans (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null,entity_id uuid not null,customer_id uuid,
  recipient_name text not null check(length(btrim(recipient_name)) between 1 and 200),
  status text not null default 'draft' check(status in ('draft','issued','cancelled')),
  document_number text,period_key text,sequence_number bigint,number_prefix_snapshot text,numbering_mode_snapshot text,
  period_start_snapshot date,period_end_snapshot date,dc_date date not null,related_invoice_id uuid,
  from_address jsonb not null,to_address jsonb not null,sender_snapshot jsonb,recipient_snapshot jsonb,
  template_id uuid,template_snapshot jsonb,snapshot_schema_version integer not null default 1,renderer_version text,notes text,
  issued_at timestamptz,issued_by uuid references auth.users(id),cancelled_at timestamptz,cancelled_by uuid references auth.users(id),cancel_reason text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version bigint not null default 1,
  created_by uuid references auth.users(id),updated_by uuid references auth.users(id),import_source text,import_external_id text,
  foreign key(workspace_id,entity_id) references public.billing_entities(workspace_id,id),
  foreign key(workspace_id,entity_id,customer_id) references public.customers(workspace_id,entity_id,id),
  foreign key(workspace_id,entity_id,customer_id,related_invoice_id) references public.invoices(workspace_id,entity_id,customer_id,id),
  foreign key(workspace_id,entity_id,template_id) references public.document_templates(workspace_id,entity_id,id),
  unique(workspace_id,entity_id,id),unique(workspace_id,entity_id,document_number),
  unique(workspace_id,entity_id,period_key,sequence_number),
  check(related_invoice_id is null or customer_id is not null),
  check((import_source is null)=(import_external_id is null)),
  check((status='draft' and document_number is null and issued_at is null and issued_by is null)
    or (status<>'draft' and document_number is not null and sequence_number>0 and issued_at is not null and issued_by is not null
      and sender_snapshot is not null and recipient_snapshot is not null and template_snapshot is not null and template_id is not null)),
  check((status='cancelled' and cancelled_at>=issued_at and cancelled_by is not null and length(btrim(cancel_reason))>0)
    or (status<>'cancelled' and cancelled_at is null and cancelled_by is null and cancel_reason is null))
);

create table public.dc_items (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null,entity_id uuid not null,dc_id uuid not null,
  sort_order integer not null check(sort_order>0),particulars text not null check(length(btrim(particulars)) between 1 and 300),
  quantity numeric(12,3) not null check(quantity>0 and quantity<1000000),unit_id uuid not null,unit_snapshot text not null,remarks text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(workspace_id,entity_id,dc_id) references public.delivery_challans(workspace_id,entity_id,id),
  foreign key(workspace_id,entity_id,unit_id) references public.units(workspace_id,entity_id,id),unique(dc_id,sort_order)
);

create table public.delivery_acknowledgements (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null,entity_id uuid not null,dc_id uuid not null unique,
  received_by text,received_at timestamptz not null,signature_path text,notes text,
  recorded_at timestamptz not null default now(),recorded_by uuid not null references auth.users(id),
  foreign key(workspace_id,entity_id,dc_id) references public.delivery_challans(workspace_id,entity_id,id),
  check(coalesce(length(btrim(received_by)),0)>0 or signature_path is not null)
);

create table public.document_files (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null,entity_id uuid not null,invoice_id uuid,dc_id uuid,
  template_id uuid not null,document_revision integer not null default 1 check(document_revision>0),
  variant text not null check(variant in ('original','cancelled')),status text not null default 'pending' check(status in ('pending','processing','ready','failed')),
  bucket_id text not null default 'invoice-pdfs',object_path text,sha256 text,mime_type text not null default 'application/pdf',byte_size bigint,
  attempt_count integer not null default 0,last_error text,lease_expires_at timestamptz,claim_token uuid,next_attempt_at timestamptz not null default now(),
  generated_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(workspace_id,entity_id,invoice_id) references public.invoices(workspace_id,entity_id,id),
  foreign key(workspace_id,entity_id,dc_id) references public.delivery_challans(workspace_id,entity_id,id),
  foreign key(workspace_id,entity_id,template_id) references public.document_templates(workspace_id,entity_id,id),
  check(num_nonnulls(invoice_id,dc_id)=1),
  check(status<>'ready' or (object_path is not null and sha256 is not null and byte_size>0 and generated_at is not null))
);
create unique index invoice_pdf_key on public.document_files(invoice_id,document_revision,variant) where invoice_id is not null;
create unique index dc_pdf_key on public.document_files(dc_id,document_revision,variant) where dc_id is not null;

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),requested_by uuid not null references auth.users(id),
  report_type text not null check(report_type in ('billing','collections','outstanding','customers','monthly','print-type','challans','cancelled','companies')),
  entity_ids uuid[] not null check(cardinality(entity_ids)>0),filters_json jsonb not null,
  as_of_date date not null,recorded_through timestamptz not null,business_timezone text not null,
  report_definition_version text not null default 'v1',title_snapshot text not null,entity_names_snapshot jsonb not null,
  format text not null check(format in ('pdf','csv')),status text not null default 'pending' check(status in ('pending','processing','ready','failed','expired')),
  bucket_id text not null default 'report-exports',object_path text,sha256 text,byte_size bigint,
  attempt_count integer not null default 0,lease_expires_at timestamptz,claim_token uuid,next_attempt_at timestamptz not null default now(),last_error text,
  generated_at timestamptz,expires_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(status<>'ready' or (object_path is not null and sha256 is not null and byte_size>0 and generated_at is not null))
);

create table public.idempotency_keys (
  workspace_id uuid not null references public.workspaces(id),actor_user_id uuid not null references auth.users(id),
  operation text not null,key text not null check(length(key) between 1 and 200),request_hash text not null,
  resource_id uuid,response_json jsonb,created_at timestamptz not null default now(),expires_at timestamptz,
  primary key(workspace_id,actor_user_id,operation,key)
);

create table public.user_preferences (
  workspace_id uuid not null references public.workspaces(id),user_id uuid not null references auth.users(id),last_entity_id uuid,
  skip_entity_selector boolean not null default false,preferences_json jsonb not null default '{}' check(jsonb_typeof(preferences_json)='object'),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),primary key(workspace_id,user_id),
  foreign key(workspace_id,last_entity_id) references public.billing_entities(workspace_id,id)
);

create unique index invoices_import_key on public.invoices(workspace_id,entity_id,import_source,import_external_id) where import_source is not null;
create unique index payments_import_key on public.payments(workspace_id,entity_id,import_source,import_external_id) where import_source is not null;
create unique index challans_import_key on public.delivery_challans(workspace_id,entity_id,import_source,import_external_id) where import_source is not null;
create index invoices_date_idx on public.invoices(workspace_id,entity_id,invoice_date desc,id);
create index invoices_customer_idx on public.invoices(workspace_id,entity_id,customer_id,invoice_date desc);
create index invoices_due_idx on public.invoices(workspace_id,entity_id,due_date) where status='issued';
create index items_style_idx on public.invoice_items(workspace_id,entity_id,style_id);
create index payments_invoice_idx on public.payments(invoice_id,payment_date,posted_at);
create index payments_date_idx on public.payments(workspace_id,entity_id,payment_date,id);
create index challans_date_idx on public.delivery_challans(workspace_id,entity_id,dc_date desc,id);
create index challans_invoice_idx on public.delivery_challans(related_invoice_id);
create index files_pending_idx on public.document_files(next_attempt_at,created_at) where status in ('pending','failed');
create index files_lease_idx on public.document_files(lease_expires_at) where status='processing';
create index exports_pending_idx on public.report_exports(next_attempt_at,created_at) where status in ('pending','failed');

create function public.guard_document() returns trigger language plpgsql set search_path='' as $$
declare previous jsonb; current_row jsonb; item_count integer;
begin
  if tg_op='DELETE' then
    if old.status<>'draft' then raise exception 'Issued documents cannot be deleted' using errcode='23514'; end if;
    return old;
  end if;
  if tg_op='UPDATE' then
    if new.workspace_id<>old.workspace_id or new.entity_id<>old.entity_id then raise exception 'Document scope is immutable' using errcode='23514'; end if;
    if old.status<>'draft' then
      previous:=to_jsonb(old)-array['status','cancelled_at','cancelled_by','cancel_reason','updated_at','updated_by','version'];
      current_row:=to_jsonb(new)-array['status','cancelled_at','cancelled_by','cancel_reason','updated_at','updated_by','version'];
      if previous<>current_row or old.status='cancelled' or new.status<>'cancelled' then
        raise exception 'Issued document contents are immutable' using errcode='23514';
      end if;
    elsif new.status='cancelled' then raise exception 'Issue the draft before cancellation' using errcode='23514'; end if;
  end if;
  if new.status='issued' and (tg_op='INSERT' or old.status='draft') then
    if tg_table_name='invoices' then select count(*) into item_count from public.invoice_items where invoice_id=new.id;
    else select count(*) into item_count from public.dc_items where dc_id=new.id; end if;
    if item_count=0 then raise exception 'Add at least one item before issuing' using errcode='23514'; end if;
  end if;
  return new;
end $$;

create function public.guard_item() returns trigger language plpgsql security definer set search_path='' as $$
declare parent_status text; rowdata jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  if tg_op='UPDATE' and ((to_jsonb(new)->>'invoice_id') is distinct from (to_jsonb(old)->>'invoice_id')
    or (to_jsonb(new)->>'dc_id') is distinct from (to_jsonb(old)->>'dc_id')) then
    raise exception 'Item parent is immutable' using errcode='23514';
  end if;
  if tg_table_name='invoice_items' then
    select status into parent_status from public.invoices where id=(rowdata->>'invoice_id')::uuid for update;
  else select status into parent_status from public.delivery_challans where id=(rowdata->>'dc_id')::uuid for update; end if;
  if parent_status is distinct from 'draft' then raise exception 'Only draft items may be changed' using errcode='23514'; end if;
  return coalesce(new,old);
end $$;

create function public.guard_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare inv public.invoices; paid numeric;
begin
  if tg_op='DELETE' then raise exception 'Receipts cannot be deleted' using errcode='23514'; end if;
  select * into strict inv from public.invoices where id=new.invoice_id for update;
  if tg_op='UPDATE' then
    if old.status<>'posted' or new.status<>'reversed' or
      to_jsonb(old)-array['status','reversed_at','reversed_by','reversal_reason'] <>
      to_jsonb(new)-array['status','reversed_at','reversed_by','reversal_reason'] then
      raise exception 'Reverse the original receipt to correct it' using errcode='23514';
    end if;
  else
    select coalesce(sum(amount),0) into paid from public.payments where invoice_id=inv.id and status='posted';
    if inv.status<>'issued' or new.currency<>inv.currency or new.payment_date<inv.invoice_date or new.amount>inv.grand_total-paid then
      raise exception 'Receipt exceeds balance or invoice is ineligible' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger payment_guard before insert or update or delete on public.payments for each row execute function public.guard_payment();

create function public.guard_catalog_history() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Archive catalog records instead of deleting' using errcode='23514'; end if;
  if tg_table_name='document_templates' and old.status='published' then raise exception 'Published templates are immutable' using errcode='23514'; end if;
  if tg_table_name='styles' and (to_jsonb(new)->>'style_number')<>(to_jsonb(old)->>'style_number') and exists(
    select 1 from public.invoice_items i join public.invoices b on b.id=i.invoice_id where i.style_id=old.id and b.status<>'draft'
  ) then raise exception 'Issued style numbers are immutable' using errcode='23514'; end if;
  return new;
end $$;

do $$
declare tab text;
begin
  foreach tab in array array['invoices','delivery_challans'] loop
    execute format('create trigger document_guard before insert or update or delete on public.%I for each row execute function public.guard_document()',tab);
    execute format('create trigger metadata before insert or update on public.%I for each row execute function public.touch_record()',tab);
  end loop;
  foreach tab in array array['invoice_items','dc_items'] loop
    execute format('create trigger item_guard before insert or update or delete on public.%I for each row execute function public.guard_item()',tab);
  end loop;
  foreach tab in array array['styles','document_templates'] loop
    execute format('create trigger history_guard before update or delete on public.%I for each row execute function public.guard_catalog_history()',tab);
  end loop;
  foreach tab in array array['invoices','delivery_challans','payments','delivery_acknowledgements','document_templates'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_record()',tab);
  end loop;
  foreach tab in array array['document_sequences','invoices','invoice_items','payments','delivery_challans','dc_items','delivery_acknowledgements','document_files','report_exports','idempotency_keys','user_preferences'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    execute format('grant select on public.%I to authenticated',tab);
    execute format('create policy owner_read on public.%I for select to authenticated using(workspace_id in(select id from public.workspaces where owner_user_id=(select auth.uid())))',tab);
  end loop;
end $$;
revoke all on function public.guard_document(),public.guard_item(),public.guard_payment(),public.guard_catalog_history() from public,anon,authenticated;
