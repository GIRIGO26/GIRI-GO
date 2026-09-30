/* ---------- v12.47: duplicate an instruction ----------
   A deep copy with new ids, as a draft without approvals/history/links. Media is copied inside the Storage bucket (server to server):
   a retake or a deleted step removes the original's files, so the copy must own its own. Clips that are still waiting for upload get
   a new local record so they go up for the copy as well. */
import { S, G, putMedia, mediaBlob } from './state.js';
import { DB, uid } from './storage.js';
import { newShareKey } from './links.js';
import { saveInstr } from './passwords.js';
import { t } from './i18n.js';
import { PUBLIC_MEDIA } from './supabase.js';

const META_DROP = ['approvals', 'status', 'history', 'pendingNote', 'lastBy', 'publishedAt', 'version', 'shareKey', 'updatedAt', '_base', 'trash', 'pw', 'pwHash', 'pwSalt', 'source'];
const bucketPath = url => { const base = PUBLIC_MEDIA(''); return url && url.startsWith(base) ? url.slice(base.length).split('?')[0] : null; };

async function copyObject(fromPath, toPath){
  const {error} = await G.sb.storage.from('media').copy(fromPath, toPath);
  if(error) throw error; return PUBLIC_MEDIA(toPath);
}

// onProgress(done, total) after every file; returns the new instruction (already saved and in S.instrs)
async function duplicateInstr(src, onProgress){
  const copy = JSON.parse(JSON.stringify(src)); META_DROP.forEach(k => { delete copy[k]; });
  copy.id = uid(); copy.title = t('copy_of', {t: src.title || t('untitled')}); copy.status = 'draft'; copy.approvals = {tech:null, dsgvo:null}; copy.history = []; copy.version = 0;
  copy.shareKey = newShareKey(); copy.createdBy = S.user.name; copy.createdAt = Date.now(); copy.updatedAt = Date.now(); copy.source = {kind:'copy', of: src.id, title: src.title, at: Date.now()};
  const steps = (copy.steps || []).filter(st => st && st.kind !== 'chapter');
  const total = steps.reduce((n, st) => n + (st.mediaPath ? 1 : 0) + (bucketPath(st.posterUrl) ? 1 : 0), 0); let done = 0;
  const tick = () => { if(onProgress){ try{ onProgress(done, total); }catch(e){} } };
  for(const st of (copy.steps || [])){
    if(!st) continue; const oldStepId = st.id; st.id = uid();
    if(st.kind === 'chapter') continue;
    (st.ann || []).forEach(a => { a.id = uid(); });
    if(!st.mediaId) continue;
    const newMid = uid();
    if(st.mediaPath && G.sb){
      const ext = st.mediaPath.split('.').pop(); const to = `${copy.ws}/${copy.id}/${newMid}.${ext}`;
      st.mediaUrl = await copyObject(st.mediaPath, to); st.mediaPath = to; done++; tick();
    } else if(!st.mediaUrl){
      // still local only (upload pending) → a second local record that uploads for the copy
      let m = null; try{ m = await DB.get('media', st.mediaId); }catch(e){}
      const b = mediaBlob(m); if(b && b.size) await putMedia({id:newMid, blob:b, w:m.w, h:m.h, type:m.type, duration:m.duration, ws:copy.ws, instrId:copy.id});
    }
    const pp = bucketPath(st.posterUrl);
    if(pp && G.sb){ try{ st.posterUrl = await copyObject(pp, `${copy.ws}/${copy.id}/${newMid}.poster.jpg`); }catch(e){ /* the thumbnail is rebuilt from the clip when missing */ delete st.posterUrl; } done++; tick(); }
    st.mediaId = newMid; void oldStepId;
  }
  await saveInstr(copy);
  return copy;
}

export { duplicateInstr };
