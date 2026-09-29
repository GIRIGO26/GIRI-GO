-- v12.45.0 – authorisation on the server (was: coarse rights in RLS, fine rights only in the browser)
--
-- 1. Roles/capabilities of GIRI Classic as SQL (mirror of src/core/roles.js): norm_role, role_caps, my_roles_in, my_can, my_can_any
-- 2. Team visibility as RLS: an instruction restricted to teams (its own teams or the teams of its folder) is only visible to members
--    of those teams; org admins see everything (mirror of canSee in src/core/workspace.js). The team ids and the folder are kept in
--    generated columns so the policy never has to read the instruction JSON.
-- 3. Write policies per team role: insert/delete need the edit right for the instruction's teams, update needs edit or an approval /
--    lock right (approvers save the row when they approve).
-- 4. Trigger instr_authz_guard: an approval needs the matching approval right, publishing needs both approvals, content changes
--    need the edit right. The service role and maintenance functions (giri.bypass_guard) are exempt.
-- 5. GDPR: gdpr_export_user(email) and gdpr_erase_user(email) for org admins (anonymises names in instructions/feedback/runs,
--    removes memberships/invites, deletes profile and auth user).

-- ---------- 1. roles ----------
create or replace function public.norm_role(r text) returns text language sql immutable as $$
  select case coalesce(r, '')
    when 'reviewer' then 'approver' when 'admin' then 'team_admin' when 'team-admin' then 'team_admin' when 'technical_approver' then 'tech_approver'
    when 'viewer' then 'viewer' when 'editor' then 'editor' when 'approver' then 'approver' when 'tech_approver' then 'tech_approver'
    when 'compliance_approver' then 'compliance_approver' when 'compliance_manager' then 'compliance_manager' when 'creator' then 'creator'
    when 'team_admin' then 'team_admin' else 'viewer' end $$;

create or replace function public.role_caps(r text) returns text[] language sql immutable as $$
  select case public.norm_role(r)
    when 'editor' then array['edit']
    when 'approver' then array['approve_tech','approve_dsgvo','lock','links']
    when 'tech_approver' then array['approve_tech','lock','links']
    when 'compliance_approver' then array['approve_dsgvo','lock','links']
    when 'compliance_manager' then array['approve_dsgvo','lock','links','users_limited']
    when 'creator' then array['edit','approve_tech','approve_dsgvo','lock','links','projects']
    when 'team_admin' then array['edit','approve_tech','approve_dsgvo','lock','links','projects','users','users_limited','team','analytics']
    else array[]::text[] end $$;

create or replace function public.jsonb_text_array(j jsonb) returns text[] language sql immutable as $$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end)), array[]::text[]) $$;

-- the team ids an instruction is restricted to: its own teams + the teams of its folder, only ids that exist in the workspace
create or replace function public.instr_team_ids(p_teams text[], p_folder text, p_ws text) returns text[]
language sql stable security definer set search_path = public as $$
  with w as (select teams, folders from public.workspaces where ws = p_ws),
  own as (select unnest(coalesce(p_teams, array[]::text[])) as tid),
  fol as (select jsonb_array_elements_text(coalesce(f->'teams', '[]'::jsonb)) as tid
          from w, jsonb_array_elements(coalesce(w.folders, '[]'::jsonb)) f where p_folder is not null and f->>'id' = p_folder),
  ids as (select tid from own union select tid from fol)
  select coalesce(array_agg(distinct ids.tid), array[]::text[]) from ids
   where exists (select 1 from w, jsonb_array_elements(coalesce(w.teams, '[]'::jsonb)) t where t->>'id' = ids.tid) $$;

-- the roles the caller holds for these teams (mirror of rolesIn): org admin → team_admin everywhere; otherwise the memberships
-- (matched by e-mail) in exactly these teams; none → the workspace role
create or replace function public.my_roles_in(p_teams text[]) returns text[]
language sql stable security definer set search_path = public as $$
  with me as (select p.email, p.role, p.is_admin, p.ws from public.profiles p where p.id = auth.uid()),
  tr as (select public.norm_role(m->>'role') as r
           from me, public.workspaces w, jsonb_array_elements(coalesce(w.teams, '[]'::jsonb)) t, jsonb_array_elements(coalesce(t->'members', '[]'::jsonb)) m
          where w.ws = me.ws and t->>'id' = any(coalesce(p_teams, array[]::text[])) and lower(m->>'email') = lower(me.email))
  select case when not exists (select 1 from me) then array[]::text[]
              when (select is_admin from me) then array['team_admin']
              when exists (select 1 from tr) then (select array_agg(distinct r) from tr)
              else array[public.norm_role((select role from me))] end $$;

