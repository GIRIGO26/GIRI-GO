-- ============================================================
-- GIRI Go — Supabase Schema  (einmal im SQL Editor ausführen)
-- ============================================================

-- ---------- Profile (1 Zeile pro User, Workspace = E-Mail-Domain) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'creator' check (role in ('creator','reviewer','viewer')),
  ws text not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role, ws)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    'creator',
    lower(split_part(new.email,'@',2))
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Hilfsfunktion: Workspace des eingeloggten Users
create or replace function public.my_ws() returns text
language sql stable security definer set search_path = public as $$
  select ws from public.profiles where id = auth.uid()
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------- Anleitungen ----------
create table if not exists public.instructions (
  id text primary key,
  ws text not null,
  status text not null default 'draft' check (status in ('draft','review','published')),
  title text not null default '',
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists instructions_ws_idx on public.instructions (ws, updated_at desc);

-- ---------- Checklisten-Durchführungen ----------
create table if not exists public.runs (
  id text primary key,
  instr_id text not null references public.instructions(id) on delete cascade,
  ws text not null,
  worker text not null default '',
  version int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items jsonb not null default '{}'::jsonb
);
create index if not exists runs_instr_idx on public.runs (instr_id, started_at desc);

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.instructions enable row level security;
alter table public.runs enable row level security;

-- Profile: Kollegen im Workspace sehen sich gegenseitig, jeder ändert nur sich selbst
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (ws = public.my_ws());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Anleitungen: veröffentlichte sind öffentlich lesbar (Link/QR ohne Login), sonst nur Workspace
drop policy if exists instr_select_public on public.instructions;
create policy instr_select_public on public.instructions for select to anon, authenticated using (status = 'published');
drop policy if exists instr_select_ws on public.instructions;
create policy instr_select_ws on public.instructions for select to authenticated using (ws = public.my_ws());
drop policy if exists instr_write on public.instructions;
create policy instr_write on public.instructions for insert to authenticated with check (ws = public.my_ws() and public.my_role() in ('creator','reviewer'));
drop policy if exists instr_update on public.instructions;
create policy instr_update on public.instructions for update to authenticated using (ws = public.my_ws() and public.my_role() in ('creator','reviewer')) with check (ws = public.my_ws());
drop policy if exists instr_delete on public.instructions;
create policy instr_delete on public.instructions for delete to authenticated using (ws = public.my_ws() and public.my_role() in ('creator','reviewer'));

-- Durchführungen: Werker (ohne Login) darf für veröffentlichte Anleitungen eintragen, Workspace liest
drop policy if exists runs_insert on public.runs;
create policy runs_insert on public.runs for insert to anon, authenticated
  with check (exists (select 1 from public.instructions i where i.id = runs.instr_id and i.status = 'published' and i.ws = runs.ws));
drop policy if exists runs_select on public.runs;
create policy runs_select on public.runs for select to authenticated using (ws = public.my_ws());

-- ---------- Storage: Bucket "media" (öffentlich lesbar, Upload nur eigener Workspace) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 104857600)
on conflict (id) do update set public = true, file_size_limit = 104857600;

drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects for select to anon, authenticated using (bucket_id = 'media');

drop policy if exists media_upload_ws on storage.objects;
create policy media_upload_ws on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = public.my_ws());

-- Beweisfotos aus der Checkliste (Werker ohne Login) landen unter runs/…
drop policy if exists media_upload_runs on storage.objects;
create policy media_upload_runs on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = 'runs');

drop policy if exists media_update_ws on storage.objects;
create policy media_update_ws on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = public.my_ws());
drop policy if exists media_delete_ws on storage.objects;
create policy media_delete_ws on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = public.my_ws());

-- ---------- Realtime (Sync zwischen Handy und PC) ----------
do $$ begin
  alter publication supabase_realtime add table public.instructions;
exception when duplicate_object then null; end $$;

-- ---------- Branding pro Workspace (Viewer + PDF) ----------
create table if not exists public.workspaces (
  ws text primary key,
  brand jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
drop policy if exists ws_select on public.workspaces;
create policy ws_select on public.workspaces for select to anon, authenticated using (true);
drop policy if exists ws_insert on public.workspaces;
create policy ws_insert on public.workspaces for insert to authenticated with check (ws = public.my_ws() and public.my_role() in ('creator','reviewer'));
drop policy if exists ws_update on public.workspaces;
create policy ws_update on public.workspaces for update to authenticated using (ws = public.my_ws() and public.my_role() in ('creator','reviewer')) with check (ws = public.my_ws());

-- ---------- Aufrufe / Statistik ----------
create table if not exists public.views (
  id text primary key,
  instr_id text not null references public.instructions(id) on delete cascade,
  ws text not null,
  version int not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_s int not null default 0,
  steps_seen int not null default 0,
  steps_total int not null default 0,
  completed boolean not null default false,
  reload boolean not null default false,
  device text
);
create index if not exists views_instr_idx on public.views (instr_id, started_at desc);
create index if not exists views_ws_idx on public.views (ws);
alter table public.views enable row level security;
drop policy if exists views_insert on public.views;
create policy views_insert on public.views for insert to anon, authenticated
  with check (exists (select 1 from public.instructions i where i.id = views.instr_id and i.status = 'published' and i.ws = views.ws));
drop policy if exists views_update on public.views;
create policy views_update on public.views for update to anon, authenticated
  using (started_at > now() - interval '1 day') with check (started_at > now() - interval '1 day');
drop policy if exists views_select on public.views;
create policy views_select on public.views for select to authenticated using (ws = public.my_ws());
create or replace view public.instr_stats with (security_invoker = true) as
  select instr_id, ws, count(*)::int as views, count(*) filter (where reload)::int as reloads,
    coalesce(avg(duration_s) filter (where duration_s > 0), 0)::int as avg_duration_s,
    count(*) filter (where completed)::int as completed,
    coalesce(avg(steps_seen) filter (where steps_total > 0), 0)::numeric(6,1) as avg_steps_seen,
    max(started_at) as last_view
  from public.views group by instr_id, ws;
grant select on public.instr_stats to authenticated;

-- ---------- Projekte (Ordner), Teams, Einladungen, Admin ----------
-- workspaces.folders: [{id, name, teams:[teamId]}]   workspaces.teams: [{id, name, members:[{email, role}]}]
-- workspaces.invites: [{email, role, at}]            profiles.is_admin: erster Benutzer eines Workspace
alter table public.workspaces add column if not exists folders jsonb not null default '[]'::jsonb;
alter table public.workspaces add column if not exists teams jsonb not null default '[]'::jsonb;
alter table public.workspaces add column if not exists invites jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists is_admin boolean not null default false;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ws text; v_cnt int; v_role text;
begin
  v_ws := lower(split_part(new.email,'@',2));
  select count(*) into v_cnt from public.profiles where ws = v_ws;
  select i->>'role' into v_role
    from public.workspaces w, jsonb_array_elements(coalesce(w.invites,'[]'::jsonb)) i
    where w.ws = v_ws and lower(i->>'email') = lower(new.email) limit 1;
  if v_role is null or v_role not in ('creator','reviewer','viewer') then v_role := 'creator'; end if;
  insert into public.profiles (id, email, name, role, ws, is_admin)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), v_role, v_ws, (v_cnt = 0))
  on conflict (id) do nothing;
  update public.workspaces set invites = coalesce((select jsonb_agg(i) from jsonb_array_elements(invites) i where lower(i->>'email') <> lower(new.email)), '[]'::jsonb) where ws = v_ws;
  return new;
