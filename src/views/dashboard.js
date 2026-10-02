import { newShareKey } from '../core/links.js';
import { pdfImport } from '../media/pdfimport.js';
import { trashInstr } from '../core/trash.js';
import { cachedUrl, cacheDel, cacheList, cacheMedia, cachePut } from '../core/viewcache.js';
import { installTop, linkNote } from '../app/pwa.js';
import { go, render } from '../app/router.js';
import { realSteps } from '../core/auth.js';
import { $$, confirmM, el, esc, modal, promptM, toast } from '../core/helpers.js';
import { fmtD, fmtDate, t } from '../core/i18n.js';
import { deleteInstr, pwDialog, saveInstr } from '../core/passwords.js';
import { duplicateInstr } from '../core/duplicate.js';
import { progressBox } from '../media/import.js';
// v12.47: a line about the plan: trial/demo with days left, expired, or suspended. Nothing for active workspaces.
function planBanner(){
  const w = S.wsRow || {}; const plan = w.plan || 'active'; if(plan === 'active') return null;
  const until = w.planUntil ? new Date(w.planUntil) : null; const days = until ? Math.ceil((until - Date.now()) / 864e5) : null;
  if(plan === 'suspended') return el(`<div class="plan-banner bad">${IC.warn} <div><b>${t('plan_suspended')}</b><span>${t('plan_suspended_sub')}</span></div></div>`);
  const label = plan === 'demo' ? t('plan_demo') : t('plan_trial');
  if(days != null && days <= 0) return el(`<div class="plan-banner warn">${IC.warn} <div><b>${t('plan_expired', {p: label})}</b><span>${t('plan_expired_sub')}</span></div></div>`);
  const soon = days != null && days <= 7;
  return el(`<div class="plan-banner ${soon ? 'warn' : ''}">${IC.checkc} <div><b>${days != null ? t('plan_days', {p: label, n: days}) : label}</b><span>${t('plan_trial_sub')}</span></div></div>`);
}
// v12.48: put instructions on this device (instruction + clips, photos, logo, symbols) – for a tablet at the line that has to work
// without network; the same copy serves the worker link. Replaces the language globe on the cards, which only showed a system detail.
async function makeOffline(list){
  if(!online()){ toast(t('off_needs_net')); return; }
  const prog = progressBox(t('off_make')); let k = 0, failed = 0; const brand = Object.assign({}, await loadBrand(S.user.ws));
  try{ for(const i of list){ k++; prog.set(list.length > 1 ? `${k} / ${list.length} · ${i.title}` : i.title, (k-1)/list.length, '');
      await cachePut(i, brand); const r = await cacheMedia(i, brand, p => prog.set(null, ((k-1) + (p.total ? p.done/p.total : 1))/list.length, t('off_saving', {n:p.done, total:p.total}))); failed += r.failed || 0; }
  }finally{ prog.remove(); }
  toast(failed ? t('off_partial', {n:failed}) : (list.length > 1 ? t('off_ready_n', {n:list.length}) : t('off_ready')));
}
// v12.47: copy an instruction (files are copied inside the bucket – a progress box while that runs), then open the copy
async function duplicateWithProgress(i){ const prog = progressBox(t('duplicate')); prog.set(i.title, 0, ''); try{ const c = await duplicateInstr(i, (done, total) => prog.set(null, total ? done/total : 1, total ? t('dup_busy', {n:done, total}) : '')); prog.remove(); toast(t('dup_done')); go('edit/'+c.id); }catch(e){ prog.remove(); toast(e.message||String(e)); } }
import { titleHtml } from '../core/richtext.js';
import { online } from '../core/offline.js';
import { G, S, loadBrand, mediaUrl } from '../core/state.js';
import { uid } from '../core/storage.js';
import { canSee, folderName, instrTeams, saveWs, teamsOf } from '../core/workspace.js';
import { can, canAny, canApproveAny, canIn, normRole, roleIcon } from '../core/roles.js';
import { posterDialog } from '../pdf/poster.js';
import { IC } from '../ui/icons.js';
import { topbar } from '../ui/topbar.js';
import { flowSticky } from '../ui/flowsticky.js';
import { brandModal } from './branding.js';
import { exportPDFAsk, shareModal } from './share.js';


/* ---------- Dashboard ---------- */
const roleLbl = r => r==='admin' ? t('role_admin') : `${roleIcon(r)} ${t('r_'+normRole(r))}`.trim();

const nOf = (n, one, many) => `${n} ${t(n===1 ? one : many)}`;

const initials = n => String(n||'?').trim().split(/\s+/).slice(0,2).map(x => x[0]||'').join('').toUpperCase() || '?';

const visFolders = () => (S.wsRow.folders||[]).filter(f => S.user.isAdmin || !(f.teams||[]).length || teamsOf().some(tm => (f.teams||[]).includes(tm.id)));

const isLoose = i => !i.folder || !(S.wsRow.folders||[]).find(f=>f.id===i.folder);

