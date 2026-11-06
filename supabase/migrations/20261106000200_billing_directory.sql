create table public.billing_entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  entity_code text not null check (entity_code ~ '^[A-Z0-9_-]{1,24}$'),
  legal_name text not null check (length(trim(legal_name)) between 1 and 200),
  display_name text,
  billing_address jsonb not null default '{}',
  email text,
  phone text,
  gst_registered boolean not null default false,
  gstin text,
  pan text,
  state_code text,
  bank_details jsonb not null default '{}',
  upi_id text,
  payment_instructions text,
  invoice_prefix text,
  default_due_days integer not null default 30 check (default_due_days between 0 and 365),
  financial_year_start_month integer not null default 4 check (financial_year_start_month between 1 and 12),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, entity_code),
  check (not gst_registered or coalesce(length(trim(gstin)), 0) = 15)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  legal_name text not null check (length(trim(legal_name)) between 1 and 200),
  display_name text,
  billing_address jsonb not null default '{}',
  shipping_address jsonb,
  contact_name text,
  email text,
  phone text,
  gstin text,
  state_code text,
  country text,
  payment_terms_days integer check (payment_terms_days between 0 and 365),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_workspace_name_idx on public.customers (workspace_id, legal_name, id);

create function public.update_directory_timestamp() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger billing_entities_updated before update on public.billing_entities
for each row execute function public.update_directory_timestamp();
create trigger customers_updated before update on public.customers
for each row execute function public.update_directory_timestamp();

alter table public.billing_entities enable row level security;
alter table public.customers enable row level security;
revoke all on public.billing_entities, public.customers from public, anon, authenticated;
grant select on public.billing_entities, public.customers to authenticated;
grant insert (workspace_id, entity_code, legal_name, display_name, billing_address, email, phone, gst_registered,
  gstin, pan, state_code, bank_details, upi_id, payment_instructions, invoice_prefix, default_due_days,
  financial_year_start_month, is_active) on public.billing_entities to authenticated;
grant update (entity_code, legal_name, display_name, billing_address, email, phone, gst_registered, gstin, pan,
  state_code, bank_details, upi_id, payment_instructions, invoice_prefix, default_due_days,
  financial_year_start_month, is_active) on public.billing_entities to authenticated;
grant insert (workspace_id, legal_name, display_name, billing_address, shipping_address, contact_name, email,
  phone, gstin, state_code, country, payment_terms_days, notes, is_active) on public.customers to authenticated;
grant update (legal_name, display_name, billing_address, shipping_address, contact_name, email, phone, gstin,
  state_code, country, payment_terms_days, notes, is_active) on public.customers to authenticated;

create policy billing_entities_owner on public.billing_entities for all to authenticated
using (workspace_id in (select id from public.workspaces where owner_user_id = (select auth.uid())))
with check (workspace_id in (select id from public.workspaces where owner_user_id = (select auth.uid())));

create policy customers_owner on public.customers for all to authenticated
using (workspace_id in (select id from public.workspaces where owner_user_id = (select auth.uid())))
with check (workspace_id in (select id from public.workspaces where owner_user_id = (select auth.uid())));
