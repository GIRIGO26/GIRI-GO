import { trashStep } from '../core/trash.js';
import { go } from '../app/router.js';
import { needsShot, realSteps } from '../core/auth.js';
import { APP_VERSION } from '../core/config.js';
import { $$, el, esc, fmtSec, toast, confirmM } from '../core/helpers.js';
import { t } from '../core/i18n.js';
import { saveInstr } from '../core/passwords.js';
import { G, S, putMedia } from '../core/state.js';
import { DB, uid } from '../core/storage.js';
import { runUploads } from '../core/uploads.js';
import { importFiles } from '../media/import.js';
import { IC } from '../ui/icons.js';
import { grabFrame, posterCache, posterFromCanvas, stepPoster, stepPosterSync } from './dashboard.js';


/* ---------- Capture ---------- */
async function renderCapture(app, id, modeArg, stepArg){
  const instr = S.instrs.find(i=>i.id===id); if(!instr) return go('');
  let mode = (modeArg==='replace'||modeArg==='after') && instr.steps.find(x=>x.id===stepArg) ? {type:modeArg, stepId:stepArg} : {type:'append'};
  // steps prepared as text only (e.g. from a PDF) are filmed first, one after the other
  const nextEmpty = afterId => { const st = realSteps(instr); const k = afterId ? st.findIndex(x => x.id===afterId) : -1; return st.slice(k+1).find(needsShot) || st.find(needsShot) || null; };
  if(mode.type==='append'){ const e0 = nextEmpty(null); if(e0) mode = {type:'replace', stepId:e0.id}; }
  try{ sessionStorage.setItem('gg_tab_'+instr.id, 'steps'); }catch(e){}
  const v = el(`<div class="capture">
    <video id="cam" autoplay muted playsinline></video>
    <div class="focus-ring" id="focus"></div><div class="flash" id="flash"></div>
    <div class="cap-top"><button class="cnt tnum" id="cnt">${realSteps(instr).length} ${t('steps')}</button><span class="spacer"></span><button class="round done-top" id="done" title="${t('cap_done')}">${IC.check}<span>${t('cap_done')}</span></button></div>
    <div class="diagwrap" id="diagwrap" hidden><pre class="diag" id="diag"></pre><label class="btn ghost sm" style="cursor:pointer;color:#fff;border-color:rgba(255,255,255,.4)">${IC.upload} ${t('native_cam')}<input type="file" accept="video/*,image/*" capture="environment" hidden id="alt-file"></label></div>
    <div class="modebar" id="modebar" hidden><span id="modetxt"></span><button id="modex" aria-label="cancel">${IC.close}</button></div>
    <div class="cap-bottom">
      <div class="zoomrow" id="zoomwrap" hidden><input type="range" id="zoom" min="1" max="5" step="0.1" value="1" aria-label="${t('zoom')}" hidden><div class="zoom-btns" id="zoombtns"></div></div>
      <div class="cap-strip" id="strip"></div>
      <div class="cap-status"><div class="cap-pill"><span class="cap-timer tnum" id="timer"></span><span class="cap-hint" id="hint">${t('cap_tap')}</span></div></div>
      <div class="cap-ctrls">
        <div class="side"><button class="round" id="flip" title="${t('cap_switch')}">${IC.flip}</button></div>
        <div class="shutter" id="shutter" role="button" aria-label="${t('cap_tap')}"><svg viewBox="0 0 88 88"><circle class="ring-bg" cx="44" cy="44" r="42"/><circle class="ring" id="ring" cx="44" cy="44" r="42"/></svg><div class="core"></div></div>
        <div class="side"></div>
      </div>
    </div>
    <div class="cap-fallback" id="fb" hidden><h2>${t('cap_fallback_title')}</h2><p>${t('cap_fallback_text')}</p>
      <label class="btn mint" style="cursor:pointer">${IC.cam} ${t('cap_video')}<input type="file" accept="video/*" capture="environment" hidden id="fb-video"></label>
      <label class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.4);cursor:pointer">${t('cap_photo')}<input type="file" accept="image/*" capture="environment" hidden id="fb-photo"></label>
      <div class="row" style="margin-top:10px"><button class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.4)" id="fb-done">${t('to_editor')}</button></div>
      <div class="cap-strip" id="strip2" style="max-width:100%"></div></div>
  </div>`);
  app.appendChild(v);
  const cam = v.querySelector('#cam'), shutter = v.querySelector('#shutter'), ring = v.querySelector('#ring'), timerEl = v.querySelector('#timer'), hint = v.querySelector('#hint');
  // the "tap = photo · hold = video" hint is for the first recordings only; afterwards the pill appears while recording (timer, "getting long")
  let capN = 0; try{ capN = +(localStorage.getItem('gg_cap_n')||0); }catch(e){}
  const statusEl = v.querySelector('.cap-status'); const updStatus = recording => { statusEl.classList.toggle('quiet', capN >= 5 && !recording); }; updStatus(false);
  const diag = v.querySelector('#diag'); const LOG = []; const log = (...a) => { const line = new Date().toLocaleTimeString('de-DE')+' '+a.map(x => typeof x==='string' ? x : JSON.stringify(x)).join(' '); LOG.push(line); if(LOG.length>40) LOG.shift(); diag.textContent = LOG.join('\n'); };
  v.querySelector('#cnt').onclick = () => { const w = v.querySelector('#diagwrap'); w.hidden = !w.hidden; };
  log('GIRI v'+APP_VERSION, navigator.userAgent.slice(0,60)); log('MediaRecorder', typeof MediaRecorder, 'mp4:', (()=>{ try{ return MediaRecorder.isTypeSupported('video/mp4'); }catch(e){ return 'n/a'; } })());
  v.querySelector('#alt-file').onchange = async e => { const f = e.target.files[0]; if(!f) return; log('file', f.type, f.size); try{ if(f.type.startsWith('video')){ const meta = await probeVideo(f); const u = URL.createObjectURL(f); const c = await grabFrame(u, 0.3, 320); URL.revokeObjectURL(u); await addStep({type:'video', blob:f, w:meta.w, h:meta.h, duration:meta.d, poster: c ? c.toDataURL('image/jpeg', .6) : null}); } else { const meta = await probeImage(f); await addStep({type:'photo', blob:f, w:meta.w, h:meta.h, duration:0, poster:null}); } }catch(err){ log('file err', err.message); toast(t('error_prefix')+': '+err.message); } e.target.value=''; };
  let stream = null, facing = 'environment', rec = null, chunks = [], recStart = 0, raf = 0, holdT = 0, pressed = false, isRec = false, track = null;
  const MAX = 12, RED = 8, ORANGE = 5;
  const stopStream = () => { if(stream){ stream.getTracks().forEach(t=>t.stop()); stream = null; } };
  G.activeCleanup = () => { cancelAnimationFrame(raf); stopStream(); };
  let cardCompact = true;
  const chapterOf = sid => { let c = null; for(const x of instr.steps){ if(x.kind==='chapter') c = x.title; if(x.id===sid) return c; } return null; };
  const renderMode = () => { const mb = v.querySelector('#modebar'); const st = realSteps(instr); const idx = st.findIndex(x=>x.id===mode.stepId);
    if(mode.type==='append' || idx<0){ mb.hidden = true; mb.classList.remove('script'); hint.textContent = t('cap_tap'); return; }
    mb.hidden = false; const s = st[idx]; const txt = v.querySelector('#modetxt');
    // replace: the step's own text on top of the camera, so you know what to film
    if(mode.type==='replace' && (s.title || s.desc || s.shot || needsShot(s))){
      mb.classList.add('script'); const ch = chapterOf(s.id); const d = (s.desc||'').replace(/[*=]|\[|\]\([^)]*\)/g, '').split('\n').filter(Boolean).join(' · ');
      const open = needsShot(s);
      txt.innerHTML = `<div class="cs-meta"><span class="cs-m"><b class="tnum">${idx+1}/${st.length}</b>${ch ? ` · ${esc(ch)}` : ''}${open ? ` · <i class="cs-open">${s.placeholder ? t('ph_tag') : t('cs_open')}</i>` : ''}</span><span class="cs-nav"><button data-prev title="${t('cap_prev')}" ${idx===0?'disabled':''}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button><button data-next title="${t('cap_next_btn')}" ${idx>=st.length-1?'disabled':''}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></span></div><div class="cs-body"><div class="cs-title">${esc((s.title||'').replace(/\*\*|==/g,'')) || t('step')+' '+(idx+1)}</div>${s.warn ? `<div class="cs-warn">⚠ ${esc(s.warn)}</div>` : ''}${s.shot ? `<div class="cs-shot">🎬 ${esc(s.shot)}</div>` : ''}${d ? `<div class="cs-desc">${esc(d)}</div>` : ''}${s.placeholder && s.mediaId ? `<div class="cs-doc"><img alt=""><span>${t('ph_doc')}</span></div>` : ''}<span class="cs-more">${t('cs_more')} ›</span></div>`;
      // tap on the text → one line only (free view for framing); tap again → full text
      mb.classList.toggle('compact', cardCompact); txt.querySelector('.cs-body').onclick = () => { cardCompact = !cardCompact; mb.classList.toggle('compact', cardCompact); };
      const di = txt.querySelector('.cs-doc img'); if(di) stepPoster(s).then(u => { if(u) di.src = u; });
      const jump = k => { const nx = st[idx+k]; if(nx){ mode = {type:'replace', stepId:nx.id}; renderMode(); refreshStrip(); } };
      txt.querySelector('[data-prev]').onclick = () => jump(-1); txt.querySelector('[data-next]').onclick = () => jump(1);
    } else { mb.classList.remove('script'); txt.textContent = mode.type==='replace' ? t('replacing',{n:idx+1}) : t('inserting',{n:idx+1}); } };
  v.querySelector('#modex').onclick = () => { mode = {type:'append'}; renderMode(); refreshStrip(); };
  { const md = v.querySelector('#modedel'); if(md) md.onclick = async () => { const st = realSteps(instr).find(x => x.id===mode.stepId); if(!st) return; if(!(await confirmM(t('confirm_del_step'), t('delete')))) return; trashStep(instr, st); await saveInstr(instr); mode = {type:'append'}; renderMode(); refreshStrip(); toast(t('trashed_toast')); }; }
  const capImp = v.querySelector('#cap-imp input'); if(capImp) capImp.onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if(!fs.length) return; const after = mode.type==='after' ? mode.stepId : null; const added = await importFiles(instr, fs, after); if(added.length){ if(mode.type==='after') mode = {type:'after', stepId:added[added.length-1].id}; posterCache.clear(); refreshStrip(); } };
  const refreshStrip = async () => {
    const st = realSteps(instr); v.querySelector('#cnt').textContent = st.length+' '+t('steps');
    for(const sid of ['#strip','#strip2']){ const strip = v.querySelector(sid); strip.innerHTML='';
      for(const [k,s] of st.entries()){ const d = el(`<div class="st ${mode.stepId===s.id?(mode.type==='replace'?'sel':'aft'):''} ${s.mediaId?'':'noshot'} ${s.placeholder?'ph':''}">${s.mediaId ? '<img alt="">' : `<b>${IC.cam}</b>`}<i>${k+1}</i>${s.placeholder ? `<u>${t('ph_tag')}</u>` : ''}</div>`); strip.appendChild(d); if(s.mediaId){ const known = stepPosterSync(s); if(known) d.querySelector('img').src = known; else stepPoster(s).then(u=>{ if(u) d.querySelector('img').src=u; }); }
        d.onclick = () => { if(mode.type==='replace' && mode.stepId===s.id) mode = {type:'append'}; else mode = {type:'replace', stepId:s.id}; renderMode(); refreshStrip(); if(navigator.vibrate) try{navigator.vibrate(8);}catch(e){} }; }
      // newest at the right, always scrolled into view (twice: now + after layout/images)
      const toEnd = () => { const selEl = strip.querySelector('.sel,.aft'); if(selEl){ strip.scrollLeft = Math.max(0, selEl.offsetLeft - strip.clientWidth/2 + 24); } else strip.scrollLeft = strip.scrollWidth; };
      toEnd(); requestAnimationFrame(toEnd); setTimeout(toEnd, 250); }
    renderMode();
  };
  refreshStrip();
  async function startCam(){
    stopStream();
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ showFallback(); return; }
    try{
      stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:facing, width:{ideal:1280}, height:{ideal:720}}, audio:false});
      cam.srcObject = stream; cam.classList.toggle('mirror', facing==='user');
      track = stream.getVideoTracks()[0]; log('cam ok', track.label, track.getSettings ? track.getSettings().width+'x'+track.getSettings().height : '');
      cam.play && cam.play().catch(err => log('preview play', err.message));
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      const zw = v.querySelector('#zoomwrap'), zi = v.querySelector('#zoom');
      if(caps.zoom && caps.zoom.max > caps.zoom.min){ zw.hidden = false; zi.min = caps.zoom.min||1; zi.max = caps.zoom.max||5; zi.step = caps.zoom.step||0.1; zi.value = (track.getSettings().zoom)||caps.zoom.min||1; renderZoomBtns(caps.zoom); }
      else zw.hidden = true;
      v.querySelector('#fb').hidden = true;
    }catch(e){ log('cam FAIL', e.name, e.message); showFallback(); }
  }
  function showFallback(){ v.querySelector('#fb').hidden = false; }
  function renderZoomBtns(zc){ const min = zc.min||1, max = zc.max||5; const cands = [0.5,1,2,3,5].filter(z => z>=min-0.01 && z<=max+0.01); if(!cands.includes(min) && min<1) cands.unshift(min); const zb = v.querySelector('#zoombtns'); zb.innerHTML = cands.map(z=>`<button data-z="${z}" class="${Math.abs(z-(+v.querySelector('#zoom').value))<0.05?'on':''}">${z===0.5?'0,5':z}×</button>`).join(''); $$('button', zb).forEach(b => b.onclick = () => { const zi = v.querySelector('#zoom'); zi.value = b.dataset.z; zi.dispatchEvent(new Event('input')); }); }
  v.querySelector('#zoom').oninput = e => { const z = +e.target.value; $$('#zoombtns button', v).forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.z - z) < 0.05)); try{ track.applyConstraints({advanced:[{zoom:z}]}); }catch(err){} };
  // pinch zoom
  let pinchD = 0; cam.addEventListener('touchstart', e => { if(e.touches.length===2) pinchD = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); }, {passive:true});
  cam.addEventListener('touchmove', e => { if(e.touches.length===2 && pinchD){ const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); const zi = v.querySelector('#zoom'); if(v.querySelector('#zoomwrap').hidden) return; const z = Math.min(+zi.max, Math.max(+zi.min, +zi.value * (d/pinchD))); zi.value = z; pinchD = d; zi.dispatchEvent(new Event('input')); } }, {passive:true});
  // tap to focus
  cam.addEventListener('click', e => {
    const f = v.querySelector('#focus'); f.style.left = e.clientX+'px'; f.style.top = e.clientY+'px'; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); setTimeout(()=>f.classList.remove('on'), 900);
    if(!track) return; const r = cam.getBoundingClientRect();
    try{ track.applyConstraints({advanced:[{focusMode:'single-shot', pointsOfInterest:[{x:(e.clientX-r.left)/r.width, y:(e.clientY-r.top)/r.height}]}]}).catch(()=>{ try{ track.applyConstraints({advanced:[{focusMode:'continuous'}]}); }catch(x){} }); }catch(err){}
  });
  v.querySelector('#flip').onclick = () => { facing = facing==='environment'?'user':'environment'; startCam(); };
  const closeB = v.querySelector('[data-close]'); if(closeB) closeB.onclick = () => go('edit/'+instr.id);
  v.querySelector('#done').onclick = () => go('edit/'+instr.id);
  v.querySelector('#fb-done').onclick = () => go('edit/'+instr.id);
  // --- photo ---
  async function takePhoto(){
    log('photo'); if(!stream){ log('photo: no stream'); return; } const c = document.createElement('canvas'); const w = cam.videoWidth||1280, h = cam.videoHeight||720; c.width = w; c.height = h; const x = c.getContext('2d');
    if(facing==='user'){ x.translate(w,0); x.scale(-1,1); } x.drawImage(cam,0,0,w,h);
    const fl = v.querySelector('#flash'); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
    await addStep({type:'photo', blob, w, h, duration:0, poster: posterFromCanvas(c, w, h)});
  }
  // --- video ---
  function pickMime(){ const c = ['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']; for(const m of c){ try{ if(MediaRecorder.isTypeSupported(m)) return m; }catch(e){} } return ''; }
  function startRec(){
    if(!stream || isRec) return; chunks = [];
    const mime = pickMime(); log('rec new', mime||'(default)');
    try{ rec = new MediaRecorder(stream, mime?{mimeType:mime, videoBitsPerSecond:4_000_000}:{}); }catch(e){ log('rec ctor FAIL', e.message); try{ rec = new MediaRecorder(stream); log('rec ctor fallback ok', rec.mimeType); }catch(e2){ toast('MediaRecorder: '+e2.message); log('rec ctor FAIL2', e2.message); return; } }
    rec.ondataavailable = e => { log('data', e.data ? e.data.size : 0); if(e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = e => toast('MediaRecorder error: '+((e.error&&e.error.message)||e.name||'?'));
    let poster = null;
    rec.onstop = async () => { try{ const dur = (performance.now()-recStart)/1000; const blob = new Blob(chunks, {type: rec.mimeType||'video/webm'}); log('stop', fmtSec(dur)+'s', blob.size+'B', blob.type); if(dur < 0.4){ toast(t('too_short')); return; } if(!blob.size){ toast(t('clip_empty')+' – '+(rec.mimeType||'?')); return; } await addStep({type:'video', blob, w:cam.videoWidth||1280, h:cam.videoHeight||720, duration:dur, poster}); }catch(err){ log('stop ERR', err.message); toast(t('error_prefix')+': '+(err&&err.message||err)); } };
    try{ if((rec.mimeType||'').includes('mp4')) rec.start(); else rec.start(250); }catch(e){ try{ rec.start(); }catch(e2){ toast('MediaRecorder: '+e2.message); return; } }
    isRec = true; recStart = performance.now(); shutter.classList.add('rec'); updStatus(true); tick(); log('rec start', rec.state);
    setTimeout(() => { if(isRec){ const pc = document.createElement('canvas'); const w = cam.videoWidth||1280, h = cam.videoHeight||720; pc.width=w; pc.height=h; const x = pc.getContext('2d'); if(facing==='user'){ x.translate(w,0); x.scale(-1,1); } try{ x.drawImage(cam,0,0,w,h); poster = posterFromCanvas(pc, w, h); }catch(e){} } }, 400);
  }
  function stopRec(){ if(!isRec) return; isRec = false; updStatus(false); log('rec stop req', rec && rec.state); cancelAnimationFrame(raf); shutter.classList.remove('rec','tl-orange','tl-red'); ring.style.strokeDashoffset = 264; timerEl.textContent=''; timerEl.className='cap-timer tnum'; hint.textContent = t('cap_tap'); try{ rec.stop(); }catch(e){} }
  function tick(){
    if(!isRec) return; const s = (performance.now()-recStart)/1000;
    ring.style.strokeDashoffset = 264 - 264*Math.min(1, s/MAX);
    shutter.classList.toggle('tl-orange', s>=ORANGE && s<RED); shutter.classList.toggle('tl-red', s>=RED);
    timerEl.textContent = fmtSec(s)+' s'; timerEl.className = 'cap-timer tnum' + (s>=RED?' bad':(s>=ORANGE?' warn':''));
    hint.textContent = s>=RED ? t('cap_long') : (s>=ORANGE ? t('cap_getting_long') : t('cap_ok'));
    if(s >= MAX){ stopRec(); return; } raf = requestAnimationFrame(tick);
  }
  // --- shutter gestures: tap = photo, hold = video ---
  shutter.addEventListener('pointerdown', e => { e.preventDefault(); try{ shutter.setPointerCapture(e.pointerId); }catch(x){} pressed = true; log('down', e.pointerType); holdT = setTimeout(() => { if(pressed) startRec(); }, 220); });
  const release = ev => { if(!pressed) return; pressed = false; clearTimeout(holdT); log('up', ev && ev.type); if(isRec) stopRec(); else takePhoto(); };
  shutter.addEventListener('pointerup', release); shutter.addEventListener('pointercancel', release); shutter.addEventListener('lostpointercapture', release);
  const docUp = ev => release(ev); document.addEventListener('pointerup', docUp); document.addEventListener('pointercancel', docUp);
  const prevCleanup = G.activeCleanup; G.activeCleanup = () => { document.removeEventListener('pointerup', docUp); document.removeEventListener('pointercancel', docUp); if(prevCleanup) prevCleanup(); };
  // Safari fallback: touch events in case pointer events misbehave
  shutter.addEventListener('touchend', e => { if(pressed){ e.preventDefault(); release(e); } }, {passive:false});
  shutter.addEventListener('keydown', e => { if(e.key===' '||e.key==='Enter'){ e.preventDefault(); if(isRec) stopRec(); else startRec(); } });
  shutter.tabIndex = 0;
  // fallback inputs
  v.querySelector('#fb-video').onchange = async e => { const f = e.target.files[0]; if(!f) return; const meta = await probeVideo(f); const u = URL.createObjectURL(f); const c = await grabFrame(u, 0.3, 320); URL.revokeObjectURL(u); await addStep({type:'video', blob:f, w:meta.w, h:meta.h, duration:meta.d, poster: c ? c.toDataURL('image/jpeg', .6) : null}); e.target.value=''; };
  v.querySelector('#fb-photo').onchange = async e => { const f = e.target.files[0]; if(!f) return; const meta = await probeImage(f); const u = URL.createObjectURL(f); const img = await new Promise(r=>{ const i=new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src=u; }); const poster = img ? posterFromCanvas(img, img.naturalWidth, img.naturalHeight) : null; URL.revokeObjectURL(u); await addStep({type:'photo', blob:f, w:meta.w, h:meta.h, duration:0, poster}); e.target.value=''; };
  async function addStep(m){
    log('addStep', m.type, m.blob.size+'B', m.w+'x'+m.h);
    const mid = uid(); try{ await putMedia({id:mid, blob:m.blob, w:m.w, h:m.h, type:m.type, ws:S.user.ws, instrId:instr.id}); log('db ok'); }catch(err){ log('db ERR', err.message); toast(t('save_error')+': '+err.message); }
    let n = realSteps(instr).length+1, nextMsg = '';
    const target = mode.stepId ? instr.steps.find(x=>x.id===mode.stepId) : null;
    if(mode.type==='replace' && target){
      if(target.mediaId){ await DB.del('media', target.mediaId).catch(()=>{}); } if(target.mediaPath) G.sb.storage.from('media').remove([target.mediaPath]).catch(()=>{});
      const wasEmpty = needsShot(target); delete target.placeholder;
      Object.assign(target, {type:m.type, mediaId:mid, mediaUrl:null, mediaPath:null, w:m.w, h:m.h, duration:m.duration, trimStart:0, trimEnd:m.duration, poster:m.poster||null}); target.ann = (target.ann||[]).map(a => Object.assign({}, a, {t:0}));
      n = realSteps(instr).indexOf(target)+1; posterCache.clear(); mode = {type:'append'};
      if(wasEmpty){ const nx = nextEmpty(target.id); if(nx){ mode = {type:'replace', stepId:nx.id}; nextMsg = t('cap_next', {n, m:realSteps(instr).indexOf(nx)+1}); } else nextMsg = t('cap_all_done') + ' ✓'; }
    } else {
      const ns = {id:uid(), type:m.type, mediaId:mid, w:m.w, h:m.h, duration:m.duration, trimStart:0, trimEnd:m.duration, title:'', desc:'', warn:'', ann:[], poster:m.poster||null};
      if(mode.type==='after' && target){ const i = instr.steps.indexOf(target); instr.steps.splice(i+1, 0, ns); n = realSteps(instr).indexOf(ns)+1; mode = {type:'after', stepId:ns.id}; }
      else instr.steps.push(ns);
    }
    if(instr.status==='published'){ instr.status='draft'; instr.approvals={tech:null,dsgvo:null}; }
    capN++; try{ localStorage.setItem('gg_cap_n', String(capN)); }catch(e){} updStatus(false);
    toast(nextMsg || t('cap_saved',{n})); refreshStrip();
    await saveInstr(instr); log('saved instr', realSteps(instr).length); runUploads().catch(()=>{});
    if(navigator.vibrate) try{ navigator.vibrate(30); }catch(e){}
  }
  startCam();
}

const probeVideo = f => new Promise(res => { const u = URL.createObjectURL(f); const v = document.createElement('video'); v.preload='metadata'; v.muted=true; v.onloadedmetadata = () => { let d = v.duration; if(!isFinite(d)) d = 5; res({w:v.videoWidth, h:v.videoHeight, d}); URL.revokeObjectURL(u); }; v.onerror = () => res({w:1280,h:720,d:5}); v.src = u; });

const probeImage = f => new Promise(res => { const u = URL.createObjectURL(f); const i = new Image(); i.onload = () => { res({w:i.naturalWidth, h:i.naturalHeight}); URL.revokeObjectURL(u); }; i.onerror = () => res({w:1280,h:960}); i.src = u; });

export { renderCapture, probeVideo, probeImage };
