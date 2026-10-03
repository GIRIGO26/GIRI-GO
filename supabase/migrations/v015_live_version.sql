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
