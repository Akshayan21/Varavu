-- Additive migration. Legacy unassigned customers remain hidden until assigned.
alter table public.workspaces
  add column timezone text not null default 'Asia/Kolkata',
  add column default_currency text not null default 'INR' check (default_currency = 'INR');

alter table public.billing_entities
  add column dc_prefix text,
  add column numbering_mode text not null default 'financial_year' check (numbering_mode in ('financial_year','continuous')),
  add column currency text not null default 'INR' check (currency = 'INR'),
  add column default_tax_profile_id uuid,
  add column default_invoice_template_id uuid,
  add column default_dc_template_id uuid,
  add column logo_path text,
  add column signature_path text,
  add column default_terms text,
  add column rounding_increment numeric(18,2) not null default 0 check (rounding_increment in (0,0.01,1)),
  add column archived_at timestamptz,
  add column version bigint not null default 1,
  add column created_by uuid references auth.users(id),
  add column updated_by uuid references auth.users(id),
  add column import_source text,
  add column import_external_id text,
  add constraint entities_import_pair check ((import_source is null) = (import_external_id is null));

alter table public.customers
  add column archived_at timestamptz,
  add column version bigint not null default 1,
  add column created_by uuid references auth.users(id),
  add column updated_by uuid references auth.users(id),
  add column import_source text,
  add column import_external_id text,
  add constraint customers_import_pair check ((import_source is null) = (import_external_id is null)),
  add unique(workspace_id,entity_id,id);

create unique index entities_import_key on public.billing_entities(workspace_id,import_source,import_external_id) where import_source is not null;
create unique index customers_import_key on public.customers(workspace_id,entity_id,import_source,import_external_id) where import_source is not null;

do $$
begin
  if not exists(select 1 from public.customers where entity_id is null) then
    alter table public.customers validate constraint customers_require_entity;
    alter table public.customers alter column entity_id set not null;
  else
    raise notice 'Legacy unassigned customers retained. Assign their company before validating customers_require_entity.';
  end if;
end $$;

-- Authorization is checked inside every SECURITY DEFINER entry point.
create function public.require_entity(p_entity uuid, p_active boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; active boolean;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in to continue' using errcode='42501';
  end if;
  select e.workspace_id,e.is_active into result,active
    from public.billing_entities e join public.workspaces w on w.id=e.workspace_id
    where e.id=p_entity and w.owner_user_id=auth.uid() for update of e;
  if result is null then raise exception 'Company not found' using errcode='42501'; end if;
  if p_active and not active then raise exception 'Company is archived' using errcode='23514'; end if;
  return result;
end $$;

-- Each option list is independent for each company.
do $$
declare tab text;
begin
  foreach tab in array array['print_types','placements','units'] loop
    execute format('create table public.%I (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null, entity_id uuid not null,
      code text not null check (code ~ ''^[A-Z0-9_-]{1,40}$''),
      label text not null check (length(btrim(label)) between 1 and 100),
      sort_order integer not null default 0, is_active boolean not null default true,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      version bigint not null default 1, created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
      foreign key(workspace_id,entity_id) references public.billing_entities(workspace_id,id),
      unique(workspace_id,entity_id,code), unique(workspace_id,entity_id,id)
    )',tab);
  end loop;
end $$;

create table public.tax_profiles (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, entity_id uuid not null,
  name text not null check(length(btrim(name)) between 1 and 100),
  tax_mode text not null check(tax_mode in ('none','intra_state','inter_state','other')),
  cgst_rate numeric(7,4) not null default 0 check(cgst_rate between 0 and 100),
  sgst_rate numeric(7,4) not null default 0 check(sgst_rate between 0 and 100),
  igst_rate numeric(7,4) not null default 0 check(igst_rate between 0 and 100),
  other_tax_rate numeric(7,4) not null default 0 check(other_tax_rate between 0 and 100),
  is_active boolean not null default true, version bigint not null default 1,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),updated_by uuid references auth.users(id),
  foreign key(workspace_id,entity_id) references public.billing_entities(workspace_id,id),
  unique(workspace_id,entity_id,id),
  check(cgst_rate+sgst_rate+igst_rate+other_tax_rate<=100),
  check((tax_mode='none' and cgst_rate+sgst_rate+igst_rate+other_tax_rate=0)
    or (tax_mode='intra_state' and igst_rate=0 and other_tax_rate=0)
    or (tax_mode='inter_state' and cgst_rate=0 and sgst_rate=0 and other_tax_rate=0)
    or (tax_mode='other' and cgst_rate=0 and sgst_rate=0 and igst_rate=0))
);

