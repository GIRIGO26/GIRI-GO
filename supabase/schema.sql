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
