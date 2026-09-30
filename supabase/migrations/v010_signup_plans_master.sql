-- v12.47.0 – go-live: self sign-up per company, invitations across domains, plans/trials, platform ("master") admins
--
-- Before: a new sign-up landed in the workspace of its e-mail domain (ws = domain) – two companies sharing a mail provider, or a
-- customer's supplier, would have seen each other. Now:
--   1. an invitation (in any workspace) wins – the person joins that workspace with the invited role;
--   2. else the domain's workspace, but only when it allows joining by domain (open_domain – switched on for the workspaces
--      that exist today, so nothing changes for them);
--   3. else a workspace of their own: the first user is its admin, 30 days trial, and the platform admins get a mail.
-- Plans (trial | active | demo | suspended), trial end, seats, notes and the domain switch are platform fields: workspace admins
-- cannot change them (ws_plan_guard); a suspended workspace is read-only (instr_authz_guard). Platform admins (platform_admins,
-- seeded with bjoern@ar-giri.com) get RPCs for the master panel: overview, users, plan, move user, merge workspaces, demo accounts.

-- ---------- 1. workspace columns ----------
alter table public.workspaces
  add column if not exists name text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists plan text not null default 'trial',
  add column if not exists plan_until timestamptz,
  add column if not exists seats int,
  add column if not exists plan_note text,
  add column if not exists open_domain boolean not null default false,
  add column if not exists owner_email text;
alter table public.workspaces drop constraint if exists workspaces_plan_check;
alter table public.workspaces add constraint workspaces_plan_check check (plan in ('trial', 'active', 'demo', 'suspended'));
-- the workspaces that exist today keep their behaviour: colleagues join by domain, no trial
update public.workspaces set open_domain = true, plan = 'active', plan_note = 'bestand vor v12.47' where plan_note is null;
update public.workspaces w set owner_email = (select p.email from public.profiles p where p.ws = w.ws and (p.is_admin or p.role = 'admin') order by p.created_at limit 1) where owner_email is null;
update public.workspaces set name = ws where name is null;

-- ---------- 2. platform admins ----------
create table if not exists public.platform_admins (email text primary key, added_at timestamptz not null default now());
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;
insert into public.platform_admins (email) values ('bjoern@ar-giri.com') on conflict do nothing;
create or replace function public.is_master() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins a join public.profiles p on lower(p.email) = lower(a.email) where p.id = auth.uid()) $$;
revoke all on function public.is_master() from public; grant execute on function public.is_master() to authenticated;

-- plan fields belong to the platform – a workspace admin's upsert keeps the old values
create or replace function public.ws_plan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and current_setting('giri.bypass_guard', true) is distinct from '1' and not public.is_master() then
    new.plan := old.plan; new.plan_until := old.plan_until; new.seats := old.seats; new.plan_note := old.plan_note;
    new.open_domain := old.open_domain; new.owner_email := old.owner_email; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists ws_plan_guard on public.workspaces;
create trigger ws_plan_guard before update on public.workspaces for each row execute function public.ws_plan_guard();
revoke execute on function public.ws_plan_guard() from public, anon, authenticated;