create table public.document_templates (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null,entity_id uuid not null,
  document_type text not null check(document_type in ('invoice','delivery_challan')),
  name text not null,version_number integer not null check(version_number>0),
  status text not null default 'draft' check(status in ('draft','published')),
  settings_schema_version integer not null default 1,
  settings_json jsonb not null default '{}' check(jsonb_typeof(settings_json)='object'),
  renderer_version text not null default 'thogai-v1',published_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),updated_by uuid references auth.users(id),
  version bigint not null default 1,
  foreign key(workspace_id,entity_id) references public.billing_entities(workspace_id,id),
  unique(workspace_id,entity_id,id),unique(workspace_id,entity_id,document_type,name,version_number),
  check((status='published')=(published_at is not null))
);

create table public.styles (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null,entity_id uuid not null,
  style_number text not null check(length(btrim(style_number)) between 1 and 100 and style_number !~ '[[:cntrl:]]'),
  normalized_style_number text collate "C" generated always as (upper(btrim(style_number))) stored,
  name text,description text,default_print_type_id uuid,default_placement_id uuid,default_unit_id uuid,
  is_active boolean not null default true,archived_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  version bigint not null default 1,created_by uuid references auth.users(id),updated_by uuid references auth.users(id),
  foreign key(workspace_id,entity_id) references public.billing_entities(workspace_id,id),
  foreign key(workspace_id,entity_id,default_print_type_id) references public.print_types(workspace_id,entity_id,id),
  foreign key(workspace_id,entity_id,default_placement_id) references public.placements(workspace_id,entity_id,id),
  foreign key(workspace_id,entity_id,default_unit_id) references public.units(workspace_id,entity_id,id),
  unique(workspace_id,entity_id,normalized_style_number),unique(workspace_id,entity_id,id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),entity_id uuid,
  actor_user_id uuid references auth.users(id),actor_type text not null default 'user' check(actor_type in ('user','system')),
  action text not null,resource_type text not null,resource_id uuid not null,request_id text,
  before_json jsonb,after_json jsonb,metadata_json jsonb not null default '{}',occurred_at timestamptz not null default now(),
  foreign key(workspace_id,entity_id) references public.billing_entities(workspace_id,id)
);
create index audit_resource_idx on public.audit_logs(resource_type,resource_id,occurred_at);
create index audit_entity_idx on public.audit_logs(workspace_id,entity_id,occurred_at desc);