create or replace function public.my_can(p_cap text, p_teams text[], p_folder text, p_ws text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(public.my_roles_in(public.instr_team_ids(p_teams, p_folder, p_ws))) r where p_cap = any(public.role_caps(r))) $$;

-- any of my roles anywhere (workspace role + every team I am in) – mirror of canAny
create or replace function public.my_can_any(p_cap text) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (select p.email, p.role, p.is_admin, p.ws from public.profiles p where p.id = auth.uid()),
  roles as (select public.norm_role((select role from me)) as r
            union select public.norm_role(m->>'role')
              from me, public.workspaces w, jsonb_array_elements(coalesce(w.teams, '[]'::jsonb)) t, jsonb_array_elements(coalesce(t->'members', '[]'::jsonb)) m
             where w.ws = me.ws and lower(m->>'email') = lower(me.email))
  select coalesce((select is_admin from me), false) or exists (select 1 from roles where p_cap = any(public.role_caps(r))) $$;

-- mirror of canSee: admins everything, unrestricted instructions everyone in the workspace, restricted ones only their teams' members
create or replace function public.my_can_see(p_teams text[], p_folder text, p_ws text) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (select p.email, p.is_admin from public.profiles p where p.id = auth.uid()),
  ids as (select public.instr_team_ids(p_teams, p_folder, p_ws) as t)
  select coalesce((select is_admin from me), false)
      or coalesce(array_length((select ids.t from ids), 1), 0) = 0
      or exists (select 1 from me, ids, public.workspaces w, jsonb_array_elements(coalesce(w.teams, '[]'::jsonb)) tm, jsonb_array_elements(coalesce(tm->'members', '[]'::jsonb)) m
                  where w.ws = p_ws and tm->>'id' = any(ids.t) and lower(m->>'email') = lower(me.email)) $$;

revoke all on function public.instr_team_ids(text[], text, text), public.my_roles_in(text[]), public.my_can(text, text[], text, text), public.my_can_any(text), public.my_can_see(text[], text, text) from public;
grant execute on function public.instr_team_ids(text[], text, text), public.my_roles_in(text[]), public.my_can(text, text[], text, text), public.my_can_any(text), public.my_can_see(text[], text, text) to authenticated, service_role;

-- ---------- 2. generated columns + policies ----------
alter table public.instructions add column if not exists folder text generated always as (data->>'folder') stored;
alter table public.instructions add column if not exists teams text[] generated always as (public.jsonb_text_array(data->'teams')) stored;
create index if not exists instructions_ws_folder on public.instructions (ws, folder);

drop policy if exists instr_select_ws on public.instructions;
create policy instr_select_ws on public.instructions for select to authenticated
  using (ws = public.my_ws() and public.my_can_see(teams, folder, ws));
drop policy if exists instr_write on public.instructions;
create policy instr_write on public.instructions for insert to authenticated
  with check (ws = public.my_ws() and (public.my_can('edit', teams, folder, ws)
              or (coalesce(array_length(public.instr_team_ids(teams, folder, ws), 1), 0) = 0 and public.my_can_any('edit'))));
drop policy if exists instr_update on public.instructions;
create policy instr_update on public.instructions for update to authenticated
  using (ws = public.my_ws() and public.my_can_see(teams, folder, ws)
         and (public.my_can('edit', teams, folder, ws) or public.my_can('approve_tech', teams, folder, ws)
              or public.my_can('approve_dsgvo', teams, folder, ws) or public.my_can('lock', teams, folder, ws)))
  with check (ws = public.my_ws());
drop policy if exists instr_delete on public.instructions;
create policy instr_delete on public.instructions for delete to authenticated
  using (ws = public.my_ws() and public.my_can('edit', teams, folder, ws));

