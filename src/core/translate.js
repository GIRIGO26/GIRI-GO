import { rememberBase } from './merge.js';
import { mirrorAll, mirrorList, mirrorMerge, mirrorRaw, netErr, online } from './offline.js';
import { t } from './i18n.js';
import { fixLegacyHosts } from './config.js';
import { toast } from './helpers.js';
import { saveInstr } from './passwords.js';
import { G, S } from './state.js';

/* ---------- Translations (DeepL via Edge Function) ---------- */
const LANGS = [['EN','English'],['FR','Français'],['ES','Español'],['IT','Italiano'],['NL','Nederlands'],['PL','Polski'],['CS','Čeština'],['TR','Türkçe'],['PT','Português'],['RO','Română'],['HU','Magyar'],['ZH','中文'],['DE','Deutsch']];

const FLAGS = {EN:'🇬🇧',FR:'🇫🇷',ES:'🇪🇸',IT:'🇮🇹',NL:'🇳🇱',PL:'🇵🇱',CS:'🇨🇿',TR:'🇹🇷',PT:'🇵🇹',RO:'🇷🇴',HU:'🇭🇺',ZH:'🇨🇳',DE:'🇩🇪'};

const langName = k => (LANGS.find(x=>x[0]===k)||[k,k])[1];

const srcTexts = instr => { const arr = [{k:'title', v:instr.title||''}]; for(const st of instr.steps){ if(st.kind==='chapter') arr.push({k:'ch:'+st.id, v:st.title||''}); else { arr.push({k:'t:'+st.id, v:st.title||''}); arr.push({k:'d:'+st.id, v:st.desc||''}); arr.push({k:'w:'+st.id, v:st.warn||''}); } } return arr; };

const strHash = str => { let h = 5381; for(let i=0;i<str.length;i++) h = ((h<<5)+h+str.charCodeAt(i))|0; return (h>>>0).toString(36); };

const srcHash = instr => strHash(srcTexts(instr).map(x=>x.v).join('\u0001'));

async function translateInstr(instr, target){
  const items = srcTexts(instr); const {data, error} = await G.sb.functions.invoke('translate', {body:{texts: items.map(x=>x.v), target}});
  if(error) throw new Error(error.message||String(error)); if(!data || data.error) throw new Error((data&&data.error)||'translate failed');
  const map = {}; items.forEach((x,i) => map[x.k] = data.translations[i]||'');
  instr.translations = instr.translations||{}; instr.translations[target] = {map, at:Date.now(), hash:srcHash(instr), by:S.user?S.user.name:''};
  await saveInstr(instr);
}

const hasTx = (instr, lang) => !!(lang && instr.translations && instr.translations[lang.toUpperCase()]);

function withLang(instr, lang){ // shallow clone with translated texts (original instr untouched)
  if(!hasTx(instr, lang)) return instr; const m = instr.translations[lang.toUpperCase()].map; const c = Object.assign({}, instr);
  c.title = m.title || instr.title; c.steps = instr.steps.map(st => st.kind==='chapter' ? Object.assign({}, st, {title: m['ch:'+st.id]||st.title}) : Object.assign({}, st, {title: m['t:'+st.id]||st.title, desc: m['d:'+st.id]||st.desc, warn: m['w:'+st.id]||st.warn})); c._lang = lang.toUpperCase(); return c;
}

const rememberRemote = instr => { for(const s of instr.steps||[]){ if(s.mediaUrl) S.remoteUrl.set(s.mediaId, s.mediaUrl); } };

const rowToInstr = r => { const i = r.data || {}; i.id = r.id; i.ws = r.ws; i.status = r.status; i.title = r.title; i.updatedAt = new Date(r.updated_at).getTime(); i._base = i.updatedAt; rememberRemote(i); rememberBase(i); return i; };

