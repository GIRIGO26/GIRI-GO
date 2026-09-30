import { LS } from './storage.js';
import { cacheProfile, cachedProfile, netErr } from './offline.js';
import { G, S } from './state.js';


/* ---------- Auth ---------- */
async function loadProfile(known){
  if(!G.sb) return null;
  const session = known || (await G.sb.auth.getSession()).data.session; S.session = session; if(!session) { S.user = null; return null; }
  let p = null, failed = false;
  try{ const r = await G.sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle(); p = r.data; failed = !!r.error && netErr(r.error); }catch(e){ failed = true; }
  if(!p && failed){ p = cachedProfile(session.user.id); } // offline: last known profile
  if(p) cacheProfile(p);
  if(!p && !failed){ // trigger not run yet? v12.47: the server places the person (invitation → domain → own workspace); the browser never picks a workspace
    try{ const r = await G.sb.rpc('ensure_profile'); p = Array.isArray(r.data) ? r.data[0] : r.data; if(p) cacheProfile(p); }catch(e){} }
  S.user = p ? {id:p.id, email:p.email, name:p.name||p.email.split('@')[0], role:p.role, ws:p.ws, isAdmin:!!p.is_admin || p.role==='admin', isMaster:!!p._master} : null;
  // platform admin? (master panel) – answered by the server, remembered with the profile for offline starts
  if(S.user && !failed && p._master == null){ try{ const {data} = await G.sb.rpc('is_master'); S.user.isMaster = !!data; p._master = !!data; cacheProfile(p); }catch(e){} }
  return S.user;
}

/* ---------- Session length: signed in for N days (workspace setting, default 14), then a fresh login ---------- */
const SESSION_DAYS_DEFAULT = 14, LOGIN_KEY = 'gg_login_at';
// called on SIGNED_IN: remember when this person signed in on this device (refreshes do not count)
const noteLogin = session => { if(!session || !session.user) return; const cur = LS.get(LOGIN_KEY); if(cur && cur.id===session.user.id) return; LS.set(LOGIN_KEY, {id:session.user.id, at:Date.now()}); };
const loginAt = session => { const cur = LS.get(LOGIN_KEY); if(cur && session && cur.id===session.user.id) return cur.at; const srv = session && session.user && Date.parse(session.user.last_sign_in_at||''); if(srv){ LS.set(LOGIN_KEY, {id:session.user.id, at:srv}); return srv; } noteLogin(session); return Date.now(); };
const sessionDays = () => { const n = +((S.wsRow && S.wsRow.settings && S.wsRow.settings.sessionDays) || 0); return n > 0 ? n : SESSION_DAYS_DEFAULT; };
// true when the sign-in is older than the workspace allows → the caller signs out
const sessionExpired = () => { if(!S.session || !S.user) return false; return Date.now() - loginAt(S.session) > sessionDays()*864e5; };
async function signOutAll(){ LS.del(LOGIN_KEY); try{ await G.sb.auth.signOut(); }catch(e){} S.user = null; S.session = null; if(G.rtChannel){ try{ G.sb.removeChannel(G.rtChannel); }catch(e){} G.rtChannel = null; } }

const orderedSteps = i => i.steps;
 // steps array carries order; chapters are entries with kind:'chapter'
const realSteps = i => i.steps.filter(s => s.kind !== 'chapter');
// text prepared but no recording yet, or a picture from the document that is only a placeholder until filmed (v0.28.3)
const needsShot = s => (!s.mediaId && !s.textOnly) || !!s.placeholder; // v12.43: a deliberate text step needs no picture

export { loadProfile, orderedSteps, realSteps, needsShot, SESSION_DAYS_DEFAULT, noteLogin, loginAt, sessionDays, sessionExpired, signOutAll };
