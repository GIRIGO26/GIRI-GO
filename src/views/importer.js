import { newShareKey } from '../core/links.js';
import { go } from '../app/router.js';
import { $$, el, esc, toast } from '../core/helpers.js';
import { fmtD, t } from '../core/i18n.js';
import { sendInvite } from '../core/invite.js';
import { saveInstr } from '../core/passwords.js';
import { uploadPoster } from '../core/posters.js';
import { G, S } from '../core/state.js';
import { uid } from '../core/storage.js';
import { htmlToMd } from '../core/richtext.js';
import { rememberRemote } from '../core/translate.js';
import { saveWs } from '../core/workspace.js';
import { can } from '../core/roles.js';
import { IC } from '../ui/icons.js';
import { topbar } from '../ui/topbar.js';
import { grabFrame, posterFromCanvas } from './dashboard.js';

/* ---------- Import from GIRI Classic (API v2) – v0.32 ----------
   Connect (server + e-mail + password → session token, kept in memory only) → pick projects / instructions → import.
   The edge function "giri-import" talks to the old server and copies binaries server-to-server into Storage; this view
   maps the old structure onto GIRI instructions (chapters, steps, media, step icons → symbols), probes the media for
   size/duration, makes posters and saves each instruction. Runs one instruction at a time, resumable per row. */

const DEFAULT_SERVER = 'https://ar-giri.cloud';
const errText = code => { const c = String(code||''); const m = {
  'classic:INVALID_CREDENTIALS': t('imp_e_cred'), 'classic:UNAUTHORIZED': t('imp_e_session'), 'server_https': t('imp_e_https'), 'server_blocked': t('imp_e_https'),
  'too_large': t('imp_e_large'), 'no_permission': t('only_admin'), 'login_required': t('pdfi_err_login_required') }; return m[c] || (c.startsWith('classic:') ? t('imp_e_server', {e: c.slice(8)}) : c); };

