import { trackEnd } from '../annotations/track.js';
import { drawAll, onImgReady } from '../annotations/draw.js';
import { render } from '../app/router.js';
import { loadProfile, realSteps } from '../core/auth.js';
import { $, $$, confirmM, el, esc, modal, toast } from '../core/helpers.js';
import { I18N, fmtDate, loadUiLang, t } from '../core/i18n.js';
import { fetchInstr } from '../core/passwords.js';
import { online } from '../core/offline.js';
import { applyCachedAssets, cacheDel, cacheGet, cacheMedia, cachePrune, cachePut, cacheStatus, cacheTouch } from '../core/viewcache.js';
import { isShareKey } from '../core/links.js';
import { installGuide, isStandalone } from '../app/pwa.js';
import { mdToHtml, mdToPlain, titleHtml } from '../core/richtext.js';
import { G, S, loadBrand, mediaUrl, putMedia } from '../core/state.js';
import { DB, LS, uid } from '../core/storage.js';
import { CFG, PUBLIC_MEDIA } from '../core/supabase.js';
import { FLAGS, LANGS, hasTx, rowToInstr, srcHash, withLang } from '../core/translate.js';
import { extOf } from '../core/uploads.js';
import { confirmSteps } from '../core/workspace.js';
import { IC } from '../ui/icons.js';
import { nOf, posterCache, stepPoster } from './dashboard.js';
import { debounce, debounces } from './editor.js';


/* ---------- Viewer: password card for protected links ---------- */
function passwordGate(app, tryOpen, key){
  return new Promise(res => {
    const v = el(`<div class="viewer"><div class="vw-start"><div class="card"><div class="big" style="font-size:40px;margin-bottom:6px">🔒</div><h1>${t('pw_title')}</h1><p style="color:#B8C6DB;margin:0 0 16px">${t('pw_sub')}</p><div class="field"><label for="vpw">${t('link_pw_label')}</label><input id="vpw" type="password" autocomplete="current-password" autocapitalize="off"></div><div class="muted" id="vpw-err" style="color:#ff8a8e;min-height:18px;margin:-6px 0 8px;font-size:13px"></div><button class="btn mint" id="vpw-go" style="width:100%;padding:14px">${t('pw_open')}</button></div></div></div>`);
    app.appendChild(v); const inp = v.querySelector('#vpw'), btn = v.querySelector('#vpw-go'), err = v.querySelector('#vpw-err'); setTimeout(() => inp.focus(), 80);
    const go = async () => { const pw = inp.value; if(!pw) return; btn.disabled = true; err.textContent = ''; const r = await tryOpen(pw); btn.disabled = false;
      if(r && !r.locked && r.row){ LS.set(key, pw); v.remove(); res(r); return; }
      err.textContent = t('pw_wrong'); inp.select(); };
    btn.onclick = go; inp.addEventListener('keydown', e => { if(e.key==='Enter') go(); }); });
}


