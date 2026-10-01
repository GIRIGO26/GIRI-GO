import { newShareKey } from '../core/links.js';
import { trackAnn, trackEnd, trackedAt } from '../annotations/track.js';
import { trashStep, restoreStep, purgeStep, purgeOldSteps } from '../core/trash.js';
import { COLORS, NO3D, SWATCHES, annBounds, annCenter, annHandles, drawAll, hasRot, isoUrl, onImgReady, preloadImg, rotP } from '../annotations/draw.js';
import { symbolPanel, symbolSheet } from '../annotations/library.js';
import { go } from '../app/router.js';
import { needsShot, realSteps } from '../core/auth.js';
import { $$, confirmM, el, esc, fitRect, fmtSec, modal, promptM, toast } from '../core/helpers.js';
import { fmtD, fmtDate, t } from '../core/i18n.js';
import { saveInstr } from '../core/passwords.js';
import { mdToHtml, mdToPlain, titleHtml } from '../core/richtext.js';
import { G, S, mediaUrl } from '../core/state.js';
import { DB, uid } from '../core/storage.js';
import { FLAGS, LANGS, srcHash, translateInstr, withLang } from '../core/translate.js';
import { can } from '../core/roles.js';
import { canSee, confirmSteps, folderTeams, saveWs } from '../core/workspace.js';
import { attachDropImport, importFiles, replaceStepMedia } from '../media/import.js';
import { exportPDF } from '../pdf/export.js';
import { IC } from '../ui/icons.js';
import { topbar } from '../ui/topbar.js';
import { instrCrumbs, instrTabs } from '../ui/instrnav.js';
import { duplicateWithProgress, grabFrame, nOf, posterCache, stepPoster, stepPosterSync } from './dashboard.js';
import { preloadInstr, touchEditorCache } from '../media/preload.js';
import { exportPDFAsk, shareModal } from './share.js';
import { emojiPicker, symbolFromFile, symbolPicker } from './symbols.js';


