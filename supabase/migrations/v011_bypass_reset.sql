-- v12.47.0 – maintenance functions switch the guard bypass off again when they are done (it is transaction-local; inside one
-- transaction a later statement must not inherit it)
create or replace function public.master_set_plan(p_ws text, p_plan text, p_until timestamptz, p_seats int, p_note text, p_open_domain boolean, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'platform admin only' using errcode = '42501'; end if;
  perform set_config('giri.bypass_guard', '1', true);
  update public.workspaces set plan = coalesce(p_plan, plan), plan_until = p_until, seats = p_seats, plan_note = p_note,
    open_domain = coalesce(p_open_domain, open_domain), name = coalesce(nullif(p_name, ''), name), updated_at = now() where ws = p_ws;
  perform set_config('giri.bypass_guard', '0', true);
  if not found then raise exception 'workspace % not found', p_ws; end if;
end $$;

create or replace function public.master_move_user(p_email text, p_ws text, p_with_instructions boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.profiles; n int := 0;
begin
  if not public.is_master() then raise exception 'platform admin only' using errcode = '42501'; end if;
  select * into p from public.profiles where lower(email) = lower(p_email);
  if p.id is null then raise exception 'no profile for %', p_email; end if;
  if not exists (select 1 from public.workspaces where ws = p_ws) then raise exception 'workspace % not found', p_ws; end if;
  if p.ws = p_ws then return jsonb_build_object('moved', false); end if;
  perform set_config('giri.bypass_guard', '1', true);
  update public.workspaces w set teams = (select coalesce(jsonb_agg(jsonb_set(t, '{members}', (select coalesce(jsonb_agg(m), '[]'::jsonb) from jsonb_array_elements(coalesce(t->'members', '[]'::jsonb)) m where lower(m->>'email') <> lower(p.email)))), '[]'::jsonb) from jsonb_array_elements(coalesce(w.teams, '[]'::jsonb)) t) where w.ws = p.ws;
  if p_with_instructions then
    with u as (update public.instructions set ws = p_ws where owner = p.id returning 1) select count(*) into n from u;
    update public.feedback f set ws = p_ws where f.instr_id in (select id from public.instructions where owner = p.id);
    update public.runs r set ws = p_ws where r.instr_id in (select id from public.instructions where owner = p.id);
  end if;
  update public.profiles set ws = p_ws, is_admin = false, role = case when role = 'admin' then 'creator' else role end where id = p.id;
  perform set_config('giri.bypass_guard', '0', true);
  return jsonb_build_object('moved', true, 'instructions', n);
end $$;

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
  update public.instr_stats set ws = p_into where ws = p_from;
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

create or replace function public.ws_teams_cascade() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.folders is not distinct from old.folders and new.teams is not distinct from old.teams then return new; end if;
  perform set_config('giri.bypass_guard', '1', true);
  update public.instructions i set teams_eff = x.t
    from (select id, public.instr_team_ids(public.jsonb_text_array(data->'teams'), data->>'folder', ws) as t from public.instructions where ws = new.ws) x
   where i.id = x.id and i.teams_eff is distinct from x.t;
  perform set_config('giri.bypass_guard', '0', true);
  return new;
end $$;
