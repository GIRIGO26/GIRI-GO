-- supabase/tests/security.sql – checks for migration v013 (security hardening after the review of 1 Oct 2026).
-- Every write runs in a savepoint that is rolled back on purpose; the database is left as it was.
-- Run as postgres:
--   select * from pg_temp.security_test('<workspace>', '<creator without org admin>', '<org admin>', '<user of ANOTHER workspace>', '<platform admin>');
-- Expected: ok = true in every row.

create or replace function pg_temp.as_user(p_id uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', p_email, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('role', 'anon', true); end $$;
create or replace function pg_temp.as_root() returns void language plpgsql as $$
begin perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true); end $$;

create or replace function pg_temp.security_test(p_ws text, p_creator text, p_admin text, p_other text, p_master text)
returns table(test text, expect text, got text, ok boolean) language plpgsql as $fn$
declare c public.profiles; a public.profiles; o public.profiles; m public.profiles; s text; n int; j jsonb;
begin
  select * into c from public.profiles where lower(email) = lower(p_creator) and ws = p_ws;
  select * into a from public.profiles where lower(email) = lower(p_admin) and ws = p_ws;
  select * into o from public.profiles where lower(email) = lower(p_other);
  select * into m from public.profiles where lower(email) = lower(p_master);
  if c.id is null or a.id is null or o.id is null or m.id is null or o.ws = p_ws then raise exception 'test users not found / other user must be in another workspace'; end if;

  -- identity
  begin perform pg_temp.as_user(c.id, c.email); update public.profiles set email = p_master where id = c.id; raise exception using errcode = 'P0999', message = public.is_master()::text;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator cannot change own profile e-mail (→ no master)'; expect := '42501'; ok := got = expect; return next;

  begin perform pg_temp.as_user(o.id, o.email); update public.profiles set email = p_master where id = o.id; raise exception using errcode = 'P0999', message = public.is_master()::text;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'admin of another workspace cannot change own e-mail (→ no master)'; expect := '42501'; ok := got = expect; return next;

  begin perform pg_temp.as_user(a.id, a.email); update public.profiles set email = 'x' || c.email where id = c.id; raise exception using errcode = 'P0999', message = 'changed';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'org admin cannot change a member''s e-mail'; expect := '42501'; ok := got = expect; return next;

  begin perform pg_temp.as_user(c.id, c.email); update public.profiles set role = 'admin', is_admin = true where id = c.id; raise exception using errcode = 'P0999', message = 'changed';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator cannot change own role'; expect := '42501'; ok := got = expect; return next;

  begin perform pg_temp.as_user(a.id, a.email); update public.profiles set role = 'editor' where id = c.id; select role into s from public.profiles where id = c.id; raise exception using errcode = 'P0999', message = s;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'org admin can change a member''s role'; expect := 'editor'; ok := got = expect; return next;

  begin perform pg_temp.as_user(a.id, a.email); update public.profiles set name = 'Neu' where id = c.id; update public.profiles set name = name || ' x' where id = a.id; raise exception using errcode = 'P0999', message = 'ok';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'names stay editable (own name; admin for members)'; expect := 'ok'; ok := got = expect; return next;

  begin perform pg_temp.as_user(m.id, m.email); raise exception using errcode = 'P0999', message = public.is_master()::text;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'the real platform admin is still master'; expect := 'true'; ok := got = expect; return next;

  -- workspace writes
  begin perform pg_temp.as_user(c.id, c.email);
    update public.workspaces set invites = coalesce(invites, '[]'::jsonb) || '[{"email":"evil@example.com","role":"admin"}]'::jsonb where ws = p_ws;
    raise exception using errcode = 'P0999', message = 'changed';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator cannot add invitations'; expect := '42501'; ok := got = expect; return next;

  begin perform pg_temp.as_user(c.id, c.email);
    update public.workspaces set teams = coalesce((select jsonb_agg(jsonb_set(tm, '{members}', coalesce(tm->'members', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('email', c.email, 'role', 'team_admin')))) from jsonb_array_elements(teams) tm), '[{"id":"x","name":"x","members":[]}]'::jsonb) where ws = p_ws;
    raise exception using errcode = 'P0999', message = 'changed';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator cannot change teams / give himself team admin'; expect := '42501'; ok := got = expect; return next;

  begin perform pg_temp.as_user(c.id, c.email); update public.workspaces set brand = brand || '{"color":"#ff0000"}'::jsonb where ws = p_ws; raise exception using errcode = 'P0999', message = 'changed';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator cannot change the branding'; expect := '42501'; ok := got = expect; return next;

  begin perform pg_temp.as_user(c.id, c.email);
    update public.workspaces set folders = folders || '[{"id":"sec-test-f","name":"Sec test","teams":[]}]'::jsonb where ws = p_ws;
    get diagnostics n = row_count; raise exception using errcode = 'P0999', message = 'rows ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator can still create folders'; expect := 'rows 1'; ok := got = expect; return next;

  begin perform pg_temp.as_user(c.id, c.email);
    insert into public.workspaces (ws, folders, updated_at) values (p_ws, (select folders from public.workspaces where ws = p_ws) || '[{"id":"sec-test-g","name":"Sec test 2","teams":[]}]'::jsonb, now())
      on conflict (ws) do update set folders = excluded.folders, updated_at = excluded.updated_at;
    get diagnostics n = row_count; raise exception using errcode = 'P0999', message = 'rows ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator can still save folders via upsert (what the app does)'; expect := 'rows 1'; ok := got = expect; return next;

  begin perform pg_temp.as_user(c.id, c.email);
    update public.workspaces set symbols = symbols || '[{"id":"sec-test-s","name":"x","url":"x"}]'::jsonb where ws = p_ws;
    get diagnostics n = row_count; raise exception using errcode = 'P0999', message = 'rows ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator can still add custom symbols'; expect := 'rows 1'; ok := got = expect; return next;

  begin perform pg_temp.as_user(a.id, a.email);
    update public.workspaces set invites = coalesce(invites, '[]'::jsonb) || '[{"email":"neu@example.com","role":"editor"}]'::jsonb where ws = p_ws;
    get diagnostics n = row_count; raise exception using errcode = 'P0999', message = 'rows ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'org admin can invite'; expect := 'rows 1'; ok := got = expect; return next;

  -- workspace reads
  begin perform pg_temp.as_user(o.id, o.email); select count(*) into n from public.workspaces where ws = p_ws; raise exception using errcode = 'P0999', message = n::text;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'user of another workspace cannot read this workspace'; expect := '0'; ok := got = expect; return next;

  begin perform pg_temp.as_user(c.id, c.email); select count(*) into n from public.workspaces; raise exception using errcode = 'P0999', message = n::text;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'a member reads exactly his own workspace'; expect := '1'; ok := got = expect; return next;

  begin perform pg_temp.as_anon(); j := public.ws_brand(p_ws); raise exception using errcode = 'P0999', message = (jsonb_typeof(j) = 'object')::text;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'anonymous worker link gets the branding via ws_brand()'; expect := 'true'; ok := got = expect; return next;

  begin perform pg_temp.as_anon(); select count(*) into n from public.workspaces; raise exception using errcode = 'P0999', message = n::text;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'anonymous cannot read workspace rows'; expect := '42501'; ok := got = expect; return next;

  -- storage
  begin perform pg_temp.as_anon(); select count(*) into n from storage.objects where bucket_id = 'media'; raise exception using errcode = 'P0999', message = n::text;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'anonymous cannot list media files'; expect := '0'; ok := got = expect; return next;

  begin perform pg_temp.as_user(o.id, o.email); select count(*) into n from storage.objects where bucket_id = 'media' and name like p_ws || '/%'; raise exception using errcode = 'P0999', message = n::text;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'user of another workspace cannot list this workspace''s media'; expect := '0'; ok := got = expect; return next;

  begin perform pg_temp.as_user(c.id, c.email); select count(*) into n from storage.objects where bucket_id = 'media' and name like p_ws || '/%'; raise exception using errcode = 'P0999', message = (n > 0)::text;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'a member still sees his workspace''s media (needed for copy/upsert)'; expect := 'true'; ok := got = expect; return next;

  -- invitation mail log (only the service role / edge function invite-notify)
  begin perform pg_temp.as_user(a.id, a.email); select count(*) into n from public.mail_log; raise exception using errcode = 'P0999', message = n::text;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'even an org admin cannot read the mail log'; expect := '42501'; ok := got = expect; return next;

  begin perform pg_temp.as_anon(); insert into public.mail_log (ws, kind, to_email) values (p_ws, 'invite', 'x@y.de'); raise exception using errcode = 'P0999', message = 'inserted';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'anonymous cannot write the mail log'; expect := '42501'; ok := got = expect; return next;

  perform pg_temp.as_root();
end $fn$;