end $$;

update public.profiles p set is_admin = true
  where not exists (select 1 from public.profiles q where q.ws = p.ws and q.is_admin)
    and p.id = (select id from public.profiles q where q.ws = p.ws order by created_at limit 1);

create or replace function public.my_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (ws = public.my_ws() and public.my_admin()) with check (ws = public.my_ws());
drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles for delete to authenticated
  using (ws = public.my_ws() and public.my_admin() and id <> auth.uid());

-- Rolle/Admin-Flag darf nur ein Admin ändern
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.is_admin is distinct from old.is_admin) then
    if auth.uid() is not null and not public.my_admin() then
      raise exception 'only admins can change roles';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before update on public.profiles for each row execute procedure public.profiles_guard();

-- Öffentliche Links (anon) lesen vom Workspace nur das Branding – Teams/Einladungen (E-Mails) bleiben intern
revoke select on public.workspaces from anon;
grant select (ws, brand, updated_at) on public.workspaces to anon;

-- Workspace-Zeile (Projekte/Teams/Einladungen): Creator, Prüfer und Admins
drop policy if exists ws_insert on public.workspaces;
create policy ws_insert on public.workspaces for insert to authenticated with check (ws = public.my_ws() and (public.my_role() in ('creator','reviewer') or public.my_admin()));
drop policy if exists ws_update on public.workspaces;
create policy ws_update on public.workspaces for update to authenticated using (ws = public.my_ws() and (public.my_role() in ('creator','reviewer') or public.my_admin())) with check (ws = public.my_ws());

-- ---------- UI-Übersetzungen (Cache pro Quelltext + Zielsprache, nur Edge Function / service role) ----------
create table if not exists public.ui_tx (
  h text not null, target text not null, src text not null, txt text not null,
  created_at timestamptz not null default now(), primary key (h, target)
);
create index if not exists ui_tx_created_idx on public.ui_tx (created_at);
alter table public.ui_tx enable row level security;
revoke all on public.ui_tx from anon, authenticated;

-- ---------- v0.10: Rollen (admin = Super Admin), laufende Checklisten ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','creator','reviewer','viewer'));
create or replace function public.my_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin or role = 'admin' from public.profiles where id = auth.uid()), false)
$$;
drop policy if exists instr_write on public.instructions;
create policy instr_write on public.instructions for insert to authenticated with check (ws = public.my_ws() and public.my_role() in ('admin','creator','reviewer'));
drop policy if exists instr_update on public.instructions;
create policy instr_update on public.instructions for update to authenticated using (ws = public.my_ws() and public.my_role() in ('admin','creator','reviewer')) with check (ws = public.my_ws());
drop policy if exists instr_delete on public.instructions;
create policy instr_delete on public.instructions for delete to authenticated using (ws = public.my_ws() and public.my_role() in ('admin','creator','reviewer'));
drop policy if exists ws_insert on public.workspaces;
create policy ws_insert on public.workspaces for insert to authenticated with check (ws = public.my_ws() and (public.my_role() in ('admin','creator','reviewer') or public.my_admin()));
drop policy if exists ws_update on public.workspaces;
create policy ws_update on public.workspaces for update to authenticated using (ws = public.my_ws() and (public.my_role() in ('admin','creator','reviewer') or public.my_admin())) with check (ws = public.my_ws());
-- Werker darf seine laufende Durchführung fortschreiben (Job-Done-Protokoll zeigt „läuft“), bis sie abgeschlossen ist
drop policy if exists runs_update on public.runs;
create policy runs_update on public.runs for update to anon, authenticated
  using (finished_at is null and started_at > now() - interval '2 days') with check (started_at > now() - interval '2 days');

-- v0.13: eigene Symbole je Workspace – workspaces.symbols: [{id, name, url, path, ar, alpha, at}] (Bilder in media/<ws>/symbols/<id>.png)
alter table public.workspaces add column if not exists symbols jsonb not null default '[]'::jsonb;
-- v0.14: Passwortschutz für veröffentlichte Links – je Projekt (workspaces.folders[].pw) und/oder je Team (workspaces.teams[].pw)
-- pw = {h: sha256hex(salt || passwort), s: salt}. Default: kein pw → Link offen wie bisher.
-- Passwörter, die für eine Anleitung gelten: Projekt-Passwort + Passwörter aller Teams der Anleitung (Projekt-Teams + direkt zugeordnete Teams). Eines davon genügt.
create or replace function public.instr_pw_hashes(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.pw), '[]'::jsonb) from (
    select f->'pw' as pw
      from public.instructions i join public.workspaces w on w.ws = i.ws,
           jsonb_array_elements(coalesce(w.folders,'[]'::jsonb)) f
      where i.id = p_id and f->>'id' = i.data->>'folder' and (f->'pw') is not null and jsonb_typeof(f->'pw') = 'object'
    union all
    select tm->'pw'
      from public.instructions i join public.workspaces w on w.ws = i.ws,
           jsonb_array_elements(coalesce(w.teams,'[]'::jsonb)) tm
      where i.id = p_id and (tm->'pw') is not null and jsonb_typeof(tm->'pw') = 'object' and (
        tm->>'id' in (select jsonb_array_elements_text(case when jsonb_typeof(i.data->'teams')='array' then i.data->'teams' else '[]'::jsonb end))
        or tm->>'id' in (select jsonb_array_elements_text(coalesce((select case when jsonb_typeof(f->'teams')='array' then f->'teams' else '[]'::jsonb end
                                                                     from jsonb_array_elements(coalesce(w.folders,'[]'::jsonb)) f where f->>'id' = i.data->>'folder' limit 1), '[]'::jsonb)))
      )
  ) x;
