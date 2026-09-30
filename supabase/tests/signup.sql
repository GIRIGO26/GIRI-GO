-- supabase/tests/signup.sql – where new users land (migrations v010/v011): a sign-up is a row in auth.users, the trigger places the
-- profile. Every write is rolled back.
-- Run as postgres:  select * from pg_temp.signup_test('ar-giri.com', 'bjoern@ar-giri.com');
create or replace function pg_temp.as_user(p_id uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', p_email, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_root() returns void language plpgsql as $$
begin perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true); end $$;

create or replace function pg_temp.signup(p_id uuid, p_email text, p_name text) returns void language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', p_name), now(), now(), now(), '', '', '', '', '');
end $$;

create or replace function pg_temp.signup_test(p_ws text, p_master text)
returns table(test text, expect text, got text, ok boolean) language plpgsql as $fn$
declare master public.profiles; u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid(); u4 uuid := gen_random_uuid(); u5 uuid := gen_random_uuid();
  r record; j jsonb; s text; n int; v_ws text;
begin
  select * into master from public.profiles where lower(email) = lower(p_master);
  if master.id is null then raise exception 'master % not found', p_master; end if;

  -- 1. colleague of an existing (open_domain) workspace joins it as creator
  begin
    perform pg_temp.signup(u1, 'neu.kollege@' || p_ws, 'Neu Kollege');
    select ws || '/' || role || '/' || is_admin into s from public.profiles where id = u1;
    raise exception using errcode = 'P0999', message = s;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate || ' ' || sqlerrm end; end;
  test := 'colleague of an open-domain workspace joins it as creator'; expect := p_ws || '/creator/false'; ok := got = expect; return next;

  -- 2. a new company gets a workspace of its own: admin, trial, 30 days, mail notice queued
  begin
    perform pg_temp.signup(u2, 'anna@neue-firma.de', 'Anna Neu');
    select p.ws || '/' || p.role || '/' || p.is_admin || '/' || w.plan || '/' || (w.plan_until > now() + interval '29 days') || '/' || w.open_domain || '/' || w.owner_email
      into s from public.profiles p join public.workspaces w on w.ws = p.ws where p.id = u2;
    raise exception using errcode = 'P0999', message = regexp_replace(s, '^neue-firma-de-[a-z0-9]{5}/', 'neue-firma-de-XXXXX/');
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate || ' ' || sqlerrm end; end;
  test := 'new company → own workspace, admin, 30-day trial, domain closed'; expect := 'neue-firma-de-XXXXX/admin/true/trial/true/false/anna@neue-firma.de'; ok := got = expect; return next;

  -- 3. a second person of that new company does NOT land in it (domain closed) → own workspace
  begin
    perform pg_temp.signup(u2, 'anna@neue-firma.de', 'Anna Neu');
    perform pg_temp.signup(u3, 'bernd@neue-firma.de', 'Bernd');
    select (select ws from public.profiles where id = u2) <> (select ws from public.profiles where id = u3) into s;
    raise exception using errcode = 'P0999', message = s;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate || ' ' || sqlerrm end; end;
  test := 'same new domain without invitation → separate workspaces'; expect := 'true'; ok := got = expect; return next;

  -- 4. an invitation from that company wins, with the invited role
  begin
    perform pg_temp.signup(u2, 'anna@neue-firma.de', 'Anna Neu');
    select ws into v_ws from public.profiles where id = u2;
    update public.workspaces set invites = jsonb_build_array(jsonb_build_object('email', 'carla@irgendwo.org', 'role', 'editor', 'at', 1)) where ws = v_ws;
    perform pg_temp.signup(u4, 'carla@irgendwo.org', 'Carla');
    select (ws = v_ws)::text || '/' || role || '/' || is_admin into s from public.profiles where id = u4;
    select s || '/invites left ' || jsonb_array_length(coalesce(invites, '[]'::jsonb)) into s from public.workspaces where ws = v_ws;
    raise exception using errcode = 'P0999', message = s;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate || ' ' || sqlerrm end; end;
  test := 'invitation (other domain) → that workspace with the invited role, invite consumed'; expect := 'true/editor/false/invites left 0'; ok := got = expect; return next;

  -- 5. gmail user → own workspace named after the person
  begin
    perform pg_temp.signup(u5, 'max.muster@gmail.com', 'Max Muster');
    select w.name || '/' || p.role into s from public.profiles p join public.workspaces w on w.ws = p.ws where p.id = u5;
    raise exception using errcode = 'P0999', message = s;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate || ' ' || sqlerrm end; end;
  test := 'public mail provider → own workspace'; expect := 'Max Muster/admin'; ok := got = expect; return next;

  -- 6. a workspace admin cannot change the plan (guard keeps the old values)
  begin
    -- a normal admin of the workspace (not a platform admin): the first non-master admin
    select p.id, p.email into r from public.profiles p where p.ws = p_ws and (p.is_admin or p.role = 'admin') and lower(p.email) <> lower(p_master) limit 1;
    perform pg_temp.as_user(r.id, r.email);
    update public.workspaces set plan = 'suspended', plan_until = now(), seats = 1, open_domain = false where ws = p_ws;
    perform pg_temp.as_root();
    select plan || '/' || open_domain || '/' || coalesce(seats::text, 'null') into s from public.workspaces where ws = p_ws;
    raise exception using errcode = 'P0999', message = s;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate || ' ' || sqlerrm end; end;
  test := 'a workspace admin cannot change plan fields'; expect := 'active/true/null'; ok := got = expect; return next;

  -- 7. master RPCs: overview, set plan, suspended = read-only, demo, move, merge
  begin
    perform pg_temp.as_user(master.id, master.email);
    j := public.master_overview();
    raise exception using errcode = 'P0999', message = (jsonb_array_length(j) >= 2)::text || '/' || (j->0 ? 'users')::text;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate || ' ' || sqlerrm end; end;
  test := 'master_overview lists the workspaces with counts'; expect := 'true/true'; ok := got = expect; return next;

  begin
    perform pg_temp.as_user(master.id, master.email);
    perform public.master_set_plan(p_ws, 'suspended', now(), 5, 'test', true, null);
    -- the creator of the workspace can no longer save an instruction
    select p.id, p.email into r from public.profiles p where p.ws = p_ws and p.role = 'creator' and not p.is_admin limit 1;
    perform pg_temp.as_user(r.id, r.email);
    update public.instructions set title = title || ' x' where id = (select id from public.instructions where ws = p_ws and deleted_at is null and teams_eff = '{}' limit 1);
    raise exception using errcode = 'P0999', message = 'saved';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'suspended workspace is read-only'; expect := '42501'; ok := got = expect; return next;

  begin
    perform pg_temp.as_user(master.id, master.email);
    v_ws := public.master_create_demo('kunde@interessent.de', 'Interessent GmbH', 14);
    perform pg_temp.as_root();
    perform pg_temp.signup(u1, 'kunde@interessent.de', 'Kunde');
    select p.ws = v_ws and p.is_admin and w.plan = 'demo' and w.plan_until > now() + interval '13 days' into s from public.profiles p join public.workspaces w on w.ws = p.ws where p.id = u1;
    raise exception using errcode = 'P0999', message = s;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate || ' ' || sqlerrm end; end;
  test := 'demo workspace: the invited prospect lands in it as admin'; expect := 'true'; ok := got = expect; return next;

  begin
    perform pg_temp.signup(u2, 'anna@neue-firma.de', 'Anna Neu'); perform pg_temp.signup(u3, 'bernd@neue-firma.de', 'Bernd');
    select ws into v_ws from public.profiles where id = u2;
    insert into public.instructions (id, ws, title, status, data, owner) values ('signup-t-1', (select ws from public.profiles where id = u3), 'Bernds Anleitung', 'draft', '{"title":"x","steps":[]}'::jsonb, u3);
    perform pg_temp.as_user(master.id, master.email);
    j := public.master_move_user('bernd@neue-firma.de', v_ws, true);
    perform pg_temp.as_root();
    select (select ws from public.profiles where id = u3) = v_ws and (select ws from public.instructions where id = 'signup-t-1') = v_ws into s;
    raise exception using errcode = 'P0999', message = s || '/' || (j->>'instructions');
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate || ' ' || sqlerrm end; end;
  test := 'master_move_user moves the person with their instructions'; expect := 'true/1'; ok := got = expect; return next;

  begin
    perform pg_temp.signup(u2, 'anna@neue-firma.de', 'Anna Neu'); perform pg_temp.signup(u3, 'bernd@neue-firma.de', 'Bernd');
    select ws into v_ws from public.profiles where id = u2;
    insert into public.instructions (id, ws, title, status, data, owner) values ('signup-t-2', (select ws from public.profiles where id = u3), 'Bernds Anleitung', 'draft', '{"title":"x","steps":[]}'::jsonb, u3);
    select ws into s from public.profiles where id = u3;
    perform pg_temp.as_user(master.id, master.email);
    j := public.master_merge_workspace(s, v_ws);
    perform pg_temp.as_root();
    select count(*) into n from public.workspaces where ws = (j->>'into');
    select (select ws from public.profiles where id = u3) = v_ws and (select ws from public.instructions where id = 'signup-t-2') = v_ws and n = 1 into s;
    raise exception using errcode = 'P0999', message = s || '/' || (j->>'users') || '/' || (j->>'instructions');
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate || ' ' || sqlerrm end; end;
  test := 'master_merge_workspace folds one workspace into another'; expect := 'true/1/1'; ok := got = expect; return next;

  begin
    select p.id, p.email into r from public.profiles p where p.ws = p_ws and p.role = 'creator' and not p.is_admin limit 1;
    perform pg_temp.as_user(r.id, r.email);
    j := public.master_overview();
    raise exception using errcode = 'P0999', message = 'allowed';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'master RPCs are refused for everyone else'; expect := '42501'; ok := got = expect; return next;
  perform pg_temp.as_root();
end $fn$;
