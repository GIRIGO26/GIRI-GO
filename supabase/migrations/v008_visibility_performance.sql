-- v12.45.0 – (a) team visibility without per-row JSON scans, (b) restricted instruction + no membership = no rights
--
-- (a) Before: the select policy called my_can_see(teams, folder, ws) for every row, which walked the workspace's folders and
--     teams JSON each time (≈0.6 ms per row → 0.7 s for the 1,100 instructions of one workspace, and the app asks for all
--     heads at every start). Now: instructions.teams_eff holds the effective team ids (own teams ∪ folder teams, existing teams
--     only) as a plain column, maintained by a trigger on instructions and a cascade from workspaces (whenever folders or teams
--     change). The policy compares that column with the caller's team ids, which are looked up once per statement
--     ("(select fn())" = initplan). The generated columns folder/teams from v005 are no longer needed.
-- (b) my_roles_in fell back to the workspace role when the caller is not a member of any of the instruction's teams; for
--     restricted instructions this let a workspace creator create rows for foreign teams (invisible even to himself).
--     Now: no membership in a restricted instruction's teams → no roles at all (org admins keep everything). The app's
--     rolesIn() in src/core/roles.js mirrors this.

-- ---------- (b) roles ----------
create or replace function public.my_roles_in(p_teams text[]) returns text[]
language sql stable security definer set search_path = public as $$
  with me as (select p.email, p.role, (p.is_admin or p.role = 'admin') as is_admin, p.ws from public.profiles p where p.id = auth.uid()),
  tr as (select public.norm_role(m->>'role') as r
           from me, public.workspaces w, jsonb_array_elements(coalesce(w.teams, '[]'::jsonb)) t, jsonb_array_elements(coalesce(t->'members', '[]'::jsonb)) m
          where w.ws = me.ws and t->>'id' = any(coalesce(p_teams, array[]::text[])) and lower(m->>'email') = lower(me.email))
  select case when not exists (select 1 from me) then array[]::text[]
              when (select is_admin from me) then array['team_admin']
              when coalesce(array_length(p_teams, 1), 0) = 0 then array[public.norm_role((select role from me))]   -- unrestricted → workspace role
              else coalesce((select array_agg(distinct r) from tr), array[]::text[]) end $$;                        -- restricted → team roles only

-- ---------- (a) effective team ids as a column ----------
alter table public.instructions add column if not exists teams_eff text[] not null default '{}';

create or replace function public.my_team_ids() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(t->>'id'), array[]::text[])
    from public.profiles p, public.workspaces w, jsonb_array_elements(coalesce(w.teams, '[]'::jsonb)) t, jsonb_array_elements(coalesce(t->'members', '[]'::jsonb)) m
   where p.id = auth.uid() and w.ws = p.ws and lower(m->>'email') = lower(p.email) $$;
revoke all on function public.my_team_ids() from public;
grant execute on function public.my_team_ids() to authenticated, service_role;

create or replace function public.instr_teams_eff() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.teams_eff := public.instr_team_ids(public.jsonb_text_array(new.data->'teams'), new.data->>'folder', new.ws);
  return new;
end $$;
drop trigger if exists instr_teams_eff on public.instructions;
create trigger instr_teams_eff before insert or update on public.instructions for each row execute function public.instr_teams_eff();

-- folders or teams of a workspace changed → recompute the column for that workspace (only rows that actually change)
create or replace function public.ws_teams_cascade() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.folders is not distinct from old.folders and new.teams is not distinct from old.teams then return new; end if;
  perform set_config('giri.bypass_guard', '1', true);
  update public.instructions i set teams_eff = x.t
    from (select id, public.instr_team_ids(public.jsonb_text_array(data->'teams'), data->>'folder', ws) as t from public.instructions where ws = new.ws) x
   where i.id = x.id and i.teams_eff is distinct from x.t;
  return new;
end $$;
drop trigger if exists ws_teams_cascade on public.workspaces;
create trigger ws_teams_cascade after insert or update of folders, teams on public.workspaces for each row execute function public.ws_teams_cascade();

-- ---------- policies on the column; caller lookups once per statement ----------
drop policy if exists instr_select_ws on public.instructions;
drop policy if exists instr_write on public.instructions;
drop policy if exists instr_update on public.instructions;
drop policy if exists instr_delete on public.instructions;
drop function if exists public.my_can_see(text[], text, text);
drop index if exists public.instructions_ws_folder;
alter table public.instructions drop column if exists teams;
alter table public.instructions drop column if exists folder;

create policy instr_select_ws on public.instructions for select to authenticated
  using (ws = (select public.my_ws())
         and ((select public.my_admin()) or coalesce(array_length(teams_eff, 1), 0) = 0 or teams_eff && (select public.my_team_ids())));
create policy instr_write on public.instructions for insert to authenticated
  with check (ws = (select public.my_ws())
              and (public.my_can('edit', public.jsonb_text_array(data->'teams'), data->>'folder', ws)
                   or (coalesce(array_length(public.instr_team_ids(public.jsonb_text_array(data->'teams'), data->>'folder', ws), 1), 0) = 0 and public.my_can_any('edit'))));
create policy instr_update on public.instructions for update to authenticated
  using (ws = (select public.my_ws())
         and ((select public.my_admin()) or coalesce(array_length(teams_eff, 1), 0) = 0 or teams_eff && (select public.my_team_ids()))
         and (public.my_can('edit', public.jsonb_text_array(data->'teams'), data->>'folder', ws) or public.my_can('approve_tech', public.jsonb_text_array(data->'teams'), data->>'folder', ws)
              or public.my_can('approve_dsgvo', public.jsonb_text_array(data->'teams'), data->>'folder', ws) or public.my_can('lock', public.jsonb_text_array(data->'teams'), data->>'folder', ws)))
  with check (ws = (select public.my_ws()));
create policy instr_delete on public.instructions for delete to authenticated
  using (ws = (select public.my_ws())
         and ((select public.my_admin()) or coalesce(array_length(teams_eff, 1), 0) = 0 or teams_eff && (select public.my_team_ids()))
         and public.my_can('edit', public.jsonb_text_array(data->'teams'), data->>'folder', ws));

-- ---------- backfill (the row trigger computes the value; the guard is bypassed – no content changes) ----------
select set_config('giri.bypass_guard', '1', true);
update public.instructions set teams_eff = teams_eff;
