alter table public.billing_entities add unique (workspace_id, id);
alter table public.customers add column entity_id uuid;
alter table public.customers add constraint customers_entity_workspace_fk
  foreign key (workspace_id, entity_id) references public.billing_entities (workspace_id, id);
create index customers_entity_name_idx on public.customers (entity_id, legal_name, id);

-- Preserve any legacy shared records for explicit assignment by an administrator.
-- New writes must supply a company and unassigned records are hidden from client roles.
alter table public.customers add constraint customers_require_entity
  check (entity_id is not null) not valid;
drop policy customers_owner on public.customers;
create policy customers_entity_owner on public.customers for all to authenticated
using (exists (
  select 1 from public.billing_entities e where e.id = customers.entity_id
    and e.workspace_id = customers.workspace_id and e.is_active
))
with check (exists (
  select 1 from public.billing_entities e where e.id = customers.entity_id
    and e.workspace_id = customers.workspace_id and e.is_active
));
grant insert (entity_id) on public.customers to authenticated;
