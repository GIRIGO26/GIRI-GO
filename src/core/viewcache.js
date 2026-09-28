/* ---------- Offline copies for workers: published instructions + their media, kept on the device (IndexedDB store "vcache") ----------
   Every instruction a worker opens is saved automatically; the viewer then works without network and shows the copy right away
   when the connection is slow. Media (clips, photos, logo, custom symbols) land in the "media" store with cache:true. */
import { DB } from './storage.js';
import { S, putMedia, mediaBlob } from './state.js';
import { IMG_CACHE, imgListeners } from '../annotations/draw.js';
import { strHash } from './translate.js';

const KEEP_DAYS = 90; // unused copies are dropped after this
const assetId = url => 'url:' + strHash(url);
const isHttp = u => /^https?:/.test(u||'');
const assetUrls = (instr, brand) => { const s = new Set(); if(brand && isHttp(brand.logo)) s.add(brand.logo); (instr.steps||[]).forEach(st => { if(isHttp(st.posterUrl)) s.add(st.posterUrl); (st.ann||[]).forEach(a => { if(a.type==='img' && isHttp(a.src)) s.add(a.src); }); }); return [...s]; };
// blob URL of a cached asset (poster, logo, symbol) when it is on the device, otherwise the URL itself
const urlCache = new Map();
async function cachedUrl(url){ if(!isHttp(url)) return url; if(urlCache.has(url)) return urlCache.get(url); let m = null; try{ m = await DB.get('media', assetId(url)); }catch(e){} const b = mediaBlob(m); if(!b || !b.size) return url; const u = URL.createObjectURL(b); urlCache.set(url, u); S.mediaURL.set(assetId(url), u); return u; }
const mediaSteps = instr => (instr.steps||[]).filter(st => st.kind!=='chapter' && st.mediaId && st.mediaUrl);
const hasLocal = async id => { try{ return await DB.has('media', id); }catch(e){ return false; } }; // key lookup only – no clip is read

async function cacheGet(id){ try{ return (await DB.get('vcache', id)) || null; }catch(e){ return null; } }
async function cacheList(){ try{ return (await DB.all('vcache')).sort((a,b) => (b.openedAt||b.at||0)-(a.openedAt||a.at||0)); }catch(e){ return []; } }
// save/refresh the instruction row (+ brand with the original logo URL); media stats are kept
async function cachePut(instr, brand){
  const prev = await cacheGet(instr.id);
  const row = {id:instr.id, ws:instr.ws, title:instr.title, instr: JSON.parse(JSON.stringify(instr)), brand: brand ? JSON.parse(JSON.stringify(brand)) : (prev && prev.brand) || null, at:Date.now(), openedAt:Date.now(), media: prev ? prev.media : null};
  try{ await DB.put('vcache', row); }catch(e){} return row;
}
async function cacheTouch(id){ const r = await cacheGet(id); if(r){ r.openedAt = Date.now(); try{ await DB.put('vcache', r); }catch(e){} } }

// how much of an instruction is on the device: {done,total}
async function cacheStatus(instr, brand){
  const steps = mediaSteps(instr), assets = assetUrls(instr, brand); let done = 0;
  for(const st of steps) if(await hasLocal(st.mediaId)) done++;
  for(const u of assets) if(await hasLocal(assetId(u))) done++;
  return {done, total: steps.length + assets.length};
}

async function fetchBlob(url){ const r = await fetch(url, {mode:'cors'}); if(!r.ok) throw new Error('HTTP '+r.status); return await r.blob(); }
const jobs = new Map(); // instrId → running download
// download everything the viewer needs; onProgress({done,total,failed}) after each file
function cacheMedia(instr, brand, onProgress){
  if(jobs.has(instr.id)) return jobs.get(instr.id);
  const p = (async () => {
    const steps = mediaSteps(instr), assets = assetUrls(instr, brand); const total = steps.length + assets.length; let done = 0, failed = 0;
    const tick = () => { if(onProgress){ try{ onProgress({done, total, failed}); }catch(e){} } };
    try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); }catch(e){}
    for(const st of steps){ try{ if(!(await hasLocal(st.mediaId))){ const b = await fetchBlob(st.mediaUrl); await putMedia({id:st.mediaId, blob:b, type:st.type, w:st.w, h:st.h, duration:st.duration, remote:st.mediaUrl, path:st.mediaPath, instrId:instr.id, ws:instr.ws, cache:true}); S.mediaURL.delete(st.mediaId); } done++; }catch(e){ failed++; } tick(); }
    for(const u of assets){ try{ const id = assetId(u); if(!(await hasLocal(id))){ const b = await fetchBlob(u); await putMedia({id, blob:b, type:'asset', remote:u, ws:instr.ws, cache:true}); } done++; }catch(e){ failed++; } tick(); }
    const row = await cacheGet(instr.id); if(row){ row.media = {done, total, failed, at:Date.now()}; try{ await DB.put('vcache', row); }catch(e){} }
    return {done, total, failed};
  })();
  jobs.set(instr.id, p); p.finally(() => jobs.delete(instr.id)); return p;
}
const cacheRunning = id => jobs.has(id);

// logo + custom symbols from the device instead of the network (when they are there)
async function applyCachedAssets(instr, brand){
  const out = Object.assign({}, brand||{});
  for(const u of assetUrls(instr, brand)){
    let m = null; try{ m = await DB.get('media', assetId(u)); }catch(e){} const b = mediaBlob(m); if(!b || !b.size) continue;
    let url = S.mediaURL.get(assetId(u)); if(!url){ url = URL.createObjectURL(b); S.mediaURL.set(assetId(u), url); }
    if(brand && brand.logo===u) out.logo = url;
    if(!IMG_CACHE.has(u)){ const e = {img:null, masks:new Map()}; e.p = new Promise(res => { const i = new Image(); i.onload = () => { e.img = i; res(i); imgListeners.forEach(f => { try{ f(); }catch(x){} }); }; i.onerror = () => res(null); i.src = url; }); IMG_CACHE.set(u, e); }
  }
  return out;
}

// remove one copy (media only when no other saved instruction uses it)
async function cacheDel(id){
  const row = await cacheGet(id); if(!row) return;
  try{ await DB.del('vcache', id); }catch(e){}
  const others = await cacheList(); const keep = new Set();
  others.forEach(o => { mediaSteps(o.instr).forEach(st => keep.add(st.mediaId)); assetUrls(o.instr, o.brand).forEach(u => keep.add(assetId(u))); });
  const ids = [...mediaSteps(row.instr).map(st => st.mediaId), ...assetUrls(row.instr, row.brand).map(assetId)];
  for(const mid of ids){ if(keep.has(mid)) continue; try{ const m = await DB.get('media', mid); if(m && m.cache){ await DB.del('media', mid); const u = S.mediaURL.get(mid); if(u){ URL.revokeObjectURL(u); S.mediaURL.delete(mid); } } }catch(e){} }
}
// copies nobody opened for a long time go away by themselves
async function cachePrune(){ try{ const rows = await cacheList(); const old = Date.now() - KEEP_DAYS*864e5; for(const r of rows){ if((r.openedAt||r.at||0) < old) await cacheDel(r.id); } }catch(e){} }

export { cachedUrl, cacheGet, cacheList, cachePut, cacheTouch, cacheStatus, cacheMedia, cacheRunning, applyCachedAssets, cacheDel, cachePrune, KEEP_DAYS };
