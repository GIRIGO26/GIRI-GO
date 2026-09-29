-- v12.45.0 – advisor clean-up after v005–v008: trigger functions are not callable through the API, pure helpers get a fixed search_path
revoke execute on function public.instr_authz_guard() from public, anon, authenticated;
revoke execute on function public.instr_teams_eff() from public, anon, authenticated;
revoke execute on function public.ws_teams_cascade() from public, anon, authenticated;
alter function public.norm_role(text) set search_path = public;
alter function public.role_caps(text) set search_path = public;
alter function public.jsonb_text_array(jsonb) set search_path = public;
alter function public.jsonb_anon_names(jsonb, text, text) set search_path = public;