// teams a person works with: admins see every team, everyone else only the teams they are in (other teams' names stay hidden)
const myTeamList = () => S.user.isAdmin ? (S.wsRow.teams||[]) : teamsOf();
const teamNamesOf = ids => (ids||[]).map(tid => (myTeamList().find(x=>x.id===tid)||{}).name).filter(Boolean);

async function newFolderDlg(){
  const teams = myTeamList();
  const r = await modal(`<h2>${t('new_folder')}</h2><div class="field"><label for="nf-name">${t('folder_name')}</label><input id="nf-name" placeholder="${t('folder_ph')}" autocomplete="off"></div>
    ${teams.length ? `<div class="lbl" style="margin-bottom:6px">${t('folder_who')}</div><label class="opt"><input type="radio" name="nf-v" value="all" checked> ${t('folder_who_all')}</label><label class="opt"><input type="radio" name="nf-v" value="teams"> ${t('folder_who_teams')}</label><div class="nf-teams" id="nf-teams" hidden>${teams.map(tm => `<label class="opt"><input type="checkbox" value="${tm.id}"> ${esc(tm.name)}</label>`).join('')}</div><p class="muted" style="font-size:12.5px;margin:6px 0 0">${t('folder_who_sub')}</p>` : ''}
    <div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${t('create')}</button></div>`, (bg, close) => {
      const inp = bg.querySelector('#nf-name'); setTimeout(() => inp.focus(), 60);
      $$('input[name="nf-v"]', bg).forEach(x => x.onchange = () => { const box = bg.querySelector('#nf-teams'); if(box) box.hidden = bg.querySelector('input[name="nf-v"]:checked').value !== 'teams'; });
      const ok = () => { const name = inp.value.trim(); if(!name){ inp.focus(); return; } const sel = bg.querySelector('input[name="nf-v"]:checked'); const tids = sel && sel.value === 'teams' ? $$('#nf-teams input:checked', bg).map(x => x.value) : []; close({name, teams: tids}); };
      bg.querySelector('[data-ok]').onclick = ok; inp.addEventListener('keydown', e => { if(e.key==='Enter') ok(); }); bg.querySelector('[data-x]').onclick = () => close(null); });
  if(!r) return null; const f = {id:uid(), name:r.name, teams:r.teams||[]}; await saveWs({folders:[...(S.wsRow.folders||[]), f]}); return f; }

