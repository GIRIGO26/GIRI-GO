-- v12.45.0 – org admin = profiles.is_admin OR profiles.role = 'admin' (same rule as my_admin() and the app's isOrgAdmin),
-- so the v005 authorisation functions never disagree with the older policies or the browser about who is an org admin.

create or replace function public.my_roles_in(p_teams text[]) returns text[]
language sql stable security definer set search_path = public as $$
  with me as (select p.email, p.role, (p.is_admin or p.role = 'admin') as is_admin, p.ws from public.profiles p where p.id = auth.uid()),
  tr as (select public.norm_role(m->>'role') as r
           from me, public.workspaces w, jsonb_array_elements(coalesce(w.teams, '[]'::jsonb)) t, jsonb_array_elements(coalesce(t->'members', '[]'::jsonb)) m
          where w.ws = me.ws and t->>'id' = any(coalesce(p_teams, array[]::text[])) and lower(m->>'email') = lower(me.email))
  select case when not exists (select 1 from me) then array[]::text[]
              when (select is_admin from me) then array['team_admin']
              when exists (select 1 from tr) then (select array_agg(distinct r) from tr)
              else array[public.norm_role((select role from me))] end $$;

create or replace function public.my_can_any(p_cap text) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (select p.email, p.role, (p.is_admin or p.role = 'admin') as is_admin, p.ws from public.profiles p where p.id = auth.uid()),
  roles as (select public.norm_role((select role from me)) as r
            union select public.norm_role(m->>'role')
              from me, public.workspaces w, jsonb_array_elements(coalesce(w.teams, '[]'::jsonb)) t, jsonb_array_elements(coalesce(t->'members', '[]'::jsonb)) m
             where w.ws = me.ws and lower(m->>'email') = lower(me.email))
  select coalesce((select is_admin from me), false) or exists (select 1 from roles where p_cap = any(public.role_caps(r))) $$;

create or replace function public.my_can_see(p_teams text[], p_folder text, p_ws text) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (select p.email, (p.is_admin or p.role = 'admin') as is_admin from public.profiles p where p.id = auth.uid()),
  ids as (select public.instr_team_ids(p_teams, p_folder, p_ws) as t)
  select coalesce((select is_admin from me), false)
      or coalesce(array_length((select ids.t from ids), 1), 0) = 0
      or exists (select 1 from me, ids, public.workspaces w, jsonb_array_elements(coalesce(w.teams, '[]'::jsonb)) tm, jsonb_array_elements(coalesce(tm->'members', '[]'::jsonb)) m
                  where w.ws = p_ws and tm->>'id' = any(ids.t) and lower(m->>'email') = lower(me.email)) $$;

-- the GDPR functions use the same admin rule
create or replace function public.gdpr_export_user(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles; p public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not (coalesce(me.is_admin, false) or me.role = 'admin') then raise exception 'admin only' using errcode = '42501'; end if;
  select * into p from public.profiles where lower(email) = lower(p_email) and ws = me.ws;
  return jsonb_build_object(
    'email', lower(p_email), 'workspace', me.ws, 'exported_at', now(), 'exported_by', me.email,
    'profile', case when p.id is null then null else jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'role', p.role, 'is_admin', p.is_admin, 'created_at', p.created_at) end,
    'team_memberships', (select coalesce(jsonb_agg(jsonb_build_object('team', t->>'name', 'role', m->>'role')), '[]'::jsonb)
                           from public.workspaces w, jsonb_array_elements(coalesce(w.teams, '[]'::jsonb)) t, jsonb_array_elements(coalesce(t->'members', '[]'::jsonb)) m
                          where w.ws = me.ws and lower(m->>'email') = lower(p_email)),
    'invites', (select coalesce(jsonb_agg(i), '[]'::jsonb) from public.workspaces w, jsonb_array_elements(coalesce(w.invites, '[]'::jsonb)) i where w.ws = me.ws and lower(i->>'email') = lower(p_email)),
    'instructions_created_or_edited', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'status', i.status, 'updated_at', i.updated_at,
                                          'created_by', i.data->>'createdBy', 'last_by', i.data->>'lastBy')), '[]'::jsonb)
                                         from public.instructions i where i.ws = me.ws and p.id is not null
                                          and (i.data->>'createdBy' = p.name or i.data->>'lastBy' = p.name or i.owner = p.id
                                               or i.data->'approvals'->'tech'->>'by' = p.name or i.data->'approvals'->'dsgvo'->>'by' = p.name)),
    'feedback', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'instr_id', f.instr_id, 'kind', f.kind, 'text', f.text, 'status', f.status, 'created_at', f.created_at, 'media_url', f.media_url)), '[]'::jsonb)
                   from public.feedback f where f.ws = me.ws and (lower(f.worker) = lower(p_email) or (p.id is not null and f.worker = p.name))),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'instr_id', r.instr_id, 'started_at', r.started_at, 'finished_at', r.finished_at)), '[]'::jsonb)
               from public.runs r where r.ws = me.ws and (lower(r.worker) = lower(p_email) or (p.id is not null and r.worker = p.name))),
    'ai_usage', (select coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'feature', a.feature, 'model', a.model, 'region', a.region, 'ok', a.ok)), '[]'::jsonb)
                   from public.ai_usage a where p.id is not null and a.user_id = p.id));
