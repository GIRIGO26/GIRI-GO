-- v015 check (v12.51) – run in the Supabase SQL editor after migrations/v015_live_version.sql.
-- Changes nothing: a test instruction is created, edited and opened inside a transaction that is rolled back at the end.
-- Expected: one row, every column = true.
begin;
insert into public.instructions(id, ws, status, title, data) values ('live-test-1', '__live_test__', 'published', 'Live-Test',
  '{"shareKey":"livetest-key-000001","version":2,"steps":[{"id":"a","title":"Freigegeben"}],"approvals":{"tech":{"by":"x"},"dsgvo":{"by":"x"}}}');
-- the creator changes a step: the next version starts as a draft
update public.instructions set status = 'draft', data = jsonb_set(jsonb_set(data, '{approvals}', '{"tech":null,"dsgvo":null}'), '{steps}', '[{"id":"a","title":"Entwurf"}]')
 where id = 'live-test-1';
select
  (select data->'live'->'steps'->0->>'title' from public.instructions where id = 'live-test-1') = 'Freigegeben'          as snapshot_kept,
  (select data->'live'->'approvals'->'tech'->>'by' from public.instructions where id = 'live-test-1') = 'x'          as approvals_kept,
  (public.open_instr('live-test-1', null, 'livetest-key-000001')->'row'->'data'->'steps'->0->>'title') = 'Freigegeben' as link_shows_approved_version,
  (public.open_instr('live-test-1', null, 'livetest-key-000001')->'row'->>'status') = 'published'                     as link_opens,
  public.instr_public('live-test-1', '__live_test__')                                                                as checklists_can_be_saved,
  coalesce((public.giri_features()->>'live')::boolean, false)                                                        as app_knows;
rollback;
