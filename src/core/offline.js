/* ---------- Offline: local mirror of instructions/profile/workspace, save queue with retry, sync status pill ---------- */
import { G, S, pendingIds } from './state.js';
import { DB, LS } from './storage.js';
import { t } from './i18n.js';
import { $, el } from './helpers.js';

const online = () => navigator.onLine !== false;
const netErr = e => !online() || /Failed to fetch|NetworkError|Load failed|network|timeout/i.test(String((e && e.message) || e || ''));

// ---- instruction mirror (IndexedDB store "instr": {id, ws, row, dirty, at}) ----
const mirrorPut = async (i, dirty) => { try{ const prev = await DB.get('instr', i.id); await DB.put('instr', {id:i.id, ws:i.ws, row: JSON.parse(JSON.stringify(i)), dirty: dirty!=null ? dirty : !!(prev && prev.dirty), at:Date.now()}); }catch(e){} };
// changed = Map of rows that came fresh from the server (only those are written; without it every row is written)
const mirrorAll = async (rows, changed, have) => { try{ have = have || await mirrorRaw(); const keep = new Set(rows.map(r => r.id)); for(const m of have){ if(!keep.has(m.id) && !m.dirty) await DB.del('instr', m.id); } for(const r of rows){ if(changed && !changed.has(r.id)) continue; await mirrorPut(r, false); } }catch(e){} };
// what is stored locally for this workspace – dirty copies win over what the server said
const mirrorRaw = async () => { try{ return (await DB.all('instr')).filter(m => m.ws===S.user.ws); }catch(e){ return []; } }; // read once per load, hand it around
const mirrorList = async have => (have || await mirrorRaw()).map(m => m.row);
const mirrorMerge = async (rows, have) => { try{ const dirty = (have || await mirrorRaw()).filter(m => m.dirty); if(!dirty.length) return rows; const out = rows.slice(); for(const d of dirty){ const k = out.findIndex(r => r.id===d.id); if(k>=0) out[k] = d.row; else out.push(d.row); } return out; }catch(e){ return rows; } };
const dirtyCount = async () => { try{ return (await DB.all('instr')).filter(m => m.ws===(S.user&&S.user.ws) && m.dirty).length; }catch(e){ return 0; } };
const pendingMedia = async () => { try{ return S.user ? (await pendingIds(S.user.ws)).length : 0; }catch(e){ return 0; } };

// ---- save queue: unsent instruction rows are pushed again when the network is back ----
let flushing = false;
async function flushDirty(upsertRow){
  if(flushing || !G.sb || !S.user || !online()) return 0; flushing = true; let n = 0;
  try{ const dirty = (await DB.all('instr')).filter(m => m.ws===S.user.ws && m.dirty);
    for(const m of dirty){ const ok = await upsertRow(m.row); if(ok){ await DB.put('instr', Object.assign(m, {dirty:false})); n++; } else break; }
  }catch(e){} finally { flushing = false; }
  if(n) syncPill(); return n;
}

// ---- profile / workspace mirror (localStorage) ----
const PROFILE_KEY = 'gg_profile_cache', WS_KEY = 'gg_ws_cache';
const cacheProfile = p => LS.set(PROFILE_KEY, p);
const cachedProfile = uid => { const p = LS.get(PROFILE_KEY); return p && p.id===uid ? p : null; };
const cacheWs = row => LS.set(WS_KEY, {ws:S.user.ws, row});
const cachedWs = () => { const c = LS.get(WS_KEY); return c && S.user && c.ws===S.user.ws ? c.row : null; };

// ---- status pill: offline, or things waiting to be synced ----
let pillTimer = 0;
async function syncPill(){
  const dirty = await dirtyCount(), media = await pendingMedia(); G.pendingSync = dirty + media;
  let e = $('#netpill'); if(!e){ e = el('<button class="netpill" id="netpill" hidden></button>'); document.body.appendChild(e); e.onclick = () => { if(online()) window.dispatchEvent(new Event('online')); }; }
  if(!S.user || (online() && !G.pendingSync)){ e.hidden = true; return; }
  const parts = []; if(media) parts.push(t(media===1 ? 'pend_media_one' : 'pend_media_many', {n:media})); if(dirty) parts.push(t(dirty===1 ? 'pend_change_one' : 'pend_change_many', {n:dirty}));
  e.hidden = false; e.classList.toggle('off', !online());
  const inCam = !!document.querySelector('.capture'); // camera: one short chip in the top row ("Offline · 3 warten"), the long text belongs to normal pages
  e.textContent = inCam ? (!online() ? `${t('offline')}${G.pendingSync ? ' · ' + t('waiting_n', {n:G.pendingSync}) : ''}` : `↻ ${t('waiting_n', {n:G.pendingSync})}`)
    : (!online() ? `${t('offline')}${parts.length ? ' · ' + parts.join(', ') + ' – ' + t('sync_later') : ''}` : `${parts.join(', ')} – ${t('sync_retry')}`);
}
const schedulePill = () => { clearTimeout(pillTimer); pillTimer = setTimeout(syncPill, 300); };

export { online, netErr, mirrorRaw, mirrorPut, mirrorAll, mirrorList, mirrorMerge, dirtyCount, pendingMedia, flushDirty, cacheProfile, cachedProfile, cacheWs, cachedWs, syncPill, schedulePill };