// new instruction: start empty with a title – or let the AI build the steps from an existing PDF work instruction
async function newInstrDlg(folderId){
  const folders = visFolders(); const cur = folderId && folderId!=='none' ? folderId : '';
  const r = await modal(`<h2>${t('new_instr')}</h2><div class="field"><label for="ni-t">${t('title')}</label><input id="ni-t" placeholder="${t('new_title_ph')}"></div>
    ${folders.length ? `<div class="field"><label for="ni-f">${t('pick_project')}</label><select id="ni-f"><option value="">${t('no_folder')}</option>${folders.map(f => `<option value="${f.id}" ${f.id===cur?'selected':''}>${esc(f.name)}</option>`).join('')}</select></div>` : ''}
    <div class="actions" style="margin-top:0"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${IC.cam} ${t('ni_empty')}</button></div>
    <div class="ni-or"><span>${t('or')}</span></div><button class="ni-pdf" data-pdf><span class="ni-pdf-ico">${IC.pdf}</span><span><b>${t('ni_pdf')}</b><small>${t('ni_pdf_sub')}</small></span><span class="ni-ai">${t('ai_badge')}</span></button>`, (bg, close) => {
      const inp = bg.querySelector('#ni-t'); setTimeout(() => inp.focus(), 60); const fid = () => { const sel = bg.querySelector('#ni-f'); return sel ? sel.value : cur; };
      bg.querySelector('[data-x]').onclick = () => close(null); bg.querySelector('[data-ok]').onclick = () => close({title: inp.value, fid: fid()}); inp.addEventListener('keydown', e => { if(e.key==='Enter') close({title: inp.value, fid: fid()}); });
      bg.querySelector('[data-pdf]').onclick = () => close({pdf: true, fid: fid()}); });
  if(!r) return; if(r.pdf) return pdfImport(r.fid || null);
  // v12.48: the camera opens at once – the instruction is in memory and on the device right away, the server copy follows in the
  // background (offline it waits in the queue). Before, the first save waited for the network (up to 30 s in airplane mode)
  if(G.creatingInstr && Date.now() - G.creatingInstr < 2000) return; G.creatingInstr = Date.now();
  const title = r.title; const i = {id:uid(), ws:S.user.ws, title:(title.trim()||t('untitled')), shareKey:newShareKey(), createdBy:S.user.name, createdAt:Date.now(), updatedAt:Date.now(), status:'draft', version:0, approvals:{tech:null,dsgvo:null}, checklist:false, steps:[], history:[]}; if(r.fid) i.folder = r.fid;
  saveInstr(i).catch(() => {}); go('rec/'+i.id); }

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
  const st = realSteps(i); const first = st.find(x => x.mediaId) || st[0]; const fname = opts.showFolder ? folderName(i.folder) : '';
  const cEdit = can(i, 'edit'), cLinks = can(i, 'links'), cStats = can(i, 'analytics') || cEdit, cApprove = can(i, 'approve_tech') || can(i, 'approve_dsgvo'); // v12.39: capabilities instead of one role
  const card = el(`<article class="card instr st-${i.status}" data-sid="${i.id}">
    <img class="thumb" alt="" src="" loading="lazy" decoding="async">
    <div class="ibody"><div class="title">${titleHtml(i.title)} ${i.example?`<span class="example-tag">${t('example')}</span>`:''}</div>
      <div class="meta"><span class="chip dot ${i.status}">${t(i.status==='review'?'in_review':i.status)}</span><span class="tnum">${nOf(st.length,'step','steps')}</span><span>${fmtD(i.updatedAt)}</span>${fname?`<span class="fold">${IC.folder} ${esc(fname)}</span>`:''}${i.checklist?`<span title="${G.LANG==='de'?'Checkliste':'Checklist'}">☑</span>`:''}<span class="stx" data-stx="${i.id}">${statChips(i.id, statMap)}</span>${opts.offline && opts.offline.has(i.id) ? `<span class="offmark" title="${t('off_on_device')}">${IC.download} ${t('offline_short')}</span>` : ''}</div></div>
    <button class="imore" data-a="more" title="${t('more')}">${IC.more}</button></article>`);
  if(first){ const known = stepPosterSync(first); if(known) card.querySelector('.thumb').src = known; else stepPoster(first).then(u => { if(u) card.querySelector('.thumb').src = u; }); }
  const act = async a => {
    if(a==='rec') go('rec/'+i.id); else if(a==='edit') go('edit/'+i.id); else if(a==='preview') go('preview/'+i.id); else if(a==='share') shareModal(i); else if(a==='pdf') exportPDFAsk(i); else if(a==='results') go('results/'+i.id); else if(a==='folder') moveToFolderDlg(i, opts.onChange);
    else if(a==='feedback'){ try{ sessionStorage.setItem('gg_rtab_'+i.id, 'feedback'); }catch(e){} go('results/'+i.id); }
    else if(a==='dup'){ await duplicateWithProgress(i); }
    else if(a==='offline'){ await makeOffline([i]); if(opts.onChange) opts.onChange(); }
    else if(a==='offdel'){ await cacheDel(i.id); toast(t('off_removed')); if(opts.onChange) opts.onChange(); }
    else if(a==='del'){ if(await confirmM(t('confirm_del_instr',{t:i.title}), t('delete'))){ try{ await trashInstr(i); toast(t('trashed_instr')); }catch(e){ toast(e.message||String(e)); } render(); } } };
  card.onclick = e => { const b = e.target.closest('[data-a]');
    if(!b){ if(e.target.closest('a, button')) return; act(cEdit || (cApprove && i.status==='review') ? 'edit' : 'preview'); return; }
    const a = b.dataset.a;
    if(a==='more'){ modal(`<div class="menu"><div class="menu-h">${esc(i.title)}</div>${cEdit ? `<button data-m="edit">${IC.edit} ${t('edit')}</button><button data-m="rec">${IC.cam} ${t('record_next')}</button>`:''}${!cEdit && cApprove ? `<button data-m="edit">${IC.check} ${t('menu_approve')}</button>`:''}<button data-m="preview">${IC.play} ${t('preview')}</button>${cLinks ? `<button data-m="share">${IC.share} ${t('share')}</button>`:''}${cEdit || cLinks ? `<button data-m="pdf">${IC.pdf} ${t('pdf')}</button>`:''}${cStats ? `<button data-m="results">${IC.eye} ${t('stats')}</button>`:''}<button data-m="offline">${IC.download} ${opts.offline && opts.offline.has(i.id) ? t('off_refresh') : t('off_make')}</button>${opts.offline && opts.offline.has(i.id) ? `<button data-m="offdel">${IC.close} ${t('off_remove')}</button>` : ''}${cEdit ? `<button data-m="folder">${IC.folder} ${t('move_to_folder')}</button><button data-m="dup">${IC.copy} ${t('duplicate')}</button><button data-m="del" class="del">${IC.trash} ${t('delete')}</button>`:''}</div>`, (bg, close) => { $$('[data-m]', bg).forEach(x => x.onclick = () => { close(); act(x.dataset.m); }); }); return; }
    act(a); };
  return card;
}

/* ---------- Dashboard ----------
   v12.42: the navigator on the left is the one block for "where am I": all instructions → teams → the folders of that team
   (scrollable, searchable, empty ones foldable). Above the list: status filter + sort. On the phone the navigator sits behind
   the "scope" button as a sheet. #/ = all instructions · #/p/<id> = one folder · #/p/none = instructions without a folder */
