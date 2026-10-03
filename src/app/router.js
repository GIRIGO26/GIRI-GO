import { logPerf } from '../core/telemetry.js';
import { retrySaves } from '../core/passwords.js';
import { migratePosters } from '../core/posters.js';
import { online, schedulePill, mirrorList } from '../core/offline.js';
import { renderTrash } from '../views/trash.js';
import { renderQrLogin } from '../views/devicelogin.js';
import { reloadForUpdate, updateSafe } from './pwa.js';
import { canAny } from '../core/roles.js';
import { ensureSeed } from './seed.js';
import { loadProfile, sessionExpired, signOutAll } from '../core/auth.js';
import { $, el, toast } from '../core/helpers.js';
import { IC } from '../ui/icons.js';
import { I18N, loadUiLang, t } from '../core/i18n.js';
import { ownWrites } from '../core/passwords.js';
import { G, S } from '../core/state.js';
import { loadInstrs, rememberRemote } from '../core/translate.js';
import { runUploads } from '../core/uploads.js';
import { loadWs, loadWsLocal } from '../core/workspace.js';
import { renderAdmin } from '../views/admin.js';
import { renderMaster } from '../views/master.js';
import { renderImporter } from '../views/importer.js';
import { renderCapture } from '../views/capture.js';
import { renderDashboard } from '../views/dashboard.js';
import { debounce, renderEditor } from '../views/editor.js';
import { renderLogin } from '../views/login.js';
import { renderResults } from '../views/results.js';
import { renderGlobalStats } from '../views/stats.js';
import { renderViewer } from '../views/viewer.js';


/* ---------- Router ---------- */
const go = h => { location.hash = h; };

