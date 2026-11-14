-- Preserve cancelled/original file identities and allow failed work to be retried explicitly.
create function public.retry_document_file(p_entity uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid; f public.document_files;
begin
  ws:=public.require_entity(p_entity);
  select * into strict f from public.document_files where id=p_id and workspace_id=ws and entity_id=p_entity for update;
  if f.status='ready' then return to_jsonb(f); end if;
  if f.status='processing' and f.lease_expires_at>clock_timestamp() then raise exception 'Document generation is running' using errcode='55P03'; end if;
  update public.document_files set status='pending',claim_token=null,lease_expires_at=null,next_attempt_at=clock_timestamp(),last_error=null,updated_at=now()
    where id=p_id returning * into f;
  return to_jsonb(f);
end $$;

create function public.retry_report_export(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.report_exports;
begin
  select r.* into strict f from public.report_exports r join public.workspaces w on w.id=r.workspace_id
    where r.id=p_id and w.owner_user_id=auth.uid() for update of r;
  if f.expires_at<=clock_timestamp() then raise exception 'Export expired. Request a new report.' using errcode='23514'; end if;
  if f.status='ready' then return jsonb_build_object('id',f.id,'status',f.status); end if;
  if f.status='processing' and f.lease_expires_at>clock_timestamp() then raise exception 'Export generation is running' using errcode='55P03'; end if;
  update public.report_exports set status='pending',claim_token=null,lease_expires_at=null,next_attempt_at=clock_timestamp(),last_error=null,updated_at=now() where id=p_id;
  return jsonb_build_object('id',f.id,'status','pending');
end $$;

-- A finished file can be written only by the current, unexpired claim.
create or replace function public.finish_document_file(p_entity uuid,p_id uuid,p_token uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare ws uuid; prefix text;
begin
  ws:=public.require_entity(p_entity);prefix:=ws::text||'/'||p_entity::text||'/';
  if p_result ? 'path' and left(p_result->>'path',length(prefix))<>prefix then raise exception 'Invalid storage path' using errcode='42501'; end if;
  if not(p_result ? 'error') and (p_result->>'sha256' is null or p_result->>'sha256' !~ '^[0-9a-f]{64}$') then raise exception 'Invalid file checksum' using errcode='23514'; end if;
  update public.document_files set status=case when p_result ? 'error' then 'failed' else 'ready' end,
    object_path=p_result->>'path',sha256=p_result->>'sha256',byte_size=(p_result->>'size')::bigint,
    last_error=left(p_result->>'error',2000),generated_at=case when not(p_result ? 'error') then clock_timestamp() end,
    lease_expires_at=null,updated_at=now() where id=p_id and workspace_id=ws and entity_id=p_entity and claim_token=p_token
      and status='processing' and lease_expires_at>clock_timestamp();
  if not found then raise exception 'PDF claim expired' using errcode='40001'; end if;
end $$;

create function public.validate_catalog_defaults() returns trigger language plpgsql set search_path='' as $$
begin
  if new.is_active then
    if new.default_print_type_id is not null and not exists(select 1 from public.print_types where id=new.default_print_type_id and is_active) then
      raise exception 'Style default print type is archived' using errcode='23514'; end if;
    if new.default_placement_id is not null and not exists(select 1 from public.placements where id=new.default_placement_id and is_active) then
      raise exception 'Style default placement is archived' using errcode='23514'; end if;
    if new.default_unit_id is not null and not exists(select 1 from public.units where id=new.default_unit_id and is_active) then
      raise exception 'Style default unit is archived' using errcode='23514'; end if;
  end if;
  return new;
end $$;
create trigger style_defaults before insert or update on public.styles for each row execute function public.validate_catalog_defaults();

-- Protect receipt precision before scaled numeric casts and keep the established idempotency contract.
alter function public.record_payment(uuid,uuid,jsonb,text) rename to record_payment_internal;
revoke all on function public.record_payment_internal(uuid,uuid,jsonb,text) from public,anon,authenticated;
create function public.record_payment(p_entity uuid,p_id uuid,p_receipt jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cents numeric:=(p_receipt->>'cents')::numeric;
begin
  if cents is null or cents<>trunc(cents) or cents not between 1 and 9007199254740991 or p_key is null or length(p_key) not between 1 and 200 then
    raise exception 'Supply integer paise and a payment request identifier' using errcode='23514'; end if;
  return public.record_payment_internal(p_entity,p_id,p_receipt,p_key);
end $$;

create function public.health_database() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to continue' using errcode='42501'; end if;
  return jsonb_build_object('status','ok','schemaVersion','20261114001100');
end $$;
revoke all on function public.retry_document_file(uuid,uuid),public.retry_report_export(uuid),public.record_payment(uuid,uuid,jsonb,text),public.health_database() from public,anon;
grant execute on function public.retry_document_file(uuid,uuid),public.retry_report_export(uuid),public.record_payment(uuid,uuid,jsonb,text),public.health_database() to authenticated;
revoke all on function public.validate_catalog_defaults() from public,anon,authenticated;