// delta sync: ask the server only for id + updated_at (a few bytes per instruction) and fetch full rows just for what changed
// since the local mirror – instead of the complete table (posters, translations, history …) on every page load
const loadInstrs = async () => {
  if(!G.sb || !S.user) { S.instrs = []; return; }
  const t0 = performance.now(), t0wall = Date.now(); const sig0 = S.instrs.map(i => i.id+':'+(i.updatedAt||0)).join(',');
  // v12.47: the copies from the device store never replace an in-memory object that is at least as new – the editor and the camera
  // hold references, and a swap while offline made steps recorded since disappear from the list until the next full sync
  const offlineFallback = async error => { const mem = new Map(S.instrs.map(i => [i.id, i])); const local = (await mirrorList()).map(r => { const m = mem.get(r.id); return m && (m.updatedAt||0) >= (r.updatedAt||0) ? m : r; }); { const ids = new Set(local.map(r => r.id)); S.instrs.forEach(m => { if(!ids.has(m.id) && m.ws === S.user.ws) local.push(m); }); } /* v12.48: an instruction created a moment ago (not in the device store yet) stays */ S.instrs = local.sort((a,b) => (b.updatedAt||0)-(a.updatedAt||0)); if(!netErr(error)) toast(error.message); else toast(t('offline_copy')); };
  // v12.48: offline → the device copy at once. Before, the request ran into the auth token refresh, which retries for up to 30 s
  if(!online()) return offlineFallback(new Error('offline'));
  let heads = null, error = null;
  // v12.37.1: page through the heads – PostgREST returns at most 1000 rows per request, large imports were cut off at 1000
  try{ heads = []; for(let from = 0; ; from += 1000){ const {data, error:e} = await G.sb.from('instructions').select('id, updated_at').eq('ws', S.user.ws).is('deleted_at', null).order('updated_at', {ascending:false}).order('id').range(from, from+999); if(e) throw e; heads.push(...(data||[])); if(!data || data.length < 1000) break; } }catch(e){ error = e; }
  if(error) return offlineFallback(error);
  const have = await mirrorRaw(); const local = new Map(have.map(m => [m.id, m.row]));
  const need = heads.filter(h => { const l = local.get(h.id); return !l || (l.updatedAt||0) !== new Date(h.updated_at).getTime(); }).map(h => h.id);
  const fresh = new Map();
  // v12.38: chunks of 40 ids, 4 requests in flight – the first login on a device with 1000+ instructions took ~10 s with 20 ids per sequential request
  const chunks = []; for(let k = 0; k < need.length; k += 40) chunks.push(need.slice(k, k+40));
  let next = 0; const worker = async () => { while(next < chunks.length && !error){ const ids = chunks[next++]; let rows = null; try{ const r = await G.sb.from('instructions').select('*').in('id', ids); rows = r.data; if(r.error) error = r.error; }catch(e){ error = e; } (rows||[]).forEach(r => fresh.set(r.id, rowToInstr(r))); } };
  await Promise.all(Array.from({length: Math.min(4, chunks.length)}, worker));
  if(error) return offlineFallback(error);
  const mem = new Map(S.instrs.map(i => [i.id, i])); // unchanged rows keep their in-memory object (editor/capture hold references)
  const rows = heads.map(h => fresh.get(h.id) || mem.get(h.id) || (local.get(h.id) && fixLegacyHosts(local.get(h.id)))).filter(Boolean);
  // v12.51: an instruction created (or saved) on this device while this sync was running is not in the heads yet – keep it. Before,
  // a new empty instruction could vanish from the list (and "to the editor" from the camera landed on the start page) until the next sync.
  // Only a save of this page that is still running or was answered after this sync began counts (G.savePending / G.savedHere) – an
  // instruction deleted elsewhere, or a copy from the device store after a reload, is not kept this way.
  { const ids = new Set(rows.map(r => r.id)); const here = G.savedHere || new Map(), pend = G.savePending || new Map();
    S.instrs.forEach(m => { if(m && !ids.has(m.id) && m.ws === S.user.ws && (pend.has(m.id) || (here.get(m.id)||0) >= t0wall - 1000)){ rows.unshift(m); ids.add(m.id); } }); }
  rows.forEach(i => { if(!fresh.has(i.id)) rememberRemote(i); });
  S.instrs = await mirrorMerge(rows, have, mem); await mirrorAll(S.instrs, fresh, have);
  G.lastSync = Date.now(); const changed = S.instrs.map(i => i.id+':'+(i.updatedAt||0)).join(',') !== sig0;
  G.perf.sync = {ms: Math.round(performance.now()-t0), heads: heads.length, fetched: need.length, changed};
  return changed;
};

export { LANGS, FLAGS, langName, srcTexts, strHash, srcHash, translateInstr, hasTx, withLang, rememberRemote, rowToInstr, loadInstrs };
