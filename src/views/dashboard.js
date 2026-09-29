import { newShareKey } from '../core/links.js';
import { pdfImport } from '../media/pdfimport.js';
import { trashInstr } from '../core/trash.js';
import { cachedUrl } from '../core/viewcache.js';
import { installBanner, installNote, linkNote } from '../app/pwa.js';
import { go, render } from '../app/router.js';
import { realSteps } from '../core/auth.js';
import { $$, confirmM, el, esc, modal, promptM, toast } from '../core/helpers.js';
import { fmtD, fmtDate, t } from '../core/i18n.js';
import { deleteInstr, pwDialog, saveInstr } from '../core/passwords.js';
import { titleHtml } from '../core/richtext.js';
import { online } from '../core/offline.js';
import { G, S, mediaUrl } from '../core/state.js';
import { uid } from '../core/storage.js';
import { canSee, effRole, folderName, instrTeams, saveWs, teamsOf } from '../core/workspace.js';
import { posterDialog } from '../pdf/poster.js';
import { IC } from '../ui/icons.js';
import { topbar } from '../ui/topbar.js';
import { brandModal } from './branding.js';
import { exportPDFAsk, shareModal } from './share.js';


/* ---------- Dashboard ---------- */
const roleLbl = r => r==='admin' ? t('role_admin') : r==='reviewer' ? t('approver') : t(r||'viewer');

const nOf = (n, one, many) => `${n} ${t(n===1 ? one : many)}`;

const initials = n => String(n||'?').trim().split(/\s+/).slice(0,2).map(x => x[0]||'').join('').toUpperCase() || '?';

const visFolders = () => (S.wsRow.folders||[]).filter(f => S.user.isAdmin || !(f.teams||[]).length || teamsOf().some(tm => (f.teams||[]).includes(tm.id)));

const isLoose = i => !i.folder || !(S.wsRow.folders||[]).find(f=>f.id===i.folder);

// teams a person works with: admins see every team, everyone else only the teams they are in (other teams' names stay hidden)
const myTeamList = () => S.user.isAdmin ? (S.wsRow.teams||[]) : teamsOf();
const teamNamesOf = ids => (ids||[]).map(tid => (myTeamList().find(x=>x.id===tid)||{}).name).filter(Boolean);

async function newFolderDlg(){ const name = await promptM(t('new_folder'), t('folder_ph'), ''); if(!name || !name.trim()) return null; const f = {id:uid(), name:name.trim(), teams:[]}; await saveWs({folders:[...(S.wsRow.folders||[]), f]}); return f; }

// new instruction: start empty with a title – or let the AI build the steps from an existing PDF work instruction
async function newInstrDlg(folderId){
  const folders = visFolders(); const cur = folderId && folderId!=='none' ? folderId : '';
  const r = await modal(`<h2>${t('new_instr')}</h2><div class="field"><label for="ni-t">${t('title')}</label><input id="ni-t" placeholder="${t('new_title_ph')}"></div>
    ${folders.length ? `<div class="field"><label for="ni-f">${t('pick_project')}</label><select id="ni-f"><option value="">${t('no_folder')}</option>${folders.map(f => `<option value="${f.id}" ${f.id===cur?'selected':''}>${esc(f.name)}</option>`).join('')}</select></div>` : ''}
    <div class="actions" style="margin-top:0"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${IC.cam} ${t('ni_empty')}</button></div>
    <div class="ni-or"><span>${t('or')}</span></div><button class="ni-pdf" data-pdf><span class="ni-pdf-ico">${IC.pdf}</span><span><b>${t('ni_pdf')}</b><small>${t('ni_pdf_sub')}</small></span><span class="ni-ai">KI</span></button>`, (bg, close) => {
      const inp = bg.querySelector('#ni-t'); setTimeout(() => inp.focus(), 60); const fid = () => { const sel = bg.querySelector('#ni-f'); return sel ? sel.value : cur; };
      bg.querySelector('[data-x]').onclick = () => close(null); bg.querySelector('[data-ok]').onclick = () => close({title: inp.value, fid: fid()}); inp.addEventListener('keydown', e => { if(e.key==='Enter') close({title: inp.value, fid: fid()}); });
      bg.querySelector('[data-pdf]').onclick = () => close({pdf: true, fid: fid()}); });
  if(!r) return; if(r.pdf) return pdfImport(r.fid || null);
  const title = r.title; const i = {id:uid(), ws:S.user.ws, title:(title.trim()||t('untitled')), shareKey:newShareKey(), createdBy:S.user.name, createdAt:Date.now(), updatedAt:Date.now(), status:'draft', version:0, approvals:{tech:null,dsgvo:null}, checklist:false, steps:[], history:[]}; if(r.fid) i.folder = r.fid; await saveInstr(i); go('rec/'+i.id); }