/* ---------- Viewer ---------- */
async function renderViewer(app, id, isPreview, langArg, arg2, arg3){
  // #/v/<id>/<key>/<lang>, #/v/<id>/<key>/<chapter>, …/<chapter>/<lang> – in any order; the key (v0.33) is what makes the link open without login
  const urlArgs = [langArg, arg2, arg3].filter(Boolean); const chapArg = +(urlArgs.find(x => /^\d+$/.test(x))||0); langArg = urlArgs.find(x => /^[a-z]{2}$/i.test(x)) || ''; let shareKey = urlArgs.find(isShareKey) || '';
  if(!G.authReady){ await loadProfile(); G.authReady = true; }
  app.innerHTML = `<div class="empty" style="padding-top:120px">…</div>`;
  let instr0 = S.instrs.find(i=>i.id===id) || null;
  const PWKEY = 'gg_pw_'+id;
  // ---- offline copy: no network → the saved copy; slow network → the copy right away, the server version follows in the background ----
  let cached = null, fromCache = false, newerRow = null;
  const fetchRow = async () => { try{ const {data, error} = await G.sb.from('instructions').select('*').eq('id', id).maybeSingle(); if(error) return {err:error}; return {row: data ? rowToInstr(data) : null}; }catch(e){ return {err:e}; } };
  if(!instr0 && !isPreview){
    cached = await cacheGet(id);
    if(cached && !online()){ instr0 = cached.instr; fromCache = true; }
    else {
      const p = fetchRow(); const r = cached ? await Promise.race([p, new Promise(res => setTimeout(() => res('timeout'), 4000))]) : await p;
      if(r==='timeout' || (r && r.err)){ if(cached){ instr0 = cached.instr; fromCache = true; if(r==='timeout') p.then(x => { if(x && x.row && (x.row.updatedAt||0) > (cached.instr.updatedAt||0)) newerRow = x.row; }); } }
      else if(r && r.row) instr0 = r.row;
      else if(cached && r && !r.row){ /* gone or unpublished meanwhile */ }
    }
  }
  if(!instr0 && !isPreview && !fromCache){
    // not readable → maybe a password-protected link: the RPC checks the project/team password server-side
    const tryOpen = async pw => { try{ const {data, error} = await G.sb.rpc('open_instr', {p_id:id, p_pw: pw||null, p_key: shareKey||null}); if(error) return {err:true}; return data; }catch(e){ return {err:true}; } };
    let res = await tryOpen(LS.get(PWKEY));
    if(res && res.stale){ app.innerHTML = `<main class="page page-narrow"><div class="card empty"><h2>${esc(res.title||'')}</h2><div>${t('link_stale')}</div><br><a class="btn" href="#/">GIRI</a></div></main>`; return; }
    if(res && res.locked){ app.innerHTML = ''; res = await passwordGate(app, tryOpen, PWKEY); }
    if(res && !res.locked && res.row) instr0 = rowToInstr(res.row);
    else if(res && res.err && cached){ instr0 = cached.instr; fromCache = true; } // request failed → the copy
    else if(!res && cached && online()) cacheDel(id).catch(() => {}); // unpublished / deleted → drop the copy
  }
  app.innerHTML = '';
  if(!instr0){ app.innerHTML = `<main class="page page-narrow"><div class="card empty"><h2>404</h2><div>${t('not_pub')}</div><br><a class="btn" href="#/">GIRI</a></div></main>`; return; }
  if(!isPreview && instr0.status!=='published' && !(S.user && S.user.ws===instr0.ws)){ app.innerHTML = `<main class="page page-narrow"><div class="card empty"><h2>${esc(instr0.title)}</h2><div>${t('not_pub')}</div><br><a class="btn" href="#/">GIRI</a></div></main>`; return; }
  // ---- language: one link for all languages; the device remembers the worker's choice ----
  const prevLang = G.LANG; let vlang = ''; try{ vlang = (langArg || localStorage.getItem('gg_vlang') || '').toUpperCase(); }catch(e){}
  if(!LANGS.some(([k]) => k===vlang)) vlang = '';
  const fresh = l => hasTx(instr0, l) && instr0.translations[l].hash===srcHash(instr0);
  // v12.37.1: steps without any content (no text, no picture/video, no symbols – e.g. an empty last step from an import) are not shown to workers
  const isBlank = st => st.kind!=='chapter' && (st.type==='empty' || (!st.mediaId && !st.mediaUrl)) && !(st.title||'').trim() && !(st.desc||'').trim() && !(st.warn||'').trim() && !(st.ann||[]).length;
  if((instr0.steps||[]).some(isBlank)) instr0 = Object.assign({}, instr0, {steps: instr0.steps.filter(st => !isBlank(st))});
  let cur = (vlang && fresh(vlang)) ? withLang(instr0, vlang) : instr0; if(vlang && cur===instr0 && hasTx(instr0, vlang)) cur = withLang(instr0, vlang); // stale cache is still better than nothing while we refresh
  const uiFor = l => I18N[l.toLowerCase()] ? l.toLowerCase() : (l==='DE' ? 'de' : 'en');
  if(vlang) G.LANG = uiFor(vlang);
  const instr = instr0;
  let brand = (fromCache && cached && cached.brand) ? Object.assign({}, cached.brand) : await loadBrand(instr.ws);
  if(!fromCache && cached && cached.brand && !online()) brand = Object.assign({}, cached.brand);
  const brandSrc = Object.assign({}, brand); // with the original logo URL (what gets saved)
  brand = await applyCachedAssets(instr, brand);
  // ---- keep a copy on the device: every published instruction a worker opens (media download in the background) ----
  const offlineOK = !isPreview && instr.status==='published';
  let offPill = null; const showOff = (txt, cls, hideAfter) => { if(!offPill){ offPill = el('<div class="vw-off" id="vw-off"></div>'); app.appendChild(offPill); } offPill.textContent = txt; offPill.className = 'vw-off show ' + (cls||''); clearTimeout(offPill._t); if(hideAfter) offPill._t = setTimeout(() => offPill.classList.remove('show'), hideAfter); };
  let offState = {done:0, total:0};
  if(offlineOK){
    (async () => { try{
      if(fromCache) await cacheTouch(instr.id); else await cachePut(instr, brandSrc);
      offState = await cacheStatus(instr, brandSrc);
      if(fromCache && !online()) showOff(t('off_copy'), 'copy', 5000);
      if(online() && offState.done < offState.total){ showOff(t('off_saving', {n:offState.done, total:offState.total}), 'busy'); const r = await cacheMedia(instr, brandSrc, p => { offState = p; showOff(t('off_saving', {n:p.done, total:p.total}), 'busy'); }); offState = r; realSteps(instr).forEach(st => { if(st.type==='photo') [...posterCache.keys()].filter(k => k.startsWith(st.mediaId+':')).forEach(k => posterCache.delete(k)); }); if(r.failed) showOff(t('off_partial', {n:r.failed}), 'warn', 6000); else showOff(t('off_ready'), 'ok', 3500); }
      cachePrune();
    }catch(e){} })();
  }
  const steps = realSteps(instr); const chapters = []; let curCh = null;
  // ---- view tracking (only real viewer opens of published instructions) ----
  const track = {id:uid(), t0:Date.now(), seen:0, completed:false, saved:false};
  const isReload = (() => { try{ const n = performance.getEntriesByType('navigation')[0]; return !!n && n.type==='reload'; }catch(e){ return false; } })();
  const deviceOf = () => { const u = navigator.userAgent; return /iPhone|iPad/.test(u) ? 'iOS' : /Android/.test(u) ? 'Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : 'Other'; };
  const trackStart = async () => { if(isPreview || instr.status!=='published' || !G.sb) return; try{ const {error} = await G.sb.from('views').insert({id:track.id, instr_id:instr.id, ws:instr.ws, version:instr.version, steps_total:steps.length, reload:isReload, device:deviceOf()}); if(!error) track.saved = true; }catch(e){} };
  const trackUpdate = async (final) => { if(!track.saved) return; const dur = Math.round((Date.now()-track.t0)/1000); const body = {ended_at:new Date().toISOString(), duration_s:dur, steps_seen:track.seen, completed:track.completed};
    try{ if(final && navigator.sendBeacon === undefined){ await G.sb.from('views').update(body).eq('id', track.id); return; }
      const {data:{session}} = await G.sb.auth.getSession(); const tok = session ? session.access_token : CFG.SUPABASE_KEY;
      await fetch(`${CFG.SUPABASE_URL}/rest/v1/views?id=eq.${encodeURIComponent(track.id)}`, {method:'PATCH', keepalive:true, headers:{'apikey':CFG.SUPABASE_KEY, 'Authorization':'Bearer '+tok, 'Content-Type':'application/json', 'Prefer':'return=minimal'}, body:JSON.stringify(body)}); }catch(e){} };
  trackStart(); const hb = setInterval(() => trackUpdate(false), 15000);
  const onHide = () => { if(document.visibilityState==='hidden') trackUpdate(true); }; document.addEventListener('visibilitychange', onHide); window.addEventListener('pagehide', () => trackUpdate(true));
  instr.steps.forEach(s => { if(s.kind==='chapter'){ curCh = {title:s.title, first:null, id:s.id}; chapters.push(curCh); } else if(curCh && !curCh.first){ curCh.first = s.id; } });
  const chapterOf = sid => { let c = null; for(const s of cur.steps){ if(s.kind==='chapter') c = s.title; if(s.id===sid) return c; } return null; };
  const useChk = !!instr.checklist; const chkSteps = confirmSteps(instr); const chkSet = new Set(chkSteps.map(s=>s.id)); const chMode = instr.checkMode||'all';
  const okLbl = () => chMode==='chapter' ? t('done_chapter') : t('done');
  const isDone = it => !!(it && it.ok!=null);
  // chapter groups for the overview (steps before the first heading form an intro group)
  const groups = []; { let g = null; for(const st of instr.steps){ if(st.kind==='chapter'){ g = {id:st.id, title:st.title, steps:[]}; groups.push(g); } else { if(!g){ g = {id:'_intro', title:'', steps:[]}; groups.push(g); } g.steps.push(st); } } }
  const groupOf = sid => groups.findIndex(g => g.steps.some(st => st.id===sid));
  let chosenGroup = -1;
  const run = {id:uid(), instrId:instr.id, ws:instr.ws, version:instr.version, worker:'', startedAt:isPreview?Date.now():0, finishedAt:0, items:{}};
  // ---- worker feedback: text + category (instruction / process), optional photo or video, lands with the creator ----
  const useFb = instr.feedback !== false;
  // phones/tablets open the camera for capture="environment"; on a PC the same input is just a file picker – then only offer that
  const canCapture = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (matchMedia('(pointer:coarse)').matches && matchMedia('(max-width: 1024px)').matches);
  async function feedbackDialog(step, stepNo){
    let wname = run.worker || ''; try{ wname = wname || localStorage.getItem('gg_worker') || ''; }catch(e){}
    const r = await modal(`<h2>${t('feedback')}${step ? ` – ${t('step')} ${stepNo}` : ''}</h2><p class="muted" style="margin:0 0 10px">${t('fb_sub')}</p>
      <div class="seg" id="fb-kind"><button type="button" class="on" data-k="quality">${t('fb_quality')}</button><button type="button" data-k="process">${t('fb_process')}</button></div>
      <div class="field"><label for="fb-text">${t('fb_text')}</label><textarea id="fb-text" placeholder="${t('fb_ph')}"></textarea></div>
      <div class="lbl" style="margin-bottom:6px">${t('fb_attach')}</div><div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:4px">${canCapture() ? `<label class="btn ghost sm" style="cursor:pointer">${IC.cam} ${t('fb_photo')}<input type="file" accept="image/*" capture="environment" hidden data-att="photo"></label><label class="btn ghost sm" style="cursor:pointer">${IC.play} ${t('fb_video')}<input type="file" accept="video/*" capture="environment" hidden data-att="video"></label>` : ''}<label class="btn ghost sm" style="cursor:pointer">${IC.upload} ${canCapture() ? t('fb_lib') : t('fb_file')}<input type="file" accept="image/*,video/*" hidden data-att="lib"></label></div><div class="muted" id="fb-att" style="font-size:12px;min-height:16px;margin-bottom:8px"></div>
      <div class="field"><label for="fb-name">${t('name')} <span class="muted">(${t('optional')})</span></label><input id="fb-name" value="${esc(wname)}"></div>
      <div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${t('fb_send')}</button></div>`, (bg, close) => {
        let kind = 'quality', file = null, mtype = null;
        $$('#fb-kind button', bg).forEach(b => b.onclick = () => { kind = b.dataset.k; $$('#fb-kind button', bg).forEach(x => x.classList.toggle('on', x===b)); });
        $$('[data-att]', bg).forEach(inp => inp.onchange = e => { file = e.target.files[0] || null; mtype = file ? ((file.type||'').startsWith('video') ? 'video' : 'photo') : null; bg.querySelector('#fb-att').textContent = file ? '✓ ' + file.name : ''; $$('[data-att]', bg).forEach(o => { if(o!==inp) o.value = ''; }); });
        bg.querySelector('[data-x]').onclick = () => close(null);
        bg.querySelector('[data-ok]').onclick = () => { const text = bg.querySelector('#fb-text').value.trim(); if(!text && !file){ bg.querySelector('#fb-text').focus(); return; } close({kind, text, file, mtype, name: bg.querySelector('#fb-name').value.trim()}); }; });
    if(!r) return;
    if(isPreview){ toast(t('preview_local')); return; }
    const id = uid(); let media_url = null;
    try{
      if(r.file){ const path = `runs/fb/${instr.id}/${id}.${extOf(r.file)}`; const up = await G.sb.storage.from('media').upload(path, r.file, {contentType:r.file.type||undefined}); if(up.error) throw up.error; media_url = PUBLIC_MEDIA(path); }
      const {error} = await G.sb.from('feedback').insert({id, instr_id:instr.id, ws:instr.ws, step_id: step ? step.id : null, step_no: step ? stepNo : null, kind:r.kind, text:r.text, worker:r.name, media_url, media_type: media_url ? r.mtype : null});
      if(error) throw error;
      try{ if(r.name) localStorage.setItem('gg_worker', r.name); }catch(e){}
      toast(t('fb_thanks'));
    }catch(e){ toast(t('fb_fail')+': '+(e.message||e)); }
  }
  const RUNKEY = 'gg_run_'+instr.id; let runDone = false;
  const runRow = () => ({id:run.id, instr_id:run.instrId, ws:run.ws, worker:run.worker, version:run.version, started_at:new Date(run.startedAt).toISOString(), finished_at: run.finishedAt ? new Date(run.finishedAt).toISOString() : null, items:run.items});
  const pushRun = async () => { if(isPreview || !run.startedAt || !G.sb) return; try{ const {error} = await G.sb.from('runs').upsert(runRow()); if(error) console.warn(error.message); }catch(e){} };
  const saveRun = () => { if(!run.startedAt || runDone) return; if(isPreview) return; LS.set(RUNKEY, {id:run.id, worker:run.worker, startedAt:run.startedAt, version:run.version, items:run.items, at:Date.now()}); debounce('pushrun', pushRun, 600); };
  const inRun = () => useChk && !isPreview && !!run.startedAt && !runDone;
  const inRunOpen = () => inRun() && !chkSteps.every(s => isDone(run.items[s.id]));
  const backHref = isPreview ? '#/edit/'+instr.id : '#/';
  const v = el(`<div class="viewer ${brand.theme==='light'?'light':''}" style="--brand:${esc(brand.color||'#004EAD')}">
    <div class="vw-top">${(isPreview || S.user) ? `<a class="round" href="${backHref}" id="vback" style="width:40px;height:40px;flex:0 0 auto" aria-label="back">${IC.back}</a>` : ''}${brand.logo?`<img class="vlogo" src="${esc(brand.logo)}" alt="">`:''}<div class="tt-wrap"><div class="ch" id="vch">${esc(brand.name||'')}</div><div class="ttl" id="vttl"></div></div><span class="cnt tnum" id="vcnt" style="flex:0 0 auto;font-weight:800;font-size:13px;background:rgba(255,255,255,.18);padding:4px 10px;border-radius:999px"></span><button class="round langbtn" id="langbtn" style="width:40px;height:40px;flex:0 0 auto" title="${t('language')}">${IC.globe}</button><button class="round" id="menu" style="width:40px;height:40px;flex:0 0 auto" aria-label="menu">${IC.menu}</button></div>
    <div class="vw-scroll" id="vs"></div>
    <aside class="vw-side" id="side"><div class="row" style="justify-content:space-between"><b id="side-h">${t('chapters')}</b><button class="round" id="sclose" style="width:36px;height:36px">${IC.close}</button></div><div id="sidelist"></div>${useChk && !isPreview ? `<button class="btn mint" id="finish" style="width:100%;margin-top:16px">${t('finish')}</button>`:''}${offlineOK ? `<div class="side-off" id="side-off"><span id="side-off-t">${t('off_title')}</span><button class="btn ghost sm" id="side-off-rm">${t('off_remove')}</button></div>` : ''}${!isPreview && !isStandalone() ? `<button class="btn ghost sm side-inst" id="side-inst">📲 ${t('install_app')}</button>` : ''}</aside>
  </div>`);
  app.appendChild(v);
  const vs = v.querySelector('#vs');
  if(!steps.length){ vs.innerHTML = `<div class="empty" style="color:#fff;padding-top:120px"><h2 style="color:#fff">${t('no_steps')}</h2></div>`; return; }
  // steps
  const players = new Map(); const refreshers = []; const imgOffs = []; const lazy = new Map();
  for(const [i,s] of steps.entries()){
    const sec = el(`<section class="vstep" data-id="${s.id}" data-i="${i}">
      <div class="vmedia"><div class="vbg"></div>${s.type==='video'?`<video muted playsinline loop preload="auto"></video>`:s.mediaId?`<img alt="">`:`<div class="vnoshot">${IC.cam}<span>${t('vw_noshot')}</span></div>`}<canvas></canvas>${s.type==='video'?'<div class="prog"><i></i></div><span class="ptime"></span>':''}${i===0 && steps.length>1 ? `<div class="vw-hint">↑ ${t('scroll_hint')}</div>`:''}</div>
      <div class="vtext"><div class="num"></div><h2></h2><div class="rich" hidden></div><div class="warnbox" hidden></div>
        ${(useChk && chkSet.has(s.id))||useFb?`<div class="chk">${useChk && chkSet.has(s.id)?`<button class="btn done off" data-ok>${IC.check} ${okLbl()}</button><button class="btn nok" data-nok>${t('not_ok')}</button>`:''}${useFb?`<button class="btn note ${useChk && chkSet.has(s.id)?'':'fbw'}" data-fb title="${t('feedback')}">${IC.msg}${useChk && chkSet.has(s.id)?'':' '+t('feedback')}</button>`:''}</div>`:''}</div>
    </section>`);
    const fbB = sec.querySelector('[data-fb]'); if(fbB) fbB.onclick = () => feedbackDialog(s, i+1);
    vs.appendChild(sec);
    const med = sec.querySelector('.vmedia video,.vmedia img') || document.createElement('img'), cv = sec.querySelector('canvas'), box = sec.querySelector('.vmedia');
    stepPoster(s).then(u => { if(u) sec.querySelector('.vbg').style.backgroundImage = `url("${u}")`; }).catch(()=>{});
    // media is loaded lazily – only the steps around the one on screen (long instructions would otherwise pull every clip at once)
    let loaded = false, loading = null;
    const ensureMedia = () => { if(loaded || loading) return loading; loading = (async () => { const url = await mediaUrl(s.mediaId); if(!url){ loading = null; return; } med.src = url; loaded = true;
        if(s.type==='video'){ if(s.mediaUrl){ const toRemote = () => { if(med.src !== s.mediaUrl){ med.src = s.mediaUrl; med.load(); } }; med.addEventListener('error', toRemote); setTimeout(() => { if(loaded && med.readyState < 2) toRemote(); }, 4000); } try{ med.load(); }catch(e){} } })(); return loading; };
    const dropMedia = () => { if(!loaded) return; loaded = false; loading = null; try{ med.pause(); med.removeAttribute('src'); if(s.type==='video') med.load(); }catch(e){} };
    lazy.set(sec, {ensureMedia, dropMedia});
    const mw = () => s.type==='video' ? (med.videoWidth||s.w) : (med.naturalWidth||s.w), mh = () => s.type==='video' ? (med.videoHeight||s.h) : (med.naturalHeight||s.h);
    let cur2 = s.trimStart||0, lastT=-1, pausedUntil=0, raf=0, active=false;
    let showing = null;
    // video: static symbols show while the clip pauses at their moment; tracked ones stay visible from their moment on and follow their spot
    const draw = () => { cv.style.width = box.clientWidth+'px'; cv.style.height = box.clientHeight+'px'; const ct = s.type==='video' ? med.currentTime : null; drawAll(cv, s.ann, mw(), mh(), null, s.type==='video' ? (a => a.track ? (ct >= (a.t||0)-0.05 && ct <= trackEnd(a)+0.4) : !!(showing && showing.has(a.id))) : null, ct); };
    new ResizeObserver(draw).observe(box); if(s.ann.some(a => a.type==='img')) imgOffs.push(onImgReady(draw));
    if(s.type==='video'){
      const prog = sec.querySelector('.prog i'), ptime = sec.querySelector('.ptime'); const fmtT = x => `${Math.floor(x/60)}:${String(Math.floor(x%60)).padStart(2,'0')}`;
      const loop = () => { if(!active) return; if(!med.paused){ const ct = med.currentTime, st = s.trimStart||0, en = s.trimEnd||s.duration||med.duration||5; if(ct >= en || ct < st-0.2){ med.currentTime = st; lastT = st-0.05; }
          const hitA = s.ann.find(a => !a.track && lastT < (a.t||0) && ct >= (a.t||0) && ct < (a.t||0)+0.6);
          if(hitA && performance.now() > pausedUntil){ const group = s.ann.filter(a => !a.track && Math.abs((a.t||0)-(hitA.t||0)) < 0.3); showing = new Set(group.map(a=>a.id)); med.pause(); cur2 = ct; lastT = Math.max(...group.map(a=>a.t||0)) + 0.01; pausedUntil = performance.now()+1300; setTimeout(()=>{ showing = null; draw(); if(active) med.play().catch(()=>{}); }, 1000); draw(); raf = requestAnimationFrame(loop); return; } else cur2 = ct;
          lastT = ct; prog.style.width = (100*Math.max(0,(cur2-st))/Math.max(0.1,(en-st)))+'%'; if(ptime) ptime.textContent = `${fmtT(Math.max(0,cur2-st))} / ${fmtT(Math.max(0,en-st))}`; draw(); }
        raf = requestAnimationFrame(loop); };
      players.set(s.id, { play(){ if(active) return; active = true; ensureMedia(); med.currentTime = s.trimStart||0; lastT = (s.trimStart||0)-0.05; med.play().catch(()=>{}); raf = requestAnimationFrame(loop); }, stop(){ active = false; cancelAnimationFrame(raf); med.pause(); } });
      med.addEventListener('loadeddata', draw, {once:true});
    } else { med.addEventListener('load', draw, {once:true}); players.set(s.id, {play(){ ensureMedia(); }, stop(){}}); }
    setTimeout(draw, 80);
    if(useChk){
      const okB = sec.querySelector('[data-ok]'), nokB = sec.querySelector('[data-nok]'), noteB = sec.querySelector('[data-note]');
      const refresh = () => { const it = run.items[s.id]; if(okB){ okB.classList.toggle('off', !(it && it.ok)); okB.innerHTML = `${IC.check} ${okLbl()}`; nokB.classList.toggle('on', !!(it && it.ok===false)); nokB.textContent = it && it.ok===false ? `✗ ${t('not_ok')}` : t('not_ok'); } if(noteB){ noteB.title = t('add_note'); noteB.classList.toggle('on', !!(it && (it.note || it.photoId || it.photoUrl))); } updateSide(); updateEndSum(); };
      refreshers.push(refresh);
      let pvHint = false; const pv = () => { if(isPreview && !pvHint){ pvHint = true; toast(t('preview_local')); } };
      // note + photo dialog (used for "not OK" and for optional remarks on any step)
      const noteDialog = async (title, danger) => {
        const it = run.items[s.id] || {};
        const r = await modal(`<h2>${title} – ${t('step')} ${i+1}</h2><div class="field"><label for="nk-note">${danger ? t('nok_note') : t('note_label')}</label><textarea id="nk-note">${esc(it.note||'')}</textarea></div><label class="btn ghost" style="cursor:pointer" id="nk-lbl">${IC.cam} ${(it.photoId||it.photoUrl) ? t('photo_replace') : t('nok_photo')}<input type="file" accept="image/*" capture="environment" hidden id="nk-ph"></label><div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn ${danger?'danger':''}" data-ok>${t('save')}</button></div>`, (bg, close) => {
          let photo = null; bg.querySelector('#nk-ph').onchange = e => { photo = e.target.files[0]; bg.querySelector('#nk-lbl').textContent = '✓ '+(photo?photo.name:''); };
          bg.querySelector('[data-x]').onclick = () => close(null); bg.querySelector('[data-ok]').onclick = () => close({note: bg.querySelector('#nk-note').value, photo}); });
        if(!r) return null; let photoId = it.photoId||null, photoUrl = it.photoUrl||null;
        if(r.photo){ photoId = uid(); photoUrl = null; await putMedia({id:photoId, blob:r.photo, type:'photo'}); if(!isPreview){ const path = `runs/${run.id}/${photoId}.${extOf(r.photo)}`; const up = await G.sb.storage.from('media').upload(path, r.photo, {contentType:r.photo.type||undefined}); if(!up.error){ photoUrl = PUBLIC_MEDIA(path); S.remoteUrl.set(photoId, photoUrl); } } }
        return {note:r.note, photoId, photoUrl}; };
      if(okB){ okB.onclick = () => { pv(); run.items[s.id] = Object.assign({}, run.items[s.id]||{}, {ok:true, at:Date.now()}); refresh(); okB.classList.remove('pop'); void okB.offsetWidth; okB.classList.add('pop'); saveRun(); if(navigator.vibrate) try{navigator.vibrate(20);}catch(e){} const nx = sec.nextElementSibling; if(nx) setTimeout(()=>nx.scrollIntoView({behavior:'smooth'}), 250); };
      nokB.onclick = async () => { pv(); const r = await noteDialog(t('not_ok'), true); if(!r) return; run.items[s.id] = Object.assign({}, run.items[s.id]||{}, r, {ok:false, at:Date.now()}); refresh(); saveRun(); }; }
      if(noteB) noteB.onclick = async () => { pv(); const r = await noteDialog(t('add_note'), false); if(!r) return; run.items[s.id] = Object.assign({}, run.items[s.id]||{}, r, {at:(run.items[s.id]||{}).at||Date.now()}); refresh(); saveRun(); };
    }
  }
  // happy end
  const endSec = el(`<section class="vstep vend" data-i="${steps.length}"><div class="vend-in">${brand.logo?`<div class="vend-logo big"><img src="${esc(brand.logo)}" alt=""></div>`:(brand.name?`<div class="vend-name">${esc(brand.name)}</div>`:'')}<div class="bigcheck">${IC.check}</div><h2 id="vend-h"></h2><p id="vend-p"></p>
    ${useChk && !isPreview ? `<div class="vend-sum" id="vend-sum"></div><button class="btn big" id="finish2">${t('finish')}</button>` : `<div class="row" style="justify-content:center;gap:10px"><button class="btn ghost big" id="again2">${t('again')}</button>${S.user||isPreview?`<a class="btn big" href="${backHref}">${t('close')}</a>`:''}</div>`}
    ${useFb ? `<button class="btn ghost" id="fb-end" style="margin-top:14px">${IC.msg} ${t('fb_give')}</button>` : ''}
    ${!isPreview && !isStandalone() ? `<button class="vend-inst" id="inst-end">📲 <span>${t('install_app')}</span><small>${t('ig_short')}</small></button>` : ''}
    </div></section>`);
  const ie = endSec.querySelector('#inst-end'); if(ie) ie.onclick = () => installGuide();
  vs.appendChild(endSec);
  const fbEnd = endSec.querySelector('#fb-end'); if(fbEnd) fbEnd.onclick = () => feedbackDialog(null, 0);
  const ag = endSec.querySelector('#again2'); if(ag) ag.onclick = () => { vs.scrollTo({top:0, behavior:'smooth'}); };
  const updateEndSum = () => { const e2 = endSec.querySelector('#vend-sum'); if(!e2) return; const its = Object.values(run.items); const ok = its.filter(i=>i.ok).length, nok = its.filter(i=>i.ok===false).length, open = Math.max(0, chkSteps.length-ok-nok); e2.innerHTML = `<span class="ok">${ok} ${t('ok_count')}</span><span class="nok">${nok} ${t('nok_count')}</span><span>${open} ${t('open_count')}</span>`; };
  // side list
  function updateSide(){
    const sl = v.querySelector('#sidelist'); let html=''; let n=0;
    if(groups.length > 1) html += `<button class="btn ghost sm" id="side-ov" style="width:100%;margin-bottom:10px">${IC.grid} ${t('chapter_overview')}</button>`;
    if(!chapters.length) html += `<h3>${t('all_steps')}</h3>`;
    for(const s of cur.steps){ if(s.kind==='chapter'){ html += `<h3>${titleHtml(s.title)}</h3>`; continue; } n++; const it = run.items[s.id]; const st = it && it.ok!=null ? (it.ok?'ok':'nok') : ''; html += `<div class="it ${st}" data-go="${s.id}"><span class="n tnum">${st ? (it.ok?'✓':'✗') : n}</span><span>${titleHtml(s.title)||t('step')+' '+n}</span>${it && (it.note||it.photoId||it.photoUrl) ? `<span class="n">${IC.note}</span>` : ''}</div>`; }
    sl.innerHTML = html; $$('[data-go]', sl).forEach(d => d.onclick = () => { const sec = vs.querySelector(`[data-id="${d.dataset.go}"]`); if(sec) sec.scrollIntoView({behavior:'smooth'}); v.querySelector('#side').classList.remove('open'); });
    const ov = sl.querySelector('#side-ov'); if(ov) ov.onclick = () => { v.querySelector('#side').classList.remove('open'); showOverview(true); };
  }
  // ---- chapter overview: entry screen when there is more than one chapter; also reachable from the top bar / side panel ----
  const urlFor = n => { const base = location.href.split('#')[0]; const k = isPreview ? '' : (shareKey || instr.shareKey || ''); return `${base}#/${isPreview?'preview':'v'}/${instr.id}${k?'/'+k:''}${n>0?'/'+n:''}${langArg?'/'+langArg.toLowerCase():''}`; };
  const setUrl = n => { try{ history.replaceState(null, '', urlFor(n)); }catch(e){} };
  const gotoGroup = (gi, smooth) => { const g = groups[gi]; if(!g) return; chosenGroup = gi; const first = g.steps[0]; const sec = first ? vs.querySelector(`.vstep[data-id="${first.id}"]`) : null; if(sec) setTimeout(() => sec.scrollIntoView({behavior: smooth ? 'smooth' : 'auto'}), 40); if(groups.length > 1) setUrl(gi+1); };
  // overall progress ring (checklist: confirmed steps; otherwise hidden)
  const ringHtml = items => { if(!useChk || !chkSteps.length) return ''; const done = chkSteps.filter(st => isDone(items[st.id])).length; const p = done/chkSteps.length; const R = 26, C = 2*Math.PI*R;
    return `<div class="ring" title="${t('progress')}"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${R}" class="rb"/><circle cx="32" cy="32" r="${R}" class="rf" style="stroke-dasharray:${C};stroke-dashoffset:${C*(1-p)}"/></svg><span class="tnum">${Math.round(p*100)}<small>%</small></span></div>`; };
  function showOverview(reopen){
    if(v.querySelector('.vw-chap')) return;
    const saved = LS.get(RUNKEY); const items = run.startedAt ? run.items : ((saved && saved.items && saved.version===instr.version) ? saved.items : {});
    const tiles = groups.map((g, gi) => { const title = g.id==='_intro' ? t('intro') : ((cur.steps.find(x=>x.id===g.id)||{}).title || g.title || `${t('chapter')} ${gi+1}`); const chk = g.steps.filter(st => chkSet.has(st.id)); const done = chk.filter(st => isDone(items[st.id])).length; const all = chk.length && done===chk.length;
      return `<button class="ch-tile" data-g="${gi}" style="animation-delay:${Math.min(gi,10)*60}ms"><img alt="" data-poster="${g.steps[0]?g.steps[0].id:''}"><span class="cn tnum">${gi+1}</span>${all?`<span class="done">${IC.check}</span>`:''}<span class="txt"><b>${titleHtml(title)}</b><span>${nOf(g.steps.length,'step','steps')}${chk.length && useChk ? ` · ${done}/${chk.length} ✓` : ''}</span>${chk.length && useChk ? `<span class="bar"><i style="width:${Math.round(100*done/chk.length)}%"></i></span>` : ''}</span></button>`; }).join('');
    const ov = el(`<div class="vw-chap"><div class="ch-head"><div class="ch-bar">${(isPreview || S.user) && !reopen ? `<a class="round" href="${backHref}" id="ov-back" aria-label="back">${IC.back}</a>` : `<span></span>`}<div class="brandline">${brand.logo?`<img src="${esc(brand.logo)}" alt="">`:''}<span>${esc(brand.name||'GIRI')}</span></div><div class="row" style="gap:6px"><button class="round" id="ov-lang" title="${t('language')}">${vlang?`<span class="flag">${FLAGS[vlang]||vlang}</span>`:IC.globe}</button>${reopen?`<button class="round" id="ov-close" aria-label="close">${IC.close}</button>`:''}</div></div>
      <div class="ch-titlerow"><div><h1>${titleHtml(cur.title)}</h1><div class="ch-sub">${groups.length} ${t('chapters')} · ${steps.length} ${t('steps')}${useChk?' · ☑ '+t('checklist_short'):''}</div><div class="ch-sub2">${t('pick_chapter')}</div></div>${ringHtml(items)}</div></div>
      <div class="ch-grid">${tiles}</div>
      <div class="ch-foot"><button class="btn mint big" id="ov-start">${IC.play} ${chosenGroup>=0 || run.startedAt ? t('continue_run') : t('start_begin')}</button></div></div>`);
    v.appendChild(ov);
    $$('[data-poster]', ov).forEach(async im => { const st = steps.find(x=>x.id===im.dataset.poster); if(!st) return; const p = await stepPoster(st); if(p) im.src = p; else im.remove(); });
    const pick = gi => { ov.classList.add('out'); setTimeout(() => ov.remove(), 220); gotoGroup(gi, !!reopen); };
    $$('[data-g]', ov).forEach(b => b.onclick = () => pick(+b.dataset.g));
    ov.querySelector('#ov-start').onclick = () => { if(run.startedAt || chosenGroup>=0){ ov.classList.add('out'); setTimeout(() => ov.remove(), 220); const open = chkSteps.find(st => !isDone(run.items[st.id])); const gi = open ? groupOf(open.id) : Math.max(0, chosenGroup); if(gi>=0) gotoGroup(gi, true); } else pick(0); };
    const oc = ov.querySelector('#ov-close'); if(oc) oc.onclick = () => { ov.classList.add('out'); setTimeout(() => ov.remove(), 220); };
    ov.querySelector('#ov-lang').onclick = openLangMenu; guard(ov.querySelector('#ov-back'));
  }
  // all translatable text lives here, so switching the language never touches the media
  let curStepId = null;
  function applyTexts(){
    v.querySelector('#vttl').textContent = mdToPlain(cur.title) + (isPreview ? ' · '+t('preview') : '');
    if(curStepId) v.querySelector('#vch').textContent = mdToPlain(chapterOf(curStepId)||'')||brand.name||'';
    const cs = realSteps(cur);
    cs.forEach((s, i) => { const sec = vs.querySelector(`.vstep[data-id="${s.id}"]`); if(!sec) return; const ch = chapterOf(s.id);
      sec.querySelector('.num').textContent = `${t('step')} ${i+1} / ${cs.length}${ch?' · '+mdToPlain(ch):''}`;
      sec.querySelector('h2').innerHTML = titleHtml(s.title) || `${t('step')} ${i+1}`;
      const rich = sec.querySelector('.rich'); rich.hidden = !s.desc; rich.innerHTML = s.desc ? mdToHtml(s.desc) : '';
      const wb = sec.querySelector('.warnbox'); wb.hidden = !s.warn; wb.textContent = s.warn ? '⚠ '+s.warn : ''; });
    endSec.querySelector('#vend-h').textContent = t('end_title'); endSec.querySelector('#vend-p').textContent = mdToPlain(cur.title) + (brand.logo&&brand.name ? ' · '+brand.name : '');
    const f1 = v.querySelector('#finish'), f2 = endSec.querySelector('#finish2'); if(f1) f1.textContent = t('finish'); if(f2) f2.textContent = t('finish'); const ag2 = endSec.querySelector('#again2'); if(ag2) ag2.textContent = t('again');
    v.querySelector('#side-h').textContent = t('chapters'); refreshers.forEach(f => f()); updateSide(); updateEndSum();
    const sc = v.querySelector('.vw-start'); if(sc){ sc.querySelector('h1').textContent = t('vw_start_title'); sc.querySelector('p').textContent = t('vw_start_sub'); sc.querySelector('label').textContent = t('your_name'); sc.querySelector('#begin').textContent = t('begin'); const lb2 = sc.querySelector('#langbtn2'); if(lb2) lb2.innerHTML = vlang ? `<span class="flag">${FLAGS[vlang]||vlang}</span>` : IC.globe; }
    const hint = vs.querySelector('.vw-hint'); if(hint) hint.textContent = '↑ '+t('scroll_hint');
    const lb = v.querySelector('#langbtn'); lb.innerHTML = vlang ? `<span class="flag">${FLAGS[vlang]||vlang}</span>` : IC.globe; lb.classList.toggle('on', !!vlang);
    const ovl = v.querySelector('.vw-chap'); if(ovl){ const reopen = !!ovl.querySelector('#ov-close'); ovl.remove(); showOverview(reopen); }
  }
  let langBusy = false;
  async function switchLang(l){
    l = (l||'').toUpperCase(); if(langBusy) return;
    if(l && !fresh(l)){
      langBusy = true; const lb = v.querySelector('#langbtn'); lb.innerHTML = `<span class="spin sm"></span>`; toast(t('translating'));
      try{ const {data, error} = await G.sb.functions.invoke('translate', {body:{instrId:instr0.id, target:l, pw: LS.get(PWKEY)||undefined, key: shareKey || instr0.shareKey || undefined}}); if(error) throw new Error(error.message||String(error)); if(!data || data.error || !data.map) throw new Error((data&&data.error)||'translate failed');
        instr0.translations = instr0.translations||{}; instr0.translations[l] = {map:data.map, at:Date.now(), hash:srcHash(instr0), by:'auto'}; }
      catch(e){ toast('DeepL: '+e.message); langBusy = false; applyTexts(); return; }
      langBusy = false; }
    vlang = l; cur = l ? withLang(instr0, l) : instr0; try{ localStorage.setItem('gg_vlang', l); }catch(e){}
    if(l && !I18N[l.toLowerCase()]){ applyTexts(); await loadUiLang(l); if(vlang!==l) return; }
    G.LANG = l ? uiFor(l) : prevLang; applyTexts();
  }
  const openLangMenu = () => modal(`<h2>${t('language')}</h2><div class="menu langmenu"><button data-l="" class="${!vlang?'cur':''}">${IC.globe} ${t('original')}</button>${LANGS.map(([k,name]) => `<button data-l="${k}" class="${vlang===k?'cur':''}"><span class="flag">${FLAGS[k]}</span> ${name}${hasTx(instr0,k)?' <small>✓</small>':''}</button>`).join('')}</div>`, (bg, close) => { $$('[data-l]', bg).forEach(b => b.onclick = () => { close(); switchLang(b.dataset.l); }); });
  v.querySelector('#langbtn').onclick = openLangMenu;
  applyTexts();
  if(vlang && (!fresh(vlang) || !I18N[vlang.toLowerCase()])) switchLang(vlang); // remembered language → translate live (cached after the first time)
  v.querySelector('#menu').onclick = async () => { v.querySelector('#side').classList.add('open'); const so = v.querySelector('#side-off-t'); if(so){ try{ const st = await cacheStatus(instr, brandSrc); so.textContent = st.total && st.done>=st.total ? `✓ ${t('off_ready')}` : (st.total ? t('off_saving', {n:st.done, total:st.total}) : t('off_title')); }catch(e){} } };
  const soRm = v.querySelector('#side-off-rm'); if(soRm) soRm.onclick = async () => { if(!(await confirmM(t('off_remove_q'), t('off_remove')))) return; await cacheDel(instr.id); toast(t('off_removed')); v.querySelector('#side').classList.remove('open'); };
  const sInst = v.querySelector('#side-inst'); if(sInst) sInst.onclick = () => { v.querySelector('#side').classList.remove('open'); installGuide(); };
  // a newer version arrived after the copy was shown → offer a refresh
  if(fromCache && online()){ const chk = setInterval(() => { if(!newerRow) return; clearInterval(chk); if($('#rt-note') || !document.body.contains(v)) return; const n = el(`<div class="rt-banner" id="rt-note">${IC.refresh||''}<span>${t('off_newer')}</span><button class="btn sm">${t('refresh_now')}</button></div>`); n.querySelector('button').onclick = () => { n.remove(); render(); }; document.body.appendChild(n); }, 800); setTimeout(() => clearInterval(chk), 30000); }
  if(groups.length > 1){ const tw = v.querySelector('.tt-wrap'); tw.classList.add('clickable'); tw.title = t('chapter_overview'); tw.onclick = () => showOverview(true); }
  v.querySelector('#sclose').onclick = () => v.querySelector('#side').classList.remove('open');
  // visibility → play
  const io = new IntersectionObserver(entries => { entries.forEach(en => { const p = players.get(en.target.dataset.id); if(!p){ if(en.isIntersecting && en.target.classList.contains('vend')){ v.querySelector('#vcnt').textContent = '✓'; v.querySelector('#vch').textContent = brand.name||''; track.completed = true; track.seen = steps.length; } return; } if(en.isIntersecting && en.intersectionRatio > 0.6){ p.play(); const i = +en.target.dataset.i; curStepId = en.target.dataset.id; track.seen = Math.max(track.seen, i+1); if(groups.length > 1){ const gi = groupOf(curStepId); if(gi>=0 && gi!==chosenGroup){ chosenGroup = gi; if(!v.querySelector('.vw-chap')) setUrl(gi+1); } } v.querySelector('#vcnt').textContent = `${i+1} / ${steps.length}`; v.querySelector('#vch').textContent = mdToPlain(chapterOf(en.target.dataset.id)||'')||brand.name||''; } else p.stop(); }); }, {root:vs, threshold:[0.6]});
  $$('.vstep', vs).forEach(s => io.observe(s));
  const ioLazy = new IntersectionObserver(entries => { entries.forEach(en => { const l = lazy.get(en.target); if(!l) return; if(en.isIntersecting) l.ensureMedia(); else l.dropMedia(); }); }, {root:vs, rootMargin:'150% 0px 150% 0px', threshold:0});
  lazy.forEach((l, sec) => ioLazy.observe(sec));
  // leaving mid-run: ask (in-app links) / browser prompt (tab close); progress is saved on the device either way
  const onUnload = e => { if(inRunOpen()){ saveRun(); e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', onUnload);
  const guard = a => { if(!a) return; a.addEventListener('click', async e => { if(!inRunOpen()) return; e.preventDefault(); saveRun(); if(await confirmM(t('leave_q'), t('leave'))) location.hash = a.getAttribute('href'); }); };
  guard(v.querySelector('#vback')); guard(endSec.querySelector('a.btn'));
  let onLeave = null; G.busyCheck = () => !!(run.startedAt || curStepId);
  G.activeCleanup = () => { if(onLeave) onLeave(); io.disconnect(); ioLazy.disconnect(); imgOffs.forEach(f=>f()); players.forEach(p=>p.stop()); clearInterval(hb); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('beforeunload', onUnload); trackUpdate(true); G.LANG = prevLang; };
  // checklist start / resume / finish
  if(useChk && !isPreview){
    const start = el(`<div class="vw-start"><div class="card"><button class="round langbtn2" id="langbtn2" title="${t('language')}">${vlang?`<span class="flag">${FLAGS[vlang]||vlang}</span>`:IC.globe}</button>${brand.logo?`<div class="vend-logo sm"><img src="${esc(brand.logo)}" alt=""></div>`:(brand.name?`<div class="vend-name sm">${esc(brand.name)}</div>`:'')}<h1>${t('vw_start_title')}</h1><p style="color:#B8C6DB;margin:0 0 16px">${t('vw_start_sub')}</p><div class="field"><label for="wname">${t('your_name')}</label><input id="wname" autocomplete="name"></div><button class="btn mint" id="begin" style="width:100%;padding:14px">${t('begin')}</button></div></div>`);
    v.appendChild(start); start.querySelector('#langbtn2').onclick = openLangMenu;
    try{ start.querySelector('#wname').value = localStorage.getItem('gg_worker')||''; }catch(e){}
    const scrollToOpen = () => { const inG = chosenGroup>=0 ? chkSteps.find(s => groupOf(s.id)===chosenGroup && !isDone(run.items[s.id])) : null; const first = inG || chkSteps.find(s => !isDone(run.items[s.id])); const sec = first ? vs.querySelector(`.vstep[data-id="${first.id}"]`) : endSec; if(sec) setTimeout(() => sec.scrollIntoView({behavior:'auto'}), 60); };
    start.querySelector('#begin').onclick = async () => {
      const n = start.querySelector('#wname').value.trim(); if(!n){ start.querySelector('#wname').focus(); return; }
      try{ localStorage.setItem('gg_worker', n); }catch(e){}
      const saved = LS.get(RUNKEY); const savedDone = saved && saved.items ? chkSteps.filter(s => isDone(saved.items[s.id])).length : 0;
      if(saved && savedDone && saved.version===instr.version){
        const all = savedDone >= chkSteps.length;
        const c = await modal(`<h2>${all ? t('resume_all_title') : t('resume_title')}</h2><p class="muted" style="margin:0 0 14px">${esc(t('resume_sub',{n:savedDone, total:chkSteps.length, w:saved.worker||n, d:fmtDate(saved.at||saved.startedAt)}))}</p><div class="actions"><button class="btn ghost" data-restart>${t('restart')}</button><button class="btn" data-resume>${all ? t('finish') : t('resume')}</button></div>`, (bg, close) => { bg.querySelector('[data-restart]').onclick = () => close('restart'); bg.querySelector('[data-resume]').onclick = () => close('resume'); });
        if(c===null) return;
        if(c==='resume'){ run.id = saved.id || run.id; run.startedAt = saved.startedAt || Date.now(); run.items = saved.items || {}; run.worker = n; refreshers.forEach(f => f()); start.remove(); if(all){ finishRun(); } else { saveRun(); scrollToOpen(); } return; }
        LS.del(RUNKEY); }
      run.worker = n; run.startedAt = Date.now(); saveRun(); start.remove(); };
    const finishRun = async () => {
      if(!run.startedAt) run.startedAt = Date.now();
      const its = Object.values(run.items); const ok = its.filter(i=>i.ok).length, nok = its.filter(i=>i.ok===false).length, open = Math.max(0, chkSteps.length-ok-nok);
      if(!runDone){ run.finishedAt = Date.now(); runDone = true; LS.del(RUNKEY); clearTimeout(debounces['pushrun']); const {error} = await G.sb.from('runs').upsert(runRow()); if(error){ toast(error.message); await DB.put('runs', run); } }
      if(v.querySelector('.vw-end')) return;
      const nokHtml = await Promise.all(steps.filter(s=>run.items[s.id] && run.items[s.id].ok===false).map(async (s,k) => { const it = run.items[s.id]; const u = it.photoUrl || (it.photoId ? await mediaUrl(it.photoId) : null); const cs = realSteps(cur).find(x=>x.id===s.id)||s; return `<div>✗ <b>${esc(cs.title)||t('step')}</b> – ${esc(it.note||'')}${u?`<img src="${u}" alt="">`:''}</div>`; }));
      const end = el(`<div class="vw-end"><div class="card"><h1>${t('vw_end_title')}</h1><p style="color:#B8C6DB;margin:4px 0 0">${esc(run.worker)} · ${fmtDate(run.startedAt)} · ${t('vw_end_sub')}</p><div class="sum"><div><b class="tnum" style="color:var(--mint)">${ok}</b><span>${t('ok_count')}</span></div><div><b class="tnum" style="color:#ff8a8e">${nok}</b><span>${t('nok_count')}</span></div><div><b class="tnum">${open}</b><span>${t('open_count')}</span></div></div><div class="nok-list">${nokHtml.join('')}</div><div class="actions" style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><a class="btn ghost" style="color:#fff;border-color:#22437A" href="#/">${t('close')}</a><button class="btn mint" id="again">${t('again')}</button></div></div></div>`);
      v.appendChild(end); v.querySelector('#side').classList.remove('open');
      end.querySelector('#again').onclick = () => render();
    };
    v.querySelector('#finish').onclick = finishRun; const f2 = endSec.querySelector('#finish2'); if(f2) f2.onclick = finishRun;
    // all steps confirmed and the worker just leaves → the run is closed automatically (no orphaned "in progress" rows)
    const allDone = () => chkSteps.length > 0 && chkSteps.every(s => isDone(run.items[s.id]));
    const pushRunBeacon = async () => { try{ const {data:{session}} = await G.sb.auth.getSession(); const tok = session ? session.access_token : CFG.SUPABASE_KEY; await fetch(`${CFG.SUPABASE_URL}/rest/v1/runs?on_conflict=id`, {method:'POST', keepalive:true, headers:{apikey:CFG.SUPABASE_KEY, Authorization:'Bearer '+tok, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify(runRow())}); }catch(e){} };
    const autoFinish = () => { if(!inRun() || !allDone()) return; run.finishedAt = Date.now(); runDone = true; LS.del(RUNKEY); clearTimeout(debounces['pushrun']); pushRunBeacon(); };
    window.addEventListener('pagehide', autoFinish); document.addEventListener('visibilitychange', () => { if(document.visibilityState==='hidden') autoFinish(); }); onLeave = autoFinish;
  }
  // entry: #/v/<id>/<n> jumps straight to chapter n; several chapters without a number → chapter overview first
  if(chapArg > 0 && chapArg <= groups.length) gotoGroup(chapArg-1, false);
  else if(groups.length > 1) showOverview(false);
  else if(!useChk && !isPreview){ // single-chapter instruction without checklist: a calm start card – no name needed
    const first = steps[0]; const sc = el(`<div class="vw-start intro"><div class="card">${brand.logo?`<div class="vend-logo sm"><img src="${esc(brand.logo)}" alt=""></div>`:(brand.name?`<div class="vend-name sm">${esc(brand.name)}</div>`:'')}<div class="intro-img"><img alt=""></div><h1>${titleHtml(cur.title)}</h1><p style="color:#B8C6DB;margin:0 0 18px">${t('vw_intro_sub',{n:steps.length})}</p><button class="btn mint" id="go" style="width:100%;padding:15px;font-size:16px">${IC.play} ${t('vw_go')}</button></div></div>`);
    v.appendChild(sc); const ii = sc.querySelector('.intro-img'); if(first) stepPoster(first).then(u => { if(u) ii.querySelector('img').src = u; else ii.remove(); }).catch(() => ii.remove()); else ii.remove();
    sc.querySelector('#go').onclick = () => { sc.classList.add('out'); setTimeout(() => sc.remove(), 240); }; }
}

export { passwordGate, renderViewer };
