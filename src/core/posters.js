/* ---------- Step posters (thumbnails) live in Storage as small JPEGs, not inside the instruction JSON (v0.24.1) ----------
   Before, every thumbnail was a data URL inside the instruction row – 30–130 KB per step – and every page load pulled all of them.
   New steps get posterUrl as soon as their media is uploaded; old rows are migrated here in the background, one instruction at a time. */
import { G, S } from './state.js';
import { PUBLIC_MEDIA } from './supabase.js';
import { online } from './offline.js';
import { fetchInstr, saveInstr } from './passwords.js';

const isData = u => /^data:/.test(u||'');
async function uploadPoster(instrId, mediaId, dataUrl){
  let blob = await (await fetch(dataUrl)).blob();
  // thumbnails are shown at ≤ 112 px: 320 px wide, q 0.6 is plenty (old posters were up to 130 KB each)
  try{ const bmp = await createImageBitmap(blob); if(bmp.width > 360){ const sc = 320/bmp.width; const c = document.createElement('canvas'); c.width = 320; c.height = Math.round(bmp.height*sc); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); const small = await new Promise(r => c.toBlob(r, 'image/jpeg', .62)); if(small) blob = small; } bmp.close && bmp.close(); }catch(e){}
  const path = `${S.user.ws}/${instrId}/${mediaId}.poster.jpg`;
  const {error} = await G.sb.storage.from('media').upload(path, blob, {upsert:true, contentType:'image/jpeg'}); if(error) throw error;
  return PUBLIC_MEDIA(path);
}
const needsMigration = i => [...(i.steps||[]), ...(i.trash||[])].some(s => isData(s.poster) && s.mediaUrl && !s.posterUrl);

let migrating = false, lastRun = 0;
// creators/admins only, online, never while something is being saved; the in-memory instruction is updated in place and saved
async function migratePosters(){
  if(migrating || Date.now()-lastRun < 2000 || !G.sb || !S.user || S.user.role==='viewer' || !online()) return; migrating = true; lastRun = Date.now();
  try{
    for(const i of S.instrs){
      if(i.ws !== S.user.ws || !needsMigration(i)) continue;
      // fresh server copy → upload posters → save that copy; the in-memory object only gets the URLs (never saved from here – it may be stale)
      const fresh = await fetchInstr(i.id); if(!fresh) continue;
      const steps = [...(fresh.steps||[]), ...(fresh.trash||[])].filter(s => isData(s.poster) && s.mediaUrl && !s.posterUrl); let changed = 0;
      for(const s of steps){ try{ s.posterUrl = await uploadPoster(fresh.id, s.mediaId, s.poster); delete s.poster; changed++; const mine = [...(i.steps||[]), ...(i.trash||[])].find(x => x.mediaId===s.mediaId); if(mine){ mine.posterUrl = s.posterUrl; delete mine.poster; } }catch(e){ break; } }
      if(changed && G.saving===0) await saveInstr(fresh);
      await new Promise(r => setTimeout(r, 300));
    }
  }catch(e){} finally { migrating = false; }
}

export { uploadPoster, migratePosters, needsMigration };