create function public.audit_record() returns trigger language plpgsql security definer set search_path='' as $$
declare rowdata jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_logs(workspace_id,entity_id,actor_user_id,action,resource_type,resource_id,before_json,after_json)
  values ((rowdata->>'workspace_id')::uuid,
    case when tg_table_name='billing_entities' then (rowdata->>'id')::uuid else (rowdata->>'entity_id')::uuid end,
    auth.uid(),lower(tg_op),tg_table_name,(rowdata->>'id')::uuid,
    case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
  return coalesce(new,old);
end $$;

create function public.touch_record() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' then
    new.updated_at:=now(); new.version:=old.version+1; new.updated_by:=auth.uid();
    if new.workspace_id<>old.workspace_id then raise exception 'Workspace is immutable' using errcode='23514'; end if;
    if tg_table_name<>'billing_entities' and (to_jsonb(new)->>'entity_id') is distinct from (to_jsonb(old)->>'entity_id') then
      raise exception 'Company is immutable' using errcode='23514';
    end if;
  else new.created_by:=auth.uid(); new.updated_by:=auth.uid(); end if;
  if tg_table_name in ('billing_entities','customers','styles') then
    new.archived_at:=case when new.is_active then null else coalesce(new.archived_at,now()) end;
  end if;
  return new;
end $$;

create function public.seed_entity_catalog() returns trigger language plpgsql security definer set search_path='' as $$
declare template_id uuid;
begin
  insert into public.print_types(workspace_id,entity_id,code,label,sort_order)
    select new.workspace_id,new.id,v.code,v.label,v.n from (values
      ('DTF','DTF',1),('SUBLIMATION','Sublimation',2),('HEAT_TRANSFER','Heat Transfer',3),('PUFF','Puff',4),
      ('PLASTISOL','Plastisol',5),('HD','HD / High Density',6),('SCREEN_PRINTING','Screen Printing',7),('OTHER','Other',8)
    ) v(code,label,n) on conflict do nothing;
  insert into public.placements(workspace_id,entity_id,code,label,sort_order)
    select new.workspace_id,new.id,v.code,v.label,v.n from (values
      ('FRONT','Front',1),('BACK','Back',2),('LEFT_CHEST','Left Chest',3),('RIGHT_CHEST','Right Chest',4),
      ('SLEEVE','Sleeve',5),('NECK','Neck',6),('OTHER','Other',7)) v(code,label,n) on conflict do nothing;
  insert into public.units(workspace_id,entity_id,code,label,sort_order)
    select new.workspace_id,new.id,v.code,v.label,v.n from (values ('PCS','Pieces',1),('BUNDLE','Bundles',2),('BOX','Boxes',3)) v(code,label,n)
    on conflict do nothing;
  insert into public.document_templates(workspace_id,entity_id,document_type,name,version_number,status,published_at,settings_json)
    values(new.workspace_id,new.id,'invoice','Default',1,'published',now(),'{"preset":"structured","accent":"#7c3bd1"}')
    returning id into template_id;
  update public.billing_entities set default_invoice_template_id=template_id where id=new.id;
  insert into public.document_templates(workspace_id,entity_id,document_type,name,version_number,status,published_at,settings_json)
    values(new.workspace_id,new.id,'delivery_challan','Default',1,'published',now(),'{"preset":"minimal","accent":"#7c3bd1"}')
    returning id into template_id;
  update public.billing_entities set default_dc_template_id=template_id where id=new.id;
  return new;
end $$;

-- Seed pre-existing entities through the same trigger, without duplicating identities.
create trigger entity_catalog_seed after insert on public.billing_entities for each row execute function public.seed_entity_catalog();
do $$
declare e public.billing_entities;
begin
  for e in select * from public.billing_entities loop
    insert into public.print_types(workspace_id,entity_id,code,label,sort_order)
      select e.workspace_id,e.id,v.code,v.label,v.n from (values ('DTF','DTF',1),('SUBLIMATION','Sublimation',2),
      ('HEAT_TRANSFER','Heat Transfer',3),('PUFF','Puff',4),('PLASTISOL','Plastisol',5),('HD','HD / High Density',6),
      ('SCREEN_PRINTING','Screen Printing',7),('OTHER','Other',8)) v(code,label,n);
    insert into public.placements(workspace_id,entity_id,code,label)
      select e.workspace_id,e.id,upper(replace(label,' ','_')),label from unnest(array['Front','Back','Left Chest','Right Chest','Sleeve','Neck','Other']) label;
    insert into public.units(workspace_id,entity_id,code,label) values(e.workspace_id,e.id,'PCS','Pieces'),(e.workspace_id,e.id,'BUNDLE','Bundles'),(e.workspace_id,e.id,'BOX','Boxes');
    insert into public.document_templates(workspace_id,entity_id,document_type,name,version_number,status,published_at,settings_json)
      values(e.workspace_id,e.id,'invoice','Default',1,'published',now(),'{"preset":"structured","accent":"#7c3bd1"}'),
      (e.workspace_id,e.id,'delivery_challan','Default',1,'published',now(),'{"preset":"minimal","accent":"#7c3bd1"}');
    update public.billing_entities b set default_invoice_template_id=(select id from public.document_templates t where t.entity_id=e.id and t.document_type='invoice'),
      default_dc_template_id=(select id from public.document_templates t where t.entity_id=e.id and t.document_type='delivery_challan') where b.id=e.id;
  end loop;
end $$;

alter table public.billing_entities
  add foreign key(workspace_id,id,default_tax_profile_id) references public.tax_profiles(workspace_id,entity_id,id),
  add foreign key(workspace_id,id,default_invoice_template_id) references public.document_templates(workspace_id,entity_id,id),
  add foreign key(workspace_id,id,default_dc_template_id) references public.document_templates(workspace_id,entity_id,id);

create function public.resolve_style(p_entity uuid,p_number text) returns public.styles
language plpgsql security definer set search_path='' as $$
declare workspace uuid; result public.styles;
begin
  workspace:=public.require_entity(p_entity,true);
  if p_number is null or length(btrim(p_number)) not between 1 and 100 or p_number ~ '[[:cntrl:]]' then
    raise exception 'Enter a style number of 1 to 100 characters' using errcode='23514';
  end if;
  insert into public.styles(workspace_id,entity_id,style_number,created_by,updated_by)
    values(workspace,p_entity,btrim(p_number),auth.uid(),auth.uid())
    on conflict(workspace_id,entity_id,normalized_style_number) do nothing;
  select * into strict result from public.styles where workspace_id=workspace and entity_id=p_entity
    and normalized_style_number=upper(btrim(p_number)) collate "C" for share;
  if not result.is_active then raise exception 'This style is archived. Restore it before use.' using errcode='23514'; end if;
  return result;
end $$;

-- Customer historical reads must survive company archival.
drop policy customers_entity_owner on public.customers;
create policy customers_read on public.customers for select to authenticated using (
  entity_id is not null and workspace_id in(select id from public.workspaces where owner_user_id=auth.uid()));
create policy customers_write on public.customers for all to authenticated
using(exists(select 1 from public.billing_entities e where e.id=entity_id and e.workspace_id=customers.workspace_id and e.is_active))
with check(exists(select 1 from public.billing_entities e where e.id=entity_id and e.workspace_id=customers.workspace_id and e.is_active));

do $$
declare tab text;
begin
  foreach tab in array array['styles','print_types','placements','units','tax_profiles','document_templates','audit_logs'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    execute format('grant select on public.%I to authenticated',tab);
    execute format('create policy owner_read on public.%I for select to authenticated using(workspace_id in(select id from public.workspaces where owner_user_id=(select auth.uid())))',tab);
  end loop;
  foreach tab in array array['billing_entities','customers','styles','print_types','placements','units','tax_profiles'] loop
    execute format('create trigger metadata before insert or update on public.%I for each row execute function public.touch_record()',tab);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_record()',tab);
  end loop;
end $$;

grant insert(dc_prefix,numbering_mode,default_terms,rounding_increment),update(dc_prefix,numbering_mode,default_terms,rounding_increment) on public.billing_entities to authenticated;
revoke all on function public.require_entity(uuid,boolean),public.audit_record(),public.touch_record(),public.seed_entity_catalog() from public,anon,authenticated;
revoke all on function public.resolve_style(uuid,text) from public,anon;
grant execute on function public.resolve_style(uuid,text) to authenticated;
