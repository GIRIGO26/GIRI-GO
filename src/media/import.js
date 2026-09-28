import { $, el, toast } from '../core/helpers.js';
import { t } from '../core/i18n.js';
import { saveInstr } from '../core/passwords.js';
import { G, S, putMedia } from '../core/state.js';
import { DB, uid } from '../core/storage.js';
import { runUploads } from '../core/uploads.js';
import { canConvert, convertVideo, isCompatVideo } from './convert.js';
import { IC } from '../ui/icons.js';
import { probeImage, probeVideo } from '../views/capture.js';
import { grabFrame, posterFromCanvas } from '../views/dashboard.js';


/* ---------- Replace a step's media (file or fresh recording) ---------- */
async function replaceStepMedia(instr, step, blob, meta){
  let m = meta;
  if(!m){ if(blob.type.startsWith('video')){ const pv = await probeVideo(blob); const u = URL.createObjectURL(blob); const c = await grabFrame(u, 0.3, 320); URL.revokeObjectURL(u); m = {type:'video', w:pv.w, h:pv.h, duration:pv.d, poster: c ? c.toDataURL('image/jpeg', .6) : null}; }
    else { const pi = await probeImage(blob); const u = URL.createObjectURL(blob); const img = await new Promise(r=>{ const i=new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src=u; }); const poster = img ? posterFromCanvas(img, img.naturalWidth, img.naturalHeight) : null; URL.revokeObjectURL(u); m = {type:'photo', w:pi.w, h:pi.h, duration:0, poster}; } }
  if(step.mediaId){ await DB.del('media', step.mediaId).catch(()=>{}); if(S.mediaURL.has(step.mediaId)){ try{ URL.revokeObjectURL(S.mediaURL.get(step.mediaId)); }catch(e){} S.mediaURL.delete(step.mediaId); } }
  if(step.mediaPath && G.sb) G.sb.storage.from('media').remove([step.mediaPath]).catch(()=>{});
  const mid = uid(); await putMedia({id:mid, blob, w:m.w, h:m.h, type:m.type, ws:instr.ws, instrId:instr.id});
  Object.assign(step, {type:m.type, mediaId:mid, mediaUrl:null, mediaPath:null, w:m.w, h:m.h, duration:m.duration, trimStart:0, trimEnd:m.duration, poster:m.poster||null});
  step.ann = (step.ann||[]).map(a => Object.assign({}, a, {t:0})); delete step.placeholder;
  runUploads();
}


/* ---------- Import photos/videos as steps (drag & drop on the PC, photo library on the phone) ---------- */
const MAX_IMPORT_MB = 80;

const isMediaFile = f => /^(image|video)\//.test(f.type||'') || /\.(jpe?g|png|webp|heic|heif|gif|mp4|mov|m4v|webm)$/i.test(f.name||'');

async function fileToMedia(file, onProgress){
  const isVid = (file.type||'').startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name||'');
  if(isVid){
    if(file.size > MAX_IMPORT_MB*1048576) throw new Error(t('import_too_big',{n:file.name, mb:MAX_IMPORT_MB}));
    const pv = await probeVideo(file); let blob = file, w = pv.w, h = pv.h, d = pv.d;
    if(!isCompatVideo(file.type, w, h, file.size) && canConvert()){ const r = await convertVideo(file, onProgress); if(r){ blob = r.blob; w = r.w; h = r.h; d = r.duration; } }
    const u = URL.createObjectURL(blob); const c = await grabFrame(u, Math.min(0.3, d/2), 320); URL.revokeObjectURL(u);
    return {blob, type:'video', w, h, duration:d, poster: c ? c.toDataURL('image/jpeg', .6) : null, converted: blob!==file};
  }
  if((file.type||'').startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name||'')){
    const u = URL.createObjectURL(file); let img;
    try{ img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(t('import_unreadable',{n:file.name}))); i.src = u; }); }
    finally{ setTimeout(() => URL.revokeObjectURL(u), 1000); }
    // photos are stored as JPEG, longest side 1600 px – plenty for phone screens and the PDF, small enough to sync fast
    const sc = Math.min(1, 1600/Math.max(1, img.naturalWidth, img.naturalHeight)); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth*sc)); c.height = Math.max(1, Math.round(img.naturalHeight*sc)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .86)); if(!blob) throw new Error(t('import_unreadable',{n:file.name}));
    return {blob, type:'photo', w:c.width, h:c.height, duration:0, poster: posterFromCanvas(c, c.width, c.height)};
  }
  throw new Error(t('import_unsupported',{n:file.name}));
}

