alter table public.customers add column if not exists contact_phone text;
grant insert (contact_phone), update (contact_phone) on public.customers to authenticated;