async function moveToFolderDlg(i, after){
  const r = await modal(`<h2>${t('move_to')}</h2><div class="menu">${visFolders().map(f => `<button data-fid="${f.id}" class="${i.folder===f.id?'cur':''}">${IC.folder} ${esc(f.name)}</button>`).join('')}<button data-fid="" class="${isLoose(i)?'cur':''}">${t('no_folder')}</button><button data-fid="__new">${IC.plus} ${t('new_folder')}</button></div><div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button></div>`, (bg, close) => { $$('[data-fid]', bg).forEach(b => b.onclick = () => close(b.dataset.fid)); bg.querySelector('[data-x]').onclick = () => close(null); });
  if(r===null) return; let fid = r; if(r==='__new'){ const f = await newFolderDlg(); if(!f) return; fid = f.id; }
  i.folder = fid || undefined; await saveInstr(i); toast(t('saved')); if(after) after();
}

// one instruction card (dashboard "all" view + project page)
// views + open feedback of one instruction (patched into the cards when fresh numbers arrive)
const statChips = (id, statMap) => { const s = statMap[id]; if(!s) return ''; return `${s.views?`<span title="${t('views_total')}">${IC.eye} ${s.views}</span>`:''}${s.fb?`<button class="fbchip" data-a="feedback" title="${t('feedback')}">${IC.msg} ${s.fb}</button>`:''}`; };
// v0.30: the instruction is the hero – tap = open, one ⋯ for everything else (before: four buttons on every card)
function instrCard(i, statMap, opts={}){
  const st = realSteps(i); const first = st.find(x => x.mediaId) || st[0]; const role = effRole(i); const fname = opts.showFolder ? folderName(i.folder) : '';
  const card = el(`<article class="card instr st-${i.status}" data-sid="${i.id}">
    <img class="thumb" alt="" src="" loading="lazy" decoding="async">
    <div class="ibody"><div class="title">${titleHtml(i.title)} ${i.example?`<span class="example-tag">${t('example')}</span>`:''}</div>
      <div class="meta"><span class="chip dot ${i.status}">${t(i.status==='review'?'in_review':i.status)}</span><span class="tnum">${nOf(st.length,'step','steps')}</span><span>${fmtD(i.updatedAt)}</span>${fname?`<span class="fold">${IC.folder} ${esc(fname)}</span>`:''}${i.checklist?`<span title="${G.LANG==='de'?'Checkliste':'Checklist'}">☑</span>`:''}<span class="stx" data-stx="${i.id}">${statChips(i.id, statMap)}</span>${Object.keys(i.translations||{}).length?`<span title="${t('translations')}">${IC.globe} ${Object.keys(i.translations).length}</span>`:''}</div></div>
    <button class="imore" data-a="more" title="${t('more')}">${IC.more}</button></article>`);
  if(first){ const known = stepPosterSync(first); if(known) card.querySelector('.thumb').src = known; else stepPoster(first).then(u => { if(u) card.querySelector('.thumb').src = u; }); }
  const act = async a => {
    if(a==='rec') go('rec/'+i.id); else if(a==='edit') go('edit/'+i.id); else if(a==='preview') go('preview/'+i.id); else if(a==='share') shareModal(i); else if(a==='pdf') exportPDFAsk(i); else if(a==='results') go('results/'+i.id); else if(a==='folder') moveToFolderDlg(i, opts.onChange);
    else if(a==='feedback'){ try{ sessionStorage.setItem('gg_rtab_'+i.id, 'feedback'); }catch(e){} go('results/'+i.id); }
    else if(a==='del'){ if(await confirmM(t('confirm_del_instr',{t:i.title}), t('delete'))){ try{ await trashInstr(i); toast(t('trashed_instr')); }catch(e){ toast(e.message||String(e)); } render(); } } };
  card.onclick = e => { const b = e.target.closest('[data-a]');
    if(!b){ if(e.target.closest('a, button')) return; act(role!=='viewer' ? 'edit' : 'preview'); return; }
    const a = b.dataset.a;
    if(a==='more'){ modal(`<div class="menu"><div class="menu-h">${esc(i.title)}</div>${role!=='viewer' ? `<button data-m="edit">${IC.edit} ${t('edit')}</button><button data-m="rec">${IC.cam} ${t('record_next')}</button>`:''}<button data-m="preview">${IC.play} ${t('preview')}</button><button data-m="share">${IC.share} ${t('share')}</button><button data-m="pdf">${IC.pdf} ${t('pdf')}</button><button data-m="results">${IC.eye} ${t('stats')}</button>${role!=='viewer' ? `<button data-m="folder">${IC.folder} ${t('move_to_folder')}</button><button data-m="del" class="del">${IC.trash} ${t('delete')}</button>`:''}</div>`, (bg, close) => { $$('[data-m]', bg).forEach(x => x.onclick = () => { close(); act(x.dataset.m); }); }); return; }
    act(a); };
  return card;
}