$$;
create or replace function public.instr_locked(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select jsonb_array_length(public.instr_pw_hashes(p_id)) > 0;
$$;
-- öffentliche Leserechte: nur veröffentlichte UND nicht passwortgeschützte Anleitungen
drop policy if exists instr_select_public on public.instructions;
create policy instr_select_public on public.instructions for select to anon, authenticated
  using (status = 'published' and not public.instr_locked(id));
-- Öffnen mit Passwort (Viewer): liefert {locked:true} oder {locked:false, row:{…}}
create or replace function public.open_instr(p_id text, p_pw text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record; hs jsonb; h jsonb; ok boolean := false;
begin
  select id, ws, status, title, data, updated_at into r from public.instructions where id = p_id and status = 'published';
  if not found then return null; end if;
  hs := public.instr_pw_hashes(p_id);
  if jsonb_array_length(hs) = 0 then ok := true;
  elsif p_pw is not null and length(p_pw) > 0 then
    for h in select * from jsonb_array_elements(hs) loop
      if encode(extensions.digest(convert_to((h->>'s') || p_pw, 'UTF8'), 'sha256'), 'hex') = h->>'h' then ok := true; end if;
    end loop;
  end if;
  if not ok then return jsonb_build_object('locked', true); end if;
  return jsonb_build_object('locked', false, 'row', to_jsonb(r));
end $$;
revoke all on function public.open_instr(text, text) from public;
grant execute on function public.open_instr(text, text) to anon, authenticated, service_role;
grant execute on function public.instr_locked(text) to anon, authenticated, service_role;
grant execute on function public.instr_pw_hashes(text) to service_role;
-- Google-Login: Name aus dem Google-Profil übernehmen
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ws text; v_cnt int; v_role text;
begin
  v_ws := lower(split_part(new.email,'@',2));
  select count(*) into v_cnt from public.profiles where ws = v_ws;
  select i->>'role' into v_role
    from public.workspaces w, jsonb_array_elements(coalesce(w.invites,'[]'::jsonb)) i
    where w.ws = v_ws and lower(i->>'email') = lower(new.email) limit 1;
  if v_role is null or v_role not in ('creator','reviewer','viewer') then v_role := 'creator'; end if;
  insert into public.profiles (id, email, name, role, ws, is_admin)
  values (new.id, new.email, coalesce(nullif(new.raw_user_meta_data->>'name',''), nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)), v_role, v_ws, (v_cnt = 0))
  on conflict (id) do nothing;
  update public.workspaces set invites = coalesce((select jsonb_agg(i) from jsonb_array_elements(invites) i where lower(i->>'email') <> lower(new.email)), '[]'::jsonb) where ws = v_ws;
  return new;
end $$;

-- v0.14: HubSpot-Sync (GIRIGO-ID, LastInstructionCreated, NumberOfInstructionViews) – Trigger → pg_net → Edge Function hubspot-sync
-- Voraussetzungen: Extensions pg_net + pgcrypto, Vault-Secrets hubspot_token (Private-App-Token) und hs_sync_secret (beliebiger Zufallsstring)
alter table public.instructions add column if not exists owner uuid default auth.uid();
create index if not exists instructions_owner_idx on public.instructions(owner);
update public.instructions i set owner = p.id from public.profiles p where i.owner is null and p.ws = i.ws and p.name = i.data->>'createdBy';
update public.instructions i set owner = (select p.id from public.profiles p where p.ws = i.ws order by p.created_at limit 1) where i.owner is null;
create or replace function public.get_hubspot_token() returns text
language sql stable security definer set search_path = public, vault as $$ select decrypted_secret from vault.decrypted_secrets where name = 'hubspot_token' limit 1 $$;
create or replace function public.get_hs_secret() returns text
language sql stable security definer set search_path = public, vault as $$ select decrypted_secret from vault.decrypted_secrets where name = 'hs_sync_secret' limit 1 $$;
revoke all on function public.get_hubspot_token() from public; grant execute on function public.get_hubspot_token() to service_role;
revoke all on function public.get_hs_secret() from public; grant execute on function public.get_hs_secret() to service_role;
-- select vault.create_secret('<zufallsstring>', 'hs_sync_secret', 'GIRI Go: shared secret DB → hubspot-sync');
-- select vault.create_secret('<pat-eu1-…>', 'hubspot_token', 'HubSpot private app token');
create or replace function public.hs_poke(p_user uuid) returns void
language plpgsql security definer set search_path = public, vault, extensions, net as $$
declare v_secret text; v_url text;
begin
  if p_user is null then return; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'hs_sync_secret' limit 1;
  if v_secret is null then return; end if;
  v_url := 'https://goorpzgcxhtjbaothluv.supabase.co/functions/v1/hubspot-sync';
  perform net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-giri-secret', v_secret, 'apikey', 'sb_publishable_eDo9afwf0tBuFqu1-yYyGg_2Tk3uv_L'),
    body := jsonb_build_object('user_id', p_user), timeout_milliseconds := 8000);
exception when others then null;
end $$;
revoke all on function public.hs_poke(uuid) from public;
create or replace function public.hs_on_profile() returns trigger language plpgsql security definer set search_path = public as $$ begin perform public.hs_poke(new.id); return new; end $$;
create or replace function public.hs_on_instruction() returns trigger language plpgsql security definer set search_path = public as $$ begin perform public.hs_poke(new.owner); return new; end $$;
create or replace function public.hs_on_view() returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid; begin select owner into v_owner from public.instructions where id = new.instr_id; perform public.hs_poke(v_owner); return new; end $$;
drop trigger if exists hs_profile_ins on public.profiles; create trigger hs_profile_ins after insert on public.profiles for each row execute function public.hs_on_profile();
drop trigger if exists hs_instr_ins on public.instructions; create trigger hs_instr_ins after insert on public.instructions for each row execute function public.hs_on_instruction();
drop trigger if exists hs_view_ins on public.views; create trigger hs_view_ins after insert on public.views for each row execute function public.hs_on_view();
create or replace function public.hs_metrics(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', p.id, 'email', p.email, 'name', p.name, 'ws', p.ws, 'created_at', p.created_at,
    'last_instruction_created', (select max(to_timestamp((i.data->>'createdAt')::double precision / 1000)) from public.instructions i where i.owner = p.id and (i.data->>'createdAt') ~ '^[0-9]+$'),
    'instruction_views', (select count(*) from public.views v join public.instructions i on i.id = v.instr_id where i.owner = p.id),
    'instructions', (select count(*) from public.instructions i where i.owner = p.id)
  ) from public.profiles p where p.id = p_user
$$;
revoke all on function public.hs_metrics(uuid) from public; grant execute on function public.hs_metrics(uuid) to service_role;
create or replace function public.hs_all_users() returns setof uuid language sql stable security definer set search_path = public as $$ select id from public.profiles $$;
revoke all on function public.hs_all_users() from public; grant execute on function public.hs_all_users() to service_role;

