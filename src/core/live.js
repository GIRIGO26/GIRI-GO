/* ---------- v12.51: the approved version stays live while the next one is being edited (migration v015) ----------
   instr.live = a snapshot of the approved content, written in the same save that publishes the instruction – the database guard
   refuses any other change to it. While the next version is in draft or review, the link, the QR code, the workers' offline copies,
   checklists, views and feedback use the snapshot. Without v015 (giri_features() missing) the app writes no snapshot – editing a
   published instruction then takes it offline as before, and the editor says so. */
import { G, S } from './state.js';

// the snapshot keeps approvals and history (who approved the live version) – not the step bin, draft notes or row columns
const LIVE_SKIP = new Set(['pendingNote', 'lastBy', 'live', 'trash', 'id', 'ws', 'status', 'updatedAt', 'liveOf']);

let featP = null;
// what the database can do – asked once per session (an old database has no giri_features → {})
const ensureFeatures = () => {
  if(G.features) return Promise.resolve(G.features);
  if(!G.sb) return Promise.resolve({});
  if(!featP) featP = (async () => { try{ const {data, error} = await G.sb.rpc('giri_features'); G.features = (!error && data && typeof data === 'object') ? data : {}; }catch(e){ G.features = {}; } featP = null; return G.features; })();
  return featP;
};
const liveSupported = () => !!(G.features && G.features.live);
const hasLive = i => !!(i && i.live && typeof i.live === 'object' && Array.isArray(i.live.steps));
const pathsOf = steps => new Set((steps || []).map(s => s && s.mediaPath).filter(Boolean));

// the snapshot written when publishing (call it after version / publishedAt are set); media URLs that are known on this device
// but not in the step yet (upload finished meanwhile) are filled in
const makeLive = i => {
  const o = {}; Object.keys(i).forEach(k => { if(!LIVE_SKIP.has(k) && k[0] !== '_') o[k] = i[k]; });
  o.title = i.title; const snap = JSON.parse(JSON.stringify(o));
  (snap.steps || []).forEach(s => { if(s && s.mediaId && !s.mediaUrl && S.remoteUrl && S.remoteUrl.has(s.mediaId)) s.mediaUrl = S.remoteUrl.get(s.mediaId); });
  return snap;
};

// what workers see while the next version is in draft / review: the snapshot, with media URLs that arrived after publishing
// (same media id in the current steps or the step bin) filled in
const liveView = i => {
  if(!i || i.status === 'published' || !hasLive(i)) return i;
  const cur = new Map(); [...(i.steps || []), ...(i.trash || [])].forEach(s => { if(s && s.mediaId) cur.set(s.mediaId, s); });
  const v = Object.assign({}, i.live, {id: i.id, ws: i.ws, status: 'published', title: i.live.title || i.title, shareKey: i.shareKey, updatedAt: i.updatedAt, liveOf: i.status});
  v.steps = (i.live.steps || []).map(s => {
    if(!s || !s.mediaId || s.mediaUrl) return s;
    const c = cur.get(s.mediaId); const url = (c && c.mediaUrl) || (S.remoteUrl && S.remoteUrl.get(s.mediaId)) || null;
    return url ? Object.assign({}, s, {mediaUrl: url, mediaPath: s.mediaPath || (c && c.mediaPath) || null}, (!s.posterUrl && c && c.posterUrl) ? {posterUrl: c.posterUrl} : {}) : s; });
  return v;
};

// media files the live version still shows must stay in the storage when the draft replaces or drops them
const liveUses = (i, path) => !!path && hasLive(i) && pathsOf(i.live.steps).has(path);
const livePaths = i => hasLive(i) ? [...pathsOf(i.live.steps)] : [];

export { ensureFeatures, liveSupported, hasLive, makeLive, liveView, liveUses, livePaths };
