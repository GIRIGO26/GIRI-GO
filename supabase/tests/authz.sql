-- supabase/tests/authz.sql – tests for the server-side authorisation (migrations v005–v008): RLS policies + instr_authz_guard + GDPR RPCs.
--
-- Every write runs inside a savepoint that is rolled back on purpose, so the database is left exactly as it was.
-- Run as the postgres role (Supabase SQL editor, MCP execute_sql or psql), then:
--
--   select * from pg_temp.authz_test('<workspace>', '<e-mail of a creator without org-admin>', '<e-mail of an org admin>', '<e-mail of any third user>');
--
-- Expected: every row has ok = true. The creator must hold the workspace role 'creator' and no org-admin flag; the workspace needs
-- one unrestricted draft and one team the creator is not a member of (with at least one instruction restricted to it).

create or replace function pg_temp.as_user(p_id uuid, p_email text) returns void language plpgsql as $$
begin  -- what PostgREST does for a signed-in request
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', p_email, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.as_root() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.authz_test(p_ws text, p_creator text, p_admin text, p_other text)
returns table(test text, expect text, got text, ok boolean) language plpgsql as $fn$
declare
  creator public.profiles; admin public.profiles; other public.profiles;
  open_id text; team_id text; team_instr text; my_teams text[]; n int; n2 int; j jsonb; ap jsonb; s text;
