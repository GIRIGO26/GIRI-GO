-- v12.47.0 – instr_stats is a view over views: the merge must not touch it
create or replace function public.master_merge_workspace(p_from text, p_into text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare src public.workspaces; dst public.workspaces; n_i int := 0; n_p int := 0;
begin
  if not public.is_master() then raise exception 'platform admin only' using errcode = '42501'; end if;
  select * into src from public.workspaces where ws = p_from; select * into dst from public.workspaces where ws = p_into;
  if src.ws is null or dst.ws is null or src.ws = dst.ws then raise exception 'workspaces % / % invalid', p_from, p_into; end if;
  perform set_config('giri.bypass_guard', '1', true);
  with u as (update public.instructions set ws = p_into where ws = p_from returning 1) select count(*) into n_i from u;
  update public.feedback set ws = p_into where ws = p_from;
  update public.runs set ws = p_into where ws = p_from;
  update public.views set ws = p_into where ws = p_from;
  update public.ai_usage set ws = p_into where ws = p_from;
  with u as (update public.profiles set ws = p_into, is_admin = false, role = case when role = 'admin' then 'creator' else role end where ws = p_from returning 1) select count(*) into n_p from u;
  update public.workspaces set
    teams = coalesce(dst.teams, '[]'::jsonb) || coalesce(src.teams, '[]'::jsonb),
    folders = coalesce(dst.folders, '[]'::jsonb) || coalesce(src.folders, '[]'::jsonb),
    symbols = coalesce(dst.symbols, '[]'::jsonb) || coalesce(src.symbols, '[]'::jsonb),
    invites = coalesce(dst.invites, '[]'::jsonb) || coalesce(src.invites, '[]'::jsonb),
    updated_at = now() where ws = p_into;
  delete from public.workspaces where ws = p_from;
  perform set_config('giri.bypass_guard', '0', true);
  return jsonb_build_object('instructions', n_i, 'users', n_p, 'into', p_into);
end $$;

