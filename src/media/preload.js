/* ---------- v12.46: editor media cache – clips and photos of the instruction being edited are fetched in the background and kept on
   the device (IndexedDB store "media", cache:true, editor:true), so switching steps is instant the second time and on the PC the
   videos are there before the step is opened. The player streams the current step from the server meanwhile; that step is fetched
   last (the browser's HTTP cache usually answers that second request). Phones fetch only the next three steps (data volume); every
   device stops when free storage runs low. Entries are listed in localStorage (gg_ecache) so pruning never reads the blobs. */
import { DB } from '../core/storage.js';
import { S, putMedia } from '../core/state.js';
import { cacheList } from '../core/viewcache.js';

const KEY = 'gg_ecache', KEEP_DAYS = 14, MIN_FREE = 300 * 1024 * 1024;
const isHttp = u => /^https?:/.test(u || '');
const index = () => { try{ return JSON.parse(localStorage.getItem(KEY) || '[]'); }catch(e){ return []; } };
const indexSet = l => { try{ localStorage.setItem(KEY, JSON.stringify(l.slice(-2000))); }catch(e){} };
const remember = (id, instrId) => { const l = index().filter(x => x.id !== id); l.push({id, instrId, at: Date.now()}); indexSet(l); };
const hasLocal = async id => { try{ return await DB.has('media', id); }catch(e){ return false; } };
async function freeOk(){ try{ if(!(navigator.storage && navigator.storage.estimate)) return true; const e = await navigator.storage.estimate(); return !e.quota || (e.quota - (e.usage || 0)) > MIN_FREE; }catch(e){ return true; } }
async function fetchBlob(url){ const r = await fetch(url, {mode:'cors'}); if(!r.ok) throw new Error('HTTP ' + r.status); return await r.blob(); }

const jobs = new Map(); // instrId → {promise, stop}
// steps with a server copy, in the order they are fetched: after the current step first, then before it, the current one last
const order = (instr, current) => {
  const steps = (instr.steps || []).filter(st => st && st.kind !== 'chapter' && st.mediaId && isHttp(st.mediaUrl));
  const k = steps.findIndex(st => st.id === current);
  return k >= 0 ? [...steps.slice(k + 1), ...steps.slice(0, k), steps[k]] : steps;
};
// opts: current (selected step id), limit (number of steps; 0 = all), onDone(id) after each cached clip
function preloadInstr(instr, opts = {}){
  if(window.__tables && !window.__pruneEditorCache){ window.__pruneEditorCache = pruneEditorCache; window.__mediaHas = id => DB.has('media', id); window.__vcachePut = row => DB.put('vcache', row); } // test hooks (Playwright build only – the Supabase mock defines __tables)
  if(jobs.has(instr.id)) return jobs.get(instr.id).promise;
  const job = {stop:false};
  job.promise = (async () => {
    let done = 0; const list = order(instr, opts.current).slice(0, opts.limit || undefined);
    for(const st of list){
      if(job.stop) break;
      try{
        if(await hasLocal(st.mediaId)) continue;
        if(!(await freeOk())) break;
        const b = await fetchBlob(st.mediaUrl); if(job.stop || !b.size) break;
        await putMedia({id:st.mediaId, blob:b, type:st.type, w:st.w, h:st.h, duration:st.duration, remote:st.mediaUrl, path:st.mediaPath, instrId:instr.id, ws:instr.ws, cache:true, editor:true, at:Date.now()});
        remember(st.mediaId, instr.id); S.mediaURL.delete(st.mediaId); done++;
        if(opts.onDone){ try{ opts.onDone(st.mediaId); }catch(e){} }
      }catch(e){ if(/quota/i.test(String((e && e.name) || e))) break; }
    }
    return done;
  })();
  jobs.set(instr.id, job); job.promise.finally(() => { if(jobs.get(instr.id) === job) jobs.delete(instr.id); });
  return job.promise;
}
const preloadStop = instrId => { const j = jobs.get(instrId); if(j) j.stop = true; };

// copies nobody edited for two weeks go away – unless a worker's offline copy still needs the clip
async function pruneEditorCache(){
  const l = index(); if(!l.length) return 0;
  const old = Date.now() - KEEP_DAYS * 864e5; const stale = l.filter(x => x.at < old); if(!stale.length) return 0;
  const keep = new Set(); try{ (await cacheList()).forEach(r => (r.instr.steps || []).forEach(st => { if(st.mediaId) keep.add(st.mediaId); })); }catch(e){}
  let n = 0; const rest = l.filter(x => x.at >= old);
  for(const x of stale){ if(keep.has(x.id)){ rest.push(x); continue; } try{ const m = await DB.get('media', x.id); if(m && m.editor){ await DB.del('media', x.id); const u = S.mediaURL.get(x.id); if(u){ URL.revokeObjectURL(u); S.mediaURL.delete(x.id); } } n++; }catch(e){ rest.push(x); } }
  indexSet(rest); return n;
}
// touch: the instruction was opened again – its clips stay another two weeks
const touchEditorCache = instrId => { const l = index(); let hit = false; l.forEach(x => { if(x.instrId === instrId){ x.at = Date.now(); hit = true; } }); if(hit) indexSet(l); };


export { preloadInstr, preloadStop, pruneEditorCache, touchEditorCache };