-- v0.15.1: öffentliche Mail-Anbieter (gmail.com, outlook.com, gmx …) bekommen einen persönlichen Workspace (ws = E-Mail-Adresse)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ws text; v_cnt int; v_role text; v_domain text; v_email text;
begin
  v_email := lower(coalesce(new.email, new.raw_user_meta_data->>'email', new.raw_user_meta_data->>'preferred_username', new.id::text || '@no-email.local'));
  v_domain := split_part(v_email,'@',2);
  if v_domain = '' or v_domain in ('gmail.com','googlemail.com','outlook.com','outlook.de','hotmail.com','hotmail.de','live.com','live.de','msn.com','yahoo.com','yahoo.de','icloud.com','me.com','mac.com','web.de','gmx.de','gmx.net','gmx.at','gmx.ch','t-online.de','freenet.de','aol.com','proton.me','protonmail.com','posteo.de','mail.de','mailbox.org','yandex.com','ymail.com')
    then v_ws := v_email; else v_ws := v_domain; end if;
  select count(*) into v_cnt from public.profiles where ws = v_ws;
  select i->>'role' into v_role
    from public.workspaces w, jsonb_array_elements(coalesce(w.invites,'[]'::jsonb)) i
    where w.ws = v_ws and lower(i->>'email') = v_email limit 1;
  if v_role is null or v_role not in ('creator','reviewer','viewer') then v_role := 'creator'; end if;
  insert into public.profiles (id, email, name, role, ws, is_admin)
  values (new.id, v_email, coalesce(nullif(new.raw_user_meta_data->>'name',''), nullif(new.raw_user_meta_data->>'full_name',''), split_part(v_email,'@',1)), v_role, v_ws, (v_cnt = 0))
  on conflict (id) do nothing;
  update public.workspaces set invites = coalesce((select jsonb_agg(i) from jsonb_array_elements(invites) i where lower(i->>'email') <> v_email), '[]'::jsonb) where ws = v_ws;
  return new;
end $$;

