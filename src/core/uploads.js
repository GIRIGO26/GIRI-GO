import { uploadPoster } from './posters.js';
import { schedulePill } from './offline.js';
import { $, el } from './helpers.js';
import { t } from './i18n.js';
import { fetchInstr, saveInstr } from './passwords.js';
import { G, S, mediaBlob, pendingIds, pendingRemove } from './state.js';
import { DB } from './storage.js';
import { PUBLIC_MEDIA } from './supabase.js';
import { canConvert, convertVideo, isCompatVideo } from '../media/convert.js';


/* ---------- Upload-Queue (Clips erst lokal, dann im Hintergrund hoch) ---------- */
const UP = { running:false, total:0, done:0, failed:0, conv:null };

const extOf = blob => (blob.type||'').includes('mp4') ? 'mp4' : (blob.type||'').includes('webm') ? 'webm' : (blob.type||'').includes('png') ? 'png' : 'jpg';

function syncUI(){
  let e = $('#sync'); if(!e){ e = el('<div class="sync" id="sync"><span id="sync-t"></span><span class="bar"><i id="sync-b"></i></span></div>'); document.body.appendChild(e); }
  const pending = UP.total - UP.done - UP.failed; document.body.classList.toggle('uploading', !!UP.running);
  if(!UP.running && pending<=0 && !UP.failed){ e.classList.remove('show','err'); return; }
  e.classList.add('show'); e.classList.toggle('err', UP.failed>0 && !UP.running);
  $('#sync-t').textContent = UP.failed && !UP.running ? `${UP.failed} ${t('upload_failed')}` : (UP.conv!=null ? `${t('converting')} ${Math.round(UP.conv*100)} % · ${UP.done+1}/${UP.total}` : `${t('uploading')} ${UP.done}/${UP.total}`);
  $('#sync-b').style.width = (UP.total ? 100*UP.done/UP.total : 0)+'%';
}

async function runUploads(){
  if(!G.sb || !S.user || UP.running) return; UP.running = true;
  try{
    const ids = await pendingIds(S.user.ws); const all = []; for(const id of ids){ const m = await DB.get('media', id); if(m && (m.blob||m.buf) && !m.remote) all.push(m); else pendingRemove(id); }
    UP.total = all.length; UP.done = 0; UP.failed = 0; syncUI();
    for(const m of all){
      let blob = mediaBlob(m);
      if(m.type==='video' && !isCompatVideo(blob.type, m.w, m.h, blob.size) && canConvert() && !m.convFailed){
        UP.conv = 0; syncUI(); const r = await convertVideo(blob, p => { UP.conv = p; syncUI(); }); UP.conv = null;
        if(r){ m.buf = await r.blob.arrayBuffer(); m.mime = 'video/mp4'; delete m.blob; m.w = r.w; m.h = r.h; m.duration = r.duration; m.converted = true; await DB.put('media', m); blob = mediaBlob(m); if(S.mediaURL.has(m.id)){ try{ URL.revokeObjectURL(S.mediaURL.get(m.id)); }catch(e){} S.mediaURL.delete(m.id); } }
        else { m.convFailed = true; await DB.put('media', m); }
      }
      const path = `${m.ws}/${m.instrId}/${m.id}.${extOf(blob)}`;
      const {error} = await G.sb.storage.from('media').upload(path, blob, {upsert:true, contentType: blob.type || undefined});
      if(error){ UP.failed++; syncUI(); continue; }
      const url = PUBLIC_MEDIA(path);
      m.remote = url; m.path = path; await DB.put('media', m); S.remoteUrl.set(m.id, url); pendingRemove(m.id);
      // Schritt in der Anleitung mit Remote-URL versehen (frische Server-Version holen, um nichts zu überschreiben)
      const inst = await fetchInstr(m.instrId);
      if(inst){ const st = (inst.steps||[]).find(s => s.mediaId === m.id); if(st && !st.mediaUrl){ const patch = {mediaUrl:url, mediaPath:path}; if(/^data:/.test(st.poster||'')){ try{ patch.posterUrl = await uploadPoster(inst.id, m.id, st.poster); delete st.poster; }catch(e){} } if(m.converted){ patch.w = m.w; patch.h = m.h; if(m.duration){ patch.duration = m.duration; if(!st.trimEnd || st.trimEnd > m.duration) patch.trimEnd = m.duration; } } Object.assign(st, patch); await saveInstr(inst); const local = S.instrs.find(i=>i.id===inst.id); if(local){ const ls = local.steps.find(s=>s.mediaId===m.id); if(ls){ Object.assign(ls, patch); if(patch.posterUrl) delete ls.poster; } } } }
      UP.done++; syncUI();
    }
  } finally { UP.running = false; syncUI(); schedulePill(); if(UP.failed) setTimeout(()=>{ UP.failed=0; syncUI(); }, 6000); }
}

export { UP, extOf, syncUI, runUploads };