const pubAt = i => i.publishedAt || ((i.history||[]).length ? (i.history[i.history.length-1].at||0) : 0) || ((i.approvals && i.approvals.dsgvo && i.approvals.dsgvo.at) || 0);
const SORTS = {
  upd: (a,b) => (b.updatedAt||0)-(a.updatedAt||0),
  created: (a,b) => (b.createdAt||b.updatedAt||0)-(a.createdAt||a.updatedAt||0),
  pub: (a,b) => pubAt(b)-pubAt(a) || (b.updatedAt||0)-(a.updatedAt||0),
  name: (a,b) => (a.title||'').localeCompare(b.title||'', undefined, {numeric:true, sensitivity:'base'}),
};
async function renderDashboard(app, pid){
  topbar(app, {crumbs: pid ? [{label: t('instructions'), href: ''}, {label: pid==='none' ? t('no_folder') : (folderName(pid) || t('folder'))}] : [{label: t('instructions')}]});
  const visible = S.instrs.filter(canSee); const hiddenN = S.instrs.length - visible.length;
  const isEditor = canAny('edit'); const canProjects = canAny('projects'); // v12.39
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
  // status filter (chips above the list; the "for you" boxes set it too), sort, search
  let stF = ''; try{ stF = sessionStorage.getItem('gg_stf') || ''; }catch(e){} let q = '';
  let sortK = 'upd'; try{ sortK = sessionStorage.getItem('gg_sort') || 'upd'; }catch(e){} if(!SORTS[sortK]) sortK = 'upd';
  const canApprove = canApproveAny();
  const revN = visible.filter(i => i.status==='review' && inTeam(i, teamF) && (can(i, 'approve_tech') || can(i, 'approve_dsgvo'))).length;
  const inFolder = (i, fid) => fid==='all' ? true : fid==='none' ? isLoose(i) : i.folder===fid;
  const cnt = fid => visible.filter(i => inFolder(i, fid) && inTeam(i, teamF)).length;
  const looseN = cnt('none');
  // the team is the top-level filter – it scopes the folders (folder.teams) and the instructions; folders without a team show under "all" and "no team"
  const folderInTeam = (x, tid) => !tid ? true : tid==='none' ? !(x.teams||[]).length : (x.teams||[]).includes(tid);
  const fol = folders.filter(x => folderInTeam(x, teamF)).sort((a,b) => (a.name||'').localeCompare(b.name||'', undefined, {numeric:true, sensitivity:'base'})); const manyF = fol.length > 12;
  // v12.37.1: full-text search – title, chapter names, step titles/descriptions/warnings, creator; several words must all match
  const ftCache = new Map(); const ftOf = i => { const k = i.id+':'+(i.updatedAt||0); let x = ftCache.get(k); if(!x){ x = [i.title, i.createdBy, ...(i.steps||[]).flatMap(st => [st.title, st.desc, st.warn])].filter(Boolean).join(' ').toLowerCase(); ftCache.set(k, x); } return x; };
  const words = () => q.split(/\s+/).filter(Boolean);
  const matchQ = i => { if(!q) return true; const ft = ftOf(i); return words().every(w => ft.includes(w)); };
  // ---- navigator: all → teams → folders of the team ----
  let fq = ''; let hideEmpty = null; try{ hideEmpty = sessionStorage.getItem('gg_fhide'); }catch(e){} hideEmpty = hideEmpty==null ? fol.length > 20 : hideEmpty==='1';
  const emptyCount = () => fol.filter(x => !cnt(x.id) && x.id!==pid).length;
  // v12.48: long lists show 40 folders and a "show all" – a search always finds every folder
  let navAll = false; const NAV_SHOW = 40;
  let coll = {}; try{ coll = JSON.parse(localStorage.getItem('gg_nav_coll') || '{}') || {}; }catch(e){}
  const isColl = k => k==='teams' ? (coll.teams != null ? coll.teams : (tl.length > 6 && !teamF)) : !!coll[k];
  const folderRows = () => { const shown = fol.filter(x => x.id===pid || (fq ? x.name.toLowerCase().includes(fq) : (!hideEmpty || cnt(x.id) > 0))); const lim = fq || navAll ? 1000 : NAV_SHOW; const more = Math.max(0, shown.length - lim);
    return `${shown.slice(0, lim).map(x => `<a class="dn-row ${pid===x.id?'on':''}" href="#/p/${x.id}" data-f="${x.id}">${IC.folder}<span>${esc(x.name)}${x.pw?' 🔒':''}</span><b>${cnt(x.id)}</b></a>`).join('')}${looseN && !fq ? `<a class="dn-row ${pid==='none'?'on':''}" href="#/p/none" data-f="none">${IC.folder}<span>${t('no_folder')}</span><b>${looseN}</b></a>`:''}${more ? `<button class="flink dn-foot" data-navall>${t('folders_all', {n: shown.length})}</button>` : ''}${fq && !shown.length ? `<div class="dn-note">${t('no_result')}</div>` : ''}`; };
  let tq = ''; const teamRows = () => tl.filter(tm => !tq || (tm.name||'').toLowerCase().includes(tq)).map(tm => `<button class="dn-row ${teamF===tm.id?'on':''}" data-t="${tm.id}">${IC.users||''}<span>${esc(tm.name)}</span><b>${teamCnt(tm.id)}</b></button>`).join('') + (!tq ? `<button class="dn-row ${teamF==='none'?'on':''}" data-t="none">${IC.users||''}<span>${t('team_none')}</span><b>${teamCnt('none')}</b></button>` : '');
  const hideBtn = () => { const n = emptyCount(); return fol.length > 8 && n ? `<button class="flink dn-foot" id="fhide">${hideEmpty ? t('folders_show_empty', {n}) : t('folders_hide_empty', {n})}</button>` : ''; };
  const teamCnt = tid => visible.filter(i => inTeam(i, tid)).length;
  // "all instructions" also clears the team; a team row scopes folders and instructions to that team
  const navHtml = () => `<button class="dn-row top ${!pid && !teamF ? 'on':''}" data-t="" data-nav="all">${IC.grid}<span>${t('nav_all')}</span><b>${visible.length}</b></button>
    ${folders.length || canProjects ? `<section class="dn-sec ${isColl('folders')?'coll':''}" data-sec="folders"><div class="dn-h"><button class="dn-tg" data-tg="folders" aria-expanded="${!isColl('folders')}">${IC.down}<span>${t('folders_h')}</span> <b>${fol.length}</b></button><button class="dn-info" data-info="folders" title="${t('nav_info')}">?</button>${canProjects?`<button class="dn-add" data-fadd title="${t('new_folder')}">${IC.plus}</button>`:''}</div>
      <div class="dn-body">${fol.length > 8 ? `<label class="dn-search">${IC.search||''}<input data-fq type="search" placeholder="${t('folder_search_ph')}" value="${esc(fq)}" autocomplete="off"></label>` : ''}
      <div class="dn-list" data-flist>${folderRows()}</div>${hideBtn()}</div></section>` : ''}
    ${showTeams ? `<section class="dn-sec ${isColl('teams')?'coll':''}" data-sec="teams"><div class="dn-h"><button class="dn-tg" data-tg="teams" aria-expanded="${!isColl('teams')}">${IC.down}<span>${t('team_lbl')}</span> <b>${tl.length}</b></button><button class="dn-info" data-info="teams" title="${t('nav_info')}">?</button></div>
      <div class="dn-body">${tl.length > 8 ? `<label class="dn-search">${IC.search||''}<input data-tq type="search" placeholder="${t('team_search_ph')}" value="${esc(tq)}" autocomplete="off"></label>` : ''}<div class="dn-list" data-tlist>${teamRows()}</div></div></section>` : ''}`;
  const teamName = tid => tid==='none' ? t('team_none') : ((tl.find(x => x.id===tid)||{}).name || '');
  const scopeLabel = () => f ? f.name : teamF ? teamName(teamF) : t('nav_all');
  const teamNames = f ? teamNamesOf(f.teams) : [];
  // ---- "for you": approvals waiting, open feedback ----
  const fbCount = () => visible.filter(i => inTeam(i, teamF) && statMap[i.id] && statMap[i.id].fb).length;
  const inboxHtml = () => { const fbN = fbCount(); const items = [];
    if(revN && canApprove) items.push(`<button class="ibx ${stF==='review'?'on':''}" id="todo">${IC.check}<span>${revN===1?t('todo_review_one'):t('todo_review_many',{n:revN})}</span><b>${stF==='review' ? '×' : '→'}</b></button>`);
    if(fbN) items.push(`<button class="ibx ${stF==='fb'?'on':''}" id="todo-fb">${IC.msg}<span>${fbN===1?t('inbox_fb_one'):t('inbox_fb_many',{n:fbN})}</span><b>${stF==='fb' ? '×' : '→'}</b></button>`);
    return items.length ? `<span class="tlbl">${t('inbox_h')}</span>${items.join('')}` : ''; };
  // ---- list toolbar: status chips + sort ----
  const scopeRows = () => visible.filter(i => (q ? true : inFolder(i, f ? f.id : 'all')) && inTeam(i, teamF) && matchQ(i));
  const stCnt = st => scopeRows().filter(i => st==='fb' ? !!(statMap[i.id] && statMap[i.id].fb) : i.status===st).length;
  const chipsHtml = () => { const base = scopeRows(); const c = st => base.filter(i => i.status===st).length; const fbN = base.filter(i => statMap[i.id] && statMap[i.id].fb).length;
    const chip = (k, lbl, n) => `<button class="lch ${stF===k?'on':''}" data-st="${k}">${lbl}${n!=null?`<b>${n}</b>`:''}</button>`;
    return chip('', t('st_all'), base.length) + chip('draft', t('draft'), c('draft')) + chip('review', t('in_review'), c('review')) + chip('published', t('published'), c('published')) + (fbN || stF==='fb' ? chip('fb', t('st_fb'), fbN) : ''); };
  // v12.48: what is filtered right now, each with a ✕ – and one "reset" (before, a team picked in the list stayed invisible once the list scrolled)
  const activeHtml = () => { const items = [];
    if(f) items.push(`<button class="afc" data-clr="folder">${IC.folder}<span>${esc(f.name)}</span>${IC.close}</button>`);
    if(teamF) items.push(`<button class="afc" data-clr="team">${IC.users||''}<span>${esc(teamName(teamF))}</span>${IC.close}</button>`);
    if(stF) items.push(`<button class="afc" data-clr="status"><span>${stF==='fb' ? t('st_fb') : t(stF==='review' ? 'in_review' : stF)}</span>${IC.close}</button>`);
    if(q) items.push(`<button class="afc" data-clr="q">${IC.search||''}<span>„${esc(q)}“</span>${IC.close}</button>`);
    return items.length ? `<span class="tlbl">${t('filter_active')}</span>${items.join('')}${items.length > 1 ? `<button class="flink" data-clr="all">${t('filter_reset')}</button>` : ''}` : ''; };
  const v = el(`<main class="page dash">
    <div id="inst-slot"></div>
    <div class="inbox" id="inbox">${inboxHtml()}</div>
    <div class="dash-head"><div class="dash-title">${f ? `<div class="eyebrow">${IC.folder} ${t('folder')}</div>` : ''}<h1>${f ? esc(f.name) : t('dash_h1')}${f && f.id!=='none' && canIn(f.teams, 'projects') ? `<button class="pen-btn" id="fren" title="${t('rename_folder')}">${IC.edit}</button>`:''}</h1>${!f ? `<p class="dash-sub">${[nOf(visible.length,'instruction','instructions'), showTeams ? nOf(tl.length,'team','teams') : '', folders.length ? nOf(folders.length,'folder','folders') : ''].filter(Boolean).join(' · ')}</p>` : ''}</div></div>
    <div class="dash-bar">${isEditor ? `<button class="btn primary" id="new">${IC.plus} ${t('new_instr')}</button>`:''}<label class="searchwrap">${IC.search || ''}<input class="search" id="q" type="search" placeholder="${t('search_ph')}" autocomplete="off"></label></div>
    <div class="dash-body ${showTeams || folders.length || canProjects ? 'with-nav' : ''}">
      ${showTeams || folders.length || canProjects ? `<aside class="dnav" id="dnav">${navHtml()}</aside>` : ''}
      <section class="dmain">
        <div class="ltools" id="ltools"><button class="scope" id="scope">${IC.folder}<span>${esc(scopeLabel())}</span>${IC.down||'▾'}</button><div class="lchips" id="lchips">${chipsHtml()}</div><label class="lsort">${t('sort_lbl')}<select id="sort">${[['upd', t('sort_upd')], ['created', t('sort_created')], ['pub', t('sort_pub')], ['name', t('sort_name')]].map(([k, l]) => `<option value="${k}" ${sortK===k?'selected':''}>${l}</option>`).join('')}</select></label></div>
        <div class="afilters" id="afilters">${activeHtml()}</div>
        ${f ? `<div class="fhead" id="fhead"><span class="muted">${nOf(cnt(f.id),'instruction','instructions')}${teamNames.length?` · 👥 ${esc(teamNames.join(', '))}`:''}${f.pw?' · 🔒':''}</span>${f.id!=='none' ? `<button class="btn ghost sm" id="fmore">${IC.more} ${t('folder')}</button>`:''}</div>` : ''}
        <div class="list" id="list"></div>
        ${hiddenN?`<p class="muted" style="margin-top:10px;font-size:12px">${t('folder_hidden',{n:hiddenN})}</p>`:''}
      </section>
    </div>
  </main>`);
  app.appendChild(v);
  // v12.47: plan state of the workspace (trial / demo running out, expired, suspended) – set by the platform, shown to everyone
  { const pb = planBanner(); if(pb) v.querySelector('#inst-slot').appendChild(pb); }
  const ln = linkNote(); if(ln) v.querySelector('#inst-slot').appendChild(ln);
  { const top = installTop(); if(top) v.insertBefore(top, v.firstChild); } // v12.47.1: install banner above the page title, every browser start
  const list = v.querySelector('#list');
  // v12.48: which instructions are saved on this device (complete) – a small "offline" mark on their cards
  const offSet = new Set(G.offIds || []);
  cacheList().then(rows => { const ids = rows.filter(r => r.media && !r.media.failed && r.media.done >= r.media.total).map(r => r.id); G.offIds = ids; const same = ids.length === offSet.size && ids.every(x => offSet.has(x)); if(same) return; offSet.clear(); ids.forEach(x => offSet.add(x));
    $$('[data-sid]', list).forEach(card => { const has = offSet.has(card.dataset.sid), mk = card.querySelector('.offmark'); if(has && !mk){ const meta = card.querySelector('.meta'); if(meta) meta.insertAdjacentHTML('beforeend', `<span class="offmark" title="${t('off_on_device')}">${IC.download} ${t('offline_short')}</span>`); } else if(!has && mk) mk.remove(); }); }).catch(() => {});
  const inScope = i => (q ? true : inFolder(i, f ? f.id : 'all')) && inTeam(i, teamF) && (!stF || (stF==='fb' ? !!(statMap[i.id] && statMap[i.id].fb) : i.status===stF)) && matchQ(i);
  function renderList(){
    const rows = visible.filter(inScope).sort(SORTS[sortK]); list.innerHTML = '';
    if(!rows.length){
      if(q || stF) list.innerHTML = `<div class="card empty"><h2>${t('no_result')}</h2>${stF ? `<button class="btn ghost sm" style="margin-top:12px" data-clearst>${t('st_clear')}</button>` : ''}</div>`;
      else if(f) list.innerHTML = `<div class="card empty"><h2>${t('empty_title')}</h2><div>${t('empty_project')}</div>${isEditor?`<button class="btn mint" style="margin-top:14px" data-new>${IC.plus} ${t('new_instr')}</button>`:''}</div>`;
      else list.innerHTML = `<div class="card empty"><h2>${t('empty_title')}</h2><div>${t('empty_sub')}</div>${isEditor?`<button class="btn mint" style="margin-top:14px" data-new>${IC.plus} ${t('new_instr')}</button>`:''}</div>`;
      const nb = list.querySelector('[data-new]'); if(nb) nb.onclick = () => newInstrDlg(pid); const cs = list.querySelector('[data-clearst]'); if(cs) cs.onclick = () => setSt(''); return; }
    // v12.38: 40 cards at a time – 1000+ cards with a thumbnail each froze the page; more follow when the end scrolls into view (or on tap)
    const PAGE = 40; let shown = 0; const opts = {showFolder: (!f || !!q) && folders.length > 0, onChange: render, offline: offSet};
    const more = el(`<div class="lmore" id="lmore"><button class="btn ghost" id="lmore-btn"></button></div>`);
    const addPage = () => { const slice = rows.slice(shown, shown + PAGE); slice.forEach(i => list.insertBefore(instrCard(i, statMap, opts), more)); shown += slice.length;
      const left = rows.length - shown; if(left > 0){ more.querySelector('#lmore-btn').textContent = t('list_more', {n: Math.min(left, PAGE), total: left}); more.hidden = false; } else more.remove(); };
    list.appendChild(more); more.querySelector('#lmore-btn').onclick = addPage; addPage();
    if('IntersectionObserver' in window){ const io = new IntersectionObserver(es => { if(es.some(x => x.isIntersecting)){ if(!more.isConnected){ io.disconnect(); return; } addPage(); } }, {rootMargin:'600px'}); io.observe(more); }
  }
  const redrawChips = () => { const lc = v.querySelector('#lchips'); if(lc){ lc.innerHTML = chipsHtml(); wireChips(); } };
  const redrawActive = () => { const af = v.querySelector('#afilters'); if(!af) return; af.innerHTML = activeHtml(); wireActive(); };
  const setTeam = tid => { try{ sessionStorage.setItem('gg_team', tid); }catch(e){} G.lastRoute = null; window.scrollTo(0, 0); if(pid && tid) go(''); else render(); }; // a new filter starts at the top
  const wireActive = () => $$('#afilters [data-clr]', v).forEach(b => b.onclick = () => { const k = b.dataset.clr;
    if(k==='status') setSt(''); else if(k==='q'){ const qi2 = v.querySelector('#q'); if(qi2) qi2.value = ''; q = ''; redrawChips(); redrawActive(); renderList(); } else if(k==='team') setTeam(''); else if(k==='folder') go('');
    else { try{ sessionStorage.setItem('gg_stf', ''); sessionStorage.setItem('gg_team', ''); }catch(e){} G.lastRoute = null; if(pid) go(''); else render(); } });
  const setSt = k => { stF = k; try{ sessionStorage.setItem('gg_stf', stF); }catch(e){} redrawChips(); redrawActive(); const ib = v.querySelector('#inbox'); if(ib){ ib.innerHTML = inboxHtml(); wireInbox(); } renderList(); };
  const wireChips = () => $$('#lchips [data-st]', v).forEach(b => b.onclick = () => setSt(stF===b.dataset.st ? '' : b.dataset.st));
  renderList(); wireChips(); wireActive();
  const nb = v.querySelector('#new'); if(nb) nb.onclick = () => newInstrDlg(pid);
  const qi = v.querySelector('#q'); if(qi) qi.oninput = () => { q = qi.value.trim().toLowerCase(); redrawChips(); redrawActive(); renderList(); };
  const so = v.querySelector('#sort'); if(so) so.onchange = () => { sortK = so.value; try{ sessionStorage.setItem('gg_sort', sortK); }catch(e){} renderList(); };
  const wireInbox = () => { const td = v.querySelector('#todo'); if(td) td.onclick = () => setSt(stF==='review' ? '' : 'review');
    const tf = v.querySelector('#todo-fb'); if(tf) tf.onclick = () => setSt(stF==='fb' ? '' : 'fb'); };
  wireInbox(); G.onStats = () => { const ib = v.querySelector('#inbox'); if(ib){ ib.innerHTML = inboxHtml(); wireInbox(); } redrawChips(); if(stF==='fb') renderList(); };
  // navigator – on the page (PC) and, on the phone, in a sheet behind the scope button; both share the markup and the wiring
  const wireNav = (root, close) => {
    $$('[data-t]', root).forEach(b => b.onclick = () => { if(close) close(); setTeam(b.dataset.t); });
    $$('[data-tg]', root).forEach(b => b.onclick = () => { const k = b.dataset.tg; coll[k] = !isColl(k); try{ localStorage.setItem('gg_nav_coll', JSON.stringify(coll)); }catch(e){} const sec = b.closest('.dn-sec'); if(sec) sec.classList.toggle('coll', isColl(k)); b.setAttribute('aria-expanded', String(!isColl(k))); });
    $$('[data-info]', root).forEach(b => b.onclick = () => modal(`<h2>${t(b.dataset.info==='teams' ? 'team_lbl' : 'folders_h')}</h2><p class="muted" style="margin:0 0 14px;line-height:1.55">${t(b.dataset.info==='teams' ? 'nav_teams_info' : 'nav_folders_info')}</p><div class="actions"><button class="btn" data-x>${t('close')}</button></div>`, (bg, c2) => { bg.querySelector('[data-x]').onclick = () => c2(); }));
    const na = root.querySelector('[data-navall]'); if(na) na.onclick = () => { navAll = true; redrawNav(root, close); };
    const ti = root.querySelector('[data-tq]'); if(ti) ti.oninput = () => { tq = ti.value.trim().toLowerCase(); const tlst = root.querySelector('[data-tlist]'); if(tlst){ tlst.innerHTML = teamRows(); $$('[data-t]', tlst).forEach(b => b.onclick = () => { if(close) close(); setTeam(b.dataset.t); }); } };
    $$('a[data-f]', root).forEach(a => a.addEventListener('click', () => { if(close) close(); }));
    const fa = root.querySelector('[data-fadd]'); if(fa) fa.onclick = async () => { const nf = await newFolderDlg(); if(nf){ if(close) close(); go('p/'+nf.id); } };
    const fh = root.querySelector('#fhide'); if(fh) fh.onclick = () => { hideEmpty = !hideEmpty; try{ sessionStorage.setItem('gg_fhide', hideEmpty ? '1' : '0'); }catch(e){} redrawNav(root); };
    const fi = root.querySelector('[data-fq]'); if(fi){ let tm = 0; fi.oninput = () => { fq = fi.value.trim().toLowerCase(); clearTimeout(tm); tm = setTimeout(() => { const fl = root.querySelector('[data-flist]'); if(fl){ fl.innerHTML = folderRows(); $$('a[data-f]', fl).forEach(a => a.addEventListener('click', () => { if(close) close(); })); const na2 = fl.querySelector('[data-navall]'); if(na2) na2.onclick = () => { navAll = true; redrawNav(root, close); }; } const hb = root.querySelector('#fhide'); if(hb) hb.outerHTML = hideBtn(); const hb2 = root.querySelector('#fhide'); if(hb2) hb2.onclick = fh ? fh.onclick : null; }, 80); }; }
  };
  const redrawNav = (root, close) => { const st = root.scrollTop; root.innerHTML = navHtml(); wireNav(root, close); root.scrollTop = st; const fi = root.querySelector('[data-fq]'); if(fi && fq){ fi.focus(); fi.setSelectionRange(fq.length, fq.length); } };
  const nav = v.querySelector('#dnav'); if(nav){ wireNav(nav); // v12.49: the navigator moves with the page (no scroll box of its own)
    const fs = flowSticky(nav, () => 74, {media:'(min-width:901px)'}); const c0 = G.activeCleanup; G.activeCleanup = () => { fs.destroy(); if(c0) c0(); }; }
  const sc = v.querySelector('#scope'); if(sc) sc.onclick = () => modal(`<div class="dnav sheet" id="dnav-sheet"></div>`, (bg, close) => { const root = bg.querySelector('#dnav-sheet'); root.innerHTML = navHtml(); wireNav(root, close); });
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
    const fm = v.querySelector('#fmore'); if(fm) fm.onclick = () => modal(`<div class="menu"><div class="menu-h">${esc(f.name)}</div><button data-m="poster">${IC.qr} ${t('poster')}</button><button data-m="offline">${IC.download} ${t('off_make_folder', {n: rows().length})}</button>${canIn(f.teams, 'projects')?`<button data-m="rename">${IC.edit} ${t('rename_folder')}</button><button data-m="pw">${f.pw?'🔒':'🔓'} ${t('link_pw')}</button><button data-m="del" class="del">${IC.trash} ${t('del_folder')}</button>`:''}</div>`, (bg, close) => { $$('[data-m]', bg).forEach(b => b.onclick = () => { close(); const m = b.dataset.m; if(m==='poster') posterDialog(f, rows()); else if(m==='offline') makeOffline(rows()).then(render); else if(m==='rename') doRename(); else if(m==='pw') doPw(); else doDel(); }); });
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

export { makeOffline, duplicateWithProgress, roleLbl, nOf, initials, visFolders, isLoose, newFolderDlg, newInstrDlg, moveToFolderDlg, instrCard, renderDashboard, posterCache, stepPoster, stepPosterSync, grabFrame, posterFromCanvas };