async function call(conn, action, extra){
  const body = Object.assign({action, server: conn.server, token: conn.token}, extra||{});
  const {data, error} = await G.sb.functions.invoke('giri-import', {body});
  if(error){ let code = error.message || 'error'; try{ if(error.context && error.context.json){ const j = await error.context.json(); if(j && j.error) code = j.error; } }catch(e){} throw new Error(errText(code)); }
  if(data && data.error) throw new Error(errText(data.error));
  return data;
}
// tiny concurrency limiter: at most n promises in flight
const pLimit = n => { let active = 0; const q = []; const next = () => { if(active >= n || !q.length) return; active++; const {fn, res, rej} = q.shift(); fn().then(res, rej).finally(() => { active--; next(); }); }; return fn => new Promise((res, rej) => { q.push({fn, res, rej}); next(); }); };
// one media per slot: several renditions of the same slot (quality variants) → the best one that is still a sane size
function pickMedia(list){
  const bySlot = new Map();
  // v12.37.1: slots without a real file (empty slots of a "1 - 2 - 3 - 4" pattern) are no steps
  (list||[]).forEach(m => { if(!m || !/^https?:\/\//.test(m.url||'')) return; const slot = (m.tags||[]).find(x => /^pattern-slot-index:/.test(x)) || ('pos:'+(m.position||0)); if(!bySlot.has(slot)) bySlot.set(slot, []); bySlot.get(slot).push(m); });
  const out = [];
  for(const [slot, group] of bySlot.entries()){
    const vids = group.filter(m => m.type==='video'), imgs = group.filter(m => m.type!=='video');
    const pool = vids.length ? vids : imgs; const ok = pool.filter(m => !m.bytes || m.bytes <= 120*1024*1024);
    const best = (ok.length ? ok : pool).sort((a,b) => (b.bytes||0)-(a.bytes||0))[0];
    if(best){ const idx = /^pattern-slot-index:(\d+)$/.exec(slot); const slug = ((best.tags||[]).find(x => /^pattern-slot:/.test(x))||'').slice(13); out.push(Object.assign({}, best, {slotIndex: idx ? +idx[1] : null, slotSlug: slug && slug!=='media' ? slug : ''})); }
  }
  return out.sort((a,b) => (a.slotIndex ?? a.position ?? 0) - (b.slotIndex ?? b.position ?? 0) || (a.position||0)-(b.position||0));
}
const plainText = html => htmlToMd(html).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
// Classic's reserved placeholder patterns ("Without template", "Kein Template", "Standard") carry no meaning for a title
const isPlaceholderLabel = x => !x || /^(without|no|none|kein(e)?|ohne)\b[\s\-_]*(template|muster|pattern|vorlage|label)?s?$/i.test(x.trim()) || /^(default|standard|media|medien|none)$/i.test(x.trim());
// slot labels of a labeling pattern: "Vorher - Nachher" → ['Vorher','Nachher'] (UI language first, then the pattern's default language, then its name);
// a label that does not split into one part per slot becomes a caption on every part; unlabeled slots fall back to their slug ("before" → "Before")
function slotLabels(pattern, media){
  const n = media.length; if(!n) return [];
  const human = x => x ? x.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase()) : '';
  const fromSlug = media.map(m => human(m.slotSlug));
  if(n === 1) return ['']; // a single slot needs no caption – its pattern label is a placeholder ("Without template", "Kein Template")
  if(!pattern || pattern.label_visible===false) return fromSlug;
  const L = pattern.labels || {}; const raw = (L[G.LANG] || L[pattern.default_language] || L.de || L.en || Object.values(L)[0] || pattern.name || '').trim();
  if(isPlaceholderLabel(raw)) return fromSlug;
  const parts = raw.split(/\s+[-–—|\/]\s+/).map(x => x.trim()).filter(Boolean);
  // the media's slot index points into the label parts ("1 - 2 - 3 - 4" with slots 0 and 2 → "1", "3")
  return media.map((m, k) => (m.slotIndex != null && parts.length > 1 && parts[m.slotIndex] != null) ? parts[m.slotIndex] : (parts.length===n ? parts[k] : (fromSlug[k] || '')));
}
const extOf = (ct, url) => ({'video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg'})[ct] || ((/\.(mp4|mov|webm|jpe?g|png|webp|gif|svg)(\?|$)/i.exec(url||'')||[])[1]||'bin').replace('jpeg','jpg');
const probe = (url, isVideo) => new Promise(res => { let done = false; const fin = x => { if(!done){ done = true; res(x); } }; setTimeout(() => fin(null), 20000);
  if(isVideo){ const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.crossOrigin = 'anonymous'; v.onloadedmetadata = () => fin({w:v.videoWidth||1280, h:v.videoHeight||720, duration: isFinite(v.duration) && v.duration > 0 ? v.duration : 5}); v.onerror = () => fin(null); v.src = url; }
  else { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => fin({w:i.naturalWidth||1280, h:i.naturalHeight||960, img:i}); i.onerror = () => fin(null); i.src = url; } });

async function renderImporter(app){
  topbar(app, {crumbs: [{label: t('instructions'), href: ''}, {label: t('ws_admin'), href: 'admin'}, {label: t('imp_title')}]});
  if(!S.user.isAdmin){ app.appendChild(el(`<main class="page page-narrow"><div class="card empty"><h2>${t('imp_title')}</h2><div>${t('only_admin')}</div></div></main>`)); return; }
  let conn = null, list = null; const sel = new Set(); const opts = {folders:true, status:true, icons:true};
  const done = new Map(); (S.instrs||[]).forEach(i => { if(i.source && i.source.kind==='giri-classic' && i.source.oldId) done.set(i.source.oldId, i.id); });
  const v = el(`<main class="page page-narrow imp">
    <div class="dash-head"><div class="dash-title"><div class="eyebrow">${IC.upload} ${t('ws_admin')}</div><h1>${t('imp_title')}</h1></div></div>
    <p class="muted" style="margin:-6px 0 14px">${t('imp_intro')}</p>
    <section class="card side-info" id="imp-connect"><h3>1 · ${t('imp_connect')}</h3>
      <div class="field"><label for="imp-srv">${t('imp_server')}</label><input id="imp-srv" value="${DEFAULT_SERVER}" autocomplete="url" spellcheck="false"></div>
      <div class="two"><div class="field"><label for="imp-mail">${t('email')}</label><input id="imp-mail" type="email" autocomplete="username"></div><div class="field"><label for="imp-pw">${t('imp_pw')}</label><input id="imp-pw" type="password" autocomplete="current-password"></div></div>
      <div class="row" style="justify-content:space-between;align-items:center"><span class="muted" id="imp-cstat">${t('imp_pw_note')}</span><button class="btn" id="imp-go">${t('imp_connect_btn')}</button></div></section>
    <section class="card side-info" id="imp-struct" hidden><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">2 · ${t('imp_st_title')}</h3><span class="chip draft" id="imp-st-chip"></span></div>
      <p class="muted" style="margin:8px 0 10px">${t('imp_st_sub')}</p><div id="imp-st-body" class="muted">${t('imp_st_loading')}</div>
      <div class="imp-opts" id="imp-st-opts" hidden><label class="toggle"><input type="checkbox" id="st-users" checked> <span>${t('imp_st_o_users')}</span></label><label class="toggle"><input type="checkbox" id="st-mail"> <span>${t('imp_st_o_mail')}</span></label><label class="toggle"><input type="checkbox" id="st-teams" checked> <span>${t('imp_st_o_teams')}</span></label><label class="toggle"><input type="checkbox" id="st-folders" checked> <span>${t('imp_st_o_folders')}</span></label><label class="toggle"><input type="checkbox" id="st-skipempty" checked> <span>${t('imp_st_o_skip_empty')}</span></label></div>
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:12px"><span class="muted" id="imp-st-stat"></span><button class="btn" id="imp-st-run" hidden>${t('imp_st_run')}</button></div></section>
    <section class="card side-info" id="imp-select" hidden><h3>3 · ${t('imp_pick')}</h3>
      <div class="imp-bar"><input id="imp-q" type="search" placeholder="${t('imp_search')}" autocomplete="off"><select id="imp-sort" title="${t('imp_sort')}"><option value="name">${t('imp_sort_name')}</option><option value="new">${t('imp_sort_new')}</option><option value="old">${t('imp_sort_old')}</option><option value="upd">${t('imp_sort_upd')}</option><option value="status">${t('imp_sort_status')}</option></select>
        <label class="imp-chk"><input type="checkbox" id="imp-onlynew"> ${t('imp_only_new')}</label><label class="imp-chk"><input type="checkbox" id="imp-oldv"> ${t('imp_old_versions')}</label>
        <span class="imp-sp"></span><button class="btn ghost sm" id="imp-all">${t('imp_all')}</button><button class="btn ghost sm" id="imp-none">${t('imp_none_sel')}</button></div>
      <div id="imp-tree"></div>
      <div class="imp-opts"><label class="toggle"><input type="checkbox" id="o-folders" checked> <span>${t('imp_o_folders')}</span></label><label class="toggle"><input type="checkbox" id="o-status" checked> <span>${t('imp_o_status')}</span></label><label class="toggle"><input type="checkbox" id="o-icons" checked> <span>${t('imp_o_icons')}</span></label></div>
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:12px"><span class="muted" id="imp-selstat"></span><button class="btn mint" id="imp-run" disabled></button></div></section>
    <section class="card side-info" id="imp-progress" hidden><h3>4 · ${t('imp_running')}</h3><div id="imp-rows"></div><div class="row" style="margin-top:12px;gap:8px" id="imp-end" hidden><button class="btn" id="imp-dash">${t('instructions')} →</button><button class="btn ghost" id="imp-more">${t('imp_more')}</button></div></section>
  </main>`);
  app.appendChild(v);
  const cstat = v.querySelector('#imp-cstat');
  v.querySelector('#imp-go').onclick = async () => {
    const server = v.querySelector('#imp-srv').value.trim().replace(/\/+$/, ''), email = v.querySelector('#imp-mail').value.trim(), password = v.querySelector('#imp-pw').value;
    if(!server || !email || !password){ toast(t('imp_e_fill')); return; }
    const b = v.querySelector('#imp-go'); b.disabled = true; cstat.textContent = t('imp_connecting');
    try{
      const c = await call({server, token:''}, 'connect', {email, password}); conn = {server, token:c.token, user:c.user, org:c.organization};
      v.querySelector('#imp-pw').value = '';
      cstat.innerHTML = `<b style="color:var(--mint-ink)">✓ ${t('imp_connected')}</b> · ${esc((conn.org&&conn.org.name)||'')} · ${esc(conn.user.email||'')}`;
      cstat.textContent += ' · ' + t('imp_loading');
      list = await call(conn, 'list'); cstat.innerHTML = `<b style="color:var(--mint-ink)">✓ ${t('imp_connected')}</b> · ${esc((conn.org&&conn.org.name)||'')} · ${list.projects.length} ${t('folders_h')} · ${list.instructions.length} ${t('instructions')}`;
      renderTree(); v.querySelector('#imp-select').hidden = false; v.querySelector('#imp-struct').hidden = false; v.querySelector('#imp-struct').scrollIntoView({behavior:'smooth', block:'start'});
      loadStructure();
    }catch(e){ cstat.innerHTML = `<span style="color:var(--red)">${esc(e.message||String(e))}</span>`; }
    b.disabled = false;
  };
  // list state: selection survives re-renders (search / sort / filters), groups collapse, older versions of a version group are hidden by default
  const collapsed = new Set(); let selInit = false;
  const teamName = id => { const tm = (list.teams||[]).find(x => x.id===id); return tm ? tm.name : ''; };
  const visibleItems = () => {
    const q = (v.querySelector('#imp-q').value||'').trim().toLowerCase(); const onlyNew = v.querySelector('#imp-onlynew').checked; const oldV = v.querySelector('#imp-oldv').checked;
    // version groups: only the newest version of each group unless asked for all
    const byGroup = new Map(); list.instructions.forEach(i => { const g = i.version_group_id || i.id; if(!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(i); });
    const older = new Map(); byGroup.forEach(arr => { arr.sort((a,b) => (b.version||0)-(a.version||0)); older.set(arr[0].id, arr.length-1); });
    let items = list.instructions.filter(i => oldV || older.has(i.id));
    if(onlyNew) items = items.filter(i => !done.has(i.id));
    if(q) items = items.filter(i => `${i.name||''} ${i.project_name||''} ${teamName(i.team_id)} ${i.creator||''}`.toLowerCase().includes(q));
    const sort = v.querySelector('#imp-sort').value; const T = x => Date.parse(x)||0;
    const cmp = {name:(a,b) => (a.name||'').localeCompare(b.name||''), new:(a,b) => T(b.created_at)-T(a.created_at), old:(a,b) => T(a.created_at)-T(b.created_at), upd:(a,b) => T(b.updated_at)-T(a.updated_at), status:(a,b) => (b.published?1:0)-(a.published?1:0) || (a.name||'').localeCompare(b.name||'')}[sort] || (() => 0);
    items.sort(cmp); items.forEach(i => { i._older = older.get(i.id)||0; });
    return items;
  };
  const itemMeta = i => { const parts = [fmtD(i.created_at)]; if(i.updated_at && fmtD(i.updated_at)!==fmtD(i.created_at)) parts.push(`${t('imp_updated')} ${fmtD(i.updated_at)}`); const tn = teamName(i.team_id); if(tn) parts.push(tn); if(i.creator) parts.push(i.creator); else { const ap = i.approvals && (i.approvals.technical||i.approvals.privacy); const u = ap && ap.user; const n = u && ([u.first_name, u.last_name].filter(Boolean).join(' ') || u.email); if(n) parts.push(t('imp_approved_by', {n})); } return parts.join(' · '); };
  function renderTree(){
    const tree = v.querySelector('#imp-tree'); const items = visibleItems();
    if(!selInit){ selInit = true; list.instructions.forEach(i => { if(!done.has(i.id) && items.includes(i)) sel.add(i.id); }); }
    const byP = new Map(); items.forEach(i => { const k = i.project_id || ''; if(!byP.has(k)) byP.set(k, []); byP.get(k).push(i); });
    const groups = [...list.projects.map(p => ({id:p.id, name:p.name, items: byP.get(p.id)||[]})), ...(byP.has('') ? [{id:'', name:t('no_folder'), items: byP.get('')}] : [])].filter(g => g.items.length);
    tree.innerHTML = groups.map(g => { const nSel = g.items.filter(i => sel.has(i.id)).length; return `<div class="imp-grp ${collapsed.has(g.id)?'coll':''}" data-g="${esc(g.id)}"><div class="imp-gh"><input type="checkbox" data-grp="${esc(g.id)}" ${nSel && nSel===g.items.length?'checked':''}><button class="imp-tg" data-tg="${esc(g.id)}" aria-label="toggle">${IC.down}</button><b>${IC.folder} ${esc(g.name)}</b><span class="muted tnum">${nSel}/${g.items.length}</span></div><div class="imp-items">${g.items.map(i => `<label class="imp-it ${done.has(i.id)?'done':''}"><input type="checkbox" data-id="${esc(i.id)}" data-grp="${esc(g.id)}" ${sel.has(i.id)?'checked':''}><span class="imp-main"><span class="imp-name">${esc(i.name||'–')}</span><span class="imp-sub muted">${esc(itemMeta(i))}</span></span><span class="imp-meta"><span class="chip dot ${i.published?'published':'draft'}">${i.published?t('published'):t('draft')}</span><span class="tnum">v${i.version}</span>${i._older?`<span class="chip draft" title="${t('imp_old_versions')}">${i._older===1 ? t('imp_older_1') : t('imp_older_n', {n:i._older})}</span>`:''}${done.has(i.id)?`<span class="chip draft">${t('imp_done_before')}</span>`:''}</span></label>`).join('')}</div></div>`; }).join('') || `<p class="muted">${list.instructions.length ? t('imp_no_match') : t('imp_none')}</p>`;
    $$('#imp-tree input[data-grp]:not([data-id])', v).forEach(g => { const its = $$(`#imp-tree input[data-id][data-grp="${g.dataset.grp}"]`, v); const n = its.filter(c => c.checked).length; g.indeterminate = n>0 && n<its.length; });
    const upd = () => { $$('#imp-tree input[data-id]', v).forEach(c => { if(c.checked) sel.add(c.dataset.id); else sel.delete(c.dataset.id); }); $$('#imp-tree input[data-grp]:not([data-id])', v).forEach(g => { const its = $$(`#imp-tree input[data-id][data-grp="${g.dataset.grp}"]`, v); const n = its.filter(c => c.checked).length; g.checked = n>0 && n===its.length; g.indeterminate = n>0 && n<its.length; g.closest('.imp-gh').querySelector('.tnum').textContent = `${n}/${its.length}`; }); const nVis = $$('#imp-tree input[data-id]:checked', v).length; v.querySelector('#imp-selstat').textContent = t('imp_selected', {n:nVis}); const rb = v.querySelector('#imp-run'); rb.disabled = !nVis; rb.textContent = t('imp_run_btn', {n:nVis}); };
    $$('#imp-tree input[data-id]', v).forEach(c => c.onchange = upd);
    $$('#imp-tree input[data-grp]:not([data-id])', v).forEach(g => g.onchange = () => { $$(`#imp-tree input[data-id][data-grp="${g.dataset.grp}"]`, v).forEach(c => { c.checked = g.checked; }); upd(); });
    $$('#imp-tree [data-tg]', v).forEach(b => b.onclick = e => { e.preventDefault(); const id = b.dataset.tg; if(collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); b.closest('.imp-grp').classList.toggle('coll', collapsed.has(id)); });
    $$('#imp-tree .imp-gh b', v).forEach(b => b.onclick = () => b.parentElement.querySelector('[data-tg]').click());
    upd();
  }
  const visSel = () => $$('#imp-tree input[data-id]:checked', v).map(c => c.dataset.id);
  v.querySelector('#imp-q').oninput = renderTree; v.querySelector('#imp-sort').onchange = renderTree; v.querySelector('#imp-onlynew').onchange = renderTree; v.querySelector('#imp-oldv').onchange = renderTree;
  v.querySelector('#imp-all').onclick = () => { $$('#imp-tree input[data-id]', v).forEach(c => { c.checked = true; sel.add(c.dataset.id); }); renderTree(); };
  v.querySelector('#imp-none').onclick = () => { $$('#imp-tree input[data-id]', v).forEach(c => { c.checked = false; sel.delete(c.dataset.id); }); renderTree(); };
  /* ---- organisation structure: users → invites/roles, teams → teams, projects → folders with team access ---- */
  // v12.39: the eight Classic roles exist 1:1 in GIRI Go
  const ROLE_MAP = {team_admin:'team_admin', creator:'creator', editor:'editor', approver:'approver', technical_approver:'tech_approver', compliance_approver:'compliance_approver', compliance_manager:'compliance_manager', viewer:'viewer'};
  const RANK = {viewer:0, editor:1, tech_approver:2, compliance_approver:2, approver:3, compliance_manager:3, creator:4, team_admin:5, admin:6};
  const domainOf = e => (e||'').split('@')[1] || '';
  let struct = null;
  async function loadStructure(){
    const body = v.querySelector('#imp-st-body'), chip = v.querySelector('#imp-st-chip');
    chip.textContent = conn.user.is_org_admin ? t('imp_st_orgadmin') : t('imp_st_member');
    try{ struct = await call(conn, 'structure'); }catch(e){ body.innerHTML = `<span style="color:var(--red)">${esc(e.message||String(e))}</span>`; return; }
    const plan = planStructure();
    body.classList.remove('muted');
    body.innerHTML = `<div class="imp-st-grid">
      <div><b>${t('users')}</b><div class="muted">${t('imp_st_users_line', {n:plan.users.length, upd:plan.users.filter(u => u.kind==='update').length, inv:plan.users.filter(u => u.kind==='invite').length, skip:plan.skipped.length})}</div>${plan.skipped.length ? `<div class="muted" style="font-size:12px">${t('imp_st_skipped')}: ${esc(plan.skipped.map(u => u.email).join(', '))}</div>` : ''}</div>
      <div><b>${t('teams')}</b><div class="muted">${plan.teams.map(tm => `${esc(tm.name)} (${tm.members.length})`).join(' · ') || '–'}</div></div>
      <div><b>${t('folders_h')}</b><div class="muted">${plan.folders.map(f => `${esc(f.name)}${f.teams.length ? ' → ' + esc(f.teams.map(id => (plan.teams.find(tm => tm.id===id)||{}).name || '').filter(Boolean).join(', ')) : ''}`).join(' · ') || '–'}</div></div>
      <div class="muted" style="font-size:12px">${t('imp_st_rolemap')}</div></div>`;
    v.querySelector('#imp-st-opts').hidden = false; v.querySelector('#imp-st-run').hidden = false;
  }
  // what the import would do – computed from the Classic structure + the instruction list (project → teams of its instructions)
  function planStructure(){
    const myWs = S.user.ws; const teams = [], folders = [], users = [], skipped = [];
    const teamById = new Map();
    (struct.teams||[]).forEach(tm => { const ex = (S.wsRow.teams||[]).find(x => x.oldId===tm.id || x.name===tm.name); const id = ex ? ex.id : uid(); const members = tm.members.filter(m => domainOf(m.email)===myWs).map(m => ({email:m.email, role:ROLE_MAP[m.role]||'viewer', name:m.name})); const g = {id, name:tm.name, oldId:tm.id, members, existing:!!ex}; teams.push(g); teamById.set(tm.id, g); });
    const projTeams = new Map(); (list.instructions||[]).forEach(i => { if(!i.project_id || !i.team_id) return; const g = teamById.get(i.team_id); if(!g) return; if(!projTeams.has(i.project_id)) projTeams.set(i.project_id, new Set()); projTeams.get(i.project_id).add(g.id); });
    (struct.projects||[]).forEach(p => { const ex = (S.wsRow.folders||[]).find(x => x.oldId===p.id || x.name===p.name); folders.push({id: ex ? ex.id : uid(), name:p.name, oldId:p.id, teams:[...(projTeams.get(p.id)||[])], existing:!!ex}); });
    // workspace role per user: org admin → admin, else the highest team role, else viewer
    (struct.users||[]).forEach(u => { if(!u.email || u.is_demo) return; if(domainOf(u.email)!==myWs){ skipped.push(u); return; } let role = u.is_org_admin ? 'admin' : 'viewer'; if(!u.is_org_admin) (struct.teams||[]).forEach(tm => tm.members.forEach(m => { if(m.email===u.email){ const r = ROLE_MAP[m.role]||'viewer'; if(RANK[r] > RANK[role]) role = r; } })); const prof = (pctx.profiles||[]).find(p => (p.email||'').toLowerCase()===u.email); users.push({email:u.email, name:u.name, role, kind: prof ? 'update' : 'invite', prof}); });
    return {teams, folders, users, skipped};
  }
  const pctx = {profiles:null};
  (async () => { try{ const {data} = await G.sb.from('profiles').select('id,email,role,is_admin').eq('ws', S.user.ws); pctx.profiles = data||[]; }catch(e){ pctx.profiles = []; } })();
  v.querySelector('#imp-st-run').onclick = async () => {
    const b = v.querySelector('#imp-st-run'), st = v.querySelector('#imp-st-stat'); b.disabled = true;
    const oUsers = v.querySelector('#st-users').checked, oMail = v.querySelector('#st-mail').checked, oTeams = v.querySelector('#st-teams').checked, oFolders = v.querySelector('#st-folders').checked, oSkipEmpty = v.querySelector('#st-skipempty').checked;
    const usedProjects = new Set((list.instructions||[]).map(i => i.project_id).filter(Boolean));
    const plan = planStructure(); const res = {upd:0, inv:0, mailed:0, teams:0, folders:0, err:[]};
    try{
      if(oTeams){ const teams = [...(S.wsRow.teams||[])]; for(const g of plan.teams){ let tm = teams.find(x => x.id===g.id); if(!tm){ tm = {id:g.id, name:g.name, members:[], oldId:g.oldId}; teams.push(tm); } tm.oldId = g.oldId; tm.members = tm.members||[]; for(const m of g.members){ const ex = tm.members.find(x => (x.email||'').toLowerCase()===m.email); if(ex) ex.role = m.role; else tm.members.push({email:m.email, role:m.role}); } res.teams++; } await saveWs({teams}); }
      if(oFolders){ const folders = [...(S.wsRow.folders||[])]; for(const f of plan.folders){ if(oSkipEmpty && !f.existing && !usedProjects.has(f.oldId)) continue; let fo = folders.find(x => x.id===f.id); if(!fo){ fo = {id:f.id, name:f.name, teams:[]}; folders.push(fo); } fo.oldId = f.oldId; fo.teams = [...new Set([...(fo.teams||[]), ...(oTeams ? f.teams : [])])]; res.folders++; } await saveWs({folders}); }
      if(oUsers){ const invites = [...(S.wsRow.invites||[])]; for(const u of plan.users){ st.textContent = u.email;
          if(u.kind==='update'){ if(u.prof.id===S.user.id) continue; if(u.prof.is_admin && u.role!=='admin') continue; if(u.prof.role===u.role) continue; const {error} = await G.sb.from('profiles').update(u.role==='admin' ? {role:'admin', is_admin:true} : {role:u.role}).eq('id', u.prof.id); if(error) res.err.push(u.email); else res.upd++; }
          else { const k = invites.findIndex(i => (i.email||'').toLowerCase()===u.email); const inv = {email:u.email, role:u.role, at:Date.now(), by:S.user.email, name:u.name||''}; if(k>=0) invites[k] = Object.assign(invites[k], inv); else invites.push(inv); res.inv++;
            if(oMail){ const r = await sendInvite(u.email); if(r.ok) res.mailed++; } } } // v12.48: the invitation mail (falls back to the code mail)
        await saveWs({invites}); }
    }catch(e){ res.err.push(e.message||String(e)); }
    st.innerHTML = `<b style="color:var(--mint-ink)">✓</b> ${t('imp_st_done', res)}${res.err.length ? ` <span style="color:var(--red)">· ${esc(res.err.join(', '))}</span>` : ''}`; b.disabled = false; toast(t('imp_st_done', res));
    // folders/teams just created → the instruction import reuses them
    (S.wsRow.folders||[]).forEach(f => { if(f.oldId) folderByOld.set(f.oldId, f.id); });
  };
  const folderByOld = new Map(); (S.wsRow.folders||[]).forEach(f => { if(f.oldId) folderByOld.set(f.oldId, f.id); });
  v.querySelector('#imp-run').onclick = async () => {
    opts.folders = v.querySelector('#o-folders').checked; opts.status = v.querySelector('#o-status').checked; opts.icons = v.querySelector('#o-icons').checked;
    const ids = new Set(visSel()); const items = list.instructions.filter(i => ids.has(i.id)); if(!items.length) return;
    v.querySelector('#imp-select').hidden = true; const pr = v.querySelector('#imp-progress'); pr.hidden = false; const rows = v.querySelector('#imp-rows'); rows.innerHTML = '';
    // v12.48: every version of a Classic version group (v1, v2, v3 …) – the newest one is imported, the older ones become its history
    const versions = new Map(); (list.instructions||[]).forEach(i => { const g = i.version_group_id || i.id; if(!versions.has(g)) versions.set(g, []); versions.get(g).push(i); });
    const ctx = {folderMap:folderByOld, symbols:new Map(), projects:list.projects||[], versions};
    for(const it of items){ const row = el(`<div class="imp-row"><b>${esc(it.name||'–')}</b><span class="imp-st muted">${t('imp_waiting')}</span></div>`); rows.appendChild(row); it._row = row; }
    let ok = 0, fail = 0;
    const runOne = async it => { const st = it._row.querySelector('.imp-st'); st.className = 'imp-st muted'; try{ const r = await importOne(it, conn, opts, ctx, msg => { st.textContent = msg; }); const sk = r._skipped||0; delete r._skipped; const dg = !!r._downgraded; delete r._downgraded; st.innerHTML = `<b style="color:var(--mint-ink)">✓ ${t('imp_ok')}</b>${sk?` <span class="muted">· ${t('imp_skipped', {n:sk})}</span>`:''}${dg?` <span class="muted">· ${t('imp_as_draft')}</span>`:''}`; it._row.classList.add('ok'); ok++; done.set(it.id, true); sel.delete(it.id); }
      catch(e){ fail++; st.innerHTML = `<span style="color:var(--red)">${esc(e.message||String(e))}</span> <button class="btn ghost sm" data-retry>${t('imp_retry')}</button>`; st.querySelector('[data-retry]').onclick = () => { fail--; runOne(it); }; } };
    for(const it of items){ it._row.scrollIntoView({block:'nearest'}); await runOne(it); }
    v.querySelector('#imp-end').hidden = false; toast(t('imp_summary', {ok, fail}));
  };
  v.querySelector('#imp-dash').onclick = () => go('');
  v.querySelector('#imp-more').onclick = () => { v.querySelector('#imp-progress').hidden = true; renderTree(); v.querySelector('#imp-select').hidden = false; };
}

// ---- one instruction: old tree → GIRI instruction, media copied server-to-server, posters made here ----
async function importOne(summary, conn, opts, ctx, say){
  say(t('imp_s_meta'));
  const {instruction: I} = await call(conn, 'instruction', {id: summary.id});
  const ws = S.user.ws; const iid = uid();
  // v12.48: dates and version from Classic – the first version's creation date, this version's last change (the list's dates if the
  // detail lacks them), the version number, and the older versions of the group as history entries (before: version 0 and, when the
  // detail came without dates, the import moment as the instruction's date)
  const group = ((ctx.versions && ctx.versions.get(summary.version_group_id || summary.id)) || [summary]).slice().sort((a,b) => (a.version||0)-(b.version||0));
  const P = x => Date.parse(x || '') || 0; const now0 = Date.now();
  const createdAt = Math.min(...group.map(x => P(x.created_at)).filter(Boolean), P(I.created_at) || P(summary.created_at) || now0);
  const updatedAt = P(I.updated_at) || P(summary.updated_at) || P(I.created_at) || P(summary.created_at) || now0;
  const vNow = I.version || summary.version || 1;
  const instr = {id:iid, ws, title:(plainText(I.name || summary.name) || t('untitled')).slice(0, 200), shareKey:newShareKey(), createdBy:S.user.name, createdAt, updatedAt, status:'draft', version: Math.max(0, vNow - 1), approvals:{tech:null,dsgvo:null}, checklist:false, steps:[], history:[],
    source:{kind:'giri-classic', server:conn.server, oldId:I.id, version:vNow, creator:summary.creator || null, published:!!I.published, description:htmlToMd(I.description||'').slice(0, 2000), at:now0, versions: group.map(x => ({id:x.id, version:x.version||1, published:!!x.published, created_at:x.created_at, updated_at:x.updated_at}))}};
  group.filter(x => x.id !== I.id && (x.version||1) < vNow).forEach(x => instr.history.push({version:x.version||1, at:P(x.updated_at) || P(x.created_at) || createdAt, by:x.creator || '', note:t(x.published ? 'imp_hist_pub' : 'imp_hist_v', {v:x.version||1})}));
  // folder from the old project
  if(opts.folders && I.project_id){
    let fid = ctx.folderMap.get(I.project_id);
    if(!fid){ const name = summary.project_name || ((ctx.projects||[]).find(p => p.id===I.project_id)||{}).name || I.project_id; const ex = (S.wsRow.folders||[]).find(f => f.name===name);
      if(ex) fid = ex.id; else { const f = {id:uid(), name, teams:[], oldId:I.project_id}; await saveWs({folders:[...(S.wsRow.folders||[]), f]}); fid = f.id; } ctx.folderMap.set(I.project_id, fid); }
    instr.folder = fid;
  }
  // team of the old instruction → GIRI team (created by the structure import or matched by name); harmless if the folder already grants it
  if(summary.team_id){ const tm = (S.wsRow.teams||[]).find(x => x.oldId===summary.team_id); if(tm) instr.teams = [tm.id]; }
  // media count for the progress line
  const allSteps = [...(I.steps||[]), ...(I.chapters||[]).flatMap(c => c.steps||[])].filter(s => !s.hidden);
  const total = allSteps.reduce((n, s) => n + pickMedia(s.media).length, 0); let doneN = 0, skipped = 0, skippedBlank = 0;
  const symbolFor = async icon => {
    if(!opts.icons || !icon || !icon.url) return null;
    if(ctx.symbols.has(icon.id)) return ctx.symbols.get(icon.id);
    const exist = (S.wsRow.symbols||[]).find(x => x.oldId===icon.id); if(exist){ ctx.symbols.set(icon.id, exist); return exist; }
    try{ const id = uid(); const r = await call(conn, 'copy', {url: icon.url, path: `${ws}/symbols/${id}.${extOf('', icon.url)==='bin' ? 'png' : extOf('', icon.url)}`});
      const p = await probe(r.url, false); const sym = {id, name:(icon.filename||'Symbol').replace(/\.[a-z0-9]+$/i, '').slice(0, 24), url:r.url, path:r.path, ar: p ? p.w/p.h : 1, alpha:true, at:Date.now(), oldId:icon.id};
      await saveWs({symbols:[...(S.wsRow.symbols||[]), sym]}); ctx.symbols.set(icon.id, sym); return sym; }catch(e){ return null; }
  };
  const annsFor = async icons => { const out = []; let k = 0; for(const ic of (icons||[]).slice(0, 6)){ const sym = await symbolFor(ic); if(!sym) continue; out.push({id:uid(), type:'img', src:sym.url, name:sym.name, ar:sym.ar||1, style:'sticker', size:0.14, x:0.1 + k*0.16, y:0.12, t:0}); k++; } return out; };
  // ---- media copies run 3 at a time with retries; a media that still fails after 3 attempts becomes an empty step ("noch filmen") instead of failing the whole instruction ----
  const pool = pLimit(3); let bytesDone = 0; const totalBytes = allSteps.reduce((n, s) => n + pickMedia(s.media).reduce((a, m) => a + (m.bytes||0), 0), 0);
  const progress = () => say(t('imp_s_media', {n:Math.min(doneN+1, total), total}) + (totalBytes ? ` · ${(bytesDone/1048576).toFixed(0)}/${(totalBytes/1048576).toFixed(0)} MB` : ''));
  const copyJob = (m, mid, isV) => pool(async () => {
    const path = `${ws}/${iid}/${mid}.${extOf('', m.url)==='bin' ? (isV ? 'mp4' : 'jpg') : extOf('', m.url)}`;
    let r = null, err = null;
    for(let attempt = 1; attempt <= 3; attempt++){
      try{ r = await call(conn, 'copy', {url: m.url, path}); err = null; break; }
      catch(e){ err = e; if(e.message === t('imp_e_large') || /login|Sitzung|session|no_permission/i.test(e.message)) break; await new Promise(res => setTimeout(res, attempt===1 ? 2000 : 6000)); }
    }
    if(!r) return {err};
    const type = isV || /^video\//.test(r.contentType||'') ? 'video' : 'photo';
    const p = await probe(r.url, type==='video');
    const w = (p && p.w) || m.width || 1280, h = (p && p.h) || m.height || (type==='video' ? 720 : 960), duration = type==='video' ? ((p && p.duration) || 5) : 0;
    let posterUrl = null;
    try{ let dataUrl = null; if(type==='photo' && p && p.img) dataUrl = posterFromCanvas(p.img, w, h); else if(type==='video'){ const c = await grabFrame(r.url, 0.3, 640); if(c) dataUrl = c.toDataURL('image/jpeg', .7); }
      if(dataUrl) posterUrl = await uploadPoster(iid, mid, dataUrl); }catch(e){}
    bytesDone += m.bytes||0; doneN++; progress();
    return {r, type, w, h, duration, posterUrl};
  });
  // first pass: start every copy (pool keeps 3 in flight), second pass: assemble the steps in order
  const plan = []; // {kind:'chapter', title} | {kind:'step', s, media, anns, jobs}
  const planStep = async s => { if(s.hidden) return; const media = pickMedia(s.media); const anns = await annsFor(s.icons); plan.push({kind:'step', s, media, anns, jobs: media.map(m => { const mid = uid(); const isV = m.type==='video'; return {m, mid, isV, p: copyJob(m, mid, isV)}; })}); };
  for(const s of (I.steps||[])) await planStep(s);
  for(const c of (I.chapters||[])){ plan.push({kind:'chapter', title:(c.name||'').slice(0, 120) || t('chapter')}); for(const s of (c.steps||[])) await planStep(s); }
  progress();
  for(const it of plan){
    if(it.kind==='chapter'){ instr.steps.push({id:uid(), kind:'chapter', title:plainText(it.title)}); continue; }
    const {s, media, anns, jobs} = it; const title = plainText(s.name||'').slice(0, 200), desc = htmlToMd(s.description||'').slice(0, 4000);
    if(!media.length && !title && !desc && !anns.length){ skippedBlank++; continue; } // v12.37.1: an empty Classic step (often the last one) is no step
    if(!media.length){ instr.steps.push({id:uid(), type:'empty', w:1280, h:720, duration:0, trimStart:0, trimEnd:0, title, desc, warn:'', ann:anns, origin:{step:s.id}}); continue; }
    // a Classic step with several slots ("Vorher - Nachher") becomes one GIRI step per slot: label in the title, text on every part, symbols on the first
    const labels = slotLabels(s.pattern, media); const n = media.length;
    const partTitle = k => { const l = labels[k]; if(l && l.toLowerCase() !== title.toLowerCase()) return (/^\d+$/.test(l) ? `${title} (${l})` : `${title}${title ? ' – ' : ''}${l}`).slice(0, 200); return k===0 || n===1 ? title : `${title} (${k+1})`; };
    const origin = k => Object.assign({step:s.id}, n>1 ? {slot:k, of:n, label:labels[k]||'', pattern:(s.pattern && s.pattern.id) || null} : {});
    for(const [k, job] of jobs.entries()){
      const res = await job.p;
      if(res.err){ if(/login|Sitzung|session|no_permission/i.test(res.err.message)) throw res.err; if(k > 0 && n > 1){ skipped++; doneN++; continue; } instr.steps.push({id:uid(), type:'empty', w:1280, h:720, duration:0, trimStart:0, trimEnd:0, title:partTitle(k), desc, warn:'', ann: k===0 ? anns : [], origin:Object.assign(origin(k), {failed: res.err.message === t('imp_e_large') ? 'too_large' : 'copy', media: job.m.id})}); skipped++; doneN++; continue; }
      const {r, type, w, h, duration, posterUrl} = res;
      const step = {id:uid(), type, mediaId:job.mid, mediaUrl:r.url, mediaPath:r.path, w, h, duration, trimStart:0, trimEnd:duration, title:partTitle(k), desc, warn:'', ann: k===0 ? anns : [], origin:origin(k)};
      if(posterUrl) step.posterUrl = posterUrl;
      instr.steps.push(step);
    }
  }
  // v12.45: the server checks rights per instruction (team of the folder / of the instruction) – say so before uploading anything
  if(!can(instr, 'edit')) throw new Error(t('imp_e_noedit'));
  // status: keep "published" published (with the old approvals noted), everything else arrives as a draft.
  // Without both approval rights for this instruction's teams the server would refuse the approvals → it stays a draft.
  if(opts.status && I.published && !(can(instr, 'approve_tech') && can(instr, 'approve_dsgvo'))){
    instr.history.push({version:instr.version, at:Date.now(), by:S.user.name, note:t('imp_no_approve_right')}); instr._downgraded = true;
  } else if(opts.status && I.published){
    const now = Date.now(); const ap = I.approvals || {}; const by = x => (x && x.user && ([x.user.first_name, x.user.last_name].filter(Boolean).join(' ') || x.user.email)) || 'Import'; const at = x => (x && Date.parse(x.at)) || now;
    instr.status = 'published'; instr.version = vNow; instr.approvals = {tech:{by:by(ap.technical), at:at(ap.technical)}, dsgvo:{by:by(ap.privacy), at:at(ap.privacy)}};
    // v12.37.1: the version keeps its original date (last approval, else last change in Classic) instead of the import moment
    const origAt = Math.max(at(ap.technical)!==now ? at(ap.technical) : 0, at(ap.privacy)!==now ? at(ap.privacy) : 0) || Date.parse(I.updated_at) || Date.parse(I.created_at) || now;
    instr.publishedAt = origAt;
    instr.history.push({version:instr.version, at:origAt, by:summary.creator || S.user.name, note:t('imp_hist_import', {s: conn.server.replace(/^https?:\/\//,'')}), tech:instr.approvals.tech, dsgvo:instr.approvals.dsgvo});
  } else instr.history.push({version:instr.version, at:updatedAt, by:summary.creator || '', note:t('imp_hist_draft', {v:vNow, s: conn.server.replace(/^https?:\/\//,'')})});
  say(t('imp_s_save')); await saveInstr(instr, {keepDate:true}); rememberRemote(instr); if(!S.instrs.find(x => x.id===instr.id)) S.instrs.unshift(instr);
  instr._skipped = skipped;
  return instr;
}

export { renderImporter, pickMedia, slotLabels, isPlaceholderLabel };