/* ---------- Dashboard (v0.30): instructions are the content, folders are a filter row, one ⋯ menu for the tools ----------
   #/ = all instructions · #/p/<id> = one folder (same layout, filtered) · #/p/none = instructions without a folder */
async function renderDashboard(app, pid){
  topbar(app, {back: pid ? '/' : null, sub: pid ? (pid==='none' ? t('no_folder') : (folderName(pid) || t('folder'))) : t('instructions')});
  const visible = S.instrs.filter(canSee); const hiddenN = S.instrs.length - visible.length;
  const isEditor = S.user.role!=='viewer' || S.user.isAdmin;
  const folders = visFolders();
  // views / open feedback never delay the first paint – last known numbers now, both queries in parallel in the background,
  // fresh numbers are patched into the cards
  G.statCache = G.statCache || {}; let statMap = G.statCache[S.user.ws] || {};
  const loadStats = async () => { const m = {}; const [a, b] = await Promise.all([G.sb.from('instr_stats').select('*').eq('ws', S.user.ws), G.sb.from('feedback').select('instr_id,status').eq('ws', S.user.ws).eq('status', 'open')]);
    (a.data||[]).forEach(r => m[r.instr_id] = r); (b.data||[]).forEach(r => { m[r.instr_id] = m[r.instr_id] || {views:0}; m[r.instr_id].fb = (m[r.instr_id].fb||0)+1; }); return m; };
  if(online()) loadStats().then(m => { G.statCache[S.user.ws] = m; if(JSON.stringify(m) === JSON.stringify(statMap)) return; statMap = m; $$('[data-stx]').forEach(el => { el.innerHTML = statChips(el.dataset.stx, statMap); }); if(G.onStats) G.onStats(); }).catch(() => {});
  // the folder in view (if any)
  const f = pid ? (pid==='none' ? {id:'none', name:t('no_folder'), teams:[]} : folders.find(x=>x.id===pid)) : null; if(pid && !f) return go('');
  // team filter – only when there is something to choose (two or more teams this person is in; admins: all teams)
  const tl = myTeamList(); let teamF = ''; try{ teamF = sessionStorage.getItem('gg_team') || ''; }catch(e){}
  if(teamF && teamF!=='none' && !tl.some(x => x.id===teamF)) teamF = '';
  const inTeam = (i, tid) => !tid ? true : tid==='none' ? !instrTeams(i).length : instrTeams(i).includes(tid);
  const showTeams = tl.length >= 2; if(!showTeams) teamF = '';
  // status filter (the "waiting for approval" to-do) and search
  let stF = ''; try{ stF = sessionStorage.getItem('gg_stf') || ''; }catch(e){} let q = '';
  const canApprove = S.user.isAdmin || S.user.role==='reviewer' || S.user.role==='admin';
  const revN = visible.filter(i => i.status==='review' && inTeam(i, teamF)).length; if(!revN && stF==='review') stF = '';
  const inFolder = (i, fid) => fid==='all' ? true : fid==='none' ? isLoose(i) : i.folder===fid;
  const cnt = fid => visible.filter(i => inFolder(i, fid) && inTeam(i, teamF)).length;
  const looseN = cnt('none');
  // v0.36: the team is the top-level filter – it scopes the folders (folder.teams) and the instructions; folders without a team show under "all" and "no team"
  const folderInTeam = (x, tid) => !tid ? true : tid==='none' ? !(x.teams||[]).length : (x.teams||[]).includes(tid);
  const fol = folders.filter(x => folderInTeam(x, teamF)); const manyF = fol.length > 12;
  // v12.37.1: full-text search – title, chapter names, step titles/descriptions/warnings, creator; several words must all match
  const ftCache = new Map(); const ftOf = i => { const k = i.id+':'+(i.updatedAt||0); let x = ftCache.get(k); if(!x){ x = [i.title, i.createdBy, ...(i.steps||[]).flatMap(st => [st.title, st.desc, st.warn])].filter(Boolean).join(' ').toLowerCase(); ftCache.set(k, x); } return x; };
  const words = () => q.split(/\s+/).filter(Boolean);
  const matchQ = i => { if(!q) return true; const ft = ftOf(i); return words().every(w => ft.includes(w)); };
  let fq = ''; let hideEmpty = null; try{ hideEmpty = sessionStorage.getItem('gg_fhide'); }catch(e){} hideEmpty = hideEmpty==null ? fol.length > 20 : hideEmpty==='1';
  const folderChips = () => { const emptyN = fol.filter(x => !cnt(x.id) && x.id!==pid).length; const shown = fol.filter(x => x.id===pid || (!fq || x.name.toLowerCase().includes(fq) || visible.some(i => i.folder===x.id && matchQ(i))) && (!hideEmpty || cnt(x.id) > 0));
    const more = Math.max(0, shown.length - 60); const show = shown.slice(0, 60);
    return `<a class="fch ${!pid?'on':''}" href="#/" data-f="all">${t('all_f')} <span>${cnt('all')}</span></a>${show.map(x => `<a class="fch ${pid===x.id?'on':''}" href="#/p/${x.id}" data-f="${x.id}">${IC.folder} ${esc(x.name)}${x.pw?' 🔒':''} <span>${cnt(x.id)}</span></a>`).join('')}${looseN ? `<a class="fch ${pid==='none'?'on':''}" href="#/p/none" data-f="none">${t('no_folder')} <span>${looseN}</span></a>`:''}${isEditor?`<button class="fch add" id="fadd" title="${t('new_folder')}">${IC.plus}</button>`:''}${more ? `<span class="muted" style="font-size:12.5px">${t('folders_more', {n:more})}</span>` : ''}${manyF && !shown.length && fq ? `<span class="muted">${t('no_result')}</span>` : ''}`; };
  const emptyCount = () => fol.filter(x => !cnt(x.id) && x.id!==pid).length;
  const hideBtn = () => { const n = emptyCount(); return manyF && n ? `<button class="flink" id="fhide">${hideEmpty ? t('folders_show_empty', {n}) : t('folders_hide_empty', {n})}</button>` : ''; };
  // v12.38.2: many folders → two rows visible, the rest folds out (no scrollbar inside a card); a search shows everything that matches
  let fExp = false; try{ fExp = sessionStorage.getItem('gg_fexp')==='1'; }catch(e){}
  const expBtn = () => manyF ? `<button class="flink" id="fexp">${fExp || fq ? t('folders_less') : t('folders_all', {n:fol.length})}</button>` : '';
  const chips = folders.length ? `<div class="fchips ${manyF && !fExp && !fq ? 'collapsed' : ''}" id="fchips">${folderChips()}</div>` : '';
  const teamChips = showTeams ? (tl.length <= 10
    ? `<div class="tfilter" id="tfilter"><span class="tlbl">${t('team_lbl')}</span><button class="fch sm ${!teamF?'on':''}" data-t="">${t('team_filter_all')}</button>${tl.map(tm => `<button class="fch sm ${teamF===tm.id?'on':''}" data-t="${tm.id}">${esc(tm.name)}</button>`).join('')}<button class="fch sm ${teamF==='none'?'on':''}" data-t="none">${t('team_none')}</button></div>`
    : `<div class="tfilter" id="tfilter"><span class="tlbl">${t('team_lbl')}</span><select id="tsel" class="tsel"><option value="">${t('team_filter_all')}</option>${tl.map(tm => `<option value="${tm.id}" ${teamF===tm.id?'selected':''}>${esc(tm.name)}</option>`).join('')}<option value="none" ${teamF==='none'?'selected':''}>${t('team_none')}</option></select></div>`) : '';
  const teamNames = f ? teamNamesOf(f.teams) : [];
  // v12.38: page order = title → (new instruction + search) → "for you" (approvals, feedback) → install → team → folders → list
  const fbCount = () => visible.filter(i => inTeam(i, teamF) && statMap[i.id] && statMap[i.id].fb).length;
  const inboxHtml = () => { const fbN = fbCount(); const items = [];
    if(revN && canApprove) items.push(`<button class="ibx ${stF==='review'?'on':''}" id="todo">${IC.check}<span>${revN===1?t('todo_review_one'):t('todo_review_many',{n:revN})}</span><b>${stF==='review' ? '×' : '→'}</b></button>`);
    if(fbN) items.push(`<button class="ibx ${stF==='fb'?'on':''}" id="todo-fb">${IC.msg}<span>${fbN===1?t('inbox_fb_one'):t('inbox_fb_many',{n:fbN})}</span><b>${stF==='fb' ? '×' : '→'}</b></button>`);
    return items.length ? `<span class="tlbl">${t('inbox_h')}</span>${items.join('')}` : ''; };
  const v = el(`<main class="page dash">
    <div class="dash-head"><div class="dash-title">${f ? `<div class="eyebrow">${IC.folder} ${t('folder')}</div>` : ''}<h1>${f ? esc(f.name) : t('dash_h1')}${f && f.id!=='none' && isEditor ? `<button class="pen-btn" id="fren" title="${t('rename_folder')}">${IC.edit}</button>`:''}</h1>${!f ? `<p class="dash-sub">${[nOf(visible.length,'instruction','instructions'), showTeams ? nOf(tl.length,'team','teams') : '', folders.length ? nOf(folders.length,'folder','folders') : ''].filter(Boolean).join(' · ')}</p>` : ''}</div></div>
    <div class="dash-bar">${isEditor ? `<button class="btn primary" id="new">${IC.plus} ${t('new_instr')}</button>`:''}<label class="searchwrap">${IC.search || ''}<input class="search" id="q" type="search" placeholder="${t('search_ph')}" autocomplete="off"></label></div>
    <div class="inbox" id="inbox">${inboxHtml()}</div>
    <div id="inst-slot"></div>
    ${(teamChips || chips) ? `<section class="filters fpanel ${manyF?'many':''} ${manyF && (fExp || fq) ? 'exp' : ''}" id="filters"><div class="frow">${teamChips || '<span></span>'}<div class="fmeta">${folders.length ? `<span class="tlbl">${t('folders_h')} <b>${fol.length}</b></span>` : ''}${hideBtn()}${expBtn()}</div></div>${chips}</section>` : ''}
    ${f ? `<div class="fhead" id="fhead"><span class="muted">${nOf(cnt(f.id),'instruction','instructions')}${teamNames.length?` · 👥 ${esc(teamNames.join(', '))}`:''}${f.pw?' · 🔒':''}</span>${f.id!=='none' ? `<button class="btn ghost sm" id="fmore">${IC.more} ${t('folder')}</button>`:''}</div>` : ''}
    <div class="list" id="list"></div>
    ${hiddenN?`<p class="muted" style="margin-top:10px;font-size:12px">${t('folder_hidden',{n:hiddenN})}</p>`:''}
  </main>`);
  app.appendChild(v);
  const ln = linkNote(); if(ln) v.querySelector('#inst-slot').appendChild(ln); const ban = ln ? null : installBanner(); if(ban) v.querySelector('#inst-slot').appendChild(ban); const inst = (ln || ban) ? null : installNote(); if(inst) v.querySelector('#inst-slot').appendChild(inst);
  // (no separate "recently edited" row any more – the list itself is sorted by last change)
  const list = v.querySelector('#list');
  const inScope = i => (q ? true : inFolder(i, f ? f.id : 'all')) && inTeam(i, teamF) && (!stF || (stF==='fb' ? !!(statMap[i.id] && statMap[i.id].fb) : i.status===stF)) && matchQ(i);
  function renderList(){
    const rows = visible.filter(inScope).sort((a,b) => (b.updatedAt||0)-(a.updatedAt||0)); list.innerHTML = '';
    if(!rows.length){
      if(q) list.innerHTML = `<div class="card empty"><h2>${t('no_result')}</h2></div>`;
      else if(f) list.innerHTML = `<div class="card empty"><h2>${t('empty_title')}</h2><div>${t('empty_project')}</div>${isEditor?`<button class="btn mint" style="margin-top:14px" data-new>${IC.plus} ${t('new_instr')}</button>`:''}</div>`;
      else list.innerHTML = `<div class="card empty"><h2>${t('empty_title')}</h2><div>${t('empty_sub')}</div>${isEditor?`<button class="btn mint" style="margin-top:14px" data-new>${IC.plus} ${t('new_instr')}</button>`:''}</div>`;
      const nb = list.querySelector('[data-new]'); if(nb) nb.onclick = () => newInstrDlg(pid); return; }
    // v12.38: 40 cards at a time – 1000+ cards with a thumbnail each froze the page; more follow when the end scrolls into view (or on tap)
    const PAGE = 40; let shown = 0; const opts = {showFolder: (!f || !!q) && folders.length > 0, onChange: render};
    const more = el(`<div class="lmore" id="lmore"><button class="btn ghost" id="lmore-btn"></button></div>`);
    const addPage = () => { const slice = rows.slice(shown, shown + PAGE); slice.forEach(i => list.insertBefore(instrCard(i, statMap, opts), more)); shown += slice.length;
      const left = rows.length - shown; if(left > 0){ more.querySelector('#lmore-btn').textContent = t('list_more', {n: Math.min(left, PAGE), total: left}); more.hidden = false; } else more.remove(); };
    list.appendChild(more); more.querySelector('#lmore-btn').onclick = addPage; addPage();
    if('IntersectionObserver' in window){ const io = new IntersectionObserver(es => { if(es.some(x => x.isIntersecting)){ if(!more.isConnected){ io.disconnect(); return; } addPage(); } }, {rootMargin:'600px'}); io.observe(more); }
  }
  renderList();
  const nb = v.querySelector('#new'); if(nb) nb.onclick = () => newInstrDlg(pid);
  const qi = v.querySelector('#q'); if(qi) qi.oninput = () => { q = qi.value.trim().toLowerCase(); fq = q; redrawChips(); renderList(); };
  const wireInbox = () => { const td = v.querySelector('#todo'); if(td) td.onclick = () => { stF = stF==='review' ? '' : 'review'; try{ sessionStorage.setItem('gg_stf', stF); }catch(e){} render(); };
    const tf = v.querySelector('#todo-fb'); if(tf) tf.onclick = () => { stF = stF==='fb' ? '' : 'fb'; try{ sessionStorage.setItem('gg_stf', stF); }catch(e){} render(); }; };
  wireInbox(); G.onStats = () => { const ib = v.querySelector('#inbox'); if(ib){ ib.innerHTML = inboxHtml(); wireInbox(); } if(stF==='fb') renderList(); };
  $$('#tfilter button', v).forEach(b => b.onclick = () => { try{ sessionStorage.setItem('gg_team', b.dataset.t); }catch(e){} render(); });
  const ts = v.querySelector('#tsel'); if(ts) ts.onchange = () => { try{ sessionStorage.setItem('gg_team', ts.value); }catch(e){} render(); };
  const redrawChips = () => { const fc = v.querySelector('#fchips'); if(!fc) return; fc.innerHTML = folderChips(); fc.classList.toggle('collapsed', manyF && !fExp && !fq); const sec = v.querySelector('#filters'); if(sec) sec.classList.toggle('exp', manyF && !!(fExp || fq)); const fh = v.querySelector('#fhide'); if(fh) fh.outerHTML = hideBtn() || '<span hidden id="fhide"></span>'; const fe = v.querySelector('#fexp'); if(fe) fe.outerHTML = expBtn() || '<span hidden id="fexp"></span>'; wireChips(); };
  const wireChips = () => { const fa = v.querySelector('#fadd'); if(fa) fa.onclick = async () => { const nf = await newFolderDlg(); if(nf) go('p/'+nf.id); };
    const fh = v.querySelector('#fhide'); if(fh) fh.onclick = () => { hideEmpty = !hideEmpty; try{ sessionStorage.setItem('gg_fhide', hideEmpty ? '1' : '0'); }catch(e){} redrawChips(); };
    const fe = v.querySelector('#fexp'); if(fe) fe.onclick = () => { fExp = !fExp; try{ sessionStorage.setItem('gg_fexp', fExp ? '1' : '0'); }catch(e){} redrawChips(); }; };
  wireChips();
  if(f && f.id!=='none'){
    const rows = () => visible.filter(i => i.folder===f.id);
    const doRename = async () => { const n = await promptM(t('rename_folder'), t('folder_ph'), f.name); if(!n || !n.trim()) return; f.name = n.trim(); await saveWs({folders:S.wsRow.folders}); render(); };
    const doPw = async () => { const r = await pwDialog(f.name, !!f.pw); if(r===undefined) return; if(r) f.pw = r; else delete f.pw; await saveWs({folders:S.wsRow.folders}); toast(t('saved')); render(); };
    // v12.37.1: a folder with content asks what happens to the instructions – keep them (they drop out of the folder) or move them to the trash too
    const doDel = async () => { const inside = rows(); let withContent = false;
      if(inside.length){ const r = await modal(`<h2>${esc(t('del_folder'))}</h2><p class="muted" style="margin:0 0 14px">${esc(t('del_folder_n',{t:f.name, n:inside.length}))}</p><div class="row wrap"><button class="btn" data-ok="keep">${esc(t('del_folder_keep'))}</button><button class="btn del" data-ok="all">${IC.trash} ${esc(t('del_folder_all',{n:inside.length}))}</button><button class="btn ghost" data-cancel>${esc(t('cancel'))}</button></div>`, (bg, close) => { $$('[data-ok]', bg).forEach(b => b.onclick = () => close(b.dataset.ok)); const c = bg.querySelector('[data-cancel]'); if(c) c.onclick = () => close(null); }); if(!r) return; withContent = r==='all'; }
      else if(!(await confirmM(t('del_folder_q',{t:f.name})))) return;
      if(withContent){ for(const i of inside){ try{ await trashInstr(i); }catch(e){ toast(e.message); return; } } }
      await saveWs({folders:(S.wsRow.folders||[]).filter(x=>x.id!==f.id)}); toast(withContent ? t('del_folder_done_all',{n:inside.length}) : t('del_folder_done')); go(''); };
    const rn = v.querySelector('#fren'); if(rn) rn.onclick = doRename;
    const fm = v.querySelector('#fmore'); if(fm) fm.onclick = () => modal(`<div class="menu"><div class="menu-h">${esc(f.name)}</div><button data-m="poster">${IC.qr} ${t('poster')}</button>${isEditor?`<button data-m="rename">${IC.edit} ${t('rename_folder')}</button><button data-m="pw">${f.pw?'🔒':'🔓'} ${t('link_pw')}</button><button data-m="del" class="del">${IC.trash} ${t('del_folder')}</button>`:''}</div>`, (bg, close) => { $$('[data-m]', bg).forEach(b => b.onclick = () => { close(); const m = b.dataset.m; if(m==='poster') posterDialog(f, rows()); else if(m==='rename') doRename(); else if(m==='pw') doPw(); else doDel(); }); });
  } else if(f && f.id==='none'){ const fm = v.querySelector('#fmore'); if(fm) fm.remove(); }
}