begin
  select * into creator from public.profiles where lower(email) = lower(p_creator) and ws = p_ws;
  select * into admin from public.profiles where lower(email) = lower(p_admin) and ws = p_ws;
  select * into other from public.profiles where lower(email) = lower(p_other) and ws = p_ws;
  if creator.id is null or admin.id is null or other.id is null then raise exception 'test users not found in workspace %', p_ws; end if;
  if not (admin.is_admin or admin.role = 'admin') then raise exception '% is not an org admin', p_admin; end if;
  if creator.is_admin or creator.role <> 'creator' then raise exception '% must be a plain creator (workspace role creator, no admin flag)', p_creator; end if;
  select coalesce(array_agg(t->>'id'), array[]::text[]) into my_teams
    from public.workspaces w, jsonb_array_elements(coalesce(w.teams,'[]'::jsonb)) t, jsonb_array_elements(coalesce(t->'members','[]'::jsonb)) m
   where w.ws = p_ws and lower(m->>'email') = lower(p_creator);
  select i.id into open_id from public.instructions i where i.ws = p_ws and i.deleted_at is null and i.status = 'draft'
    and coalesce(array_length(public.instr_team_ids(public.jsonb_text_array(i.data->'teams'), i.data->>'folder', i.ws), 1), 0) = 0 order by i.updated_at desc limit 1;
  select t->>'id' into team_id from public.workspaces w, jsonb_array_elements(coalesce(w.teams,'[]'::jsonb)) t where w.ws = p_ws and not (t->>'id' = any(my_teams)) limit 1;
  select i.id into team_instr from public.instructions i where i.ws = p_ws and i.deleted_at is null
    and public.instr_team_ids(public.jsonb_text_array(i.data->'teams'), i.data->>'folder', i.ws) @> array[team_id] and not (public.instr_team_ids(public.jsonb_text_array(i.data->'teams'), i.data->>'folder', i.ws) && my_teams) limit 1;
  if open_id is null or team_id is null or team_instr is null then raise exception 'fixture missing (open draft %, foreign team %, its instruction %)', open_id, team_id, team_instr; end if;
  ap := jsonb_build_object('by', 'authz test', 'at', (extract(epoch from now()) * 1000)::bigint);

  -- ---- visibility ----
  select count(*) into n from public.instructions i where i.ws = p_ws
    and (coalesce(array_length(public.instr_team_ids(public.jsonb_text_array(i.data->'teams'), i.data->>'folder', i.ws), 1), 0) = 0 or public.instr_team_ids(public.jsonb_text_array(i.data->'teams'), i.data->>'folder', i.ws) && my_teams);
  perform pg_temp.as_user(creator.id, creator.email); select count(*) into n2 from public.instructions; perform pg_temp.as_root();
  test := 'creator sees unrestricted + own-team instructions only'; expect := n::text; got := n2::text; ok := n = n2; return next;

  select count(*) into n from public.instructions where ws = p_ws;
  perform pg_temp.as_user(admin.id, admin.email); select count(*) into n2 from public.instructions; perform pg_temp.as_root();
  test := 'org admin sees every instruction of the workspace'; expect := n::text; got := n2::text; ok := n = n2; return next;

  begin
    perform set_config('role', 'anon', true); select count(*) into n2 from public.instructions; perform pg_temp.as_root();
    got := n2::text;
  exception when others then got := sqlstate; perform pg_temp.as_root(); end;
  test := 'anonymous (no login) sees no instruction rows'; expect := '0 (or 42501)'; ok := got in ('0', '42501'); return next;

  -- ---- creator (edit + both approvals for unrestricted instructions) ----
  begin
    perform pg_temp.as_user(creator.id, creator.email);
    insert into public.instructions (id, ws, title, status, data) values ('authz-test-1', p_ws, 'authz', 'draft', jsonb_build_object('title', 'authz', 'steps', '[]'::jsonb, 'approvals', jsonb_build_object('tech', null, 'dsgvo', null)));
    raise exception using errcode = 'P0999', message = 'inserted';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator may create an unrestricted instruction'; expect := 'inserted'; ok := got = expect; return next;

  begin
    perform pg_temp.as_user(creator.id, creator.email);
    insert into public.instructions (id, ws, title, status, data) values ('authz-test-2', p_ws, 'authz', 'draft', jsonb_build_object('title', 'authz', 'steps', '[]'::jsonb, 'teams', jsonb_build_array(team_id)));
    raise exception using errcode = 'P0999', message = 'inserted';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator may NOT create an instruction for a team he is not in'; expect := '42501'; ok := got = expect; return next;

  begin
    perform pg_temp.as_user(creator.id, creator.email);
    update public.instructions set title = title || ' (t)', data = jsonb_set(data, '{title}', to_jsonb(title || ' (t)')) where id = open_id; get diagnostics n = row_count;
    raise exception using errcode = 'P0999', message = 'updated ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator may change the content of an unrestricted instruction'; expect := 'updated 1'; ok := got = expect; return next;

  begin
    perform pg_temp.as_user(creator.id, creator.email);
    update public.instructions set title = title || ' (t)' where id = team_instr; get diagnostics n = row_count;
    raise exception using errcode = 'P0999', message = 'updated ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator cannot touch an instruction of a team he is not in (invisible)'; expect := 'updated 0'; ok := got = expect; return next;

  begin
    perform pg_temp.as_user(creator.id, creator.email);
    update public.instructions set data = jsonb_set(data, '{approvals,tech}', ap) where id = open_id; get diagnostics n = row_count;
    raise exception using errcode = 'P0999', message = 'updated ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator may give the technical approval'; expect := 'updated 1'; ok := got = expect; return next;

  begin
    perform pg_temp.as_user(creator.id, creator.email);
    update public.instructions set status = 'published', data = jsonb_set(data, '{status}', '"published"') where id = open_id;
    raise exception using errcode = 'P0999', message = 'published';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'publishing without both approvals is refused'; expect := '42501'; ok := got = expect; return next;

  begin
    perform pg_temp.as_user(creator.id, creator.email);
    update public.instructions set status = 'published', data = jsonb_set(jsonb_set(jsonb_set(data, '{approvals,tech}', ap), '{approvals,dsgvo}', ap), '{status}', '"published"') where id = open_id; get diagnostics n = row_count;
    raise exception using errcode = 'P0999', message = 'updated ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator may publish once both approvals are in'; expect := 'updated 1'; ok := got = expect; return next;

  begin
    perform pg_temp.as_user(creator.id, creator.email);
    delete from public.instructions where id = open_id; get diagnostics n = row_count;
    raise exception using errcode = 'P0999', message = 'deleted ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'creator may delete an unrestricted instruction'; expect := 'deleted 1'; ok := got = expect; return next;

  -- ---- viewer (workspace role) ----
  begin
    update public.profiles set role = 'viewer' where id = creator.id;
    perform pg_temp.as_user(creator.id, creator.email);
    select count(*) into n2 from public.instructions;
    update public.instructions set title = title || ' (t)' where id = open_id; get diagnostics n = row_count;
    raise exception using errcode = 'P0999', message = 'sees ' || n2 || ', updated ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  select count(*) into n from public.instructions i where i.ws = p_ws and coalesce(array_length(public.instr_team_ids(public.jsonb_text_array(i.data->'teams'), i.data->>'folder', i.ws), 1), 0) = 0;
  test := 'viewer reads unrestricted instructions but cannot change them'; expect := 'sees ' || n || ', updated 0'; ok := got = expect; return next;

  begin
    update public.profiles set role = 'viewer' where id = creator.id;
    perform pg_temp.as_user(creator.id, creator.email);
    insert into public.instructions (id, ws, title, status, data) values ('authz-test-3', p_ws, 'authz', 'draft', jsonb_build_object('title', 'authz', 'steps', '[]'::jsonb));
    raise exception using errcode = 'P0999', message = 'inserted';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'viewer may not create instructions'; expect := '42501'; ok := got = expect; return next;

  begin
    update public.profiles set role = 'viewer' where id = creator.id;
    perform pg_temp.as_user(creator.id, creator.email);
    delete from public.instructions where id = open_id; get diagnostics n = row_count;
    raise exception using errcode = 'P0999', message = 'deleted ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'viewer may not delete instructions'; expect := 'deleted 0'; ok := got = expect; return next;

  -- ---- editor (edit only) ----
  begin
    update public.profiles set role = 'editor' where id = creator.id;
    perform pg_temp.as_user(creator.id, creator.email);
    update public.instructions set title = title || ' (t)', data = jsonb_set(data, '{title}', to_jsonb(title || ' (t)')) where id = open_id; get diagnostics n = row_count;
    raise exception using errcode = 'P0999', message = 'updated ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'editor may change content'; expect := 'updated 1'; ok := got = expect; return next;

  begin
    update public.profiles set role = 'editor' where id = creator.id;
    perform pg_temp.as_user(creator.id, creator.email);
    update public.instructions set data = jsonb_set(data, '{approvals,tech}', ap) where id = open_id;
    raise exception using errcode = 'P0999', message = 'approved';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'editor may NOT give the technical approval'; expect := '42501'; ok := got = expect; return next;

  -- ---- technical approver (approve_tech + lock, no edit) ----
  begin
    update public.profiles set role = 'tech_approver' where id = creator.id;
    perform pg_temp.as_user(creator.id, creator.email);
    update public.instructions set data = jsonb_set(data, '{approvals,tech}', ap) where id = open_id; get diagnostics n = row_count;
    raise exception using errcode = 'P0999', message = 'updated ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'technical approver may give the technical approval'; expect := 'updated 1'; ok := got = expect; return next;

  begin
    update public.profiles set role = 'tech_approver' where id = creator.id;
    perform pg_temp.as_user(creator.id, creator.email);
    update public.instructions set data = jsonb_set(data, '{approvals,dsgvo}', ap) where id = open_id;
    raise exception using errcode = 'P0999', message = 'approved';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'technical approver may NOT give the privacy approval'; expect := '42501'; ok := got = expect; return next;

  begin
    update public.profiles set role = 'tech_approver' where id = creator.id;
    perform pg_temp.as_user(creator.id, creator.email);
    update public.instructions set title = title || ' (t)', data = jsonb_set(data, '{title}', to_jsonb(title || ' (t)')) where id = open_id;
    raise exception using errcode = 'P0999', message = 'edited';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'technical approver may NOT change content'; expect := '42501'; ok := got = expect; return next;

  -- ---- team roles: membership in the instruction's team decides ----
  begin
    update public.workspaces w set teams = (select jsonb_agg(case when t->>'id' = team_id then jsonb_set(t, '{members}', coalesce(t->'members', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('email', lower(creator.email), 'role', 'viewer'))) else t end) from jsonb_array_elements(w.teams) t) where w.ws = p_ws;
    perform pg_temp.as_user(creator.id, creator.email);
    select count(*) into n2 from public.instructions where id = team_instr;
    update public.instructions set title = title || ' (t)' where id = team_instr; get diagnostics n = row_count;
    raise exception using errcode = 'P0999', message = 'sees ' || n2 || ', updated ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'team viewer sees the team instruction but cannot change it (workspace role creator does not count there)'; expect := 'sees 1, updated 0'; ok := got = expect; return next;

  begin
    update public.workspaces w set teams = (select jsonb_agg(case when t->>'id' = team_id then jsonb_set(t, '{members}', coalesce(t->'members', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('email', lower(creator.email), 'role', 'editor'))) else t end) from jsonb_array_elements(w.teams) t) where w.ws = p_ws;
    perform pg_temp.as_user(creator.id, creator.email);
    update public.instructions set title = title || ' (t)', data = jsonb_set(data, '{title}', to_jsonb(title || ' (t)')) where id = team_instr; get diagnostics n = row_count;
    raise exception using errcode = 'P0999', message = 'updated ' || n;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'team editor may change the team instruction'; expect := 'updated 1'; ok := got = expect; return next;

  -- ---- teams_eff column (v008) ----
  select count(*) into n from public.instructions i where i.ws = p_ws
    and i.teams_eff is distinct from public.instr_team_ids(public.jsonb_text_array(i.data->'teams'), i.data->>'folder', i.ws);
  test := 'teams_eff matches the computed team ids on every row'; expect := '0'; got := n::text; ok := n = 0; return next;

  begin  -- assign the open draft's folder (or the draft itself) to the foreign team → the creator loses sight of it
    update public.instructions set data = jsonb_set(data, '{teams}', jsonb_build_array(team_id)) where id = open_id;
    perform pg_temp.as_user(creator.id, creator.email);
    select count(*) into n2 from public.instructions where id = open_id;
    raise exception using errcode = 'P0999', message = 'sees ' || n2;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'restricting an instruction to a foreign team hides it at once (row trigger)'; expect := 'sees 0'; ok := got = expect; return next;

  begin  -- the same through the folder: give the draft a new folder that belongs to the foreign team → cascade from workspaces
    update public.instructions set data = jsonb_set(data, '{folder}', '"authz-folder"') where id = open_id;
    update public.workspaces w set folders = coalesce(w.folders, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', 'authz-folder', 'name', 'authz', 'teams', jsonb_build_array(team_id))) where w.ws = p_ws;
    select teams_eff into s from public.instructions where id = open_id;
    perform pg_temp.as_user(creator.id, creator.email);
    select count(*) into n2 from public.instructions where id = open_id;
    raise exception using errcode = 'P0999', message = 'teams_eff=' || s || ', sees ' || n2;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'assigning a folder to a team cascades into the folder''s instructions'; expect := 'teams_eff={' || team_id || '}, sees 0'; ok := got = expect; return next;

  -- ---- GDPR ----
  begin
    perform pg_temp.as_user(creator.id, creator.email);
    j := public.gdpr_export_user(other.email);
    raise exception using errcode = 'P0999', message = 'exported';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'GDPR export is refused for non-admins'; expect := '42501'; ok := got = expect; return next;

  begin
    perform pg_temp.as_user(admin.id, admin.email);
    j := public.gdpr_export_user(other.email);
    raise exception using errcode = 'P0999', message = (select string_agg(k, ',' order by k) from jsonb_object_keys(j) k);
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'GDPR export (admin) returns the full record'; expect := 'ai_usage,email,exported_at,exported_by,feedback,instructions_created_or_edited,invites,profile,runs,team_memberships,workspace'; ok := got = expect; return next;

  begin
    perform pg_temp.as_user(admin.id, admin.email);
    j := public.gdpr_erase_user(other.email);
    perform pg_temp.as_root();
    select count(*) into n from public.profiles where id = other.id;
    select count(*) into n2 from auth.users where id = other.id;
    raise exception using errcode = 'P0999', message = 'profile_deleted=' || (j->>'profile_deleted') || ', profiles left=' || n || ', auth users left=' || n2;
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'GDPR erase (admin) removes profile + auth user (rolled back here)'; expect := 'profile_deleted=true, profiles left=0, auth users left=0'; ok := got = expect; return next;

  begin
    perform pg_temp.as_user(admin.id, admin.email);
    j := public.gdpr_erase_user(admin.email);
    raise exception using errcode = 'P0999', message = 'erased';
  exception when others then got := case when sqlstate = 'P0999' then sqlerrm else sqlstate end; end;
  test := 'an admin cannot erase his own account'; expect := '42501'; ok := got = expect; return next;

  -- ---- performance of the list query under the new policies (creator) ----
  perform pg_temp.as_user(creator.id, creator.email);
  for s in execute 'explain (analyze, format text) select id, updated_at from public.instructions where ws = ' || quote_literal(p_ws) loop
    if s like 'Execution Time:%' then got := s; end if;
  end loop;
  perform pg_temp.as_root();
  test := 'heads query (id, updated_at) as creator'; expect := 'Execution Time < 100 ms'; ok := (regexp_replace(got, '[^0-9.]', '', 'g'))::numeric < 100; return next;
  perform pg_temp.as_root();
end $fn$;