/* ---------- Editor ---------- */
async function renderEditor(app, id, selStepId, fbId){
  const instr = S.instrs.find(i=>i.id===id); if(!instr || !canSee(instr)) return go('');
  if(!Array.isArray(instr.steps)) instr.steps = []; instr.steps.forEach(st => { if(st && st.kind!=='chapter' && !Array.isArray(st.ann)) st.ann = []; }); if(!instr.approvals) instr.approvals = {tech:null, dsgvo:null}; if(!Array.isArray(instr.history)) instr.history = [];
  if(selStepId === 'fb'){ fbId = fbId || null; selStepId = null; } else fbId = null;
  topbar(app, {crumbs: instrCrumbs(instr)}); // v12.48: Instructions › folder › this instruction
  // v12.39: capabilities from the team roles – editing, technical approval and privacy approval are separate rights
  const canEdit = can(instr, 'edit'), canTech = can(instr, 'approve_tech'), canDsgvo = can(instr, 'approve_dsgvo'), canLinks = can(instr, 'links');
  const myRole = canEdit ? 'editor' : 'viewer'; const canApprove = canTech && canDsgvo; const canApproveKey = k => k==='tech' ? canTech : canDsgvo;
  let tab = 'steps'; try{ tab = sessionStorage.getItem('gg_tab_'+id) || 'steps'; }catch(e){}
  const v = el(`<main class="page">
    <div class="ed-head"><div class="ed-top"><div class="title-wrap"><input class="title" id="ititle" value="${esc(instr.title)}" placeholder="${t('title')}" ${myRole==='viewer'?'disabled':''}><button class="pen-btn" id="rename" title="${t('rename')}">${IC.edit}</button></div>
      <div class="ed-meta"><button type="button" class="chip dot ${instr.status}" id="stchip" title="${t('status_details')}">${t(instr.status==='review'?'in_review':instr.status)}</button><span class="muted tnum" id="vchip">v${instr.version}</span><span class="muted" id="ed-n"></span><span class="muted ed-when" id="ed-when"></span></div></div>
      <div class="ed-bar">${instrTabs(instr, 'edit')}<div class="ed-acts"><button class="btn mint sm" id="rec">${IC.cam} <span>${t('record')}</span></button><button class="btn sm" id="cta" hidden></button><button class="btn ghost icon" id="more" title="${t('more')}">${IC.more}</button></div></div></div>
    <div class="fb-banner" id="fb-banner" hidden><span>${IC.msg} <b id="fb-n"></b></span><a class="btn sm" href="#/results/${instr.id}" id="fb-open">${t('fb_view')}</a></div>
    <div class="editor" id="tab-steps" data-pane="${selStepId ? 'step' : 'list'}" ${tab!=='steps'?'hidden':''}>
      <aside class="card steps-panel">
        <button class="noshot-bar" id="noshot-bar" hidden></button><div class="slist" id="slist"></div>
        <div class="shortcuts">${t('shortcuts')}</div></aside>
      <section class="ed-main">
        <div class="card stage" id="stage"></div>
        <div class="card props" id="props"></div>
      </section>
    </div>
    <div class="settings" id="tab-settings" ${tab!=='settings'?'hidden':''}><button class="sback always" data-sback>${IC.back} ${t('back_steps')}</button>
      <div class="card side-info"><h3>${t('tab_settings')}</h3>
        <label class="toggle"><input type="checkbox" id="chk" ${instr.checklist?'checked':''}> <span>${t('checklist')}<br><span class="muted" style="font-weight:500">${t('checklist_sub')}</span></span></label>
        <div class="chkmodes" id="chkmodes" ${instr.checklist?'':'hidden'}>${[['all','cm_all','cm_all_sub'],['chapter','cm_chapter','cm_chapter_sub'],['custom','cm_custom','cm_custom_sub']].map(([k,l,sub])=>`<label><input type="radio" name="cm" value="${k}" ${(instr.checkMode||'all')===k?'checked':''}> <span>${t(l)}<br><span class="muted" style="font-weight:500">${t(sub)}</span></span></label>`).join('')}</div>
        <label class="toggle" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--line)"><input type="checkbox" id="fbk" ${instr.feedback!==false?'checked':''}> <span>${t('fb_allow')}<br><span class="muted" style="font-weight:500">${t('fb_allow_sub')}</span></span></label>
        <div class="fb-sub" id="fb-sub" ${instr.feedback===false?'hidden':''}><div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span class="muted" style="font-size:13px">${t('fb_where')}</span><a class="btn ghost sm" href="#/results/${instr.id}" id="fb-open2">${IC.msg} ${t('fb_open_btn')}</a></div>
          <label class="toggle" style="margin-top:12px"><input type="checkbox" id="fbn" ${instr.fbNotify!==false?'checked':''}> <span>${t('fb_notify')}<br><span class="muted" style="font-weight:500">${t('fb_notify_sub', {n: esc(instr.createdBy||'')})}</span></span></label>
          <label class="toggle" style="margin-top:10px"><input type="checkbox" id="fbnr" ${instr.fbNotifyReviewers?'checked':''}> <span>${t('fb_notify_rev')}<br><span class="muted" style="font-weight:500">${t('fb_notify_rev_sub')}</span></span></label></div>
      </div>
      <details class="card side-info acc"><summary><h3>${t('instr_access')}</h3><span class="muted">${(instr.teams||[]).length ? nOf((instr.teams||[]).length, 'team', 'teams') : t('like_project')}</span></summary><p class="muted" style="margin:10px 0">${t('instr_access_sub')}</p><div id="iaccess">${(S.wsRow.teams||[]).length ? (S.wsRow.teams||[]).map(tm => `<label class="opt" style="margin-bottom:6px"><input type="checkbox" data-itm="${tm.id}" ${(instr.teams||[]).includes(tm.id)?'checked':''} ${myRole==='viewer'?'disabled':''}> ${esc(tm.name)}${folderTeams(instr.folder).includes(tm.id)?` <span class="muted" style="font-weight:500">(${t('via_project')})</span>`:''}</label>`).join('') : `<p class="muted" style="margin:0">${t('no_teams_short')}</p>`}</div></details>
      <div class="card side-info" id="txcard"></div>
      <div class="card side-info" id="appr"></div>
    </div></main>`);
  app.appendChild(v);
  // v12.48: the head (title, tabs, record / submit / approve) stays on screen on the PC – the side panels start below it
  { const eh = v.querySelector('.ed-head'); const setH = () => v.style.setProperty('--edh', eh.offsetHeight + 'px'); setH(); const ro = new ResizeObserver(setH); ro.observe(eh);
    const onSc = () => eh.classList.toggle('stuck', window.scrollY > 4); window.addEventListener('scroll', onSc, {passive:true}); onSc();
    G.activeCleanup = () => { ro.disconnect(); window.removeEventListener('scroll', onSc); }; }
  // v12.43: no tab row – the steps are the editor; approval & settings, link/QR, PDF and statistics live in the ⋯ menu, preview is a button
  const showTab = k => { tab = k; try{ sessionStorage.setItem('gg_tab_'+id, tab); }catch(e){} v.querySelector('#tab-steps').hidden = tab!=='steps'; v.querySelector('#tab-settings').hidden = tab!=='settings'; if(tab==='steps') setTimeout(()=>window.dispatchEvent(new Event('resize')), 30); else window.scrollTo({top:0}); };
  { const sb = v.querySelector('[data-sback]'); if(sb) sb.onclick = () => showTab('steps'); }
  v.querySelector('#rec').onclick = () => go('rec/'+instr.id);
  v.querySelector('#stchip').onclick = () => { showTab('settings'); setTimeout(() => { const a = v.querySelector('#appr'); if(a) a.scrollIntoView({behavior:'smooth', block:'start'}); }, 60); }; // v12.48: the status chip leads to the approvals
  let fbOpenN = 0;
  v.querySelector('#more').onclick = () => modal(`<div class="menu"><div class="menu-h">${esc(instr.title)}</div><button data-m="undo" ${undo.length?'':'disabled'}>${IC.undo} ${t('undo')}</button><button data-m="redo" ${redo.length?'':'disabled'}>${IC.redo} ${t('redo')}</button><div class="menu-sep"></div>${canLinks ? `<button data-m="share">${IC.share} ${t('share')}</button>` : ''}<button data-m="pdf">${IC.pdf} ${t('pdf')}</button><div class="menu-sep"></div>${canEdit ? `<button data-m="dup">${IC.copy} ${t('duplicate')}</button>` : ''}<button data-m="settings">${IC.gear} ${t('tab_settings')}</button></div>`, (bg, close) => { $$('[data-m]', bg).forEach(b => b.onclick = () => { close(); const m = b.dataset.m; if(m==='undo') doUndo(); else if(m==='redo') doRedo(); else if(m==='dup') duplicateWithProgress(instr); else if(m==='share') shareModal(instr); else if(m==='pdf') exportPDFAsk(instr); else if(m==='results') go('results/'+instr.id); else if(m==='settings') showTab('settings'); }); });
  const setChip = () => { const c = v.querySelector('#stchip'); c.className = 'chip dot '+instr.status; c.textContent = t(instr.status==='review'?'in_review':instr.status); const vc = v.querySelector('#vchip'); if(vc) vc.textContent = 'v'+instr.version; updateCTA(); };
  function updateCTA(){ const b = v.querySelector('#cta'); b.hidden = true; b.className = 'btn sm'; const narrow = matchMedia('(max-width:560px)').matches;
    if(instr.status==='draft' && realSteps(instr).length && myRole!=='viewer'){ b.hidden = false; b.textContent = t(narrow ? 'submit_review_short' : 'submit_review'); b.onclick = submitForReview; }
    else if(instr.status==='review' && canApprove){ b.hidden = false; b.textContent = t(narrow ? 'approve_publish_short' : 'approve_publish'); b.onclick = approveAll; } }
  async function submitForReview(){ const note = await promptM(t('publish_note'), G.LANG==='de'?'z. B. Schritt 4 Drehmoment korrigiert':'e.g. corrected torque in step 4', instr.version===0 ? (G.LANG==='de'?'Erstversion':'Initial version') : ''); if(note===null) return; instr.pendingNote = note; instr.status='review'; await saveInstr(instr); setChip(); renderApprovals(); toast(t('in_review')); }
  async function approveAll(){ if(!(await confirmM(t('approve_all_q'), t('approve')))) return; const now = Date.now(); if(!instr.approvals.tech) instr.approvals.tech = {by:S.user.name, at:now}; if(!instr.approvals.dsgvo) instr.approvals.dsgvo = {by:S.user.name, at:now}; instr.status='published'; instr.version++; if(!instr.shareKey) instr.shareKey = newShareKey(); instr.history.push({version:instr.version, at:now, by:instr.createdBy, note:instr.pendingNote||'', tech:instr.approvals.tech, dsgvo:instr.approvals.dsgvo}); instr.pendingNote=''; await saveInstr(instr); setChip(); renderApprovals(); toast(t('published')+' · v'+instr.version); }
  const undo = [], redo = []; let lastSnap = JSON.stringify(instr.steps);
  const snapshot = () => { const cur = JSON.stringify(instr.steps); if(cur !== lastSnap){ undo.push(lastSnap); redo.length = 0; if(undo.length > 40) undo.shift(); lastSnap = cur; } updateUndo(); };
  const updateUndo = () => { const b = v.querySelector('#undo'); if(b) b.disabled = !undo.length; };
  const applySnap = async (snap, msg) => { lastSnap = snap; instr.steps = JSON.parse(snap); updateUndo(); if(!instr.steps.find(x=>x.id===sel)) sel = (realSteps(instr)[0]||{}).id; await saveInstr(instr); renderList(); renderStage(); toast(msg); };
  async function doUndo(){ if(!undo.length) return; redo.push(JSON.stringify(instr.steps)); await applySnap(undo.pop(), t('undone')); }
  async function doRedo(){ if(!redo.length) return; undo.push(JSON.stringify(instr.steps)); await applySnap(redo.pop(), t('redone')); }
  const touch = async () => { snapshot(); if(instr.status!=='draft'){ instr.status='draft'; instr.approvals={tech:null,dsgvo:null}; renderApprovals(); setChip(); } await saveInstr(instr); };
  const onKey = e => { if(/INPUT|TEXTAREA|SELECT/.test((e.target.tagName||''))) return; if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z' && !e.shiftKey){ e.preventDefault(); doUndo(); return; } if((e.ctrlKey||e.metaKey) && ((e.key.toLowerCase()==='z' && e.shiftKey) || e.key.toLowerCase()==='y')){ e.preventDefault(); doRedo(); return; } if(stageApi && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target.closest && e.target.closest('.srow'))){ if(stageApi.key(e)) e.preventDefault(); } };
  document.addEventListener('keydown', onKey);
  v.querySelector('#ititle').oninput = e => { instr.title = e.target.value; debounce('title', touch); };
  v.querySelector('#rename').onclick = async () => { const nt = await promptM(t('rename'), t('title'), instr.title); if(nt===null || !nt.trim()) return; instr.title = nt.trim(); v.querySelector('#ititle').value = instr.title; await touch(); };
  v.querySelector('#chk').onchange = async e => { instr.checklist = e.target.checked; v.querySelector('#chkmodes').hidden = !instr.checklist; await saveInstr(instr); renderList(); renderStage(); };
  v.querySelector('#fbk').onchange = async e => { instr.feedback = e.target.checked; v.querySelector('#fb-sub').hidden = !e.target.checked; await saveInstr(instr); };
  v.querySelector('#fbn').onchange = async e => { instr.fbNotify = e.target.checked; await saveInstr(instr); };
  v.querySelector('#fbnr').onchange = async e => { instr.fbNotifyReviewers = e.target.checked; await saveInstr(instr); };
  v.querySelector('#fb-open2').onclick = () => { try{ sessionStorage.setItem('gg_rtab_'+instr.id, 'feedback'); }catch(e){} };
  $$('input[name="cm"]', v).forEach(r => r.onchange = async () => { if(!r.checked) return; instr.checkMode = r.value; await saveInstr(instr); renderList(); renderStage(); });
  $$('[data-itm]', v).forEach(cb => cb.onchange = async () => { const tid = cb.dataset.itm; instr.teams = (instr.teams||[]).filter(x=>x!==tid); if(cb.checked) instr.teams.push(tid); await saveInstr(instr); toast(t('saved')); });
  let remembered = null; try{ remembered = sessionStorage.getItem('gg_sel_'+id); }catch(e){}
  let sel = selStepId && instr.steps.find(s=>s.id===selStepId) ? selStepId : (remembered && instr.steps.find(s=>s.id===remembered) ? remembered : (realSteps(instr)[0]||{}).id);
  // v0.30 phone: the step list and the step itself are two screens – "list" (overview) or "step" (one step, full width); the PC shows both
  const isPhone = () => window.innerWidth < 901;
  const setPane = p => { const ed = v.querySelector('#tab-steps'); ed.dataset.pane = p; if(p==='step') window.scrollTo({top:0}); else setTimeout(() => { const r = v.querySelector(`.srow[data-id="${sel}"]`); if(r) r.scrollIntoView({block:'center'}); }, 30); };
  let stageCleanup = null, stageApi = null, warnOpen = false;
  // step bar (back / previous / next) by delegation: it keeps working whatever happens to the rest of the stage
  { const st = v.querySelector('#stage'); st.addEventListener('click', e => { const b = e.target.closest('[data-back],[data-prev],[data-next]'); if(!b || b.disabled) return; if(b.hasAttribute('data-back')){ setPane('list'); return; } const rs = realSteps(instr); const k = rs.findIndex(x => x.id===sel); const nx = b.hasAttribute('data-prev') ? rs[k-1] : rs[k+1]; if(nx) selectStep(nx.id); }); }
  let collapsed = new Set(); try{ collapsed = new Set(JSON.parse(localStorage.getItem('gg_coll_'+id)||'[]')); }catch(e){}
  let openedFor = null; // which selection already had its chapter auto-opened
  const saveColl = () => { try{ localStorage.setItem('gg_coll_'+id, JSON.stringify([...collapsed])); }catch(e){} };

  /* --- chapter blocks: a chapter row + all steps until the next chapter --- */
  const chapterBlock = idx => { let end = idx+1; while(end < instr.steps.length && instr.steps[end].kind!=='chapter') end++; return [idx, end]; };
  const blockStartOf = idx => { let i = idx; while(i > 0 && instr.steps[i].kind!=='chapter') i--; return instr.steps[i].kind==='chapter' ? i : -1; };
  async function moveChapter(idx, dir){
    const [cs, ce] = chapterBlock(idx); const block = instr.steps.slice(cs, ce);
    if(dir < 0){ if(cs===0) return; const ps = blockStartOf(cs-1); const target = ps>=0 ? ps : 0; instr.steps.splice(cs, ce-cs); instr.steps.splice(target, 0, ...block); }
    else { if(ce >= instr.steps.length) return; const [, ne] = chapterBlock(ce); instr.steps.splice(cs, ce-cs); instr.steps.splice(ne - (ce-cs), 0, ...block); }
    await touch(); renderList();
  }
  async function moveItemTo(fromIdx, toIdx){
    const item = instr.steps[fromIdx];
    if(item.kind==='chapter'){
      const [cs, ce] = chapterBlock(fromIdx); const block = instr.steps.slice(cs, ce);
      // target = start of the block that contains toIdx; when moving down, insert after that block
      let ts = blockStartOf(toIdx); if(ts < 0) ts = toIdx; let te = instr.steps[ts].kind==='chapter' ? chapterBlock(ts)[1] : ts+1;
      instr.steps.splice(cs, ce-cs);
      let insertAt = toIdx > cs ? te - (ce-cs) : ts;
      instr.steps.splice(Math.max(0, Math.min(insertAt, instr.steps.length)), 0, ...block);
    } else { const [x] = instr.steps.splice(fromIdx,1); instr.steps.splice(toIdx,0,x); }
    await touch(); renderList();
  }

  /* --- step list --- */
  // "add step": record, pick photos/videos from the library, or drop files – always at the end of the list
  function addStepCard(){
    const c = el(`<div class="addstep"><div class="as-t">${IC.plus} ${t('add_step')}</div><div class="as-b"><button class="btn mint sm" data-rec>${IC.cam}<span>${t('record')}</span></button><label class="btn ghost sm" style="cursor:pointer">${IC.upload}<span>${t('pick_files_short')}</span><input type="file" multiple accept="image/*,video/*" hidden></label><button class="btn ghost sm" data-empty title="${t('empty_step_sub')}">${IC.text}<span>${t('empty_step')}</span></button><button class="btn ghost sm" data-ch title="${t('add_chapter')}">${IC.note}<span>${t('new_chapter')}</span></button></div><div class="as-sub">${t('add_step_sub')}</div></div>`);
    c.querySelector('[data-rec]').onclick = () => go(`rec/${instr.id}`);
    c.querySelector('[data-empty]').onclick = () => addEmptyStep(null);
    c.querySelector('[data-ch]').onclick = () => addChapter();
    c.querySelector('input').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if(!fs.length) return; const added = await importFiles(instr, fs, null); if(!added.length) return; snapshot(); setChip(); renderApprovals(); sel = added[0].id; renderList(); renderStage(); setTimeout(() => focusRow(sel), 50); };
    return c; }
  // v0.31.2: choosing a step only moves the highlight – the list (and its thumbnails) stays as it is; a full redraw happens
  // only when the step sits in a collapsed chapter (which then opens)
  function selectStep(id){
    sel = id; try{ if(sel) sessionStorage.setItem('gg_sel_'+instr.id, sel); }catch(e){}
    const list = v.querySelector('#slist'); const row = list.querySelector(`.srow[data-id="${sel}"]`);
    if(!row){ renderList(); renderStage(); return; }
    list.querySelectorAll('.srow.sel').forEach(r => r.classList.remove('sel')); row.classList.add('sel'); openedFor = sel;
    renderStage();
  }
  const localMedia = new Set(); // media ids that are on this device (recorded here or cached by the preloader) – a dot on the row
  function renderList(){
    const list = v.querySelector('#slist'); list.innerHTML=''; let n = 0; let curCh = null;
    { const nb = v.querySelector('#noshot-bar'); const empt = realSteps(instr).filter(needsShot); nb.hidden = !empt.length || myRole==='viewer'; if(empt.length){ nb.innerHTML = `${IC.cam}<span>${empt.length===1 ? t('noshot_one') : t('noshot_many', {n:empt.length})}</span><b>${t('noshot_go')} →</b>`; nb.onclick = () => go(`rec/${instr.id}/replace/${empt[0].id}`); } }
    try{ if(sel) sessionStorage.setItem('gg_sel_'+id, sel); }catch(e){}
    // the chapter of the selected step is always open (e.g. coming back from the camera with a fresh step)
    if(sel !== openedFor){ openedFor = sel; let ch = null; for(const s of instr.steps){ if(s.kind==='chapter') ch = s; else if(s.id===sel){ if(ch && collapsed.has(ch.id)){ collapsed.delete(ch.id); saveColl(); } break; } } }
    const edn = v.querySelector('#ed-n'); if(edn) edn.textContent = '· ' + nOf(realSteps(instr).length, 'step', 'steps');
    const ew = v.querySelector('#ed-when'); if(ew) ew.textContent = instr.updatedAt ? '· ' + t('changed_by', {d: fmtD(instr.updatedAt), n: instr.lastBy || instr.createdBy || ''}).replace(/ (von|by) $/, '') : '';
    if(!instr.steps.length){ list.innerHTML = `<div class="muted" style="padding:10px">${t('no_steps')}</div>`; if(myRole!=='viewer') list.appendChild(addStepCard()); }
    instr.steps.forEach((s, idx) => { try{
      if(s.kind==='chapter'){
        curCh = s; const [cs, ce] = chapterBlock(idx); const cnt = ce-cs-1; const isC = collapsed.has(s.id);
        const chIdx = instr.steps.slice(0, idx).filter(x => x.kind==='chapter').length;
        const r = el(`<div class="chrow ${isC?'coll':''}" data-id="${s.id}" style="--chc:${['#004EAD','#03D39B','#F5A524','#8B5CF6','#EC4899','#0EA5E9'][chIdx % 6]}"><span class="grip" title="${t('drag')}">${IC.grip}</span><button class="chev" title="${isC?t('expand'):t('collapse')}">${IC.down}</button><input value="${esc(s.title)}" placeholder="${t('chapter')}"><button class="chlbl" type="button" title="${t('ch_rename_hint')}">${esc(s.title)||t('chapter')}</button><span class="cnt tnum" data-lbl="${isC ? (cnt===1 ? t('step') : t('steps')) : ''}">${cnt}</span><button class="mini x" title="${t('delete')}">${IC.trash}</button></div>`);
        const toggle = () => { if(collapsed.has(s.id)) collapsed.delete(s.id); else collapsed.add(s.id); saveColl(); renderList(); };
        // v12.48: chapters move like steps – by the grip (drag & drop); the label (phone) renames, the chevron folds
        r.querySelector('.chlbl').onclick = async () => { if(myRole==='viewer') return toggle(); const name = await promptM(t('ch_rename'), t('chapter_ph'), s.title||''); if(name!==null){ s.title = name.trim(); await touch(); renderList(); } };
        r.querySelector('input').oninput = e => { s.title = e.target.value; debounce('ch'+s.id, touch); };
        r.querySelector('.chev').onclick = toggle;
        r.querySelector('.x').onclick = async () => { instr.steps.splice(idx,1); await touch(); renderList(); };
        attachDrag(r, idx); list.appendChild(r); return;
      }
      n++;
      if(curCh && collapsed.has(curCh.id)) return;
      const chC = curCh ? ['#004EAD','#03D39B','#F5A524','#8B5CF6','#EC4899','#0EA5E9'][instr.steps.slice(0, instr.steps.indexOf(curCh)).filter(x => x.kind==='chapter').length % 6] : 'transparent';
      const r = el(`<div class="srow ${s.id===sel?'sel':''} ${curCh?'in-ch':''} ${s.mediaId && localMedia.has(s.mediaId)?'local':''}" data-id="${s.id}" tabindex="0" style="--chc:${chC}"><span class="grip" title="${t('drag')}">${IC.grip}</span><span class="n tnum">${n}</span><div class="th-wrap ${s.mediaId?'':'noshot'} ${s.placeholder?'ph':''} ${s.textOnly?'txt':''}">${s.mediaId ? '<img class="th" alt="">' : `<span class="th">${s.textOnly ? IC.text : IC.cam}</span>`}${s.placeholder ? `<u class="phtag">${t('ph_tag')}</u>` : ''}${s.type==='video'?`<span class="vd tnum">${fmtSec(Math.max(0,(s.trimEnd||s.duration)-(s.trimStart||0)))}s</span>`:''}</div><div class="tt">${titleHtml(s.title)||`<span class="muted">${t('step')} ${n}</span>`}${myRole!=='viewer' ? `<button class="mini x rowdel" data-rowdel title="${t('delete')}">${IC.trash}</button>`:''}<small>${instr.checklist && (instr.checkMode||'all')!=='all' && confirmSteps(instr).includes(s) ? '☑ ' : ''}${s.ann.length?s.ann.length+' ⌖':''} ${s.desc?'· '+esc(mdToPlain(s.desc).replace(/\n+/g,' ').slice(0,30)):''}</small></div></div>`);
      if(s.mediaId){ const known = stepPosterSync(s); if(known) r.querySelector('.th').src = known; else stepPoster(s).then(u => { if(u) r.querySelector('.th').src = u; }); }
      const rd = r.querySelector('[data-rowdel]'); if(rd) rd.onclick = e => { e.stopPropagation(); delStep(s); };
      r.onclick = e => { if(e.target.closest('.grip')) return; selectStep(s.id); if(isPhone()) setPane('step'); };
      r.onkeydown = e => {
        const i = instr.steps.indexOf(s);
        if(e.key==='ArrowDown' && !e.altKey){ e.preventDefault(); const nx = instr.steps.slice(i+1).find(x=>x.kind!=='chapter'); if(nx){ selectStep(nx.id); focusRow(sel); } }
        else if(e.key==='ArrowUp' && !e.altKey){ e.preventDefault(); const pv = [...instr.steps.slice(0,i)].reverse().find(x=>x.kind!=='chapter'); if(pv){ selectStep(pv.id); focusRow(sel); } }
        else if(e.altKey && (e.key==='ArrowUp'||e.key==='ArrowDown')){ e.preventDefault(); move(i, e.key==='ArrowUp'?-1:1); focusRow(s.id); }
        else if(e.key==='Delete'||e.key==='Backspace'){ e.preventDefault(); delStep(s); }
        else if(e.key==='Enter'){ e.preventDefault(); const ti = v.querySelector('#stitle'); if(ti) ti.focus(); }
      };
      attachDrag(r, idx); list.appendChild(r);
    }catch(e){ console.error('step row', s && s.id, e); const r = el(`<div class="srow ${s.id===sel?'sel':''}" data-id="${s.id}" tabindex="0"><span class="grip"></span><span class="n tnum">${n}</span><div class="th-wrap noshot"><span class="th">${IC.warn}</span></div><div class="tt">${esc(s.title||'')}<small>${esc(String(e && e.message || e))}</small></div></div>`); r.onclick = () => { selectStep(s.id); if(isPhone()) setPane('step'); }; list.appendChild(r); } });
    if(instr.steps.length && myRole!=='viewer') list.appendChild(addStepCard());
    renderTrashBox(list);
  }
  // deleted steps stay here for 30 days – bring them back or drop them for good
  function renderTrashBox(list){
    const tr = instr.trash||[];
    if(!tr.length) return;
    const box = el(`<details class="trashbox"><summary>${IC.trash} ${t('trash')} <span class="cnt tnum">${tr.length}</span><span class="hint">· ${t('trash_open_hint')}</span><span class="chev">${IC.down}</span></summary><div class="tlist"></div><div class="muted" style="font-size:11px;margin-top:6px">${t('trash_steps_sub')}</div></details>`);
    const tl = box.querySelector('.tlist');
    tr.slice().sort((a,b) => (b.deletedAt||0)-(a.deletedAt||0)).forEach(ts => {
      const r = el(`<div class="trow"><img class="th" alt="" src=""><div class="tt">${titleHtml(ts.title)||`<span class="muted">${t('step')}</span>`}<small>${fmtDate(ts.deletedAt||0)}</small></div><button class="mini" data-restore title="${t('restore')}">${IC.undo}</button><button class="mini x" data-purge title="${t('purge')}">${IC.trash}</button></div>`);
      stepPoster(ts).then(u => { if(u) r.querySelector('.th').src = u; });
      r.querySelector('[data-restore]').onclick = async () => { const s = restoreStep(instr, ts); sel = s.id; await touch(); renderList(); renderStage(); toast(t('restored')); };
      r.querySelector('[data-purge]').onclick = async () => { if(!(await confirmM(t('purge_step_q'), t('purge')))) return; await purgeStep(instr, ts); await touch(); renderList(); toast(t('deleted')); };
      tl.appendChild(r); });
    list.appendChild(box);
  }
  const focusRow = id => { const r = v.querySelector(`.srow[data-id="${id}"]`); if(r){ r.focus(); r.scrollIntoView({block:'nearest'}); } };
  async function move(i, d){ const j = i+d; if(j<0||j>=instr.steps.length) return; const [x] = instr.steps.splice(i,1); instr.steps.splice(j,0,x); await touch(); renderList(); }
  async function delStep(s){ if(!(await confirmM(t('confirm_del_step'), t('delete')))) return; const i = instr.steps.indexOf(s); trashStep(instr, s); if(sel===s.id){ sel = (realSteps(instr)[Math.min(i, realSteps(instr).length-1)]||{}).id; } await touch(); renderList(); renderStage(); toast(t('trashed_toast')); }
  // drag & drop: the row follows the finger as a ghost; a placeholder moves through the list.
  // The original row stays in place (hidden) so pointer capture is never lost.
  function attachDrag(r, idx){
    const grip = r.querySelector('.grip'); if(!grip) return;
    grip.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const list = v.querySelector('#slist'); const item = instr.steps[idx]; const isCh = item.kind==='chapter';
      let hidden = [];
      if(isCh){ const [cs,ce] = chapterBlock(idx); const ids = new Set(instr.steps.slice(cs+1,ce).map(x=>x.id)); hidden = $$('[data-id]', list).filter(x=>ids.has(x.dataset.id)); hidden.forEach(x=>x.hidden=true); }
      const rect = r.getBoundingClientRect();
      const ghost = r.cloneNode(true); ghost.classList.add('drag-ghost'); ghost.style.width = rect.width+'px'; ghost.style.left = rect.left+'px'; ghost.style.top = rect.top+'px'; document.body.appendChild(ghost);
      const ph = document.createElement('div'); ph.className = 'placeholder'; ph.style.height = rect.height+'px'; r.after(ph); r.classList.add('drag-src');
      const offY = e.clientY - rect.top, offX = e.clientX - rect.left;
      try{ grip.setPointerCapture(e.pointerId); }catch(x){}
      if(navigator.vibrate) try{ navigator.vibrate(12); }catch(x){}
      const visible = x => x && x.nodeType===1 && x!==r && !x.hidden && (x.matches('[data-id]') );
      const sib = (el, dir) => { let n = dir>0 ? el.nextElementSibling : el.previousElementSibling; while(n && !visible(n)) n = dir>0 ? n.nextElementSibling : n.previousElementSibling; return n; };
      const unitOf = (row) => { if(!row) return null; const idx0 = instr.steps.findIndex(x=>x.id===row.dataset.id); const it = instr.steps[idx0];
        if(!isCh) return [row];
        let bs = it.kind==='chapter' ? idx0 : blockStartOf(idx0); if(bs < 0) return [row];
        const [cs,ce] = chapterBlock(bs); const ids = new Set(instr.steps.slice(cs,ce).map(x=>x.id)); return $$('[data-id]', list).filter(x=>!x.hidden && x!==r && ids.has(x.dataset.id)); };
      let lastY = e.clientY, done = false;
      const mv = ev => {
        ghost.style.top = (ev.clientY-offY)+'px'; ghost.style.left = (ev.clientX-offX)+'px';
        const dy = ev.clientY - lastY; if(Math.abs(dy) < 2) return; const dir = dy > 0 ? 1 : -1; lastY = ev.clientY;
        for(let k=0;k<12;k++){ const nb = unitOf(sib(ph, dir)); if(!nb || !nb.length) break;
          const first = nb[0].getBoundingClientRect(), last = nb[nb.length-1].getBoundingClientRect(); const top = first.top, bottom = last.bottom, h = bottom - top;
          if(dir > 0 && ev.clientY > top + h*0.5) nb[nb.length-1].after(ph);
          else if(dir < 0 && ev.clientY < bottom - h*0.5) nb[0].before(ph);
          else break; }
        if(ev.clientY < 90) window.scrollBy(0,-12); else if(ev.clientY > window.innerHeight-90) window.scrollBy(0,12);
      };
      const up = async () => {
        if(done) return; done = true;
        grip.removeEventListener('pointermove',mv); grip.removeEventListener('pointerup',up); grip.removeEventListener('pointercancel',up); document.removeEventListener('pointerup',up); document.removeEventListener('pointercancel',up);
        ghost.remove(); r.classList.remove('drag-src'); hidden.forEach(x=>x.hidden=false);
        const byId = Object.fromEntries(instr.steps.map(x=>[x.id,x])); const order = []; const skip = new Set();
        const ci = instr.steps.indexOf(item); const block = isCh ? instr.steps.slice(ci, chapterBlock(ci)[1]) : [item]; block.forEach(x=>skip.add(x.id));
        [...list.children].forEach(x => {
          if(x===ph){ order.push(...block); return; }
          const it = x.dataset ? byId[x.dataset.id] : null; if(!it || skip.has(it.id)) return;
          if(it.kind==='chapter' && collapsed.has(it.id)){ const k = instr.steps.indexOf(it); instr.steps.slice(k, chapterBlock(k)[1]).forEach(st => { order.push(st); skip.add(st.id); }); }
          else order.push(it); });
        ph.remove();
        if(order.length === instr.steps.length && order.some((x,i)=>x!==instr.steps[i])){ instr.steps = order; await touch(); }
        renderList();
      };
      grip.addEventListener('pointermove',mv); grip.addEventListener('pointerup',up); grip.addEventListener('pointercancel',up);
      document.addEventListener('pointerup',up); document.addEventListener('pointercancel',up);
    });
  }
  // v12.43: a step without a picture – text only for now, the picture can follow (camera / file) at any time
  async function addEmptyStep(after){
    const ns = {id:uid(), type:'empty', textOnly:true, w:1280, h:720, duration:0, trimStart:0, trimEnd:0, title:'', desc:'', warn:'', ann:[]};
    const at = after ? instr.steps.indexOf(after) : instr.steps.length-1; instr.steps.splice(at+1, 0, ns);
    sel = ns.id; await touch(); renderList(); renderStage(); if(isPhone()) setPane('step');
    setTimeout(() => { const ti = v.querySelector('#stitle'); if(ti) ti.focus(); }, 80); }
  async function addChapter(){
    const selStep = instr.steps.find(s=>s.id===sel); const n = selStep ? realSteps(instr).indexOf(selStep)+1 : 0;
    const name = await promptM(selStep ? t('chapter_before',{n}) : t('add_chapter'), t('chapter_ph'), ''); if(name===null) return;
    const ch = {id:uid(), kind:'chapter', title:(name.trim()||(t('chapter')+' '+(instr.steps.filter(s=>s.kind==='chapter').length+1)))};
    const i = selStep ? instr.steps.indexOf(selStep) : instr.steps.length; instr.steps.splice(Math.max(0,i), 0, ch); await touch(); renderList();
    setTimeout(()=>{ const row = v.querySelector(`.chrow[data-id="${ch.id}"]`); if(row) row.scrollIntoView({block:'center', behavior:'smooth'}); }, 50); toast(selStep ? t('chapter_added',{n}) : t('saved')); };

  /* --- stage (media + annotation + trim) --- */
  // an error while building the stage must not leave a dead screen: it is reported, the step bar stays usable
  async function renderStage(){ try{ await renderStageInner(); }catch(e){ console.error('stage', e); toast((G.LANG==='de' ? 'Anzeige-Fehler: ' : 'Display error: ') + (e && e.message || e)); } }
  async function renderStageInner(){
    if(stageCleanup){ stageCleanup(); stageCleanup=null; }
    const stage = v.querySelector('#stage'), props = v.querySelector('#props');
    const s = instr.steps.find(x=>x.id===sel);
    if(!s){ stage.innerHTML = `<div class="empty"><h2>${t('no_steps')}</h2><button class="btn mint" id="rec2">${IC.cam} ${t('record')}</button></div>`; stage.querySelector('#rec2').onclick=()=>go('rec/'+instr.id); props.innerHTML=''; return; }
    const isV = s.type==='video';
    const n = realSteps(instr).indexOf(s)+1;
    const rs = realSteps(instr); const k = rs.indexOf(s); const stepbar = `<div class="stepbar"><button class="sb-back" data-back>${IC.back}<span>${t('back_steps')}</span></button><b class="tnum" title="${t('step_of', {n:k+1, total:rs.length})}">${k+1} ${t('of')} ${rs.length}</b><span class="sb-nav"><button data-prev ${k<=0?'disabled':''} title="${t('cap_prev')}">${IC.up}</button><button data-next ${k>=rs.length-1?'disabled':''} title="${t('cap_next_btn')}">${IC.down}</button><button data-mmore title="${t('more')}">${IC.more}</button></span></div>`;
    // v12.43: the step bar goes up before anything is awaited – moving between steps must work even when the picture is slow or
    // the device store hangs (its buttons are handled by the delegated listener on the stage, see stageNav)
    stage.innerHTML = `${stepbar}<div class="stage-skel"><div class="sk"></div></div>`;
    let url = null; if(s.mediaId){ try{ url = await Promise.race([mediaUrl(s.mediaId), new Promise(r => setTimeout(() => r(undefined), 3000))]); }catch(e){ url = undefined; } if(url === undefined){ console.warn('media url fallback', s.mediaId); url = s.mediaUrl || null; } }
    if(sel !== s.id || stage !== v.querySelector('#stage')) return; // another step was chosen meanwhile
    const noShot = !s.mediaId;
    // v12.41: one symbol library – docked under the picture on the PC (#symdock), behind the blue button on the phone (#tools-open)
    stage.innerHTML = noShot ? `${stepbar}<div class="row desk" style="justify-content:space-between;margin-bottom:10px"><b>${t('step')} ${n} ${t('of')} ${realSteps(instr).length}</b><button class="btn ghost sm del" id="del" title="${t('delete_step')}">${IC.trash} ${t('delete')}</button></div>
      <div class="noshot-stage ${s.textOnly?'textonly':''}"><div class="ns-ico">${s.textOnly ? IC.text : IC.cam}</div><div class="ns-h">${s.textOnly ? t('text_step') : t('noshot')}</div><div class="ns-title">${titleHtml(s.title)||`${t('step')} ${n}`}</div>${s.shot ? `<div class="ns-shot">🎬 ${esc(s.shot)}</div>` : ''}<p class="muted">${s.textOnly ? t('text_step_sub') : t('noshot_sub')}</p>
        <div class="ns-acts"><button class="btn ${s.textOnly?'ghost':'mint'}" id="retake">${IC.cam} ${s.textOnly ? t('record') : t('noshot_rec')}</button><label class="btn ghost" style="cursor:pointer">${IC.upload} ${t('pick_files_short')}<input type="file" accept="video/*,image/*" hidden id="repl-file"></label><button class="btn ghost" id="after" hidden></button></div></div>` : `${stepbar}<div class="row desk" style="justify-content:space-between;margin-bottom:10px"><b>${t('step')} ${n} ${t('of')} ${realSteps(instr).length}</b><button class="btn ghost sm del" id="del" title="${t('delete_step')}">${IC.trash} ${t('delete')}</button></div>
      ${s.placeholder ? `<div class="ph-banner"><span>${IC.pdf}</span><div>${t('ph_banner')}</div><button class="btn mint sm" id="ph-rec">${IC.cam} ${t('noshot_rec')}</button><button class="btn ghost sm" id="ph-keep">${t('ph_keep')}</button></div>` : ''}
      <div class="media-box loading" id="mbox"><div class="vbg" id="mbg"></div>${isV?`<video id="med" src="${url}" ${(stepPosterSync(s)||s.posterUrl) ? `poster="${esc(stepPosterSync(s)||s.posterUrl)}"` : ''} muted playsinline autoplay loop preload="auto"></video>`:`<img id="med" src="${url}" alt="">`}<canvas class="ann sel-mode" id="acv"></canvas><div class="pausetag" id="ptag" hidden></div></div>
      <div class="ann-list" id="annlist"></div><div class="ann3d" id="ann3d" hidden></div>
      ${isV?`<div class="trimwrap"><div class="trimrow"><button class="playbtn" id="playbtn" title="Play / Pause">${IC.play}</button><div class="trimbar" id="trimbar"><div class="tb-film" id="tb-film"></div><div class="tb-dim l" id="tb-dl"></div><div class="tb-dim r" id="tb-dr"></div><div class="tb-keep" id="tb-keep"><div class="tb-h l" id="tb-hl"><i></i></div><div class="tb-h r" id="tb-hr"><i></i></div></div><div id="marks"></div><div class="tb-play" id="tb-play"></div></div></div>
        <div class="trim-labels"><span>${IC.scissors} ${t('trim_hint')}</span><span class="tnum"><b id="tcur">0,0</b> / <span id="tsv">${fmtSec(s.trimStart||0)}</span>–<span id="tev">${fmtSec(s.trimEnd||s.duration)}</span> s <span id="annt" class="muted"></span></span></div></div>`:''}
      <button class="tools-cta" id="tools-open"><span class="tc-ico">${IC.plus}</span><span><b>${t('mark_img')}</b><small>${t('mark_img_sub')}</small></span></button>
      <div class="symdock" id="symdock"></div>
      <div class="mact"><div class="mact-g"><span class="mact-l">${t('mact_this')}</span><button class="btn ghost sm" id="retake">${IC.cam} ${t('retake')}</button><label class="btn ghost sm" style="cursor:pointer">${IC.upload} ${t('replace_file')}<input type="file" accept="video/*,image/*" hidden id="repl-file"></label></div>
        <div class="mact-g"><span class="mact-l">${t('mact_after')}</span><button class="btn ghost sm" id="after">${IC.cam} ${t('record')}</button><label class="btn ghost sm" style="cursor:pointer">${IC.upload} ${t('pick_files_short')}<input type="file" accept="video/*,image/*" multiple hidden id="after-file"></label><button class="btn ghost sm" id="after-empty">${IC.note} ${t('empty_step')}</button></div></div>`;
    props.innerHTML = `${s.shot && !noShot ? `<div class="shot-hint" title="${t('shot_hint')}">🎬 <span>${esc(s.shot)}</span><button data-shotx title="${t('delete')}">×</button></div>` : ''}<div class="field"><label for="stitle">${t('title')}</label><input id="stitle" value="${esc(s.title)}" placeholder="${t('step_title_ph')}"><div class="fmtbar sm"><button data-tf="b" title="${t('fmt_bold')}"><b>B</b></button><button data-tf="link" title="${t('fmt_link')}">🔗 ${t('fmt_link')}</button><button data-tf="keep" title="${t('fmt_keep')}">🔒 ${t('fmt_keep')}</button></div></div>
      <div class="field"><label for="sdesc">${t('desc')}</label><textarea id="sdesc" placeholder="${t('desc_ph')}">${esc(s.desc)}</textarea><div class="fmtbar"><button data-f="b" title="${t('fmt_bold')}"><b>B</b></button><button data-f="ul" title="${t('fmt_ul')}">•&thinsp;${t('fmt_ul')}</button><button data-f="ol" title="${t('fmt_ol')}">1.&thinsp;${t('fmt_ol')}</button><button data-f="link" title="${t('fmt_link')}">🔗 ${t('fmt_link')}</button><button data-f="keep" title="${t('fmt_keep')}">🔒 ${t('fmt_keep')}</button></div><div class="rich rich-prev" id="sprev" hidden></div><div class="fmt-hint">${esc(t('fmt_hint'))}</div></div>
      <div class="field warnf ${s.warn || warnOpen ? '' : 'closed'}"><label for="swarn">${t('warn')}</label><input id="swarn" value="${esc(s.warn||'')}" placeholder="⚠"><button class="lnk" type="button" data-addwarn>⚠ ${t('add_warn')}</button></div>
      ${instr.checklist && (instr.checkMode||'all')==='custom' ? `<label class="toggle" style="margin-top:6px"><input type="checkbox" id="sconf" ${s.confirm?'checked':''}> <span>${t('step_confirm')}<br><span class="muted" style="font-weight:500">${t('step_confirm_sub')}</span></span></label>` : ''}`;
    const sconf = props.querySelector('#sconf'); if(sconf) sconf.onchange = async e => { s.confirm = e.target.checked; if(!s.confirm) delete s.confirm; await touch(); renderList(); };
    { const sx = props.querySelector('[data-shotx]'); if(sx) sx.onclick = () => { delete s.shot; touch(); renderStage(); }; }
    props.querySelector('#stitle').oninput = e => { s.title = e.target.value; debounce('st', async()=>{ await touch(); renderList(); }); };
    const ti = props.querySelector('#stitle'); const wrapTitle = (pre, post, ph) => { const st = ti.selectionStart||0, en = ti.selectionEnd||0, val = ti.value; const inner = val.slice(st,en) || ph; ti.value = val.slice(0,st)+pre+inner+post+val.slice(en); ti.focus(); ti.setSelectionRange(st+pre.length, st+pre.length+inner.length); ti.dispatchEvent(new Event('input')); };
    $$('[data-tf]', props).forEach(b => b.onclick = async () => { const f = b.dataset.tf; if(f==='b') wrapTitle('**','**', G.LANG==='de'?'Text':'text'); else if(f==='keep') wrapTitle('==','==', 'M6'); else { const st = ti.selectionStart||0, en = ti.selectionEnd||0; const selTxt = ti.value.slice(st,en); const url = await promptM(t('fmt_link'), t('link_url'), 'https://'); if(!url || url==='https://') return; const ins = `[${selTxt||url}](${url})`; ti.value = ti.value.slice(0,st)+ins+ti.value.slice(en); ti.focus(); ti.dispatchEvent(new Event('input')); } });
    const ta = props.querySelector('#sdesc'), sprev = props.querySelector('#sprev');
    const updPrev = () => { const has = /\*\*|==|\[.+\]\(|^\s*[-*•]\s|^\s*\d+[.)]\s|https?:\/\//m.test(s.desc||''); sprev.hidden = !has; if(has) sprev.innerHTML = mdToHtml(s.desc); };
    ta.oninput = e => { s.desc = e.target.value; updPrev(); debounce('sd', touch); }; updPrev();
    const fire = () => ta.dispatchEvent(new Event('input'));
    // v12.43: bold / keep work line by line – three selected lines become three bold lines (markers never span a line break),
    // list prefixes stay outside the markers, and applying it again to already marked lines removes the markers
    const wrapSel = (pre, post, ph) => { const st = ta.selectionStart, en = ta.selectionEnd, val = ta.value; const inner = val.slice(st,en);
      if(!inner.includes('\n')){ const txt = inner || ph; const wrapped = txt.startsWith(pre) && txt.endsWith(post) && txt.length >= pre.length+post.length; const out = wrapped ? txt.slice(pre.length, txt.length-post.length) : pre+txt+post; ta.value = val.slice(0,st)+out+val.slice(en); ta.focus(); if(wrapped) ta.setSelectionRange(st, st+out.length); else ta.setSelectionRange(st+pre.length, st+pre.length+txt.length); fire(); return; }
      const split = l => { const m = l.match(/^(\s*(?:[-*•]\s|\d+[.)]\s)?)([\s\S]*)$/); return [m[1], m[2]]; };
      const lines = inner.split('\n'); const isW = b => b.startsWith(pre) && b.endsWith(post) && b.length >= pre.length+post.length;
      const all = lines.filter(l => l.trim()).every(l => isW(split(l)[1]));
      const out = lines.map(l => { const [pfx, body] = split(l); if(!body.trim()) return l; return pfx + (all ? body.slice(pre.length, body.length-post.length) : pre+body+post); }).join('\n');
      ta.value = val.slice(0,st)+out+val.slice(en); ta.focus(); ta.setSelectionRange(st, st+out.length); fire(); };
    const prefixLines = fn => { const st = ta.selectionStart, en = ta.selectionEnd, val = ta.value; const ls = val.lastIndexOf('\n', st-1)+1; let le = val.indexOf('\n', en); if(le<0) le = val.length; const out = val.slice(ls, le).split('\n').map(fn).join('\n'); ta.value = val.slice(0,ls)+out+val.slice(le); ta.focus(); ta.setSelectionRange(ls, ls+out.length); fire(); };
    $$('[data-f]', props).forEach(b => b.onclick = async () => { const f = b.dataset.f;
      if(f==='b') wrapSel('**','**', G.LANG==='de'?'Text':'text'); else if(f==='keep') wrapSel('==','==', 'M6');
      else if(f==='ul') prefixLines(l => /^\s*[-*•]\s/.test(l) ? l.replace(/^\s*[-*•]\s/,'') : '- '+l);
      else if(f==='ol') prefixLines((l,i) => /^\s*\d+[.)]\s/.test(l) ? l.replace(/^\s*\d+[.)]\s/,'') : (i+1)+'. '+l);
      else if(f==='link'){ const st = ta.selectionStart, en = ta.selectionEnd; const selTxt = ta.value.slice(st,en); const url = await promptM(t('fmt_link'), t('link_url'), 'https://'); if(!url || url==='https://') return; const ins = `[${selTxt||url}](${url})`; ta.value = ta.value.slice(0,st)+ins+ta.value.slice(en); ta.focus(); ta.setSelectionRange(st, st+ins.length); fire(); } });
    props.querySelector('#swarn').oninput = e => { s.warn = e.target.value; debounce('sw', touch); };
    props.querySelector('[data-addwarn]').onclick = () => { warnOpen = true; props.querySelector('.warnf').classList.remove('closed'); props.querySelector('#swarn').focus(); };
    stage.querySelector('#del').onclick = () => delStep(s);
    { stage.querySelector('[data-mmore]').onclick = () => modal(`<div class="menu"><div class="menu-h">${t('mact_this')}</div><button data-m="retake">${IC.cam} ${noShot ? t('noshot_rec') : t('retake')}</button><button data-m="file">${IC.upload} ${t('replace_file')}</button><div class="menu-h" style="margin-top:8px">${t('mact_after')}</div><button data-m="after">${IC.cam} ${t('record')}</button><button data-m="afile">${IC.upload} ${t('pick_files_short')}</button><button data-m="aempty">${IC.note} ${t('empty_step')}</button><div class="menu-sep"></div><button data-m="del" class="del">${IC.trash} ${t('delete_step')}</button></div>`, (bg, close) => { $$('[data-m]', bg).forEach(b => b.onclick = () => { close(); const m = b.dataset.m; if(m==='retake') go(`rec/${instr.id}/replace/${s.id}`); else if(m==='after') go(`rec/${instr.id}/after/${s.id}`); else if(m==='file'){ const fi = stage.querySelector('#repl-file'); if(fi) fi.click(); } else if(m==='afile'){ const fi = stage.querySelector('#after-file'); if(fi) fi.click(); } else if(m==='aempty') addEmptyStep(s); else delStep(s); }); }); }
    stage.querySelector('#retake').onclick = () => go(`rec/${instr.id}/replace/${s.id}`);
    stage.querySelector('#after').onclick = () => go(`rec/${instr.id}/after/${s.id}`);
    { const ae = stage.querySelector('#after-empty'); if(ae) ae.onclick = () => addEmptyStep(s); const af = stage.querySelector('#after-file'); if(af) af.onchange = e => { const fs = [...e.target.files]; e.target.value = ''; doImport(fs); }; }
    stage.querySelector('#repl-file').onchange = async e => { const f = e.target.files[0]; if(!f) return; try{ await replaceStepMedia(instr, s, f); await touch(); posterCache.clear(); renderList(); renderStage(); toast(t('saved')); }catch(err){ toast(t('error_prefix')+': '+err.message); } e.target.value=''; };
    if(noShot) return; // nothing to play or annotate yet
    { const pr = stage.querySelector('#ph-rec'); if(pr) pr.onclick = () => go(`rec/${instr.id}/replace/${s.id}`); const pk = stage.querySelector('#ph-keep'); if(pk) pk.onclick = async () => { delete s.placeholder; await touch(); toast(t('ph_kept')); renderList(); renderStage(); }; }

    const med = stage.querySelector('#med'), cv = stage.querySelector('#acv'), box = stage.querySelector('#mbox');
    stepPoster(s).then(u => { const bg = stage.querySelector('#mbg'); if(u && bg) bg.style.backgroundImage = `url("${u}")`; }).catch(()=>{});
    if(s.w && s.h) box.style.aspectRatio = `${s.w} / ${s.h}`;
    if(isV){ const toRemote = () => { if(s.mediaUrl && med.src !== s.mediaUrl){ med.src = s.mediaUrl; med.load(); med.play().catch(()=>{}); } }; med.addEventListener('error', toRemote); setTimeout(() => { if(med.readyState < 2) toRemote(); }, 3500); }
    // v12.45.1: a spinner on the picture until the first frame is there (a video from the server can take seconds on the PC)
    { const ready = () => box.classList.remove('loading'); if(isV){ if(med.readyState >= 2) ready(); else med.addEventListener('loadeddata', ready, {once:true}); } else { if(med.complete) ready(); else med.addEventListener('load', ready, {once:true}); } med.addEventListener('error', () => setTimeout(ready, 4000), {once:true}); }
    let selAnn = null, drag = null, curTime = s.trimStart||0, pausedUntil = 0, lastT = -1, stageCleanupDone = false, color = 'blue', lastTap = null;
    const mw = () => isV ? (med.videoWidth||s.w) : (med.naturalWidth||s.w), mh = () => isV ? (med.videoHeight||s.h) : (med.naturalHeight||s.h);
    // symbols of one moment (±0.3 s) show together while the video pauses there – and only then; paused by hand → the symbols of that moment + the selected one
    let showing = null;
    // a symbol belongs to one moment: paused → the symbols within ±0.3 s of the play head; playing → the group of the current auto-pause
    const isVis = a => !isV || (a.track ? (curTime >= (a.t||0)-0.3 && curTime <= trackEnd(a)+0.3) : (med.paused ? Math.abs(curTime-(a.t||0)) < 0.3 : !!(showing && showing.has(a.id))));
    const visibleAnns = () => s.ann.filter(isVis);
    const rectNow = () => { const b = cv.getBoundingClientRect(); return Object.assign(fitRect(b.width, b.height, mw(), mh()), {bx:b.left, by:b.top}); };
    // v12.43: the canvas is redrawn on every frame / every pointer move, the DOM around it (pills, marks, selection bar) only when the
    // symbols or the selection changed – rebuilding it 60× per second made taps on the phone go astray
    let uiSig = '';
    const syncUI = force => { const sig = s.ann.map(a => a.id+':'+(a.t||0)+':'+a.type+':'+(a.text||'')+':'+(a.n||'')+':'+(a.color||'')+':'+(a.style||'')+':'+(a.anim||'')+':'+(a.tx||0)+':'+(a.ty||0)+':'+(a.track ? a.track.pts.length : 0)).join('|')+'#'+selAnn; if(force || sig !== uiSig){ uiSig = sig; renderAnnList(); } };
    const draw = () => { cv.style.width = box.clientWidth+'px'; cv.style.height = box.clientHeight+'px'; drawAll(cv, s.ann, mw(), mh(), selAnn, isVis, isV ? curTime : null); syncUI(false); };
    const ro = new ResizeObserver(draw); ro.observe(box); const offImg = onImgReady(draw);
    const annToolId = a => a.type==='turn' ? (a.dir==='ccw' ? 'turn_ccw' : 'turn') : a.type==='thumb' ? (a.dir==='down' ? 'thumb_down' : 'thumb_up') : a.type==='smile' ? (a.mood==='sad' ? 'smile_sad' : 'smile') : a.type;
    // a short ring where the picture was tapped: "the next symbol lands here"
    let tapEls = null, tapTimer = 0;
    const clearTapMark = () => { clearTimeout(tapTimer); if(tapEls){ tapEls.forEach(x => x.remove()); tapEls = null; } };
    // the ring says "the next symbol lands here"; the chip next to it opens the library (phone) or points at the panel below (PC)
    const showTapMark = (nx, ny) => { clearTapMark(); const r = rectNow(); const px = r.x + nx*r.w, py = r.y + ny*r.h; const m = el(`<div class="tapmark"></div>`); m.style.left = px+'px'; m.style.top = py+'px';
      const chip = el(`<button class="tapchip">${IC.plus}<span>${t('mark_here')}</span></button>`); const right = nx < 0.6; chip.style.top = (py + (ny > 0.8 ? -46 : 18))+'px'; if(right) chip.style.left = (px + 16)+'px'; else { chip.style.right = (box.clientWidth - px + 16)+'px'; }
      chip.onclick = e => { e.stopPropagation(); if(isPhone()) placeTool('iso'); else { const dock = stage.querySelector('#symdock'); if(dock){ dock.classList.remove('pulse'); void dock.offsetWidth; dock.classList.add('pulse'); dock.scrollIntoView({block:'nearest', behavior:'smooth'}); } } };
      box.appendChild(m); box.appendChild(chip); tapEls = [m, chip]; tapTimer = setTimeout(clearTapMark, 6000); };
    const scaleAnn = (a, f) => { if(a.x2!=null){ const cx=(a.x+a.x2)/2, cy=(a.y+a.y2)/2; a.x=cx+(a.x-cx)*f; a.y=cy+(a.y-cy)*f; a.x2=cx+(a.x2-cx)*f; a.y2=cy+(a.y2-cy)*f; } else { a.size = Math.min(0.7, Math.max(0.05, (a.size||0.14)*f)); } };
    // rotate: arrows turn their endpoints (pixel space, so the angle is true on any aspect ratio); everything else carries a.rot
    const rotateAnn = (a, dAng, o) => { const r = rectNow(); if(a.type==='arrow'){ const oo = o||a; const cx = (oo.x+oo.x2)/2*r.w, cy = (oo.y+oo.y2)/2*r.h; const p1 = rotP(oo.x*r.w, oo.y*r.h, cx, cy, dAng), p2 = rotP(oo.x2*r.w, oo.y2*r.h, cx, cy, dAng); a.x = p1.x/r.w; a.y = p1.y/r.h; a.x2 = p2.x/r.w; a.y2 = p2.y/r.h; } else { const base = o ? (o.rot||0) : (a.rot||0); let ang = base + dAng; if(o){ const q = Math.round(ang/(Math.PI/2))*(Math.PI/2); if(Math.abs(ang-q) < 0.06) ang = q; } a.rot = ((ang+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI; if(Math.abs(a.rot) < 1e-4) delete a.rot; } };
    // PC keyboard: + / − size, [ / ] rotate, Backspace delete (selected symbol, focus outside inputs)
    stageApi = { key(e){ const a = s.ann.find(x=>x.id===selAnn); if(!a) return false; if(e.key==='+'||e.key==='='){ scaleAnn(a, 1.18); } else if(e.key==='-'){ scaleAnn(a, 0.85); } else if(e.key==='['){ rotateAnn(a, -Math.PI/12); } else if(e.key===']'){ rotateAnn(a, Math.PI/12); } else if(e.key==='Backspace'||e.key==='Delete'){ s.ann = s.ann.filter(x=>x.id!==selAnn); selAnn = null; renderList(); } else return false; draw(); touch(); return true; } };
    // Tool tap = place symbol in the middle; drag a tool onto the image = place at that point
    // v12.40: a symbol lands where the picture was last tapped (else in the middle) – k is a tool id from the quick bar or a spec from the library sheet
    const QUICK = {turn:{type:'turn', extra:{dir:'cw'}}, pin:{type:'pin'}, thumb_up:{type:'thumb', extra:{dir:'up'}}, smile:{type:'smile', color:'yellow'}};
    let dockPanel = null;
    const uploadOwn = async files => { const added = []; for(const f of files){ try{ added.push(await symbolFromFile(f)); }catch(e){ toast(t('sym_bad', {n:f.name})); } }
      if(added.length){ try{ await saveWs({symbols:[...(S.wsRow.symbols||[]), ...added]}); added.forEach(sy => preloadImg(sy.url)); }catch(e){ toast(e.message||String(e)); return null; } }
      if(dockPanel) dockPanel.refresh(); return added; };
    const libOpts = () => ({symbols: () => S.wsRow.symbols||[], onUpload: async files => { const added = await uploadOwn(files); if(added && added.length===1){ const sy = added[0]; placeTool({id:'img', type:'img', src:sy.url, name:sy.name||'', ar:sy.ar||1, alpha:!!sy.alpha}); } }});
    async function placeTool(k, cx, cy){
      if(k==='iso' || (k && k.manage===undefined && typeof k==='object' && k.id==='sheet')){ const spec = await symbolSheet(libOpts()); if(!spec) return; return placeTool(spec, cx, cy); }
      const spec = typeof k==='string' ? (QUICK[k] ? Object.assign({id:k}, QUICK[k]) : {id:k, type:k}) : k;
      if(spec.type==='img' && spec.manage){ const sym = await symbolPicker(); if(!sym) return; return placeTool({id:'img', type:'img', src:sym.url, name:sym.name||'', ar:sym.ar||1, alpha:!!sym.alpha}, cx, cy); }
      if(spec.type==='emoji' && (spec.picker || !spec.emoji)){ const em = await emojiPicker(); if(!em) return; return placeTool({id:'emoji', type:'emoji', emoji:em}, cx, cy); }
      if(spec.type==='img' && !spec.src){ const sym = await symbolPicker(); if(!sym) return; return placeTool({id:'img', type:'img', src:sym.url, name:sym.name||'', ar:sym.ar||1, alpha:!!sym.alpha}, cx, cy); }
      if(isV) med.pause();
      const ty = spec.type; const base = Object.assign({id:uid(), type:ty, color: spec.color || color, size:0.12, t: isV ? Math.round(curTime*20)/20 : 0}, spec.extra||{});
      if(cx==null && lastTap){ cx = lastTap.x; cy = lastTap.y; lastTap = null; } clearTapMark();
      const jitter = cx==null ? (s.ann.length % 5) * 0.03 : 0; const px = cx==null ? 0.5+jitter : cx, py = cy==null ? 0.5+jitter : cy;
      if(ty==='arrow') Object.assign(base, {x:px-0.13, y:py+0.11, x2:px+0.13, y2:py-0.11});
      else if(ty==='circle'||ty==='rect') Object.assign(base, {x:px-0.15, y:py-0.2, x2:px+0.15, y2:py+0.2});
      else if(ty==='text'){ const txt = await promptM(t('text_prompt'), 'z. B. 10 Nm'); if(!txt) return; Object.assign(base, {x:px-0.1, y:py, text:txt}); }
      else if(ty==='emoji'){ Object.assign(base, {x:px, y:py, emoji:spec.emoji, size:0.24}); }
      else if(ty==='img'){ Object.assign(base, {x:px, y:py, src:spec.src, name:spec.name||'', ar:spec.ar||1, style: spec.alpha ? 'glow' : 'sticker', size:0.2}); preloadImg(spec.src); }
      else if(ty==='iso'){ Object.assign(base, {x:px, y:py, code:spec.code, ar:spec.r||1, name:spec.name||spec.code, size:0.2}); preloadImg(isoUrl(spec.code)); }
      else if(ty==='number'){ const nums = s.ann.filter(a=>a.type==='number').map(a=>a.n); Object.assign(base, {x:px, y:py, n:(Math.max(0,...nums)||0)+1}); }
      else Object.assign(base, {x:px, y:py});
      s.ann.push(base); selAnn = base.id; draw(); renderList(); touch();
    }
    { const to = stage.querySelector('#tools-open'); if(to) to.onclick = () => placeTool('iso'); }
    // PC: the library sits under the picture – click = place (at the last tapped spot or the middle), drag a tile onto the picture = place there
    { const dock = stage.querySelector('#symdock'); if(dock && !isPhone()){
        const tileInit = (b, spec) => b.addEventListener('pointerdown', e => { if(e.button) return; const sx = e.clientX, sy = e.clientY; let ghost = null; b._dragged = false;
          const mv = ev => { if(!ghost){ if(Math.hypot(ev.clientX-sx, ev.clientY-sy) < 8) return; const vis = b.querySelector('canvas, img, .ss-emo'); ghost = el(`<div class="tool-ghost"></div>`); if(vis){ const c = vis.cloneNode(true); if(c.tagName==='CANVAS'){ c.getContext('2d').drawImage(vis, 0, 0); } ghost.appendChild(c); } document.body.appendChild(ghost); b._dragged = true; try{ b.setPointerCapture(e.pointerId); }catch(x){} }
            ghost.style.left = ev.clientX+'px'; ghost.style.top = ev.clientY+'px'; const r = rectNow(); const inside = ev.clientX>=r.bx+r.x && ev.clientX<=r.bx+r.x+r.w && ev.clientY>=r.by+r.y && ev.clientY<=r.by+r.y+r.h; box.classList.toggle('drop-ok', inside); };
          const up = ev => { b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', up); b.removeEventListener('pointercancel', up); box.classList.remove('drop-ok'); if(!ghost) return; ghost.remove(); const r = rectNow(); const nx = (ev.clientX-r.bx-r.x)/r.w, ny = (ev.clientY-r.by-r.y)/r.h; if(nx>=0&&nx<=1&&ny>=0&&ny<=1) placeTool(spec, nx, ny); };
          b.addEventListener('pointermove', mv); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); });
        // v12.45.1: the library sits below the picture in the scrolling stage column – a tab click brings the whole panel into view
        // (before, only the tab row peeked out at the bottom of the screen and "nothing unfolded"); a pick scrolls the picture back
        dockPanel = symbolPanel(dock, Object.assign(libOpts(), {docked:true, onPick: spec => { placeTool(spec); box.scrollIntoView({block:'nearest', behavior:'smooth'}); }, onAction: spec => placeTool(spec), tileInit}));
        dock.addEventListener('click', e => { if(e.target.closest('.ss-tab, .ss-chip, .ss-grp')) requestAnimationFrame(() => dock.scrollIntoView({block:'end', behavior:'smooth'})); });
    } }
    const FIXED_COL = ['check','cross','warn','elec','hot','emoji','iso'];
    // green flags on the timeline: one per symbol, follows add/remove/move, the selected one is white
    let markDrag = false;
    function renderMarks(force){ const mk = stage.querySelector('#marks'); if(!mk || markDrag) return; const d = s.duration||1; const sig = s.ann.map(a => a.id+':'+(a.t||0)).join('|')+'@'+d;
      if(force || mk.dataset.sig !== sig){ mk.dataset.sig = sig; mk.innerHTML = s.ann.map(x=>`<div class="mark" data-id="${x.id}" style="left:${100*(x.t||0)/d}%" title="${t('mark_drag')}"></div>`).join('');
        $$('.mark', mk).forEach(m => m.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); const a = s.ann.find(x => x.id===m.dataset.id); if(!a) return; clearTimeout(resumeTimer); autoPaused = false; med.pause(); selAnn = a.id; seekTo(a.t||0); draw(); syncUI(true);
          const bar = stage.querySelector('#trimbar'); const rect = bar.getBoundingClientRect(); const t0 = a.t||0; let moved = false; markDrag = true; try{ m.setPointerCapture(e.pointerId); }catch(x){}
          const mv = ev => { const tm = Math.min(s.trimEnd||d, Math.max(s.trimStart||0, (ev.clientX - rect.left)/rect.width*d)); const nt = Math.round(tm*20)/20; if(Math.abs(nt - t0) > 0.04) moved = true; if(moved){ a.t = nt; m.style.left = (100*nt/d)+'%'; seekTo(nt); } };
          const up = () => { m.removeEventListener('pointermove', mv); m.removeEventListener('pointerup', up); m.removeEventListener('pointercancel', up); markDrag = false; if(moved){ touch(); } syncUI(true); draw(); };
          m.addEventListener('pointermove', mv); m.addEventListener('pointerup', up); m.addEventListener('pointercancel', up); })); }
      $$('.mark', mk).forEach(m => m.classList.toggle('on', m.dataset.id===selAnn)); }
    function renderAnnList(){ const l = stage.querySelector('#annlist'); if(!l) return; renderMarks(false);
      const sorted = [...s.ann].sort((a,b) => (a.t||0)-(b.t||0));
      l.innerHTML = sorted.length ? sorted.map(a => { const on = a.id===selAnn; return `<span class="ann-pill ${on?'on':''}" data-id="${a.id}">${a.type==='emoji'?a.emoji:a.type==='img'?`<img class="pimg" src="${esc(a.src)}" alt="">${esc(a.name||t('tool_img'))}`:a.type==='iso'?`<img class="pimg" src="${isoUrl(a.code)}" alt="">${esc(a.name||a.code)}`:t('tool_'+annToolId(a))}${a.type==='text'?': '+esc(a.text):''}${a.type==='number'?' '+a.n:''}${isV?` <span class="muted tnum">@${fmtSec(a.t||0)}s</span>`:''}<button data-del="${a.id}" title="${t('delete_ann')}">${IC.trash}</button></span>`; }).join('') : `<span class="muted">${t('no_ann')}</span>`;
      $$('.ann-pill', l).forEach(p => { p.onclick = async e => {
        const delB = e.target.closest('[data-del]'); if(delB){ e.stopPropagation(); s.ann = s.ann.filter(a=>a.id!==delB.dataset.del); if(selAnn===delB.dataset.del) selAnn=null; touch(); draw(); syncUI(true); renderList(); return; }
        const a = s.ann.find(x=>x.id===p.dataset.id); if(!a) return;
        if(selAnn===a.id && a.type==='text'){ const txt = await promptM(t('text_prompt'), 'z. B. 10 Nm', a.text||''); if(txt!==null && txt.trim()){ a.text = txt.trim(); draw(); touch(); } return; }
        selAnn = a.id; if(isV){ med.pause(); seekTo(a.t||0); } draw(); }; });
      const at = stage.querySelector('#annt'); if(at){ const a = s.ann.find(x=>x.id===selAnn); at.textContent = a ? t('ann_at',{t:fmtSec(a.t||0)}) : ''; }
      // 3D (tilt / turn) and animation for the selected symbol – rebuilt only when the selection or the animation changes, so sliders survive their own drag
      // v12.40: one bar for the selected symbol – colour, size, pose (3D presets; fine-tuning is the orbit handle on the picture), animation, duplicate, delete
      const p3 = stage.querySelector('#ann3d'); if(p3){ const a = s.ann.find(x=>x.id===selAnn);
        if(!a){ p3.hidden = true; p3.dataset.sig = ''; }
        else { const sig = a.id+':'+(a.anim||'')+':'+(a.track ? a.track.pts.length : 0)+':'+(a.color||'')+':'+(a.style||'');
          // v12.44: one slim row – colour (where the symbol has one), animation, own picture: glow/sticker, video: static/follow.
          // Size and rotation are the handles / two fingers, tilt is the grip under the symbol, delete is the trash on the pill.
          if(p3.dataset.sig !== sig){ p3.dataset.sig = sig; p3.hidden = false;
            p3.innerHTML = `<div class="a3-row ab-main">${!FIXED_COL.includes(a.type) ? `<span class="pill-sw">${SWATCHES.map(c=>`<button class="sw ${c===(a.color||'blue')?'on':''}" data-col="${c}" style="background:${COLORS[c]}" title="${c}"></button>`).join('')}</span>` : ''}${a.type==='img' ? `<button class="a3-chip" data-style="${(a.style||'glow')==='glow'?'sticker':'glow'}" title="${t('img_style')}">${(a.style||'glow')==='glow'?'✨ '+t('style_glow'):'🏷 '+t('style_sticker')}</button>` : ''}<span class="a3-lbl">${t('a3_anim')}</span><span class="a3-anim">${['','pulse','bounce','blink'].map(k => `<button class="a3-chip ${(a.anim||'')===k?'on':''}" data-anim="${k}">${t('anim_'+(k||'none'))}</button>`).join('')}</span>${isV ? `<span class="a3-vid"><button class="a3-chip ${a.track?'':'on'}" data-trk="off">${t('trk_static')}</button><button class="a3-chip ${a.track?'on':''}" data-trk="on">${a.track ? t('trk_on', {t:fmtSec(trackEnd(a))}) : t('trk_follow')}</button></span>` : ''}</div>`;
            $$('[data-col]', p3).forEach(b => b.onclick = () => { a.color = b.dataset.col; color = a.color; p3.dataset.sig = ''; draw(); touch(); });
            const stB = p3.querySelector('[data-style]'); if(stB) stB.onclick = () => { a.style = stB.dataset.style; p3.dataset.sig = ''; draw(); touch(); };
            $$('[data-anim]', p3).forEach(b => b.onclick = () => { if(b.dataset.anim) a.anim = b.dataset.anim; else delete a.anim; p3.dataset.sig = ''; draw(); touch(); });
            $$('[data-trk]', p3).forEach(b => b.onclick = async () => {
              if(b.dataset.trk==='off'){ delete a.track; p3.dataset.sig = ''; draw(); touch(); return; }
              if(b.disabled) return; b.disabled = true; med.pause(); const src = med.currentSrc || med.src; const end = s.trimEnd || s.duration || (a.t||0)+10;
              try{ const r = await trackAnn(src, a, end, p => { b.textContent = t('trk_running', {p:Math.round(p*100)}); });
                if(!r){ toast(t('trk_fail')); b.disabled = false; b.textContent = t('trk_follow'); return; }
                if(r.track.pts.length < 2){ toast(t('trk_lost', {t:fmtSec(a.t||0)})); b.disabled = false; b.textContent = t('trk_follow'); return; }
                a.track = r.track; toast(r.lostAt!=null ? t('trk_lost', {t:fmtSec(r.lostAt)}) : t('trk_done', {t:fmtSec(trackEnd(a))}));
              }catch(e){ toast(t('trk_fail')); }
              b.disabled = false; p3.dataset.sig = ''; seekTo(a.t||0); draw(); touch(); }); }
          } } }
    // --- pointer: select / move / handles ---
    const toNorm = (e, r) => ({x:(e.clientX-r.bx-r.x)/r.w, y:(e.clientY-r.by-r.y)/r.h});
    const HIT = 34; const pts = new Map(); let pinch = null;
    const snapOf = a => ({x:a.x, y:a.y, x2:a.x2, y2:a.y2, size:a.size||0.14, rot:a.rot||0, tx:a.tx||0, ty:a.ty||0});
    let lastOrbitTap = 0;
    window.__orbitPos = () => { const a = s.ann.find(x=>x.id===selAnn); if(!a) return null; const h = annHandles(a, rectNow()).find(x => x.kind==='orbit'); return h ? {x:h.x, y:h.y} : null; }; // tests
    cv.addEventListener('pointerdown', e => {
      e.preventDefault(); cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
      if(pts.size===2){ const a = s.ann.find(x=>x.id===selAnn); if(a){ const [p1,p2] = [...pts.values()]; pinch = {a, d0: Math.hypot(p1.x-p2.x, p1.y-p2.y), ang0: Math.atan2(p2.y-p1.y, p2.x-p1.x), o:snapOf(a), moved:false}; drag = null; } return; }
      const r = rectNow(); const px = e.clientX-r.bx, py = e.clientY-r.by; const p = toNorm(e, r);
      const selA = s.ann.find(x=>x.id===selAnn);
      if(selA){ const selD = isV ? trackedAt(selA, curTime) : selA; // nearest handle wins – on a phone the knobs of a small symbol sit close together
          const h = annHandles(selD, r).map(h => ({h, d:Math.hypot(h.x-px, h.y-py)})).filter(x => x.d <= HIT).sort((a,b) => a.d-b.d).map(x => x.h)[0]; if(h){ const c = annCenter(selD, r);
          if(h.kind==='orbit'){ const now = performance.now(); if(now - lastOrbitTap < 350){ delete selA.tx; delete selA.ty; lastOrbitTap = 0; draw(); renderAnnList(); touch(); return; } lastOrbitTap = now; }
          drag = {a:selA, kind:h.kind, sx:p.x, sy:p.y, px0:e.clientX, py0:e.clientY, c, ang0:Math.atan2(py-c.y, px-c.x), o:snapOf(selA), r, moved:false}; return; } }
      const hit = [...visibleAnns()].reverse().find(a => { const bb = annBounds(isV ? trackedAt(a, curTime) : a, r); return px>=bb.x-16 && px<=bb.x+bb.w+16 && py>=bb.y-16 && py<=bb.y+bb.h+16; });
      selAnn = hit ? hit.id : null;
      if(hit) drag = {a:hit, kind:'move', sx:p.x, sy:p.y, o:snapOf(hit), r, moved:false};
      else drag = {kind:'none', moved:false, sx:p.x, sy:p.y, cx0:e.clientX, cy0:e.clientY, t0:performance.now()};
      draw();
    });
    cv.addEventListener('pointermove', e => {
      if(pts.has(e.pointerId)) pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
      if(pinch && pts.size>=2){ const [p1,p2] = [...pts.values()]; const f = Math.hypot(p1.x-p2.x, p1.y-p2.y) / (pinch.d0||1); const dAng = Math.atan2(p2.y-p1.y, p2.x-p1.x) - pinch.ang0; const a = pinch.a, o = pinch.o; pinch.moved = true;
        if(o.x2!=null){ const cx=(o.x+o.x2)/2, cy=(o.y+o.y2)/2; a.x=cx+(o.x-cx)*f; a.y=cy+(o.y-cy)*f; a.x2=cx+(o.x2-cx)*f; a.y2=cy+(o.y2-cy)*f; } else a.size = Math.min(0.7, Math.max(0.05, o.size*f));
        if(a.type==='arrow') rotateAnn(a, dAng, {x:a.x, y:a.y, x2:a.x2, y2:a.y2}); else rotateAnn(a, dAng, o);
        draw(); return; }
      if(!drag) return; const r = drag.r || rectNow(); const p = toNorm(e, r); const dx = p.x-drag.sx, dy = p.y-drag.sy;
      if(Math.abs(dx)+Math.abs(dy) > 0.004) drag.moved = true;
      if(drag.kind==='none') return; const a = drag.a, o = drag.o;
      if(drag.kind==='move'){ a.x = o.x+dx; a.y = o.y+dy; if(o.x2!=null){ a.x2 = o.x2+dx; a.y2 = o.y2+dy; } }
      else if(drag.kind==='rot'){ const px = e.clientX-r.bx, py = e.clientY-r.by; const ang = Math.atan2(py-drag.c.y, px-drag.c.x); rotateAnn(a, ang-drag.ang0, o); }
      else if(drag.kind==='orbit'){ // v12.40: drag sideways = turn, up/down = tilt – snaps to flat near the middle
        const dpx = e.clientX-drag.px0, dpy = e.clientY-drag.py0; const clamp = v => Math.max(-70, Math.min(70, Math.round(v))); let tx = clamp(o.tx - dpy*0.55), ty = clamp(o.ty + dpx*0.55); if(Math.abs(tx) < 6) tx = 0; if(Math.abs(ty) < 6) ty = 0;
        if(tx) a.tx = tx; else delete a.tx; if(ty) a.ty = ty; else delete a.ty; cv._orbit = true; }
      else { // resize handles work in the symbol's own (rotated) frame
        const rot = hasRot(a) ? a.rot : 0; const dpx = e.clientX-drag.px0, dpy = e.clientY-drag.py0; const cs = Math.cos(-rot), sn = Math.sin(-rot); const ldx = (dpx*cs - dpy*sn)/r.w, ldy = (dpx*sn + dpy*cs)/r.h;
        if(drag.kind==='p1'){ a.x = o.x+ldx; a.y = o.y+ldy; }
        else if(drag.kind==='p2'){ a.x2 = o.x2+ldx; a.y2 = o.y2+ldy; }
        else if(drag.kind==='size'){ a.size = Math.min(0.6, Math.max(0.06, o.size + (ldx+ldy)*0.8)); } }
      draw();
    });
    const endDrag = async e => {
      if(e) pts.delete(e.pointerId);
      if(pinch){ if(pts.size<2){ pinch = null; await touch(); } return; }
      if(!drag) return; const d = drag; drag = null; if(d.kind==='orbit'){ cv._orbit = false; renderAnnList(); }
      if(d.kind==='none'){
        if(!d.moved){ lastTap = {x:d.sx, y:d.sy}; if(isV && !med.paused){ clearTimeout(resumeTimer); autoPaused = false; showing = null; med.pause(); } showTapMark(d.sx, d.sy); return; }
        clearTapMark();
        // v12.47: a quick horizontal swipe over the picture (phone) = previous / next step, like the arrows in the step bar
        if(e && isPhone()){ const dx = e.clientX-d.cx0, dy = e.clientY-d.cy0; if(Math.abs(dx) >= 60 && Math.abs(dy) <= Math.abs(dx)*0.6 && performance.now()-d.t0 < 700){ const rs = realSteps(instr); const k = rs.findIndex(x => x.id===sel); const nx = dx < 0 ? rs[k+1] : rs[k-1]; if(nx){ if(isV){ try{ med.pause(); }catch(x){} } selectStep(nx.id); } } }
        return; }
      clearTapMark();
      if(d.moved) await touch();
    };
    cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
    // video timeline + trim + 1s pause at annotation
    let raf = 0, autoPaused = false, resumeTimer = 0, updPlay = () => {};
    const togglePlay = () => { if(!isV) return; clearTimeout(resumeTimer);
      if(med.paused && !autoPaused){ if(curTime >= (s.trimEnd||s.duration)-0.05) seekTo(s.trimStart||0); med.play().catch(()=>{}); }
      else { autoPaused = false; showing = null; med.pause(); updPlay(); } };
    if(isV){ const pb = stage.querySelector('#playbtn'); updPlay = () => { const running = !med.paused || autoPaused; pb.innerHTML = running ? IC.pause : IC.play; pb.classList.toggle('on', running); if(!med.paused && !autoPaused) showing = null; draw(); }; med.addEventListener('play', updPlay); med.addEventListener('pause', updPlay); pb.onclick = togglePlay; setTimeout(updPlay, 100); }
    function seekTo(tm){ curTime = tm; const sa = s.ann.find(x=>x.id===selAnn); if(sa && Math.abs(tm-(sa.t||0)) >= 0.3) selAnn = null; try{ med.currentTime = tm; }catch(e){} const tc = stage.querySelector('#tcur'); if(tc) tc.textContent = fmtSec(tm); const pl = stage.querySelector('#tb-play'); if(pl) pl.style.left = (100*tm/(s.duration||1))+'%'; draw(); }
    if(isV){
      const bar = stage.querySelector('#trimbar'), keep = stage.querySelector('#tb-keep'), dl = stage.querySelector('#tb-dl'), dr = stage.querySelector('#tb-dr'), play = stage.querySelector('#tb-play'), marks = stage.querySelector('#marks'), hl = stage.querySelector('#tb-hl'), hr = stage.querySelector('#tb-hr');
      const D = () => s.duration||1;
      const layout = () => { const d = D(); const a = 100*(s.trimStart||0)/d, b = 100*(s.trimEnd||d)/d; keep.style.left = a+'%'; keep.style.width = (b-a)+'%'; dl.style.width = a+'%'; dr.style.width = (100-b)+'%'; renderMarks(true); stage.querySelector('#tsv').textContent = fmtSec(s.trimStart||0); stage.querySelector('#tev').textContent = fmtSec(s.trimEnd||d); };
      const setPlay = tm => { play.style.left = (100*tm/D())+'%'; const tc = stage.querySelector('#tcur'); if(tc) tc.textContent = fmtSec(tm); };
      layout(); setPlay(s.trimStart||0);
      (async () => { const film = stage.querySelector('#tb-film'); const N = 7; const d = D(); for(let i=0;i<N;i++){ const c = await grabFrame(url, d*(i+0.5)/N, 160); if(!c || stageCleanupDone) return; const im = document.createElement('img'); im.src = c.toDataURL('image/jpeg', .6); film.appendChild(im); } })();
      const pct = ev => { const r = bar.getBoundingClientRect(); return Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)); };
      const dragHandle = (h, which) => { h.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId); med.pause();
        const mv = ev => { const tm = pct(ev)*D(); if(which==='l'){ s.trimStart = Math.min(tm, (s.trimEnd||D())-0.3); seekTo(s.trimStart); } else { s.trimEnd = Math.max(tm, (s.trimStart||0)+0.3); seekTo(s.trimEnd); } layout(); setPlay(which==='l'?s.trimStart:s.trimEnd); };
        const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); posterCache.delete(s.mediaId+':'+s.trimStart); touch(); renderList(); };
        h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up); }); };
      dragHandle(hl, 'l'); dragHandle(hr, 'r');
      bar.addEventListener('pointerdown', e => { if(e.target.closest('.tb-h')) return; e.preventDefault(); bar.setPointerCapture(e.pointerId); med.pause(); const mv = ev => { const tm = pct(ev)*D(); seekTo(tm); setPlay(tm); }; mv(e); const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); }; bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up); });
      med.addEventListener('loadedmetadata', () => { if(isFinite(med.duration) && med.duration > 0 && Math.abs(med.duration - s.duration) > 0.5){ s.duration = med.duration; if(!s.trimEnd || s.trimEnd > s.duration) s.trimEnd = s.duration; layout(); } draw(); });
      const ptag = stage.querySelector('#ptag');
      const loop = () => {
        if(!med.paused){ const ct = med.currentTime; const end = s.trimEnd||s.duration;
          if(ct >= end || ct < (s.trimStart||0)-0.2){ med.currentTime = s.trimStart||0; lastT = (s.trimStart||0)-0.05; }
          const hitA = s.ann.find(a => !a.track && lastT < (a.t||0) && ct >= (a.t||0) && ct < (a.t||0)+0.6);
          if(hitA && performance.now() > pausedUntil){ const group = s.ann.filter(a => !a.track && Math.abs((a.t||0)-(hitA.t||0)) < 0.3); showing = new Set(group.map(a=>a.id)); autoPaused = true; med.pause(); curTime = ct; lastT = Math.max(...group.map(a=>a.t||0)) + 0.01; pausedUntil = performance.now()+1300; ptag.hidden=false; ptag.textContent = t('ann_at',{t:fmtSec(hitA.t||0)}); updPlay(); clearTimeout(resumeTimer); resumeTimer = setTimeout(()=>{ ptag.hidden=true; if(!stageCleanupDone && autoPaused && med.paused){ autoPaused = false; showing = null; med.play().catch(()=>{}); } }, 1000); setPlay(curTime); draw(); raf = requestAnimationFrame(loop); return; }
          else { curTime = ct; }
          lastT = ct; setPlay(curTime); draw(); }
        raf = requestAnimationFrame(loop); };
      med.addEventListener('seeking', () => { lastT = med.currentTime - 0.05; });
      raf = requestAnimationFrame(loop);
      med.addEventListener('loadeddata', () => seekTo(s.trimStart||0), {once:true});
    } else { med.addEventListener('load', draw, {once:true}); }
    stageCleanup = () => { stageCleanupDone = true; cancelAnimationFrame(raf); ro.disconnect(); offImg(); if(isV){ try{ med.pause(); }catch(e){} } };
    setTimeout(draw, 50);
  }

  /* --- translations --- */
  function renderTx(){
    const c = v.querySelector('#txcard'); const h = srcHash(instr); const tx = instr.translations||{};
    c.innerHTML = `<h3>${IC.pdf} ${t('pdf_dl')}</h3><p class="muted" style="margin:0 0 10px">${t('pdf_dl_sub')}</p><div class="langs"><div class="lang orig"><button data-pdforig title="${t('pdf_dl_orig')}"><b>${IC.pdf}</b> ${t('pdf_dl_orig')}</button></div>${LANGS.filter(([k])=>k!=='DE').map(([k,name]) => { const st = tx[k] ? (tx[k].hash===h ? 'ok' : 'stale') : ''; return `<div class="lang ${st}"><button data-txpdf="${k}" title="${st==='ok'?t('pdf_dl_ready'):(st==='stale'?t('tx_stale'):t('pdf_dl_tx'))}"><b>${FLAGS[k]||k}</b> ${name}${st==='ok'?' ✓':(st==='stale'?' ↻':'')}</button>${st?`<button data-txdel="${k}" title="${t('tx_remove')}">×</button>`:''}</div>`; }).join('')}</div><p class="muted" style="margin:10px 0 0;font-size:12.5px">${t('pdf_dl_note')}</p>`;
    c.querySelector('[data-pdforig]').onclick = () => exportPDF(instr);
    $$('[data-txpdf]', c).forEach(b => b.onclick = async () => { const k = b.dataset.txpdf; if(!(tx[k] && tx[k].hash===h)){ b.disabled = true; b.textContent = t('tx_running'); try{ await translateInstr(instr, k); }catch(e){ toast('DeepL: '+e.message); renderTx(); return; } renderTx(); } exportPDF(withLang(instr, k)); });
    $$('[data-txdel]', c).forEach(b => b.onclick = async () => { delete instr.translations[b.dataset.txdel]; await saveInstr(instr); renderTx(); });
  }
  /* --- approvals --- */
  function renderApprovals(){
    const a = v.querySelector('#appr'); const ap = instr.approvals;
    const note = instr.status==='draft' ? t('status_note_draft') : instr.status==='review' ? t('status_note_review') : t('status_note_pub');
    a.innerHTML = `<h3>${t('approvals')}</h3><div class="flow"><span class="${instr.status==='draft'?'cur':'done'}">1 · ${t('draft')}</span><span class="${instr.status==='review'?'cur':(instr.status==='published'?'done':'')}">2 · ${t('in_review')}</span><span class="${instr.status==='published'?'cur':''}">3 · ${t('published')}</span></div><div class="notice ${instr.status==='published'?'':'blue'}" style="margin-bottom:10px">${note}</div>
      <div class="approve-box">
        ${['tech','dsgvo'].map(k => `<div class="appr ${ap[k]?'ok':''}"><div><b>${t(k)}</b><small>${ap[k]?`${t('approved_by')} ${esc(ap[k].by)} · ${fmtDate(ap[k].at)}`:t('pending')}</small></div>
          ${instr.status==='review' && !ap[k] ? (canApproveKey(k) ? `<div class="row"><button class="btn ghost sm" data-rej="${k}">${t('reject')}</button><button class="btn mint sm" data-ok="${k}">${t('approve')}</button></div>` : `<span class="muted">${t('only_reviewer')}</span>`) : ''}</div>`).join('')}
      </div>
      <div class="row" style="margin-top:12px">${instr.status==='draft' && myRole!=='viewer' && realSteps(instr).length ? `<button class="btn" id="submit">${t('submit_review')}</button>`:''}${instr.status==='review' && myRole!=='viewer' ? `<button class="btn ghost sm" id="todraft">${t('back_to_draft')}</button>`:''}${instr.status==='published' ? `<span class="muted">${t('locked_hint')}</span>`:''}</div>
      ${instr.history.length ? `<h3 style="margin-top:14px">${t('history')}</h3><div class="hist">${[...instr.history].reverse().map(h=>`<div><b>v${h.version}</b> · ${fmtDate(h.at)} · ${esc(h.by)} — ${esc(h.note)}</div>`).join('')}</div>`:''}`;
    const sb2 = a.querySelector('#submit'); if(sb2) sb2.onclick = submitForReview;
    const td = a.querySelector('#todraft'); if(td) td.onclick = async () => { instr.status='draft'; instr.approvals={tech:null,dsgvo:null}; await saveInstr(instr); setChip(); renderApprovals(); };
    $$('[data-ok]', a).forEach(b => b.onclick = async () => { instr.approvals[b.dataset.ok] = {by:S.user.name, at:Date.now()};
      if(instr.approvals.tech && instr.approvals.dsgvo){ instr.status='published'; instr.publishedAt = Date.now(); instr.version++; if(!instr.shareKey) instr.shareKey = newShareKey(); instr.history.push({version:instr.version, at:Date.now(), by:instr.createdBy, note:instr.pendingNote||'', tech:instr.approvals.tech, dsgvo:instr.approvals.dsgvo}); instr.pendingNote=''; setChip(); toast(t('published')+' · v'+instr.version); }
      await saveInstr(instr); renderApprovals(); });
    $$('[data-rej]', a).forEach(b => b.onclick = async () => { const r = await promptM(t('reject_reason'), t('reason_ph')); if(r===null) return; instr.status='draft'; instr.approvals={tech:null,dsgvo:null}; instr.history.push({version:instr.version, at:Date.now(), by:S.user.name, note:`${t('reject')} (${t(b.dataset.rej)}): ${r}`}); await saveInstr(instr); setChip(); renderApprovals(); });
  }
  // import: file picker (phone: photo library, multiple) and drag & drop anywhere on the page (PC)
  const afterHint = () => { const st = instr.steps.find(x=>x.id===sel); return st ? t('import_after',{n: realSteps(instr).indexOf(st)+1}) : t('import_end'); };
  async function doImport(files){ if(myRole==='viewer') return; const added = await importFiles(instr, files, sel); if(!added.length) return; snapshot(); setChip(); renderApprovals(); sel = added[0].id; renderList(); renderStage(); setTimeout(() => focusRow(sel), 50); }
  const impFile = v.querySelector('#imp-file'); if(impFile) impFile.onchange = e => { const fs = [...e.target.files]; e.target.value = ''; doImport(fs); };
  const detachDrop = attachDropImport(doImport, afterHint);
  renderList(); renderStage(); renderApprovals(); renderTx(); updateCTA();
  // v12.46: the clips of this instruction come onto the device in the background (PC: all of them, phone: the next three) – switching
  // steps is then instant; the list shows a small dot per step that is on the device
  { touchEditorCache(instr.id); const markLocal = mid => { localMedia.add(mid); (instr.steps||[]).filter(x => x && x.mediaId===mid).forEach(st => { const r = v.querySelector(`.srow[data-id="${st.id}"]`); if(r) r.classList.add('local'); }); };
    (instr.steps||[]).forEach(st => { if(st && st.mediaId) DB.has('media', st.mediaId).then(h => { if(h) markLocal(st.mediaId); }).catch(()=>{}); });
    setTimeout(() => preloadInstr(instr, {current: sel, limit: isPhone() ? 3 : 0, onDone: markLocal}), 1500); }
  // open worker feedback → banner; arriving via "adopt" → the feedback's photo/video becomes a new step after the step it refers to
  (async () => { try{ const {data} = await G.sb.from('feedback').select('id,status').eq('instr_id', instr.id).eq('status', 'open'); const n = (data||[]).length; fbOpenN = n; const rt = v.querySelector('.itab[data-itab="results"]'); if(rt && n && !rt.querySelector('.nbadge')) rt.insertAdjacentHTML('beforeend', `<span class="nbadge">${n}</span>`); const bn = v.querySelector('#fb-banner'); if(bn && n){ bn.hidden = false; bn.querySelector('#fb-n').textContent = t('fb_open_n', {n}); bn.querySelector('#fb-open').onclick = () => { try{ sessionStorage.setItem('gg_rtab_'+instr.id, 'feedback'); }catch(e){} }; } }catch(e){} })();
  if(fbId && myRole!=='viewer'){ (async () => {
    try{ const {data:fb} = await G.sb.from('feedback').select('*').eq('id', fbId).maybeSingle(); if(!fb) return;
      if(fb.media_url){ toast(t('fb_adopting')); const res = await fetch(fb.media_url); if(!res.ok) throw new Error('HTTP '+res.status); const blob = await res.blob(); const ext = fb.media_url.split('.').pop().split('?')[0]; const file = new File([blob], `feedback-${fb.id}.${ext}`, {type: blob.type || (fb.media_type==='video' ? 'video/mp4' : 'image/jpeg')});
        const after = fb.step_id && instr.steps.some(x => x.id===fb.step_id) ? fb.step_id : null; const added = await importFiles(instr, [file], after); if(!added.length) return;
        if(fb.text && !added[0].desc) added[0].desc = fb.text; if(!added[0].title) added[0].title = t('fb_step_title', {n: fb.worker || t('worker')}); await touch(); snapshot(); setChip(); renderApprovals(); sel = added[0].id; renderList(); renderStage(); setTimeout(() => focusRow(sel), 50); }
      else if(fb.step_id && instr.steps.some(x => x.id===fb.step_id)){ sel = fb.step_id; renderList(); renderStage(); if(fb.text) toast('💬 '+fb.text.slice(0,140)); }
      await G.sb.from('feedback').update({status:'done', resolved_at:new Date().toISOString()}).eq('id', fb.id); toast(t('fb_adopted'));
    }catch(e){ toast(t('fb_fail')+': '+(e.message||e)); } })(); }
  { const c0 = G.activeCleanup; G.activeCleanup = () => { if(stageCleanup) stageCleanup(); document.removeEventListener('keydown', onKey); detachDrop(); if(c0) c0(); }; }
}

const debounces = {};
 const debounce = (k, fn, ms=400) => { clearTimeout(debounces[k]); debounces[k] = setTimeout(fn, ms); };

export { renderEditor, debounces, debounce };