-- ---------- 3. the guard ----------
create or replace function public.instr_authz_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  meta text[] := array['approvals','status','history','pendingNote','lastBy','publishedAt','version','shareKey','updatedAt','_base','translations','txSrc','txHash'];
  old_ap jsonb := '{}'::jsonb; new_ap jsonb; t_ids text[]; f_id text; changed boolean;
begin
  if uid is null or current_setting('giri.bypass_guard', true) = '1' then return new; end if;  -- service role, migrations, maintenance
  new_ap := coalesce(new.data->'approvals', '{}'::jsonb);
  if tg_op = 'UPDATE' then old_ap := coalesce(old.data->'approvals', '{}'::jsonb); end if;
  t_ids := public.jsonb_text_array(new.data->'teams'); f_id := new.data->>'folder';
  -- an approval that appears, or changes hands, needs the matching right
  if new_ap->'tech' is not null and new_ap->'tech' <> 'null'::jsonb and coalesce(old_ap->'tech', 'null'::jsonb) <> new_ap->'tech'
     and not public.my_can('approve_tech', t_ids, f_id, new.ws) then
    raise exception 'technical approval needs the approver role' using errcode = '42501';
  end if;
  if new_ap->'dsgvo' is not null and new_ap->'dsgvo' <> 'null'::jsonb and coalesce(old_ap->'dsgvo', 'null'::jsonb) <> new_ap->'dsgvo'
     and not public.my_can('approve_dsgvo', t_ids, f_id, new.ws) then
    raise exception 'privacy approval needs the compliance approver role' using errcode = '42501';
  end if;
  -- published only with both approvals in place
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and (coalesce(new_ap->'tech', 'null'::jsonb) = 'null'::jsonb or coalesce(new_ap->'dsgvo', 'null'::jsonb) = 'null'::jsonb) then
    raise exception 'publishing needs both approvals' using errcode = '42501';
  end if;
  -- content (everything except the approval/status metadata) may only be changed with the edit right for the instruction's teams
  if tg_op = 'UPDATE' then
    changed := (new.data - meta) is distinct from (old.data - meta) or new.title is distinct from old.title;
    if changed and not public.my_can('edit', public.jsonb_text_array(old.data->'teams'), old.data->>'folder', old.ws) then
      raise exception 'editing needs the editor role' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists instr_authz_guard on public.instructions;
create trigger instr_authz_guard before insert or update on public.instructions for each row execute function public.instr_authz_guard();

-- ---------- 4. GDPR ----------
-- replaces a person's name wherever an instruction records who did something (creator, last editor, approvals, history)
create or replace function public.jsonb_anon_names(d jsonb, p_name text, p_anon text) returns jsonb language plpgsql immutable as $$
declare r jsonb := coalesce(d, '{}'::jsonb); h jsonb;
begin
  if p_name is null or p_name = '' then return r; end if;
  if r->>'createdBy' = p_name then r := jsonb_set(r, '{createdBy}', to_jsonb(p_anon)); end if;
  if r->>'lastBy' = p_name then r := jsonb_set(r, '{lastBy}', to_jsonb(p_anon)); end if;
  if r->'approvals'->'tech'->>'by' = p_name then r := jsonb_set(r, '{approvals,tech,by}', to_jsonb(p_anon)); end if;
  if r->'approvals'->'dsgvo'->>'by' = p_name then r := jsonb_set(r, '{approvals,dsgvo,by}', to_jsonb(p_anon)); end if;
  if jsonb_typeof(r->'history') = 'array' then
    select coalesce(jsonb_agg(case when x->>'by' = p_name then jsonb_set(x, '{by}', to_jsonb(p_anon)) else x end), '[]'::jsonb) into h from jsonb_array_elements(r->'history') x;
    r := jsonb_set(r, '{history}', h);
  end if;
  return r;
end $$;
create or replace function public.gdpr_export_user(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles; p public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not coalesce(me.is_admin, false) then raise exception 'admin only' using errcode = '42501'; end if;
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
  if me.id is null or not coalesce(me.is_admin, false) then raise exception 'admin only' using errcode = '42501'; end if;
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
revoke all on function public.gdpr_export_user(text), public.gdpr_erase_user(text) from public;
grant execute on function public.gdpr_export_user(text), public.gdpr_erase_user(text) to authenticated;