-- ---------- v0.18: Werker-Feedback aus der Anleitung ----------
-- Text + Kategorie (quality = Anleitung verbessern, process = Prozess verbessern), optional Foto/Video (Storage unter runs/fb/…).
-- Der Creator sieht offene Rückmeldungen im Dashboard/Editor und kann ein Medium direkt als neuen Schritt übernehmen.
create table if not exists public.feedback (
  id text primary key,
  instr_id text not null references public.instructions(id) on delete cascade,
  ws text not null,
  step_id text,
  step_no int,
  kind text not null default 'quality',
  text text not null default '',
  worker text not null default '',
  media_url text,
  media_type text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists feedback_instr_idx on public.feedback (instr_id, created_at desc);
create index if not exists feedback_ws_open_idx on public.feedback (ws, status);
alter table public.feedback enable row level security;
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert to anon, authenticated
  with check (exists (select 1 from public.instructions i where i.id = feedback.instr_id and i.status = 'published' and i.ws = feedback.ws));
drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback for select to authenticated using (ws = public.my_ws());
drop policy if exists feedback_update on public.feedback;
create policy feedback_update on public.feedback for update to authenticated using (ws = public.my_ws()) with check (ws = public.my_ws());
drop policy if exists feedback_delete on public.feedback;
create policy feedback_delete on public.feedback for delete to authenticated using (ws = public.my_ws() and (public.my_role() in ('admin','creator','reviewer') or public.my_admin()));

-- ---------- v0.21: Papierkorb (soft delete) ----------
-- Gelöschte Anleitungen bekommen deleted_at und bleiben 30 Tage wiederherstellbar (#/trash). Öffentliche Links und open_instr ignorieren sie sofort.
-- Gelöschte Schritte wandern in instr.data.trash (mit Medien) und lassen sich im Editor zurückholen.
alter table public.instructions add column if not exists deleted_at timestamptz;
create index if not exists instructions_deleted_idx on public.instructions (ws, deleted_at);
drop policy if exists instr_select_public on public.instructions;
create policy instr_select_public on public.instructions for select to anon, authenticated
  using (status = 'published' and deleted_at is null and not public.instr_locked(id));
create or replace function public.open_instr(p_id text, p_pw text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record; hs jsonb; h jsonb; ok boolean := false;
begin
  select id, ws, status, title, data, updated_at into r from public.instructions where id = p_id and status = 'published' and deleted_at is null;
  if not found then return null; end if;
  hs := public.instr_pw_hashes(p_id);
  if jsonb_array_length(hs) = 0 then ok := true;
  elsif p_pw is not null and length(p_pw) > 0 then
    for h in select * from jsonb_array_elements(hs) loop
      if encode(extensions.digest(convert_to((h->>'s') || p_pw, 'UTF8'), 'sha256'), 'hex') = h->>'h' then ok := true; end if;
    end loop;
  end if;
  if not ok then return jsonb_build_object('locked', true); end if;
  return jsonb_build_object('locked', false, 'row', to_jsonb(r));
end $$;
create or replace function public.purge_trash() returns int language sql security definer set search_path = public as $$
  with d as (delete from public.instructions where deleted_at is not null and deleted_at < now() - interval '30 days' returning 1) select count(*)::int from d;
$$;
revoke all on function public.purge_trash() from public;
grant execute on function public.purge_trash() to authenticated, service_role;

-- ---------- v0.23: workspace settings (session length etc.), only admins may change them ----------
alter table public.workspaces add column if not exists settings jsonb not null default '{}'::jsonb;
create or replace function public.ws_settings_guard() returns trigger language plpgsql security definer as $$
begin
  if new.settings is distinct from old.settings and not public.my_admin() then
    raise exception 'only admins can change workspace settings';
  end if;
  return new;
end $$;
drop trigger if exists ws_settings_guard on public.workspaces;
create trigger ws_settings_guard before update on public.workspaces for each row execute function public.ws_settings_guard();

-- ---------- v0.25.1: a save from a device with a stale copy must never drop mediaUrl/mediaPath/posterUrl a step already has ----------
create or replace function public.instr_keep_media() returns trigger language plpgsql as $$
declare i int; s jsonb; o jsonb; steps jsonb; mid text; changed boolean := false;
begin
  if new.data is null or old.data is null then return new; end if;
  steps := coalesce(new.data->'steps', '[]'::jsonb);
  if jsonb_typeof(steps) <> 'array' then return new; end if;
  for i in 0 .. jsonb_array_length(steps)-1 loop
    s := steps->i; mid := s->>'mediaId';
    if mid is null then continue; end if;
    if (s->>'mediaUrl') is null or (s->>'posterUrl') is null then
      select x into o from jsonb_array_elements(coalesce(old.data->'steps','[]'::jsonb)) x where x->>'mediaId' = mid limit 1;
      if o is not null then
        if (s->>'mediaUrl') is null and (o->>'mediaUrl') is not null then
          s := s || jsonb_build_object('mediaUrl', o->'mediaUrl', 'mediaPath', o->'mediaPath'); changed := true;
        end if;
        if (s->>'posterUrl') is null and (o->>'posterUrl') is not null then
          s := (s || jsonb_build_object('posterUrl', o->'posterUrl')) - 'poster'; changed := true;
        end if;
        if changed then steps := jsonb_set(steps, array[i::text], s); end if;
      end if;
    end if;
  end loop;
  if changed then new.data := jsonb_set(new.data, '{steps}', steps); end if;
  return new;
end $$;
drop trigger if exists instr_keep_media on public.instructions;
create trigger instr_keep_media before update on public.instructions for each row execute function public.instr_keep_media();

-- ---------- v0.26: security lockdown (Supabase advisor) – only open_instr/instr_locked stay callable from the browser ----------
revoke execute on function public.get_hubspot_token() from public, anon, authenticated;
revoke execute on function public.get_hs_secret() from public, anon, authenticated;
revoke execute on function public.get_deepl_key() from public, anon, authenticated;
revoke execute on function public.hs_all_users() from public, anon, authenticated;
revoke execute on function public.hs_metrics(uuid) from public, anon, authenticated;
revoke execute on function public.hs_poke(uuid) from public, anon, authenticated;
grant execute on function public.get_hubspot_token(), public.get_hs_secret(), public.get_deepl_key(), public.hs_all_users(), public.hs_metrics(uuid), public.hs_poke(uuid) to service_role;
revoke execute on function public.hs_on_instruction() from public, anon, authenticated, service_role;
revoke execute on function public.hs_on_profile() from public, anon, authenticated, service_role;
revoke execute on function public.hs_on_view() from public, anon, authenticated, service_role;
revoke execute on function public.profiles_guard() from public, anon, authenticated, service_role;
revoke execute on function public.ws_settings_guard() from public, anon, authenticated, service_role;
revoke execute on function public.instr_keep_media() from public, anon, authenticated, service_role;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.instr_pw_hashes(text) from public, anon, authenticated;
revoke execute on function public.purge_trash() from public, anon, authenticated;
revoke execute on function public.my_admin() from public, anon;
revoke execute on function public.my_role() from public, anon;
revoke execute on function public.my_ws() from public, anon;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke execute on functions from authenticated;
alter function public.ws_settings_guard() set search_path = public, pg_temp;
alter function public.instr_keep_media() set search_path = public, pg_temp;
-- anonymous viewers see only the brand of a workspace (no team e-mails, invites, settings)
revoke select on table public.workspaces from anon;
grant select (ws, brand) on table public.workspaces to anon;

-- ---------- v0.28: AI usage log (PDF import via Vertex AI / Gemini, europe-west3) ----------
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  user_id uuid not null, ws text not null, feature text not null, model text, region text,
  bytes int, pages int, tokens_in int, tokens_out int, ok boolean not null default false, error text
);
create index if not exists ai_usage_ws_at on public.ai_usage (ws, at desc);
alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_select_admin on public.ai_usage;
create policy ai_usage_select_admin on public.ai_usage for select to authenticated using (ws = public.my_ws() and public.my_admin());
revoke all on public.ai_usage from anon;
revoke insert, update, delete on public.ai_usage from authenticated;

-- ===== v0.29: client log (langsame Screenwechsel, Kaltstarts, JS-Fehler) + Index für instr_stats =====
create table if not exists public.client_log (
  id uuid primary key default gen_random_uuid(), at timestamptz not null default now(), ws text, uid uuid,
  kind text not null check (kind in ('perf','error')), ctx jsonb, payload jsonb);
alter table public.client_log enable row level security;
create index if not exists client_log_ws_at on public.client_log (ws, at desc);
create index if not exists client_log_at on public.client_log (at);
create policy client_log_insert on public.client_log for insert to anon, authenticated
  with check (length(coalesce(payload::text,'')) < 4000 and length(coalesce(ctx::text,'')) < 1500 and (uid is null or uid = auth.uid()));
create policy client_log_admin_read on public.client_log for select to authenticated using (ws = public.my_ws() and public.my_admin());
revoke all on public.client_log from anon, authenticated; grant insert on public.client_log to anon, authenticated; grant select on public.client_log to authenticated;
create or replace function public.client_log_sweep() returns trigger language plpgsql security definer set search_path = public as $$
begin if random() < 0.02 then delete from public.client_log where at < now() - interval '30 days'; end if; return null; end $$;
revoke execute on function public.client_log_sweep() from public, anon, authenticated;
create trigger client_log_sweep_t after insert on public.client_log for each statement execute function public.client_log_sweep();
create index if not exists views_ws_instr_idx on public.views (ws, instr_id);
-- ---------- v0.33: öffentliche Links mit Schlüssel ----------
-- Jede Anleitung trägt einen zufälligen Share-Key (data.shareKey, 24 Zeichen / 144 Bit). Öffentlicher Link: #/v/<id>/<key>.
-- Anonyme Leser kommen nur noch über open_instr(p_id, p_pw, p_key) an eine Anleitung – die frühere Select-Policy für anon
-- (alle veröffentlichten Anleitungen aller Workspaces per REST lesbar) entfällt. Alte Links ohne Schlüssel melden {stale:true}.
update public.instructions
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('shareKey', translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'))
  where coalesce(data->>'shareKey', '') = '';
drop policy if exists instr_select_public on public.instructions;
-- Policies, die bisher per Unterabfrage auf die öffentlichen Leserechte angewiesen waren (Views, Durchführungen, Feedback)
create or replace function public.instr_public(p_id text, p_ws text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.instructions i where i.id = p_id and i.ws = p_ws and i.status = 'published' and i.deleted_at is null);
$$;
revoke all on function public.instr_public(text, text) from public;
grant execute on function public.instr_public(text, text) to anon, authenticated, service_role;
drop policy if exists runs_insert on public.runs;
create policy runs_insert on public.runs for insert to anon, authenticated with check (public.instr_public(runs.instr_id, runs.ws));
drop policy if exists views_insert on public.views;
create policy views_insert on public.views for insert to anon, authenticated with check (public.instr_public(views.instr_id, views.ws));
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert to anon, authenticated with check (public.instr_public(feedback.instr_id, feedback.ws));
drop function if exists public.open_instr(text, text);
create or replace function public.open_instr(p_id text, p_pw text default null, p_key text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record; hs jsonb; h jsonb; ok boolean := false;
begin
  select id, ws, status, title, data, updated_at into r from public.instructions where id = p_id and status = 'published' and deleted_at is null;
  if not found then return null; end if;
  if p_key is null or length(p_key) < 16 or p_key <> coalesce(r.data->>'shareKey', '') then return jsonb_build_object('stale', true); end if;
  hs := public.instr_pw_hashes(p_id);
  if jsonb_array_length(hs) = 0 then ok := true;
  elsif p_pw is not null and length(p_pw) > 0 then
    for h in select * from jsonb_array_elements(hs) loop
      if encode(extensions.digest(convert_to((h->>'s') || p_pw, 'UTF8'), 'sha256'), 'hex') = h->>'h' then ok := true; end if;
    end loop;
  end if;
  if not ok then return jsonb_build_object('locked', true); end if;
  return jsonb_build_object('locked', false, 'row', to_jsonb(r));
end $$;
revoke all on function public.open_instr(text, text, text) from public;
grant execute on function public.open_instr(text, text, text) to anon, authenticated, service_role;

-- ---------- v0.34: Einladung mit Rolle 'admin' (Struktur-Import aus GIRI Classic: Org-Admins) ----------
-- handle_new_user akzeptiert jetzt auch role='admin' in workspaces.invites → Profil startet als Admin (role 'admin', is_admin true).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ws text; v_cnt int; v_role text; v_domain text; v_email text; v_admin boolean := false;
begin
  v_email := lower(coalesce(new.email, new.raw_user_meta_data->>'email', new.raw_user_meta_data->>'preferred_username', new.id::text || '@no-email.local'));
  v_domain := split_part(v_email,'@',2);
  if v_domain = '' or v_domain in ('gmail.com','googlemail.com','outlook.com','outlook.de','hotmail.com','hotmail.de','live.com','live.de','msn.com','yahoo.com','yahoo.de','icloud.com','me.com','mac.com','web.de','gmx.de','gmx.net','gmx.at','gmx.ch','t-online.de','freenet.de','aol.com','proton.me','protonmail.com','posteo.de','mail.de','mailbox.org','yandex.com','ymail.com')
    then v_ws := v_email; else v_ws := v_domain; end if;
  select count(*) into v_cnt from public.profiles where ws = v_ws;
  select i->>'role' into v_role
    from public.workspaces w, jsonb_array_elements(coalesce(w.invites,'[]'::jsonb)) i
    where w.ws = v_ws and lower(i->>'email') = v_email limit 1;
  if v_role = 'admin' then v_admin := true; end if;
  if v_role is null or v_role not in ('admin','creator','reviewer','viewer') then v_role := 'creator'; end if;
  insert into public.profiles (id, email, name, role, ws, is_admin)
  values (new.id, v_email, coalesce(nullif(new.raw_user_meta_data->>'name',''), nullif(new.raw_user_meta_data->>'full_name',''), split_part(v_email,'@',1)), v_role, v_ws, (v_cnt = 0) or v_admin)
  on conflict (id) do nothing;
  update public.workspaces set invites = coalesce((select jsonb_agg(i) from jsonb_array_elements(invites) i where lower(i->>'email') <> v_email), '[]'::jsonb) where ws = v_ws;
  return new;
end $$;

-- ---------- v0.35: E-Mail an den Ersteller bei neuem Werker-Feedback ----------
-- Trigger auf feedback → pg_net → Edge Function feedback-notify (Shared Secret hs_sync_secret) → Resend (Vault-Secret resend_api_key,
-- Absender GIRI <giri@ar-giri.de>, Domain ar-giri.de in Resend verifiziert). Aus je Anleitung mit data.fbNotify = false. feedback.notified_at verhindert Doppelversand.
-- select vault.create_secret('<re_…>', 'resend_api_key', 'Resend sending key (domain ar-giri.de) for feedback-notify');
alter table public.feedback add column if not exists notified_at timestamptz;
create or replace function public.get_resend_key() returns text
language sql stable security definer set search_path = public, vault as $$ select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1 $$;
revoke execute on function public.get_resend_key() from public, anon, authenticated;
grant execute on function public.get_resend_key() to service_role;
create or replace function public.feedback_poke(p_id text) returns void
language plpgsql security definer set search_path = public, vault, extensions, net as $$
declare v_secret text;
begin
  if p_id is null then return; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'hs_sync_secret' limit 1;
  if v_secret is null then return; end if;
  perform net.http_post(url := 'https://goorpzgcxhtjbaothluv.supabase.co/functions/v1/feedback-notify',
    headers := jsonb_build_object('Content-Type','application/json','x-giri-secret', v_secret, 'apikey', 'sb_publishable_eDo9afwf0tBuFqu1-yYyGg_2Tk3uv_L'),
    body := jsonb_build_object('feedback_id', p_id), timeout_milliseconds := 10000);
exception when others then null;
end $$;
revoke all on function public.feedback_poke(text) from public;
create or replace function public.feedback_on_insert() returns trigger language plpgsql security definer set search_path = public as $$ begin perform public.feedback_poke(new.id); return new; end $$;
revoke execute on function public.feedback_on_insert() from public, anon, authenticated, service_role;
drop trigger if exists feedback_notify_ins on public.feedback;
create trigger feedback_notify_ins after insert on public.feedback for each row execute function public.feedback_on_insert();

-- ============================================================
-- v12.37 – Frankfurt: Google service account from the vault (pdf-analyze v3)
-- vault secret google_sa_json holds the service-account JSON (giri-go-ai, role Vertex AI User)
-- ============================================================
create or replace function public.get_google_sa() returns text language sql security definer set search_path=public as $$ select decrypted_secret from vault.decrypted_secrets where name='google_sa_json' limit 1 $$;
revoke all on function public.get_google_sa() from public, anon, authenticated;
grant execute on function public.get_google_sa() to service_role;

-- ============================================================
-- v12.38.1 – after the move: never let a client write the old project's media host back
-- ============================================================
create or replace function public.instr_rewrite_old_urls() returns trigger language plpgsql as $$
begin
  if new.data::text like '%goorpzgcxhtjbaothluv.supabase.co%' then new.data := replace(new.data::text, 'goorpzgcxhtjbaothluv.supabase.co', 'hcomtmogkuxxchrnticq.supabase.co')::jsonb; end if;
  return new;
end $$;
drop trigger if exists instr_rewrite_old_urls on public.instructions;
create trigger instr_rewrite_old_urls before insert or update on public.instructions for each row execute function public.instr_rewrite_old_urls();
create or replace function public.ws_rewrite_old_urls() returns trigger language plpgsql as $$
begin
  if new.brand::text like '%goorpzgcxhtjbaothluv%' then new.brand := replace(new.brand::text, 'goorpzgcxhtjbaothluv.supabase.co', 'hcomtmogkuxxchrnticq.supabase.co')::jsonb; end if;
  if new.symbols::text like '%goorpzgcxhtjbaothluv%' then new.symbols := replace(new.symbols::text, 'goorpzgcxhtjbaothluv.supabase.co', 'hcomtmogkuxxchrnticq.supabase.co')::jsonb; end if;
  return new;
end $$;
drop trigger if exists ws_rewrite_old_urls on public.workspaces;
create trigger ws_rewrite_old_urls before insert or update on public.workspaces for each row execute function public.ws_rewrite_old_urls();
-- ============================================================
-- v12.39 – roles & permissions like GIRI Classic (8 team roles + org admin)
-- Server side: anyone who is more than a viewer somewhere (workspace role or any team role) may write rows of the
-- workspace; the fine-grained capabilities (edit vs. approve vs. links …) are enforced in the app per instruction.
-- ============================================================
create or replace function public.my_can_write() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((
    select p.is_admin or p.role not in ('viewer')
        or exists (
          select 1 from public.workspaces w, jsonb_array_elements(coalesce(w.teams,'[]'::jsonb)) tm, jsonb_array_elements(coalesce(tm->'members','[]'::jsonb)) m
          where w.ws = p.ws and lower(m->>'email') = lower(p.email) and coalesce(m->>'role','viewer') <> 'viewer')
    from public.profiles p where p.id = auth.uid()), false) $$;
revoke all on function public.my_can_write() from public; grant execute on function public.my_can_write() to authenticated, anon, service_role;

drop policy if exists instr_write on public.instructions;
create policy instr_write on public.instructions for insert to authenticated with check (ws = my_ws() and my_can_write());
drop policy if exists instr_update on public.instructions;
create policy instr_update on public.instructions for update to authenticated using (ws = my_ws() and my_can_write()) with check (ws = my_ws());
drop policy if exists instr_delete on public.instructions;
create policy instr_delete on public.instructions for delete to authenticated using (ws = my_ws() and my_can_write());
drop policy if exists ws_insert on public.workspaces;
create policy ws_insert on public.workspaces for insert to authenticated with check (ws = my_ws() and (my_can_write() or my_admin()));
drop policy if exists ws_update on public.workspaces;
create policy ws_update on public.workspaces for update to authenticated using (ws = my_ws() and (my_can_write() or my_admin())) with check (ws = my_ws());
drop policy if exists feedback_delete on public.feedback;
create policy feedback_delete on public.feedback for delete to authenticated using (ws = my_ws() and (my_can_write() or my_admin()));

-- invites may carry any of the eight roles (+ admin)
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_ws text; v_cnt int; v_role text; v_domain text; v_email text; v_admin boolean := false;
begin
  v_email := lower(coalesce(new.email, new.raw_user_meta_data->>'email', new.raw_user_meta_data->>'preferred_username', new.id::text || '@no-email.local'));
  v_domain := split_part(v_email,'@',2);
  if v_domain = '' or v_domain in ('gmail.com','googlemail.com','outlook.com','outlook.de','hotmail.com','hotmail.de','live.com','live.de','msn.com','yahoo.com','yahoo.de','icloud.com','me.com','mac.com','web.de','gmx.de','gmx.net','gmx.at','gmx.ch','t-online.de','freenet.de','aol.com','proton.me','protonmail.com','posteo.de','mail.de','mailbox.org','yandex.com','ymail.com')
    then v_ws := v_email; else v_ws := v_domain; end if;
  select count(*) into v_cnt from public.profiles where ws = v_ws;
  select i->>'role' into v_role from public.workspaces w, jsonb_array_elements(coalesce(w.invites,'[]'::jsonb)) i where w.ws = v_ws and lower(i->>'email') = v_email limit 1;
  if v_role = 'admin' then v_admin := true; end if;
  if v_role = 'reviewer' then v_role := 'approver'; end if;
  if v_role is null or v_role not in ('admin','viewer','editor','approver','tech_approver','compliance_approver','compliance_manager','creator','team_admin') then v_role := 'creator'; end if; -- uninvited colleagues of the domain keep joining as creators (unchanged)
  insert into public.profiles (id, email, name, role, ws, is_admin)
  values (new.id, v_email, coalesce(nullif(new.raw_user_meta_data->>'name',''), nullif(new.raw_user_meta_data->>'full_name',''), split_part(v_email,'@',1)), v_role, v_ws, (v_cnt = 0) or v_admin)
  on conflict (id) do nothing;
  update public.workspaces set invites = coalesce((select jsonb_agg(i) from jsonb_array_elements(invites) i where lower(i->>'email') <> v_email), '[]'::jsonb) where ws = v_ws;
  return new;
end $function$;

-- ---------- v12.44.1: migration helpers removed (Irland → Frankfurt), advisor clean-up ----------
-- (applied as migration v004_cleanup_migration_helpers) – the temporary functions/tables carried a shared secret and one was callable
-- without login; the old project's giri_export* functions and the mig-env / mig-copy edge functions are retired as well
drop function if exists public._mig_fetch(text, integer, integer);
drop function if exists public._mig_fetch_delta(text, timestamp with time zone);
drop function if exists public._mig_apply(bigint, text);
drop table if exists public._mig;
drop table if exists public._mig_obj;
alter function public.instr_rewrite_old_urls() set search_path = public;
alter function public.ws_rewrite_old_urls() set search_path = public;
revoke execute on function public.my_can_write() from anon;
revoke execute on function public.purge_trash() from authenticated;   -- nothing in the app calls it; service role / cron only

-- ============================================================
-- v12.45.0 – authorisation on the server (migrations v005–v009, applied to the Frankfurt project on 2026-09-29)
-- Files: supabase/migrations/v005_server_side_authorisation.sql … v009_advisor_cleanup.sql (same content as below).
-- Tests: supabase/tests/authz.sql (29 checks as simulated users, every write rolled back).
-- ============================================================

-- ---------- v005_server_side_authorisation ----------
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

-- ---------- v006_org_admin_alias ----------
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

-- ---------- v007_profile_roles_check ----------
-- v12.45.0 – profiles.role accepts the eight Classic roles (+ org admin, + legacy 'reviewer'); until now the check constraint
-- still only knew admin/creator/reviewer/viewer, so the workspace-role menu in Admin and invites with the new roles failed.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','viewer','editor','approver','tech_approver','compliance_approver','compliance_manager','creator','team_admin','reviewer'));

-- ---------- v008_visibility_performance ----------
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

-- ---------- v009_advisor_cleanup ----------
-- v12.45.0 – advisor clean-up after v005–v008: trigger functions are not callable through the API, pure helpers get a fixed search_path
revoke execute on function public.instr_authz_guard() from public, anon, authenticated;
revoke execute on function public.instr_teams_eff() from public, anon, authenticated;
revoke execute on function public.ws_teams_cascade() from public, anon, authenticated;
alter function public.norm_role(text) set search_path = public;
alter function public.role_caps(text) set search_path = public;
alter function public.jsonb_text_array(jsonb) set search_path = public;
alter function public.jsonb_anon_names(jsonb, text, text) set search_path = public;

-- v12.47.0 – sign-up model, plans and the master panel (migrations v010–v012, applied to the Frankfurt project on 2026-09-30)
-- Files: supabase/migrations/v010_signup_plans_master.sql, v011_bypass_reset.sql, v012_merge_fix.sql (same content as below).

-- ---------- v010_signup_plans_master ----------
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

-- ---------- v011_bypass_reset ----------
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

-- ---------- v012_merge_fix ----------
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


-- ---------- v013_security_hardening ----------
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

-- ---------- v014_device_login ----------
-- v014 (v12.50) – sign in on the phone with a QR code shown on the PC ("Auf dem Handy anmelden")
--
-- The PC (signed in) asks the edge function device-login for a one-time code; the QR holds  https://go.ar-giri.de/#/qr/<id>/<secret>.
-- The phone scans it and shows a two-digit number; the person types that number on the PC to allow it; then the phone gets a one-time sign-in
-- token (no e-mail is sent). This table is the state of these hand-overs – only the service role (the edge function) reads and writes it.
--
--   secret_hash  SHA-256 of the secret in the QR (the secret itself is never stored)
--   status       pending → claimed (phone scanned, number shown) → approved / denied (PC) → used (phone signed in)
--                expired codes simply stay pending/claimed with expires_at in the past; replaced = a newer code of the same person
--   code         the two-digit number shown on the phone; the person types it on the PC (number matching – a phone that is not the
--                person's own cannot be allowed by a careless click, and the PC never learns the number from the server)
--   claim_hash   SHA-256 of a second secret that only the phone which scanned first holds – only that phone can pick up the sign-in
--   device       "iPhone · Safari" etc. (what the PC shows before allowing)
-- Rows are removed after 30 days by the function (they double as a small log of sign-ins by QR).

create table if not exists public.device_logins (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  secret_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'approved', 'denied', 'used', 'replaced')),
  code smallint,
  claim_hash text,
  device text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  decided_at timestamptz,
  used_at timestamptz
);
create index if not exists device_logins_user on public.device_logins (user_id, created_at desc);
alter table public.device_logins enable row level security;
revoke all on public.device_logins from public, anon, authenticated;
-- no policies on purpose: browsers never see this table, they only talk to the edge function device-login

-- ---------- v015_live_version ----------
-- v015 (v12.51) – the approved version stays live while the next one is being edited
--
-- Before: editing a published instruction put it back to "draft" – from that moment its link and QR code showed "not published"
-- (and the workers' phones dropped their offline copy) until both approvals were given again. A typo fix took the instruction away
-- from the shop floor.
-- Now the database keeps a snapshot of the published content in instructions.data.live and workers see exactly that snapshot while
-- the next version is in draft or review.
--
--   instr_authz_guard  keeps data.live itself – the app never writes it (what a client sends there is ignored):
--                        status 'published'            → live = the content being published (title, steps, settings, translations,
--                                                         approvals and history – without the step bin and draft notes)
--                        published → draft / review     → live = the content as it was published (the last approved state)
--                        draft / review → draft / review → live stays as it was (none for an instruction never published)
--                      'live' counts as meta in the edit check, so an approver without the edit right can still publish.
--   open_instr         draft / review with a snapshot → the link opens the snapshot (as 'published', its version and title)
--   instr_public       checklists, views and feedback can be saved for such an instruction as well
--   giri_features()    tells the app that this update is in (it then says "workers keep version n" instead of "offline")
-- No backfill needed: the snapshot of an instruction published today is taken from its published state at its first change.
--
-- Test afterwards (rolled back, changes nothing): ../tests/live.sql

-- ---------- 1. guard ----------
create or replace function public.instr_authz_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  meta text[] := array['approvals','status','history','pendingNote','lastBy','publishedAt','version','shareKey','updatedAt','_base','translations','txSrc','txHash','live'];
  nolive text[] := array['pendingNote','lastBy','_base','live','trash'];  -- the snapshot keeps its approvals and history (who approved what)
  old_ap jsonb := '{}'::jsonb; new_ap jsonb; t_ids text[]; f_id text; changed boolean;
begin
  -- v015: the live snapshot is kept here for every write (also service role / maintenance) – never taken from the client
  if new.status = 'published' then
    new.data := jsonb_set(new.data, '{live}', (new.data - nolive) || jsonb_build_object('title', new.title));
  elsif tg_op = 'UPDATE' and old.status = 'published' then
    new.data := jsonb_set(new.data, '{live}', (old.data - nolive) || jsonb_build_object('title', old.title));
  elsif tg_op = 'UPDATE' and coalesce(old.data->'live', 'null'::jsonb) <> 'null'::jsonb then
    new.data := jsonb_set(new.data, '{live}', old.data->'live');
  else
    new.data := new.data - 'live';
  end if;
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
end $function$;

-- ---------- 2. open by link: the snapshot while the next version is in the works ----------
create or replace function public.open_instr(p_id text, p_pw text default null::text, p_key text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare r record; hs jsonb; h jsonb; ok boolean := false; lv jsonb; d jsonb; ti text; st text;
begin
  select id, ws, status, title, data, updated_at into r from public.instructions
    where id = p_id and deleted_at is null
      and (status = 'published' or coalesce(data->'live', 'null'::jsonb) <> 'null'::jsonb);
  if not found then return null; end if;
  if p_key is null or length(p_key) < 16 or p_key <> coalesce(r.data->>'shareKey', '') then return jsonb_build_object('stale', true); end if;
  hs := public.instr_pw_hashes(p_id);
  if jsonb_array_length(hs) = 0 then ok := true;
  elsif p_pw is not null and length(p_pw) > 0 then
    for h in select * from jsonb_array_elements(hs) loop
      if encode(extensions.digest(convert_to((h->>'s') || p_pw, 'UTF8'), 'sha256'), 'hex') = h->>'h' then ok := true; end if;
    end loop;
  end if;
  if not ok then return jsonb_build_object('locked', true); end if;
  if r.status = 'published' then d := r.data - 'live'; ti := r.title; st := 'published';
  else -- draft / review of the next version: the approved snapshot (with the current link key)
    lv := r.data->'live'; ti := coalesce(lv->>'title', r.title); st := 'published';
    d := (lv - 'title') || jsonb_build_object('shareKey', r.data->'shareKey', 'liveOf', r.status);
  end if;
  return jsonb_build_object('locked', false, 'row', jsonb_build_object('id', r.id, 'ws', r.ws, 'status', st, 'title', ti, 'data', d, 'updated_at', r.updated_at));
end $function$;

-- ---------- 3. checklists / views / feedback for the live version ----------
create or replace function public.instr_public(p_id text, p_ws text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.instructions i where i.id = p_id and i.ws = p_ws and i.deleted_at is null
                   and (i.status = 'published' or coalesce(i.data->'live', 'null'::jsonb) <> 'null'::jsonb)); $function$;

-- ---------- 4. the app asks whether this update is in ----------
create or replace function public.giri_features()
 returns jsonb
 language sql
 stable
as $function$ select '{"live": true}'::jsonb $function$;
grant execute on function public.giri_features() to anon, authenticated;
