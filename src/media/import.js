import { $, el, esc, modal, toast } from '../core/helpers.js';
import { t } from '../core/i18n.js';
import { saveInstr } from '../core/passwords.js';
import { G, S, putMedia } from '../core/state.js';
import { DB, uid } from '../core/storage.js';
import { liveUses } from '../core/live.js';
import { runUploads } from '../core/uploads.js';
import { canConvert, convertVideo, isCompatVideo } from './convert.js';
import { IC } from '../ui/icons.js';
import { probeImage, probeVideo } from '../views/capture.js';
import { grabFrame, posterFromCanvas } from '../views/dashboard.js';


/* ---------- progress box shared by import and replace ---------- */
function progressBox(title){
  const box = el(`<div class="modal-bg"><div class="modal" style="max-width:360px"><h2>${title}</h2><div class="muted" id="imp-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">&nbsp;</div><div class="pbar2"><i id="imp-bar"></i></div><div class="tnum" id="imp-cnt"></div></div></div>`); $('#modals').appendChild(box);
  return { set(name, frac, label){ if(name!=null) box.querySelector('#imp-name').textContent = name; box.querySelector('#imp-bar').style.width = Math.round(100*frac)+'%'; box.querySelector('#imp-cnt').textContent = label||''; }, remove(){ box.remove(); } };
}
// v12.41: what went wrong stays on screen until closed – a toast vanished before anyone could read it
const errorList = (title, errors) => modal(`<h2>${esc(title)}</h2><ul style="margin:0 0 6px;padding-left:18px;font-size:14px;line-height:1.5">${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul><p class="muted" style="margin:0 0 10px;font-size:13px">${t('import_err_hint')}</p><div class="actions"><button class="btn primary" data-x>${t('close')}</button></div>`, (bg, close) => { bg.querySelector('[data-x]').onclick = () => close(true); });

/* ---------- Replace a step's media (file or fresh recording) ---------- */
async function replaceStepMedia(instr, step, blob, meta){
  let m = meta;
  if(!m && blob instanceof File){ // v12.41: a picked file goes the same way as an import – shrunk, first 60 s, clear errors
    const prog = progressBox(t('importing')); try{ const r = await fileToMedia(blob, p => prog.set(blob.name, p, `${t('converting')} ${Math.round(p*100)} %`)); blob = r.blob; m = r; } finally{ prog.remove(); } }
  if(!m){ if(blob.type.startsWith('video')){ const pv = await probeVideo(blob); const u = URL.createObjectURL(blob); const c = await grabFrame(u, 0.3, 320); URL.revokeObjectURL(u); m = {type:'video', w:pv.w, h:pv.h, duration:pv.d, poster: c ? c.toDataURL('image/jpeg', .6) : null}; }
    else { const pi = await probeImage(blob); const u = URL.createObjectURL(blob); const img = await new Promise(r=>{ const i=new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src=u; }); const poster = img ? posterFromCanvas(img, img.naturalWidth, img.naturalHeight) : null; URL.revokeObjectURL(u); m = {type:'photo', w:pi.w, h:pi.h, duration:0, poster}; } }
  if(step.mediaId){ await DB.del('media', step.mediaId).catch(()=>{}); if(S.mediaURL.has(step.mediaId)){ try{ URL.revokeObjectURL(S.mediaURL.get(step.mediaId)); }catch(e){} S.mediaURL.delete(step.mediaId); } }
  if(step.mediaPath && G.sb && !liveUses(instr, step.mediaPath)) G.sb.storage.from('media').remove([step.mediaPath]).catch(()=>{}); // v12.51: the live version may still show it
  const mid = uid(); await putMedia({id:mid, blob, w:m.w, h:m.h, type:m.type, ws:instr.ws, instrId:instr.id});
  Object.assign(step, {type:m.type, mediaId:mid, mediaUrl:null, mediaPath:null, w:m.w, h:m.h, duration:m.duration, trimStart:0, trimEnd:m.duration, poster:m.poster||null});
  step.ann = (step.ann||[]).map(a => Object.assign({}, a, {t:0})); delete step.placeholder;
  runUploads();
}


