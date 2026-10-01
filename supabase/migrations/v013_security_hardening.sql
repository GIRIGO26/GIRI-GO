-- v013 (v12.48.0) – security hardening after the review of 1 Oct 2026
--
-- Findings (all reproduced on the Frankfurt project before this migration, see supabase/tests/security.sql):
--   A  any signed-in user could change the e-mail in their own profile; team roles and platform-admin status (is_master)
--      were decided by profiles.email → a user could take over someone's team roles or become platform admin
--   B  a writer (creator/editor) could change the workspace row: invite people as admin, give themselves team_admin
--   C  every signed-in user could read every workspace row (members, e-mails, roles, link-password hashes)
--   D  anyone could list all files of the media bucket through the API (17 000 objects, all workspaces)
--
-- Fixes:
--   1  identity: profiles.email (and id) can only be changed by the system; an e-mail change of the login is copied over by
--      trigger; is_master() reads the e-mail of the login (auth.users), not of the profile; admins cannot change their own role
--   2  workspace writes: teams, invites, settings, branding and the name → org admins (and platform admins) only;
--      folders → the 'projects' right; custom symbols → the 'edit' right
--   3  workspace reads: members of the workspace (and platform admins) only; anonymous worker links get the branding through
--      ws_brand(ws), which returns nothing but the brand
--   4  storage: reading/listing through the API only inside the own workspace folder; public file URLs keep working
--   5  workspace rows for accounts from before v12.47 that never got one (so the master panel lists them; behaviour unchanged)
--   6  invitation e-mails (edge function invite-notify): a log that only the service role can read and write – the function counts
--      it to limit mails per invitation, workspace and hour (no free mail relay through self-service sign-up)

-- ---------- 1. identity ----------
create or replace function public.is_master() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins a join auth.users u on lower(u.email) = lower(a.email) where u.id = auth.uid())
$$;

create or replace function public.profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare v_sys boolean := current_setting('giri.bypass_guard', true) = '1';
begin
  if new.ws is distinct from old.ws and not v_sys then
    raise exception 'a workspace change is a platform action' using errcode = '42501';
  end if;
  if v_sys or auth.uid() is null then return new; end if;
  if new.id is distinct from old.id or lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, '')) then
    raise exception 'the e-mail of a profile follows the login and cannot be changed' using errcode = '42501';
  end if;
  if new.role is distinct from old.role or new.is_admin is distinct from old.is_admin then
    if not public.my_admin() then raise exception 'only admins can change roles' using errcode = '42501'; end if;
    if new.id = auth.uid() then raise exception 'admins cannot change their own role' using errcode = '42501'; end if;
  end if;
  if new.created_at is distinct from old.created_at then new.created_at := old.created_at; end if;
  return new;
end $$;

create or replace function public.sync_profile_email() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and lower(new.email) is distinct from lower(coalesce(old.email, '')) then
    perform set_config('giri.bypass_guard', '1', true);
    update public.profiles set email = lower(new.email) where id = new.id;
    perform set_config('giri.bypass_guard', '0', true);
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_email_change on auth.users;
create trigger on_auth_user_email_change after update of email on auth.users for each row execute function public.sync_profile_email();
revoke execute on function public.sync_profile_email() from public, anon, authenticated;

-- ---------- 2. workspace writes ----------
create or replace function public.ws_write_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or current_setting('giri.bypass_guard', true) = '1' then return new; end if;
  if public.my_admin() or public.is_master() then return new; end if;
  if tg_op = 'INSERT' then
    if jsonb_array_length(coalesce(new.teams, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(new.invites, '[]'::jsonb)) > 0
       or coalesce(new.settings, '{}'::jsonb) <> '{}'::jsonb or coalesce(new.brand, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'only admins can set up teams, invitations, settings or branding' using errcode = '42501';
    end if;
    if jsonb_array_length(coalesce(new.folders, '[]'::jsonb)) > 0 and not public.my_can_any('projects') then
      raise exception 'no right to manage folders' using errcode = '42501';
    end if;
    if jsonb_array_length(coalesce(new.symbols, '[]'::jsonb)) > 0 and not public.my_can_any('edit') then
      raise exception 'no right to add symbols' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.teams is distinct from old.teams then raise exception 'only admins can change teams and team roles' using errcode = '42501'; end if;
  if new.invites is distinct from old.invites then raise exception 'only admins can invite people' using errcode = '42501'; end if;
  if new.brand is distinct from old.brand then raise exception 'only admins can change the branding' using errcode = '42501'; end if;
  if new.name is distinct from old.name then raise exception 'only admins can rename the workspace' using errcode = '42501'; end if;
  if new.folders is distinct from old.folders and not public.my_can_any('projects') then
    raise exception 'no right to manage folders' using errcode = '42501';
  end if;
  if new.symbols is distinct from old.symbols and not public.my_can_any('edit') then
    raise exception 'no right to change symbols' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists ws_write_guard on public.workspaces;
create trigger ws_write_guard before insert or update on public.workspaces for each row execute function public.ws_write_guard();
revoke execute on function public.ws_write_guard() from public, anon, authenticated;

-- the settings guard follows the same pattern (system writes and migrations pass)
create or replace function public.ws_settings_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or current_setting('giri.bypass_guard', true) = '1' then return new; end if;
  if new.settings is distinct from old.settings and not (public.my_admin() or public.is_master()) then
    raise exception 'only admins can change workspace settings' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------- 3. workspace reads ----------
drop policy if exists ws_select on public.workspaces;
create policy ws_select on public.workspaces for select to authenticated
  using (ws = (select public.my_ws()) or (select public.is_master()));

create or replace function public.ws_brand(p_ws text) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select brand from public.workspaces where ws = p_ws), '{}'::jsonb)
$$;
revoke execute on function public.ws_brand(text) from public;
grant execute on function public.ws_brand(text) to anon, authenticated;

-- ---------- 4. storage ----------
drop policy if exists media_read on storage.objects;
drop policy if exists media_read_ws on storage.objects;
create policy media_read_ws on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select public.my_ws()));

-- ---------- 5. missing workspace rows (accounts from before v12.47) ----------
insert into public.workspaces (ws, name, brand, folders, teams, invites, symbols, settings, plan, plan_until, open_domain, owner_email, plan_note, created_at, updated_at)
select p.ws, p.ws, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
       'active', null, (p.ws !~ '@' and p.ws ~ '^[a-z0-9.-]+\.[a-z]{2,}$'), (array_agg(p.email order by p.created_at))[1],
       'Bestand vor v12.47 (Zeile nachgetragen in v12.48)', min(p.created_at), now()
from public.profiles p
where not exists (select 1 from public.workspaces w where w.ws = p.ws)
group by p.ws;

-- ---------- 6. invitation mails: log for the limits of invite-notify (service role only) ----------
create table if not exists public.mail_log (
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  ws text not null, kind text not null, by_user uuid, to_email text not null, ok boolean not null default true, error text);
create index if not exists mail_log_ws_at on public.mail_log (ws, kind, at desc);
create index if not exists mail_log_at on public.mail_log (at desc);
alter table public.mail_log enable row level security;
revoke all on public.mail_log from public, anon, authenticated;
-- no policies on purpose: browsers never see it; invite-notify (service role) writes and counts, rows older than 90 days are removed