-- ---------- 3. where a new user lands ----------
create or replace function public.place_new_user(p_id uuid, p_email text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(coalesce(p_email, '')); v_domain text; v_ws text; v_role text; v_admin boolean := false; v_name text; v_public boolean; v_rnd text;
begin
  if exists (select 1 from public.profiles where id = p_id) then return; end if;
  if v_email = '' then v_email := p_id::text || '@no-email.local'; end if;
  v_domain := split_part(v_email, '@', 2);
  v_public := v_domain = '' or v_domain in ('gmail.com','googlemail.com','outlook.com','outlook.de','hotmail.com','hotmail.de','live.com','live.de','msn.com','yahoo.com','yahoo.de','icloud.com','me.com','mac.com','web.de','gmx.de','gmx.net','gmx.at','gmx.ch','t-online.de','freenet.de','aol.com','proton.me','protonmail.com','posteo.de','mail.de','mailbox.org','yandex.com','ymail.com');
  v_name := coalesce(nullif(p_name, ''), split_part(v_email, '@', 1));
  -- 1. an invitation anywhere wins (the newest one)
  select w.ws, i->>'role' into v_ws, v_role from public.workspaces w, jsonb_array_elements(coalesce(w.invites, '[]'::jsonb)) i
   where lower(i->>'email') = v_email order by coalesce((i->>'at')::numeric, 0) desc limit 1;
  -- 2. else the domain's workspace, if it lets colleagues join by domain
  if v_ws is null and not v_public then
    select ws into v_ws from public.workspaces where ws = v_domain and open_domain limit 1;
    if v_ws is not null then v_role := 'creator'; end if;
  end if;
  -- 3. else a workspace of their own (30 days trial, first user = admin)
  if v_ws is null then
    v_rnd := substr(md5(random()::text || clock_timestamp()::text), 1, 5);
    v_ws := regexp_replace(lower(case when v_public then split_part(v_email, '@', 1) else v_domain end), '[^a-z0-9]+', '-', 'g') || '-' || v_rnd;
    insert into public.workspaces (ws, name, brand, folders, teams, invites, symbols, settings, plan, plan_until, open_domain, owner_email, updated_at)
      values (v_ws, case when v_public then v_name else v_domain end, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'trial', now() + interval '30 days', false, v_email, now());
    v_role := 'admin';
  end if;
  if v_role = 'admin' then v_admin := true; end if;
  if not exists (select 1 from public.profiles where ws = v_ws) then v_admin := true; end if;  -- the first person of a workspace administers it
  if v_role = 'reviewer' then v_role := 'approver'; end if;
  if v_role is null or v_role not in ('admin','viewer','editor','approver','tech_approver','compliance_approver','compliance_manager','creator','team_admin') then v_role := 'creator'; end if;
  insert into public.profiles (id, email, name, role, ws, is_admin) values (p_id, v_email, v_name, v_role, v_ws, v_admin) on conflict (id) do nothing;
  update public.workspaces set invites = coalesce((select jsonb_agg(i) from jsonb_array_elements(coalesce(invites, '[]'::jsonb)) i where lower(i->>'email') <> v_email), '[]'::jsonb)
   where ws = v_ws and exists (select 1 from jsonb_array_elements(coalesce(invites, '[]'::jsonb)) i where lower(i->>'email') = v_email);
end $$;
revoke all on function public.place_new_user(uuid, text, text) from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.place_new_user(new.id, coalesce(new.email, new.raw_user_meta_data->>'email', new.raw_user_meta_data->>'preferred_username'),
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), nullif(new.raw_user_meta_data->>'full_name', '')));
  return new;
end $$;

-- the app's fallback when the trigger has not created a profile yet (never lets the browser choose a workspace)
create or replace function public.ensure_profile() returns setof public.profiles
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    perform public.place_new_user(auth.uid(), auth.jwt()->>'email', coalesce(auth.jwt()->'user_metadata'->>'name', auth.jwt()->'user_metadata'->>'full_name'));
  end if;
  return query select * from public.profiles where id = auth.uid();
end $$;
revoke all on function public.ensure_profile() from public; grant execute on function public.ensure_profile() to authenticated;

-- ---------- 4. sign-up mail to the platform admins ----------
create or replace function public.signup_poke(p_id uuid) returns void
language plpgsql security definer set search_path = public, vault, extensions, net as $$
declare v_secret text;
begin
  if p_id is null then return; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'hs_sync_secret' limit 1;
  if v_secret is null then return; end if;
  perform net.http_post(url := 'https://hcomtmogkuxxchrnticq.supabase.co/functions/v1/signup-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-giri-secret', v_secret, 'apikey', 'sb_publishable_DPCsusG0yVnugNpJaB-vpA_-DLUJaLW'),
    body := jsonb_build_object('user_id', p_id), timeout_milliseconds := 10000);
