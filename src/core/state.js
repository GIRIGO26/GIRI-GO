import { DB, LS } from './storage.js';
// mutable app state that used to be top-level "let" variables – one place, live everywhere
const G = {
  LANG: 'de',
  lastSync: 0, // last successful delta sync (ms) – navigation renders from memory while this is recent
  perf: {on:false, last:null, log:[]}, // navigation timings (v0.29: tap the version label 5× to show)
  sb: null,
  wsLoaded: false,
  saving: 0,
  toastT: undefined,
  animRaf: 0,
  animLast: 0,
  activeCleanup: null,
  authReady: false,
  rtChannel: null,
  renderSeq: 0,
  seedOnce: null,
  recentEmojis: [],
  pdfBusy: false,
  renderAfterPdf: false,
  installPrompt: null,
  pendingUpdate: null,
  lastUpdCheck: 0,
  busyCheck: null,
  pickingUp: false,
  pendingSync: 0,
};



/* ---------- State ---------- */
const S = { user: null, session: null, instrs: [], route: null, mediaURL: new Map(), remoteUrl: new Map() };

// Medien: lokal im Browser (IndexedDB) als Offline-Puffer, remote im Storage. Lokal gewinnt, wenn vorhanden.
// Safari: Blobs aus IndexedDB sind als <video>-Quelle unzuverlässig → wir speichern ArrayBuffer + MIME
const mediaBlob = m => m ? (m.buf ? new Blob([m.buf], {type:m.mime||''}) : (m.blob ? new Blob([m.blob], {type:m.blob.type||m.mime||''}) : null)) : null;

async function putMedia(rec){ const blob = rec.blob; if(blob){ rec.buf = await blob.arrayBuffer(); rec.mime = blob.type||''; delete rec.blob; } await DB.put('media', rec); if(!rec.remote && !rec.cache && rec.ws) pendingAdd(rec.id, rec.ws); return rec; }

/* recordings waiting for upload – a small list in localStorage, so no page has to read every clip out of IndexedDB to know what is pending */
const PEND_KEY = 'gg_pend_media';
const pendingList = () => LS.get(PEND_KEY);
const pendingSet = l => LS.set(PEND_KEY, l);
const pendingAdd = (id, ws) => { const l = pendingList() || []; if(!l.some(x => x.id===id)) l.push({id, ws}); pendingSet(l); };
const pendingRemove = id => { const l = pendingList(); if(l) pendingSet(l.filter(x => x.id!==id)); };
// first run after the update (no list yet): one full scan builds it
async function pendingIds(ws){ let l = pendingList(); if(!l){ try{ l = (await DB.all('media')).filter(m => (m.blob||m.buf) && !m.remote && !m.cache && m.ws).map(m => ({id:m.id, ws:m.ws})); }catch(e){ l = []; } pendingSet(l); } return l.filter(x => x.ws===ws).map(x => x.id); }

const mediaUrl = async id => {
  if(!id) return null;
  if(S.mediaURL.has(id)) return S.mediaURL.get(id);
  let m = null; try{ m = await DB.get('media', id); }catch(e){ console.warn('media store', e && e.message); } // v12.43: a failing device store falls back to the server copy
  const b = mediaBlob(m);
  if(b && b.size){ const u = URL.createObjectURL(b); S.mediaURL.set(id,u); return u; }
  if(m && m.remote) return m.remote;
  return S.remoteUrl.get(id) || null;
};

const BRAND_DEFAULT = {name:'', color:'#004EAD', logo:null, theme:'dark'};
 const brandCache = new Map();

// v12.48: workspace rows are readable for their members only – a worker link (no login, or another company) gets the branding
// through ws_brand(), which returns nothing but the brand
async function loadBrand(ws){ if(!G.sb || !ws) return S.brand; if(brandCache.has(ws)){ S.brand = brandCache.get(ws); return S.brand; }
  let brand = null;
  if(S.user && S.user.ws === ws){ try{ const {data} = await G.sb.from('workspaces').select('brand').eq('ws', ws).maybeSingle(); brand = data && data.brand; }catch(e){} }
  if(!brand){ try{ const {data, error} = await G.sb.rpc('ws_brand', {p_ws: ws}); if(!error && data && typeof data === 'object') brand = data; }catch(e){} }
  S.brand = Object.assign({}, BRAND_DEFAULT, brand || {}); if(brand) brandCache.set(ws, S.brand); return S.brand; }

async function saveBrand(brand){ const {error} = await G.sb.from('workspaces').upsert({ws:S.user.ws, brand, updated_at:new Date().toISOString()}); if(error) throw error; S.brand = Object.assign({}, BRAND_DEFAULT, brand); brandCache.set(S.user.ws, S.brand); }

export { S, mediaBlob, putMedia, pendingIds, pendingRemove, pendingAdd, mediaUrl, BRAND_DEFAULT, brandCache, loadBrand, saveBrand, G };
