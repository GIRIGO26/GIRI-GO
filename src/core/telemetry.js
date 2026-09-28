/* ---------- v0.29: client log – slow screen changes, cold starts and JS errors land in public.client_log ----------
   Never blocks anything: queued, sent in small batches (keepalive on page hide), at most MAX events per session, no personal data
   beyond the user id / workspace. Admins see their workspace's rows; everything is dropped after 30 days (DB trigger). */
import { APP_VERSION } from './config.js';
import { G, S } from './state.js';
import { CFG } from './supabase.js';

const Q = []; let sent = 0, timer = 0; const MAX = 40, seenErr = new Set(); let errs = 0;
const device = () => { const u = navigator.userAgent; return /iPhone|iPad/.test(u) ? 'iOS' : /Android/.test(u) ? 'Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : 'Other'; };
const ctx = () => { const c = navigator.connection || null; let sa = false; try{ sa = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }catch(e){}
  return {v: APP_VERSION, dev: device(), ua: navigator.userAgent.slice(0, 120), conn: c ? {t: c.effectiveType||null, rtt: c.rtt ?? null, down: c.downlink ?? null, save: !!c.saveData} : null, online: navigator.onLine !== false, app: sa, sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), lang: G.LANG, route: location.hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard'}; };
function logEvent(kind, payload, ws){
  if(!CFG.SUPABASE_URL || sent + Q.length >= MAX) return;
  Q.push({kind, ws: ws || (S.user ? S.user.ws : null), uid: S.user ? S.user.id : null, ctx: ctx(), payload});
  clearTimeout(timer); timer = setTimeout(() => flush(false), 4000);
}
async function flush(final){
  if(!Q.length || navigator.onLine === false) return; const rows = Q.splice(0, 10); sent += rows.length;
  const tok = (S.session && S.session.access_token) || CFG.SUPABASE_KEY;
  try{ await fetch(`${CFG.SUPABASE_URL}/rest/v1/client_log`, {method:'POST', keepalive: !!final, headers:{'apikey': CFG.SUPABASE_KEY, 'Authorization': 'Bearer '+tok, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'}, body: JSON.stringify(rows)}); }catch(e){}
  if(Q.length && !final) timer = setTimeout(() => flush(false), 2000);
}
// a screen change that took long, or the first one after a (re)start – with the phases the router measured
const logPerf = (entry, cold) => {
  let nav = null; try{ const n = performance.getEntriesByType('navigation')[0]; if(n) nav = {ttfb: Math.round(n.responseStart), shell: Math.round(n.responseEnd), dom: Math.round(n.domContentLoadedEventEnd), type: n.type}; }catch(e){}
  logEvent('perf', Object.assign({cold: !!cold, sinceStart: Math.round(performance.now()), nav}, entry));
};
const logError = (msg, extra) => { const key = String(msg).slice(0, 120); if(errs >= 5 || seenErr.has(key)) return; seenErr.add(key); errs++; logEvent('error', Object.assign({msg: String(msg).slice(0, 300)}, extra||{})); };
function installTelemetry(){
  window.addEventListener('error', e => { if(!e || !e.message) return; logError(e.message, {src: String(e.filename||'').split('/').pop().slice(0, 60), line: e.lineno||0}); });
  window.addEventListener('unhandledrejection', e => { const r = e && e.reason; const m = r && (r.message || (typeof r === 'string' ? r : '')); if(!m || /Failed to fetch|Load failed|NetworkError|AbortError/i.test(m)) return; logError(m, {kind:'promise'}); });
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') flush(true); });
  window.addEventListener('pagehide', () => flush(true));
}
export { logEvent, logPerf, logError, installTelemetry };