// files → steps, inserted after `afterStepId` (or appended); returns the new steps
async function importFiles(instr, files, afterStepId){
  const list = [...files].filter(f => f && f.size && isMediaFile(f)); if(!list.length){ toast(t('import_none')); return []; }
  if(list.every(f => f.lastModified > 0)) list.sort((a,b) => a.lastModified - b.lastModified); // shooting order
  const prog = el(`<div class="modal-bg"><div class="modal" style="max-width:360px"><h2>${t('importing')}</h2><div class="muted" id="imp-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">&nbsp;</div><div class="pbar2"><i id="imp-bar"></i></div><div class="tnum" id="imp-cnt"></div></div></div>`); $('#modals').appendChild(prog);
  const added = [], errors = []; let at = afterStepId ? instr.steps.findIndex(x=>x.id===afterStepId) : instr.steps.length-1; if(at < 0) at = instr.steps.length-1;
  try{
    for(const [k,f] of list.entries()){
      prog.querySelector('#imp-name').textContent = f.name; prog.querySelector('#imp-bar').style.width = (100*k/list.length)+'%'; prog.querySelector('#imp-cnt').textContent = `${k+1} / ${list.length}`;
      const onP = p => { prog.querySelector('#imp-bar').style.width = (100*(k+p)/list.length)+'%'; prog.querySelector('#imp-cnt').textContent = `${k+1} / ${list.length} · ${t('converting')} ${Math.round(p*100)} %`; };
      try{ const m = await fileToMedia(f, onP); const mid = uid(); await putMedia({id:mid, blob:m.blob, w:m.w, h:m.h, type:m.type, ws:instr.ws, instrId:instr.id});
        const ns = {id:uid(), type:m.type, mediaId:mid, w:m.w, h:m.h, duration:m.duration, trimStart:0, trimEnd: m.type==='video' ? Math.min(m.duration, 15) : 0, title:'', desc:'', warn:'', ann:[], poster:m.poster||null};
        instr.steps.splice(at+1, 0, ns); at++; added.push(ns); }
      catch(e){ errors.push(e.message||String(e)); }
    }
  } finally { prog.remove(); }
  if(added.length){ if(instr.status!=='draft'){ instr.status='draft'; instr.approvals={tech:null,dsgvo:null}; } await saveInstr(instr); runUploads(); toast(t('imported',{n:added.length})); }
  if(errors.length) setTimeout(() => toast(errors.slice(0,2).join(' · ')), added.length ? 2300 : 0);
  return added;
}

// full-window drop target (PC): shows an overlay while files are dragged over the page
function attachDropImport(onFiles, hintFn){
  let depth = 0; const zone = el(`<div class="dropzone" hidden><div class="dz-in">${IC.upload}<b>${t('import_hint')}</b><span id="dz-sub"></span></div></div>`); document.body.appendChild(zone);
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types||[])].includes('Files');
  const enter = e => { if(!hasFiles(e)) return; e.preventDefault(); depth++; zone.querySelector('#dz-sub').textContent = hintFn ? hintFn() : ''; zone.hidden = false; };
  const over = e => { if(!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  const leave = e => { if(!hasFiles(e)) return; depth = Math.max(0, depth-1); if(!depth) zone.hidden = true; };
  const drop = e => { if(!hasFiles(e)) return; e.preventDefault(); depth = 0; zone.hidden = true; const files = [...e.dataTransfer.files]; if(files.length) onFiles(files); };
  document.addEventListener('dragenter', enter); document.addEventListener('dragover', over); document.addEventListener('dragleave', leave); document.addEventListener('drop', drop);
  return () => { document.removeEventListener('dragenter', enter); document.removeEventListener('dragover', over); document.removeEventListener('dragleave', leave); document.removeEventListener('drop', drop); zone.remove(); };
}

export { replaceStepMedia, MAX_IMPORT_MB, isMediaFile, fileToMedia, importFiles, attachDropImport };