// another device changed the instruction that is open here: refresh right away when nothing is being typed, otherwise show a banner
function remoteChanged(row){
  if(row && row.deleted_at){ // v12.48.1: someone moved the open instruction to the trash → say so (instead of "changed elsewhere")
    if($('#rt-trash')) return; $('#rt-note') && $('#rt-note').remove();
    const n = el(`<div class="rt-banner" id="rt-trash">${IC.trash||''}<span>${t('remote_trashed')}</span><button class="btn sm">${t('to_overview')}</button></div>`); n.querySelector('button').onclick = () => { n.remove(); go(''); }; document.body.appendChild(n); return;
  }
  const cur = S.instrs.find(i => i.id===row.id); const remoteAt = row.updated_at ? Date.parse(row.updated_at) : 0;
  if(cur && remoteAt && remoteAt <= (cur.updatedAt||0)) return;
  promptRefresh();
}
function promptRefresh(){
  const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && !document.activeElement.readOnly;
  if(!typing && G.saving===0 && (!G.busyCheck || !G.busyCheck())){ render(); toast(t('remote_refreshed')); return; }
  if($('#rt-note')) return; const n = el(`<div class="rt-banner" id="rt-note">${IC.refresh||''}<span>${t('remote_changed')}</span><button class="btn sm">${t('refresh_now')}</button></div>`); n.querySelector('button').onclick = () => { n.remove(); render(); }; document.body.appendChild(n);
}
// when the tab comes back to the front: has the open instruction moved on elsewhere? (websockets often die in background tabs)
async function refreshIfStale(){
  if(!G.sb || !S.user) return; const h = location.hash.replace(/^#\/?/, ''); const [view, id] = h.split('/');
  if(!view || ['p','trash','results','stats','admin'].includes(view)){ let changed = true; try{ changed = await loadInstrs(); }catch(e){} if(changed !== false) render(); return; } // v12.48: no redraw (flicker) when nothing changed
  if((view==='edit'||view==='settings'||view==='rec') && id){ try{ const {data} = await G.sb.from('instructions').select('id, updated_at').eq('id', id).maybeSingle(); if(data) remoteChanged(data); }catch(e){} }
}
function ensureRealtime(){
  if(!G.sb || !S.user || G.rtChannel) return;
  G.rtChannel = G.sb.channel('instr-'+S.user.ws).on('postgres_changes', {event:'*', schema:'public', table:'instructions', filter:'ws=eq.'+S.user.ws}, payload => {
    if(G.saving>0) return; // eigene Schreibvorgänge ignorieren
    if(payload.new && payload.new.updated_at && ownWrites.has(Date.parse(payload.new.updated_at))) return;
    const h = location.hash.replace(/^#\/?/, ''); const [view, id] = h.split('/');
    if(!view || ['p','trash','results','stats','admin'].includes(view)){ debounce('rt', render, 300); }
    else if((view==='edit'||view==='settings'||view==='rec') && payload.new && payload.new.id===id){ debounce('rt', () => remoteChanged(payload.new), 500); }
  }).subscribe();
}

// navigation never waits for the network when the in-memory copy is recent: render now, delta-sync in the background,
// and redraw only if something actually changed (realtime covers live edits on top)
const SYNC_FRESH_MS = 10*60*1000;
function bgSync(view, id){
  if(G.bgSyncing) return; G.bgSyncing = true;
  const before = id ? ((S.instrs.find(i => i.id===id)||{}).updatedAt||0) : 0;
  loadInstrs().then(changed => {
    if(!changed) return; const h = location.hash.replace(/^#\/?/, ''); const [v2, id2] = h.split('/'); if(v2 !== view || id2 !== id) return;
    if(!view || ['p','trash','results','stats','admin'].includes(view)) render();
    else if((view==='edit'||view==='settings'||view==='rec') && id){ const after = (S.instrs.find(i => i.id===id)||{}).updatedAt||0; if(after > before) promptRefresh(); } // newer on the server than what is open here
  }).catch(() => {}).finally(() => { G.bgSyncing = false; });
}
const perfChip = () => { const P = G.perf; if(!P.on || !P.last) return; let c = $('#perf-chip'); if(!c){ c = el(`<button id="perf-chip" class="perf-chip" title="Mess-Anzeige (Version 5× tippen = aus)"></button>`); document.body.appendChild(c); c.onclick = () => { c.classList.toggle('open'); }; }
  const L = P.last; const line = x => `<b>${x.view||'start'}</b> ${x.total} ms · ${x.mode}${x.sync ? ` · Sync ${x.sync.ms} ms (${x.sync.fetched}/${x.sync.heads} neu)` : ''}${x.auth ? ` · Login ${x.auth} ms` : ''} · Aufbau ${x.build} ms`;
  c.innerHTML = `<span>${line(L)}</span><div class="perf-log">${P.log.slice(-8).reverse().map(line).join('<br>')}</div>`; };
async function render(){
  if(G.pdfBusy){ G.renderAfterPdf = true; return; }
  const seq = ++G.renderSeq; const stale = () => seq !== G.renderSeq;
  const P = {t0: performance.now(), mode: 'sofort', auth: 0, syncMs: 0};
  if(G.activeCleanup){ try{ G.activeCleanup(); }catch(e){} G.activeCleanup = null; }
  const h = location.hash.replace(/^#\/?/, '');
  const [view, id, extra, extra2, extra3] = h.split('/');
  const app = $('#app');
  // v12.48: the same page drawn again (sync, a colleague's change, back to the tab) keeps where the list was scrolled to and does not
  // fade in again – on busy workspaces that looked like flickering
  const soft = G.lastRoute === h; G.lastRoute = h; const keepY = soft ? window.scrollY : 0; app.classList.toggle('soft', soft);
  const restoreY = () => { if(soft && keepY && G.lastRoute === h && Math.abs(window.scrollY - keepY) > 2) window.scrollTo(0, keepY); }; G.busyCheck = null; if(G.pendingUpdate && updateSafe()){ reloadForUpdate(); return; }
  if(!G.sb){ app.innerHTML = `<main class="page page-narrow"><div class="card empty"><h2>GIRI</h2><div>${t('loading_backend')}</div><br><button class="btn" onclick="location.reload()">${t('reload')}</button></div></main>`; return; }
  if(!I18N[G.LANG]){ app.innerHTML = `<div class="loading"><div class="spin"></div></div>`; const ok = await loadUiLang(G.LANG); if(stale()) return; if(!ok) G.LANG = 'en'; }
  if(view === 'v' && id){ app.innerHTML = ''; const tv = performance.now(); const cold = G.perf.log.length === 0; return Promise.resolve(renderViewer(app, id, false, extra, extra2, extra3)).then(r => { const total = Math.round(performance.now()-tv); const entry = {view:'v', total, mode:'werker', auth:0, build:total, sync:null}; G.perf.log.push(entry); if(cold || total > 1500) logPerf(entry, cold); return r; }); }
  if(!G.authReady){ app.innerHTML = `<div class="loading"><div class="spin"></div></div>`; const ta = performance.now(); await loadProfile(); if(stale()) return; G.authReady = true; P.auth = Math.round(performance.now()-ta); }
  app.innerHTML = '';
  if(view === 'qr' && id){ return renderQrLogin(app, id, extra); } // v12.50: sign-in by QR code from the PC (signed out or switching)
  if(!S.user){ return renderLogin(app); }
  ensureRealtime(); runUploads(); retrySaves(); schedulePill();
  const needWs = view==='' || view==='admin' || view==='p';
  // v12.48: offline with instructions in memory → draw at once (the background sync falls back to the device copy without waiting)
  const recent = S.instrs.length && ((G.lastSync && (Date.now()-G.lastSync) < SYNC_FRESH_MS) || !online()) && (!needWs || S.wsRow);
  // v0.29: cold start (app reopened, page reloaded) → the local mirror from the last visit is drawn at once, the server copy follows;
  // before: 3–4 sequential round trips (profile, list, changed rows, workspace) before anything appeared
  let localFirst = false;
  if(!recent && !S.instrs.length && G.lastSync === 0 && online()){ try{ const rows = await mirrorList(); if(rows.length){ S.instrs = rows.sort((a,b) => (b.updatedAt||0)-(a.updatedAt||0)); rows.forEach(rememberRemote); localFirst = !needWs || loadWsLocal(); } }catch(e){} }
  if(recent || localFirst){ // instant: memory/device first, server in the background
    if(needWs) loadWs(true).catch(() => {}); bgSync(view, id); P.mode = recent ? 'sofort' : 'lokal';
  } else {
    P.mode = 'mit Server'; app.innerHTML = `<main class="page"><div class="skel"><div class="sk line"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div></main>`; // skeleton instead of a spinner
    const ts = performance.now(); await Promise.all([loadInstrs(), loadWs(needWs)]); if(stale()) return; P.syncMs = Math.round(performance.now()-ts);
  }
  if(!S.instrs.length && canAny('edit') && online()){ await ensureSeed(); await loadInstrs(); if(stale()) return; }
  app.innerHTML = '';
  setTimeout(migratePosters, 1500);
  if(sessionExpired()){ await signOutAll(); toast(t('session_expired')); go(''); return renderLogin(app); }
  const tb = performance.now();
  const done = r => { restoreY(); const total = Math.round(performance.now()-P.t0); const cold = G.perf.log.length === 0; const entry = {view: view||'dashboard', total, mode: P.mode, auth: P.auth, build: Math.round(performance.now()-tb), sync: (P.mode==='sofort'||P.mode==='lokal') ? null : {ms: P.syncMs, fetched: (G.perf.sync||{}).fetched||0, heads: (G.perf.sync||{}).heads||0}}; G.perf.last = entry; G.perf.log.push(entry); window.__perfLog = G.perf.log; if(G.perf.log.length > 30) G.perf.log.shift(); if(total > 1500) console.warn('[giri-go] langsamer Screenwechsel', entry); perfChip(); if(cold || total > 1500) logPerf(entry, cold); return r; };
  const out = (() => {
    if(view === 'rec' && id) return renderCapture(app, id, extra, extra2);
    if(view === 'edit' && id) return renderEditor(app, id, extra, extra2);
    if(view === 'settings' && id) return renderEditor(app, id, null, null, 'settings'); // v12.49: settings are a sub-page of the instruction
    if(view === 'preview' && id) return renderViewer(app, id, true, extra, extra2, extra3);
    if(view === 'results' && id) return renderResults(app, id);
    if(view === 'p' && id) return renderDashboard(app, id);
    if(view === 'stats') return renderGlobalStats(app);
    if(view === 'trash') return renderTrash(app);
    if(view === 'admin' && id === 'import') return renderImporter(app);
    if(view === 'admin') return renderAdmin(app, id);
    if(view === 'master') return renderMaster(app);
    return renderDashboard(app);
  })();
  return Promise.resolve(out).then(done, e => { done(); throw e; });
}
// perf display on/off: the version label in the top bar, tapped 5× within 3 s
function perfToggle(){ G.perf.on = !G.perf.on; try{ localStorage.setItem('gg_perf', G.perf.on ? '1' : ''); }catch(e){} const c = $('#perf-chip'); if(!G.perf.on && c) c.remove(); if(G.perf.on){ toast('Mess-Anzeige an'); perfChip(); } else toast('Mess-Anzeige aus'); }
try{ G.perf.on = localStorage.getItem('gg_perf') === '1'; }catch(e){}
let verTaps = [];
document.addEventListener('click', e => { const v = e.target.closest && e.target.closest('.topbar .ver, .app-ver'); if(!v) return; const now = Date.now(); verTaps = verTaps.filter(x => now-x < 3000); verTaps.push(now); if(verTaps.length >= 5){ verTaps = []; perfToggle(); } });

export { remoteChanged, promptRefresh, refreshIfStale, go, ensureRealtime, render, perfToggle };