exception when others then null;
end $$;
revoke all on function public.signup_poke(uuid) from public, anon, authenticated;
create or replace function public.profiles_signup_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.signup_poke(new.id); return new; end $$;
revoke execute on function public.profiles_signup_notify() from public, anon, authenticated, service_role;
drop trigger if exists profiles_signup_notify on public.profiles;
create trigger profiles_signup_notify after insert on public.profiles for each row execute function public.profiles_signup_notify();

-- ---------- 5. suspended workspaces are read-only ----------
create or replace function public.instr_authz_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  meta text[] := array['approvals','status','history','pendingNote','lastBy','publishedAt','version','shareKey','updatedAt','_base','translations','txSrc','txHash'];
  old_ap jsonb := '{}'::jsonb; new_ap jsonb; t_ids text[]; f_id text; changed boolean;
begin
  if uid is null or current_setting('giri.bypass_guard', true) = '1' then return new; end if;  -- service role, migrations, maintenance
  if exists (select 1 from public.workspaces w where w.ws = new.ws and w.plan = 'suspended') then
    raise exception 'workspace suspended' using errcode = '42501';
  end if;
  new_ap := coalesce(new.data->'approvals', '{}'::jsonb);
  if tg_op = 'UPDATE' then old_ap := coalesce(old.data->'approvals', '{}'::jsonb); end if;
  t_ids := public.jsonb_text_array(new.data->'teams'); f_id := new.data->>'folder';
  if new_ap->'tech' is not null and new_ap->'tech' <> 'null'::jsonb and coalesce(old_ap->'tech', 'null'::jsonb) <> new_ap->'tech'
     and not public.my_can('approve_tech', t_ids, f_id, new.ws) then
    raise exception 'technical approval needs the approver role' using errcode = '42501';
  end if;
  if new_ap->'dsgvo' is not null and new_ap->'dsgvo' <> 'null'::jsonb and coalesce(old_ap->'dsgvo', 'null'::jsonb) <> new_ap->'dsgvo'
     and not public.my_can('approve_dsgvo', t_ids, f_id, new.ws) then
    raise exception 'privacy approval needs the compliance approver role' using errcode = '42501';
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and (coalesce(new_ap->'tech', 'null'::jsonb) = 'null'::jsonb or coalesce(new_ap->'dsgvo', 'null'::jsonb) = 'null'::jsonb) then
    raise exception 'publishing needs both approvals' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    changed := (new.data - meta) is distinct from (old.data - meta) or new.title is distinct from old.title;
    if changed and not public.my_can('edit', public.jsonb_text_array(old.data->'teams'), old.data->>'folder', old.ws) then
      raise exception 'editing needs the editor role' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- role changes by the platform functions pass the profile guard
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.is_admin is distinct from old.is_admin or new.ws is distinct from old.ws) then
    if auth.uid() is not null and current_setting('giri.bypass_guard', true) is distinct from '1' and not public.my_admin() then
      raise exception 'only admins can change roles';
    end if;
    if new.ws is distinct from old.ws and current_setting('giri.bypass_guard', true) is distinct from '1' then
      raise exception 'a workspace change is a platform action' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ---------- 6. master RPCs ----------
create or replace function public.master_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'platform admin only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select jsonb_build_object('ws', w.ws, 'name', w.name, 'plan', w.plan, 'plan_until', w.plan_until, 'seats', w.seats, 'plan_note', w.plan_note,
      'open_domain', w.open_domain, 'owner_email', w.owner_email, 'created_at', w.created_at,
      'users', (select count(*) from public.profiles p where p.ws = w.ws),
      'instructions', (select count(*) from public.instructions i where i.ws = w.ws and i.deleted_at is null),
      'published', (select count(*) from public.instructions i where i.ws = w.ws and i.deleted_at is null and i.status = 'published'),
      'last_activity', (select max(i.updated_at) from public.instructions i where i.ws = w.ws),
      'last_login', (select max(u.last_sign_in_at) from public.profiles p join auth.users u on u.id = p.id where p.ws = w.ws)) as x
    from public.workspaces w) s), '[]'::jsonb);