end $$;

create or replace function public.gdpr_erase_user(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles; p public.profiles; anon text := 'Gelöschter Nutzer'; n_instr int := 0; n_fb int := 0; n_runs int := 0; n_ai int := 0; n_teams int := 0; had_profile boolean := false;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not (coalesce(me.is_admin, false) or me.role = 'admin') then raise exception 'admin only' using errcode = '42501'; end if;
  if lower(p_email) = lower(me.email) then raise exception 'you cannot erase your own account' using errcode = '42501'; end if;
  perform set_config('giri.bypass_guard', '1', true);
  select * into p from public.profiles where lower(email) = lower(p_email) and ws = me.ws; had_profile := p.id is not null;
  -- names inside instructions become anonymous; the instructions themselves stay with the company
  if had_profile and coalesce(p.name, '') <> '' then
    with u as (update public.instructions i set data = public.jsonb_anon_names(i.data, p.name, anon), owner = case when i.owner = p.id then null else i.owner end
                where i.ws = me.ws and (i.owner = p.id or public.jsonb_anon_names(i.data, p.name, anon) <> i.data) returning 1) select count(*) into n_instr from u;
  elsif had_profile then
    with u as (update public.instructions i set owner = null where i.ws = me.ws and i.owner = p.id returning 1) select count(*) into n_instr from u;
  end if;
  with u as (update public.feedback set worker = anon where ws = me.ws and (lower(worker) = lower(p_email) or (had_profile and worker = p.name)) returning 1) select count(*) into n_fb from u;
  with u as (update public.runs set worker = anon where ws = me.ws and (lower(worker) = lower(p_email) or (had_profile and worker = p.name)) returning 1) select count(*) into n_runs from u;
  if had_profile then with u as (update public.ai_usage set user_id = '00000000-0000-0000-0000-000000000000' where user_id = p.id returning 1) select count(*) into n_ai from u; end if;
  -- team memberships and open invites
  with u as (update public.workspaces w set
      teams = (select coalesce(jsonb_agg(jsonb_set(t, '{members}', (select coalesce(jsonb_agg(m), '[]'::jsonb) from jsonb_array_elements(coalesce(t->'members', '[]'::jsonb)) m where lower(m->>'email') <> lower(p_email)))), '[]'::jsonb) from jsonb_array_elements(coalesce(w.teams, '[]'::jsonb)) t),
      invites = (select coalesce(jsonb_agg(i), '[]'::jsonb) from jsonb_array_elements(coalesce(w.invites, '[]'::jsonb)) i where lower(i->>'email') <> lower(p_email))
    where w.ws = me.ws returning 1) select count(*) into n_teams from u;
  if had_profile then delete from public.profiles where id = p.id; delete from auth.users where id = p.id; end if;
  return jsonb_build_object('email', lower(p_email), 'profile_deleted', had_profile, 'instructions_anonymised', n_instr, 'feedback_anonymised', n_fb, 'runs_anonymised', n_runs, 'ai_usage_anonymised', n_ai, 'erased_at', now(), 'erased_by', me.email);
end $$;