/* ---------- Import photos/videos as steps (drag & drop on the PC, photo library on the phone) ---------- */
// v12.41: big or long clips are no longer refused – the browser shrinks them (H.264, ≤ 1280 px, first 60 s, ~2 Mbit/s) before
// they are stored. Only where the browser cannot convert (old browsers) the old 80 MB limit applies.
const MAX_IMPORT_MB = 600;   // sanity cap for the converter
const MAX_RAW_MB = 80;       // stored as it is – above this a clip must be converted

const isMediaFile = f => /^(image|video)\//.test(f.type||'') || /\.(jpe?g|png|webp|heic|heif|gif|mp4|mov|m4v|webm)$/i.test(f.name||'');
const mb = n => Math.round(n/1048576);

async function fileToMedia(file, onProgress){
  const isVid = (file.type||'').startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name||'');
  if(isVid){
    if(file.size > MAX_IMPORT_MB*1048576) throw new Error(t('import_too_big',{n:file.name, mb:MAX_IMPORT_MB}));
    const pv = await probeVideo(file); let blob = file, w = pv.w, h = pv.h, d = pv.d, converted = false;
    if(!isCompatVideo(file.type, w, h, file.size)){
      if(canConvert()){ const r = await convertVideo(file, onProgress); if(r){ blob = r.blob; w = r.w; h = r.h; d = r.duration; converted = true; } }
      if(!converted && file.size > MAX_RAW_MB*1048576) throw new Error(t('import_too_big_conv',{n:file.name, mb:mb(file.size), max:MAX_RAW_MB}));
    }
    const u = URL.createObjectURL(blob); const c = await grabFrame(u, Math.min(0.3, d/2), 320); URL.revokeObjectURL(u);
    return {blob, type:'video', w, h, duration:d, poster: c ? c.toDataURL('image/jpeg', .6) : null, converted, cut: converted && pv.d > d + 0.5 ? pv.d : 0};
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
  const prog = progressBox(t('importing'));
  const added = [], errors = [], notes = []; let at = afterStepId ? instr.steps.findIndex(x=>x.id===afterStepId) : instr.steps.length-1; if(at < 0) at = instr.steps.length-1;
  try{
    for(const [k,f] of list.entries()){
      prog.set(f.name, k/list.length, `${k+1} / ${list.length}`);
      const onP = p => prog.set(null, (k+p)/list.length, `${k+1} / ${list.length} · ${t('shrinking')} ${Math.round(p*100)} %`);
      try{ const m = await fileToMedia(f, onP); const mid = uid(); await putMedia({id:mid, blob:m.blob, w:m.w, h:m.h, type:m.type, ws:instr.ws, instrId:instr.id});
        const ns = {id:uid(), type:m.type, mediaId:mid, w:m.w, h:m.h, duration:m.duration, trimStart:0, trimEnd: m.type==='video' ? Math.min(m.duration, 15) : 0, title:'', desc:'', warn:'', ann:[], poster:m.poster||null};
        instr.steps.splice(at+1, 0, ns); at++; added.push(ns); if(m.cut) notes.push(t('import_cut', {n:f.name, s:Math.round(m.duration)})); }
      catch(e){ errors.push(e.message||String(e)); }
    }
  } finally { prog.remove(); }
  if(added.length){ if(instr.status!=='draft'){ instr.status='draft'; instr.approvals={tech:null,dsgvo:null}; } await saveInstr(instr); runUploads();
    const nv = added.filter(x => x.type==='video').length, np = added.length - nv; const parts = []; if(nv) parts.push(`${nv} ${t(nv===1?'one_video':'n_videos')}`); if(np) parts.push(`${np} ${t(np===1?'one_photo':'n_photos')}`);
    toast(t('imported2', {n:added.length, what:parts.join(' + ')})); }
  if(notes.length && !errors.length) setTimeout(() => toast(notes[0]), added.length ? 2300 : 0);
  if(errors.length) await errorList(t('import_failed', {n:errors.length}), errors.concat(notes));
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

export { replaceStepMedia, MAX_IMPORT_MB, isMediaFile, fileToMedia, importFiles, attachDropImport, progressBox };