// resolved poster URLs by step (v0.31.2): a redraw of a list sets the image source synchronously – before, every thumbnail waited
// for an IndexedDB lookup and flashed black. Cleared together with posterCache (media replaced / trimmed).
const posterMem = new Map();
class PosterCache extends Map { clear(){ super.clear(); posterMem.clear(); } }
const posterCache = new PosterCache();
const posterKey = step => step.posterUrl ? 'u:'+step.posterUrl : step.poster ? 'p:'+step.id : (step.mediaId ? 'm:'+step.mediaId+':'+(step.trimStart||0) : null);
// the poster if it is already known (string) – otherwise null; callers then fall back to stepPoster()
const stepPosterSync = step => { const k = posterKey(step); return k && posterMem.has(k) ? posterMem.get(k) : null; };

async function stepPoster(step){
  const k = posterKey(step); if(k && posterMem.has(k)) return posterMem.get(k);
  const u = await stepPosterRaw(step); if(u && k) posterMem.set(k, u); return u;
}
async function stepPosterRaw(step){
  if(step.posterUrl) return cachedUrl(step.posterUrl); // small JPEG in Storage (v0.24.1)
  if(step.poster) return step.poster; // legacy: data URL inside the instruction (migrated in the background)
  if(!step.mediaId) return null;
  const key = step.mediaId + ':' + (step.trimStart||0);
  if(posterCache.has(key)) return posterCache.get(key);
  const url = await mediaUrl(step.mediaId); if(!url) return null;
  if(step.type==='photo'){ posterCache.set(key,url); return url; }
  const p = grabFrame(url, step.trimStart||0).then(c => c ? c.toDataURL('image/jpeg', .7) : (step.poster||null)).catch(()=>step.poster||null);
  posterCache.set(key, p); return p;
}

