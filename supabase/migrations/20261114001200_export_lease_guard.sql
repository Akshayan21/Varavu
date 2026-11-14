create function public.guard_export_completion() returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='processing' and new.status in ('ready','failed') and
    (old.lease_expires_at is null or old.lease_expires_at<=clock_timestamp() or old.claim_token is distinct from new.claim_token) then
    raise exception 'Export claim expired' using errcode='40001';
  end if;
  return new;
end $$;
create trigger export_completion_guard before update on public.report_exports for each row execute function public.guard_export_completion();
revoke all on function public.guard_export_completion() from public,anon,authenticated;

create or replace function public.health_database() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to continue' using errcode='42501'; end if;
  return jsonb_build_object('status','ok','schemaVersion','20261114001200');
end $$;
