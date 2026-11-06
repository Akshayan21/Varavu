create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id),
  name text not null default 'Billing Workspace',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role = 'owner'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

revoke all on public.workspaces, public.workspace_members from public, anon, authenticated;
grant select on public.workspaces, public.workspace_members to authenticated;

create policy "Owners can read their workspace" on public.workspaces
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy "Owners can read their membership" on public.workspace_members
  for select to authenticated using (
    user_id = (select auth.uid()) and exists (
      select 1 from public.workspaces where id = workspace_members.workspace_id
    )
  );

create function public.initialize_workspace()
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  workspace_id_value uuid;
begin
  if actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise insufficient_privilege using message = 'A registered account is required';
  end if;

  insert into public.workspaces (owner_user_id) values (actor)
  on conflict (owner_user_id) do nothing;

  select w.id into strict workspace_id_value
    from public.workspaces w where w.owner_user_id = actor;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (workspace_id_value, actor, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return query select w.id, w.name from public.workspaces w where w.id = workspace_id_value;
end;
$$;

revoke execute on function public.initialize_workspace() from public, anon, authenticated;
grant execute on function public.initialize_workspace() to authenticated;

insert into storage.buckets (id, name, public)
values ('billing-assets', 'billing-assets', false),
       ('invoice-pdfs', 'invoice-pdfs', false);