function grabFrame(url, time, maxW=640){
  return new Promise((res) => {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline',''); v.preload='auto'; v.crossOrigin='anonymous'; let done = false;
    const finish = () => { if(done) return; done = true; try{ const s = Math.min(1, maxW/(v.videoWidth||1)); const c = document.createElement('canvas'); c.width = Math.round((v.videoWidth||640)*s); c.height = Math.round((v.videoHeight||480)*s); c.getContext('2d').drawImage(v,0,0,c.width,c.height); res(c); }catch(e){ res(null); } try{ v.pause(); v.removeAttribute('src'); v.load(); }catch(e){} };
    const seek = async () => { try{ await v.play(); }catch(e){} try{ v.pause(); }catch(e){} try{ v.currentTime = Math.max(0.05, time); }catch(e){ finish(); } };
    v.addEventListener('loadedmetadata', seek, {once:true});
    v.addEventListener('seeked', () => setTimeout(finish, 60), {once:true});
    v.addEventListener('error', () => { done = true; res(null); }, {once:true});
    setTimeout(() => { if(!done) finish(); }, 5000);
    v.src = url; try{ v.load(); }catch(e){}
  });
}

const posterFromCanvas = (src, w, h, maxW=320) => { try{ const sc = Math.min(1, maxW/(w||1)); const c = document.createElement('canvas'); c.width = Math.round((w||320)*sc); c.height = Math.round((h||240)*sc); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', .6); }catch(e){ return null; } };

export { roleLbl, nOf, initials, visFolders, isLoose, newFolderDlg, newInstrDlg, moveToFolderDlg, instrCard, renderDashboard, posterCache, stepPoster, stepPosterSync, grabFrame, posterFromCanvas };