end $$;

create or replace function public.master_users(p_ws text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'platform admin only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'role', p.role, 'is_admin', p.is_admin, 'created_at', p.created_at,
      'last_login', u.last_sign_in_at, 'instructions', (select count(*) from public.instructions i where i.owner = p.id and i.deleted_at is null)) order by p.created_at)
    from public.profiles p left join auth.users u on u.id = p.id where p.ws = p_ws), '[]'::jsonb);
end $$;

create or replace function public.master_set_plan(p_ws text, p_plan text, p_until timestamptz, p_seats int, p_note text, p_open_domain boolean, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'platform admin only' using errcode = '42501'; end if;
  perform set_config('giri.bypass_guard', '1', true);
  update public.workspaces set plan = coalesce(p_plan, plan), plan_until = p_until, seats = p_seats, plan_note = p_note,
    open_domain = coalesce(p_open_domain, open_domain), name = coalesce(nullif(p_name, ''), name), updated_at = now() where ws = p_ws;
  if not found then raise exception 'workspace % not found', p_ws; end if;
end $$;

-- a person moves to another workspace (optionally with the instructions they own); memberships in the old teams are dropped
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
  return jsonb_build_object('moved', true, 'instructions', n);
end $$;

-- everything of one workspace goes into another (two colleagues who signed up separately); the empty one is deleted
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
  return jsonb_build_object('instructions', n_i, 'users', n_p, 'into', p_into);
end $$;

-- a demo workspace for a prospect: they sign in with this e-mail and land in it as admin (30 days, plan demo)
create or replace function public.master_create_demo(p_email text, p_name text, p_days int) returns text
language plpgsql security definer set search_path = public as $$
declare v_ws text; v_email text := lower(trim(p_email));
begin
  if not public.is_master() then raise exception 'platform admin only' using errcode = '42501'; end if;
  if v_email = '' or v_email not like '%@%' then raise exception 'e-mail missing'; end if;
  if exists (select 1 from public.profiles where lower(email) = v_email) then raise exception 'this e-mail already has an account – move the user instead'; end if;
  v_ws := 'demo-' || regexp_replace(lower(coalesce(nullif(p_name, ''), split_part(v_email, '@', 1))), '[^a-z0-9]+', '-', 'g') || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
  insert into public.workspaces (ws, name, brand, folders, teams, invites, symbols, settings, plan, plan_until, open_domain, owner_email, plan_note, updated_at)
    values (v_ws, coalesce(nullif(p_name, ''), 'Demo ' || v_email), '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('email', v_email, 'role', 'admin', 'at', (extract(epoch from now()) * 1000)::bigint, 'by', 'master')),
      '[]'::jsonb, '{}'::jsonb, 'demo', now() + make_interval(days => greatest(1, coalesce(p_days, 30))), false, v_email, 'Demo-Konto', now());
  return v_ws;
end $$;

create or replace function public.master_add_admin(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'platform admin only' using errcode = '42501'; end if;
  insert into public.platform_admins (email) values (lower(trim(p_email))) on conflict do nothing;
end $$;

revoke all on function public.master_overview(), public.master_users(text), public.master_set_plan(text, text, timestamptz, int, text, boolean, text), public.master_move_user(text, text, boolean), public.master_merge_workspace(text, text), public.master_create_demo(text, text, int), public.master_add_admin(text) from public;
grant execute on function public.master_overview(), public.master_users(text), public.master_set_plan(text, text, timestamptz, int, text, boolean, text), public.master_move_user(text, text, boolean), public.master_merge_workspace(text, text), public.master_create_demo(text, text, int), public.master_add_admin(text) to authenticated;

-- ---------- 7. invites are no longer bound to the domain: the workspace row carries them, place_new_user finds them anywhere ----------
-- (nothing to change in the schema; the Admin page's domain check goes away in the app)
