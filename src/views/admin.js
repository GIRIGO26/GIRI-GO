import { go } from '../app/router.js';
import { SESSION_DAYS_DEFAULT, sessionDays } from '../core/auth.js';
import { $$, confirmM, el, esc, modal, promptM, toast } from '../core/helpers.js';
import { t } from '../core/i18n.js';
import { pwDialog, saveInstr } from '../core/passwords.js';
import { G, S } from '../core/state.js';
import { uid } from '../core/storage.js';
import { folderName, folderTeams, loadWs, saveWs } from '../core/workspace.js';
import { IC } from '../ui/icons.js';
import { topbar } from '../ui/topbar.js';
import { roleLbl } from './dashboard.js';
import { ROLES as TEAM_ROLES, CAPS, capsOf, normRole, roleIcon } from '../core/roles.js';
import { debounce } from './editor.js';
import { defaultGuide } from '../media/pdfimport.js';
import { inviteMsg, sendInvite } from '../core/invite.js';


/* ---------- Admin panel: users, teams, project access ---------- */
async function renderAdmin(app, sub){
  topbar(app, {crumbs: [{label: t('instructions'), href: ''}, {label: t('ws_admin')}]});
  if(!S.user.isAdmin){ app.appendChild(el(`<main class="page page-narrow"><div class="card empty"><h2>${t('admin')}</h2><div>${t('only_admin')}</div></div></main>`)); return; }
  const ws = await loadWs(true); const {data:prows} = await G.sb.from('profiles').select('*').eq('ws', S.user.ws).order('created_at');
  const CAPKEYS = ['view','edit','approve_tech','approve_dsgvo','lock','links','projects','users','team','analytics'];
  const people = prows||[]; const ROLES = ['admin', ...TEAM_ROLES.slice().reverse()]; const TROLES = TEAM_ROLES.slice().reverse(); // v12.39: the eight Classic roles (+ org admin at workspace level)
  const v = el(`<main class="page"><div class="dash-head"><div><h1>${t('admin')}</h1><div class="sub">${t('admin_sub')} · ${esc(S.user.ws)}</div></div></div>
    <div class="settings" style="max-width:900px">
      <div class="card side-info"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">${t('users')} <span class="muted tnum">${people.length}</span></h3><button class="btn sm" id="invite">${IC.plus} ${t('invite')}</button></div>
        <div class="tbl-wrap" style="margin-top:10px"><table class="res" id="utable"><thead><tr><th>${t('name')}</th><th>${t('email')}</th><th>${t('role')}</th><th></th></tr></thead><tbody></tbody></table></div>
        <div id="invites"></div></div>
      <div class="card side-info"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">${t('teams')} <span class="muted tnum">${(ws.teams||[]).length}</span></h3><button class="btn ghost sm" id="newteam">${IC.plus} ${t('new_team')}</button></div>${(ws.teams||[]).length > 6 ? `<label class="dn-search adm-search">${IC.search||''}<input id="team-q" type="search" placeholder="${t('team_search_ph')}" autocomplete="off"></label>` : ''}<div id="teams" style="margin-top:10px"></div></div>
      <details class="card side-info roles-card"><summary><h3 style="margin:0;display:inline">${t('roles_h')}</h3> <span class="muted">${t('roles_sub')}</span></summary>
        <p class="muted" style="margin:10px 0">${t('roles_principle')}</p>
        <div class="tbl-wrap"><table class="res roles"><thead><tr><th>${t('role')}</th><th>${t('roles_desc')}</th>${CAPKEYS.map(c => `<th title="${t('cap_'+c)}">${t('cap_'+c+'_s')}</th>`).join('')}</tr></thead><tbody>
          ${TEAM_ROLES.map(r => `<tr><td><b>${roleIcon(r)} ${t('r_'+r)}</b></td><td class="muted">${t('rd_'+r)}</td>${CAPKEYS.map(c => `<td class="cap ${capsOf(r).includes(c) || (c==='view') ? 'y' : 'n'}">${capsOf(r).includes(c) || c==='view' ? '✓' : '·'}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>
        <p class="muted" style="margin:10px 0 0;font-size:12.5px">${t('roles_notes')}</p></details>
      <details class="card side-info acc-card" ${(ws.folders||[]).length <= 20 ? 'open' : ''}><summary><h3 style="margin:0;display:inline">${t('folder_access')}</h3> <span class="muted tnum">${(ws.folders||[]).length}</span><span class="chev">${IC.down}</span></summary><div class="row" style="justify-content:space-between;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap"><p class="muted" style="margin:0;flex:1 1 260px">${t('folder_access_sub')}</p><button class="btn ghost sm" id="del-empty">${IC.trash} ${t('del_empty_folders')}</button></div><label class="dn-search adm-search">${IC.search||''}<input id="fa-q" type="search" placeholder="${t('folder_search_ph')}" autocomplete="off"></label><div id="faccess"></div></details>
      <details class="card side-info acc-card"><summary><h3 style="margin:0;display:inline">${t('instr_access')}</h3> <span class="muted tnum">${(S.instrs||[]).length}</span><span class="chev">${IC.down}</span></summary><p class="muted" style="margin:10px 0">${t('instr_access_admin_sub')}</p><label class="dn-search adm-search">${IC.search||''}<input id="ia-q" type="search" placeholder="${t('search_ph')}" autocomplete="off"></label><div id="iaccess2"></div></details>
      <div class="card side-info ai-card" id="ai-card"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0"><span class="pdfi-ico ai sm">✦</span> ${t('ai_cfg')}</h3><span class="chip ${(ws.settings||{}).pdfGuide ? 'review' : 'draft'}" id="ai-state">${(ws.settings||{}).pdfGuide ? t('ai_cfg_custom') : t('ai_cfg_default')}</span></div>
        <p class="muted" style="margin:8px 0 10px">${t('ai_cfg_sub')}</p>
        <div class="field" style="margin:0"><textarea id="ai-guide" rows="14" style="box-sizing:border-box;font-size:13.5px;font-family:inherit">${esc((ws.settings||{}).pdfGuide || defaultGuide())}</textarea></div>
        <p class="muted" style="margin:8px 0 10px;font-size:12.5px">${t('ai_cfg_fixed')}</p>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn mint sm" id="ai-save">${t('ai_cfg_save')}</button><button class="btn ghost sm" id="ai-reset">${t('pdfi_guide_reset')}</button></div></div>
      <div class="card side-info" id="imp-card"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">${IC.upload} ${t('imp_title')}</h3><button class="btn sm" id="imp-open">${t('imp_open')}</button></div><p class="muted" style="margin:8px 0 0">${t('imp_card_sub')}</p></div>
      <div class="card side-info"><h3>${t('ws_settings')}</h3><div class="field" style="max-width:320px"><label for="s-days">${t('session_days')}</label><div class="row" style="flex-wrap:nowrap;align-items:center;gap:8px"><input id="s-days" type="number" min="1" max="365" step="1" value="${sessionDays()}" style="width:110px"><span class="muted">${t('days')}</span></div></div><p class="muted" style="margin:0">${t('session_days_sub')}</p></div>
    </div></main>`);
  v.querySelector('#s-days').onchange = async e => { let n = Math.round(+e.target.value); if(!(n>0)) n = SESSION_DAYS_DEFAULT; n = Math.min(365, n); e.target.value = n; const settings = Object.assign({}, ws.settings||{}, {sessionDays:n}); try{ await saveWs({settings}); toast(t('saved')); }catch(err){} };
  { const ta = v.querySelector('#ai-guide'), st = v.querySelector('#ai-state');
    const setState = custom => { st.className = 'chip ' + (custom ? 'review' : 'draft'); st.textContent = custom ? t('ai_cfg_custom') : t('ai_cfg_default'); };
    v.querySelector('#ai-save').onclick = async () => { const g = ta.value.trim(); const custom = g && g !== defaultGuide().trim(); try{ await saveWs({settings: Object.assign({}, ws.settings||{}, {pdfGuide: custom ? g : ''})}); ws.settings = Object.assign({}, ws.settings||{}, {pdfGuide: custom ? g : ''}); setState(custom); toast(t('ai_cfg_saved')); }catch(e){ toast(e.message||String(e)); } };
    v.querySelector('#ai-reset').onclick = () => { ta.value = defaultGuide(); toast(t('pdfi_guide_reset_done')); }; }
  v.querySelector('#imp-open').onclick = () => go('admin/import');
  // v0.36: bulk cleanup after a structure import – folders without instructions
  v.querySelector('#del-empty').onclick = async () => { const used = new Set((S.instrs||[]).map(i => i.folder).filter(Boolean)); const empties = (ws.folders||[]).filter(f => !used.has(f.id)); if(!empties.length){ toast(t('no_empty_folders')); return; } if(!(await confirmM(t('del_empty_folders_q', {n:empties.length})))) return; const keep = (ws.folders||[]).filter(f => used.has(f.id)); await saveWs({folders:keep}); ws.folders = keep; toast(t('del_empty_folders_done', {n:empties.length})); renderAccess(); };
  app.appendChild(v);
  if(sub==='ai'){ const c = v.querySelector('#ai-card'); setTimeout(() => { c.scrollIntoView({behavior:'smooth', block:'start'}); c.classList.add('hl'); }, 80); }
  const emails = () => [...new Set([...people.map(p=>p.email), ...(ws.invites||[]).map(i=>i.email)])];
  function renderUsers(){
    const tb = v.querySelector('#utable tbody'); tb.innerHTML = people.map(p => `<tr data-id="${p.id}"><td><b>${esc(p.name||'')}</b>${p.id===S.user.id?` <span class="muted">(${t('you')})</span>`:''}</td><td>${esc(p.email)}</td><td><select data-role ${p.id===S.user.id?'disabled':''}>${ROLES.map(r=>`<option value="${r}" ${(p.role==='admin' ? 'admin' : normRole(p.role))===r?'selected':''}>${roleLbl(r)}</option>`).join('')}</select></td><td class="tnum" style="white-space:nowrap"><button class="btn ghost sm" data-gdpr title="${t('gdpr_export')}">${IC.download}</button>${p.id!==S.user.id?` <button class="btn ghost sm del" data-rm title="${t('gdpr_erase')}">${IC.trash}</button>`:''}</td></tr>`).join('');
    $$('tr[data-id]', tb).forEach(tr => { const p = people.find(x=>x.id===tr.dataset.id);
      tr.querySelector('[data-role]').onchange = async e => { const role = e.target.value; const {error} = await G.sb.from('profiles').update({role, is_admin: role==='admin'}).eq('id', p.id); if(error){ toast(error.message); e.target.value = p.role; return; } p.role = role; p.is_admin = role==='admin'; toast(t('saved')); };
      // v12.45: GDPR – everything the workspace stores about a person as a JSON file (Art. 15 / 20)
      tr.querySelector('[data-gdpr]').onclick = async () => { const {data, error} = await G.sb.rpc('gdpr_export_user', {p_email:p.email}); if(error){ toast(error.message); return; }
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'})); a.download = `giri-go-${p.email.replace(/[^a-z0-9.@-]/gi, '_')}-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast(t('gdpr_exported')); };
      // v12.45: GDPR erase (Art. 17) – login + profile + memberships go, names in instructions/feedback become "deleted user"; runs in the database
      const rm = tr.querySelector('[data-rm]'); if(rm) rm.onclick = async () => { if(!(await confirmM(t('gdpr_erase_q',{e:p.email})))) return; const {data, error} = await G.sb.rpc('gdpr_erase_user', {p_email:p.email}); if(error){ toast(error.message); return; } people.splice(people.indexOf(p),1); renderUsers(); toast(t('gdpr_erased', {n:(data&&data.instructions_anonymised)||0})); }; });
    // v12.48: open invitations as a list – when invited, when the mail went out, send again, withdraw
    const inv = (ws.invites||[]); const dt = x => x ? new Date(+x || Date.parse(x)).toLocaleString(G.LANG, {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}) : '';
    v.querySelector('#invites').innerHTML = inv.length ? `<div class="lbl" style="margin:12px 0 6px">${t('pending_invites')} <span class="muted tnum">${inv.length}</span></div><div class="inv-list">${inv.map((i,k)=>`<div class="inv-row"><span class="inv-main"><b>${esc(i.email)}</b><small class="muted">${roleLbl(i.role)}${i.at ? ' · ' + t('inv_invited_at', {d: dt(i.at)}) : ''}${i.mailed_at ? ' · ' + t('inv_mailed_at', {d: dt(i.mailed_at)}) : ''}</small></span><button class="btn ghost sm" data-reinv="${k}" title="${t('inv_resend_sub')}">${IC.mail||''} ${t('inv_resend')}</button><button class="btn ghost sm del" data-rminv="${k}" title="${t('inv_withdraw')}" aria-label="${t('inv_withdraw')}">×</button></div>`).join('')}</div><p class="muted" style="margin:6px 0 0;font-size:12px">${t('inv_valid_note')}</p>` : '';
    $$('[data-rminv]', v).forEach(b => b.onclick = async () => { const i = ws.invites[+b.dataset.rminv]; if(!i || !(await confirmM(t('inv_withdraw_q', {e: i.email}), t('inv_withdraw')))) return; ws.invites.splice(+b.dataset.rminv, 1); await saveWs({invites:ws.invites}); renderUsers(); });
    $$('[data-reinv]', v).forEach(b => b.onclick = async () => { const i = ws.invites[+b.dataset.reinv]; if(!i) return; b.disabled = true; const r = await sendInvite(i.email, {lang: i.lang}); toast(inviteMsg(r, i.email, t)); if(r.ok){ i.mailed_at = Date.now(); renderUsers(); } else b.disabled = false; });
  }
  v.querySelector('#invite').onclick = async () => {
    const r = await modal(`<h2>${t('invite_title')}</h2><p class="muted" style="margin:0 0 12px">${t('invite_sub')}</p><div class="field"><label for="iv-mail">${t('email')}</label><input id="iv-mail" type="email" placeholder="name@${esc(S.user.ws)}" autocomplete="off"></div><div class="row" style="gap:10px;flex-wrap:wrap"><div class="field" style="flex:2 1 200px"><label for="iv-role">${t('role')}</label><select id="iv-role">${ROLES.map(r=>`<option value="${r}" ${r==='creator'?'selected':''}>${roleLbl(r)}</option>`).join('')}</select></div><div class="field" style="flex:1 1 120px"><label for="iv-lang">${t('inv_lang')}</label><select id="iv-lang"><option value="de" ${G.LANG==='de'?'selected':''}>Deutsch</option><option value="en" ${G.LANG!=='de'?'selected':''}>English</option></select></div></div><div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${t('invite')}</button></div>`, (bg, close) => { bg.querySelector('[data-x]').onclick = () => close(null); bg.querySelector('[data-ok]').onclick = () => close({email:bg.querySelector('#iv-mail').value.trim().toLowerCase(), role:bg.querySelector('#iv-role').value, lang:bg.querySelector('#iv-lang').value}); setTimeout(() => bg.querySelector('#iv-mail').focus(), 60); });
    if(!r || !r.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)){ if(r && r.email) toast(t('inv_bad_email')); return; } // v12.47: any address – the invitation decides the workspace, not the mail domain
    if(people.some(p => (p.email||'').toLowerCase() === r.email)){ toast(t('inv_already_member', {e:r.email})); return; }
    ws.invites = (ws.invites||[]).filter(i => i.email !== r.email); ws.invites.push({email:r.email, role:r.role, at:Date.now(), by:S.user.email, lang:r.lang}); await saveWs({invites:ws.invites});
    // v12.48: a real invitation mail (who, where, role, button to the sign-in page, validity) – the plain code mail only as fallback
    const res = await sendInvite(r.email, {lang:r.lang}); toast(inviteMsg(res, r.email, t)); if(res.ok){ const i = ws.invites.find(x => x.email === r.email); if(i) i.mailed_at = Date.now(); }
    renderUsers();
  };
  const openTeams = new Set();
  function renderTeams(){
    const tw = v.querySelector('#teams'); const teams = ws.teams||[];
    const tq = ((v.querySelector('#team-q')||{}).value||'').trim().toLowerCase(); const shownT = teams.filter(tm => !tq || (tm.name||'').toLowerCase().includes(tq) || (tm.members||[]).some(m => (m.email||'').includes(tq)));
    tw.innerHTML = teams.length ? shownT.map(tm => `<details class="team" data-t="${tm.id}" ${teams.length <= 4 || openTeams.has(tm.id) || tq ? 'open' : ''}><summary><span class="tsum">${IC.users||''}<b>${esc(tm.name||t('team_ph'))}</b><span class="muted">${(tm.members||[]).length} ${t((tm.members||[]).length===1 ? 'member' : 'member_many')}</span></span><span class="chev">${IC.down}</span></summary><div class="row" style="justify-content:space-between;align-items:center;margin-top:8px"><input class="tname" value="${esc(tm.name)}" placeholder="${t('team_ph')}"><button class="btn ghost sm" data-tpw title="${t('link_pw')}">${tm.pw?'🔒':'🔓'} ${t('link_pw_short')}</button><button class="btn ghost sm del" data-delt title="${t('delete')}">${IC.trash}</button></div>
      <div class="members">${(tm.members||[]).map((m,k)=>`<div class="mem"><span>${esc(m.email)}</span><select data-mrole="${k}">${TROLES.map(r=>`<option value="${r}" ${normRole(m.role)===r?'selected':''}>${roleLbl(r)}</option>`).join('')}</select><button data-mrm="${k}" title="${t('remove')}">×</button></div>`).join('')}</div>
      <div class="row" style="margin-top:8px"><input class="madd" list="dl-emails" placeholder="${t('member_email')}" style="flex:1;min-width:0"><button class="btn ghost sm" data-madd>${IC.plus} ${t('add_member')}</button></div></details>`).join('') + (tq && !shownT.length ? `<p class="muted">${t('no_result')}</p>` : '') + `<datalist id="dl-emails">${emails().map(e=>`<option value="${esc(e)}">`).join('')}</datalist>` : `<p class="muted" style="margin:0">${t('no_teams')}</p>`;
    $$('.team', tw).forEach(box => { const tm = teams.find(x=>x.id===box.dataset.t); box.addEventListener('toggle', () => { if(box.open) openTeams.add(tm.id); else openTeams.delete(tm.id); });
      box.querySelector('.tname').oninput = e => { tm.name = e.target.value; debounce('team'+tm.id, () => saveWs({teams}).then(renderAccess)); };
      box.querySelector('[data-tpw]').onclick = async () => { const r = await pwDialog(tm.name, !!tm.pw); if(r===undefined) return; if(r) tm.pw = r; else delete tm.pw; await saveWs({teams}); toast(t('saved')); renderTeams(); };
      box.querySelector('[data-delt]').onclick = async () => { if(!(await confirmM(t('delete')+': '+tm.name))) return; teams.splice(teams.indexOf(tm),1); (ws.folders||[]).forEach(f => f.teams = (f.teams||[]).filter(x=>x!==tm.id)); await saveWs({teams, folders:ws.folders}); renderTeams(); renderAccess(); };
      $$('[data-mrole]', box).forEach(sel => sel.onchange = async () => { tm.members[+sel.dataset.mrole].role = sel.value; await saveWs({teams}); toast(t('saved')); });
      $$('[data-mrm]', box).forEach(b => b.onclick = async () => { tm.members.splice(+b.dataset.mrm, 1); await saveWs({teams}); renderTeams(); });
      const addI = box.querySelector('.madd'); const add = async () => { const em = addI.value.trim().toLowerCase(); if(!em || !em.includes('@')) return; tm.members = tm.members||[]; if(!tm.members.find(m=>m.email===em)) tm.members.push({email:em, role:'viewer'}); await saveWs({teams}); renderTeams(); };
      box.querySelector('[data-madd]').onclick = add; addI.onkeydown = e => { if(e.key==='Enter') add(); }; });
  }
  v.querySelector('#newteam').onclick = async () => { const name = await promptM(t('new_team'), t('team_ph'), ''); if(!name || !name.trim()) return; ws.teams = ws.teams||[]; ws.teams.push({id:uid(), name:name.trim(), members:[]}); await saveWs({teams:ws.teams}); renderTeams(); renderAccess(); };
  let faAll = false, iaAll = false;
  function renderAccess(){
    const fa = v.querySelector('#faccess'); const folders = ws.folders||[], teams = ws.teams||[];
    const fq = ((v.querySelector('#fa-q')||{}).value||'').trim().toLowerCase(); const fShown = folders.filter(f => !fq || (f.name||'').toLowerCase().includes(fq)); const fLim = faAll ? fShown.length : 50;
    fa.innerHTML = folders.length ? `<div class="tbl-wrap"><table class="res"><thead><tr><th>${t('folder')}</th>${teams.map(tm=>`<th>${esc(tm.name)}</th>`).join('')}<th class="muted">${t('instructions')}</th></tr></thead><tbody>${fShown.slice(0, fLim).map(f=>`<tr data-f="${f.id}"><td><b>${IC.folder} ${esc(f.name)}</b></td>${teams.map(tm=>`<td><input type="checkbox" data-tm="${tm.id}" ${(f.teams||[]).includes(tm.id)?'checked':''}></td>`).join('')}<td class="tnum muted">${S.instrs.filter(i=>i.folder===f.id).length}</td></tr>`).join('')}</tbody></table></div>${fShown.length > fLim ? `<button class="flink" id="fa-all" style="margin-top:8px">${t('folders_all', {n: fShown.length})}</button>` : ''}` : `<p class="muted" style="margin:0">${t('no_folders')}</p>`;
    { const fb = fa.querySelector('#fa-all'); if(fb) fb.onclick = () => { faAll = true; renderAccess(); }; }
    $$('tr[data-f]', fa).forEach(tr => { const f = folders.find(x=>x.id===tr.dataset.f); $$('[data-tm]', tr).forEach(cb => cb.onchange = async () => { f.teams = f.teams||[]; if(cb.checked){ if(!f.teams.includes(cb.dataset.tm)) f.teams.push(cb.dataset.tm); } else f.teams = f.teams.filter(x=>x!==cb.dataset.tm); await saveWs({folders}); toast(t('saved')); }); });
    // single instructions → teams (in addition to the project's teams)
    const ia = v.querySelector('#iaccess2'); if(!ia) return; const iq = ((v.querySelector('#ia-q')||{}).value||'').trim().toLowerCase(); const list = [...S.instrs].filter(i => !iq || (i.title||'').toLowerCase().includes(iq) || (folderName(i.folder)||'').toLowerCase().includes(iq)).sort((a,b) => (folderName(a.folder)||'').localeCompare(folderName(b.folder)||'') || a.title.localeCompare(b.title)); const iLim = iaAll ? list.length : 50;
    ia.innerHTML = (teams.length && list.length) ? `<div class="tbl-wrap"><table class="res"><thead><tr><th>${t('instruction')}</th><th class="muted">${t('folder')}</th>${teams.map(tm=>`<th>${esc(tm.name)}</th>`).join('')}</tr></thead><tbody>${list.slice(0, iLim).map(i=>`<tr data-i="${i.id}"><td><b>${esc(i.title)}</b></td><td class="muted">${esc(folderName(i.folder)||'–')}</td>${teams.map(tm=>`<td><input type="checkbox" data-tm="${tm.id}" ${(i.teams||[]).includes(tm.id)?'checked':''} ${folderTeams(i.folder).includes(tm.id)?'disabled title="'+t('via_project')+'"':''}></td>`).join('')}</tr>`).join('')}</tbody></table></div>${list.length > iLim ? `<button class="flink" id="ia-all" style="margin-top:8px">${t('list_more', {n: list.length - iLim, total: list.length - iLim})}</button>` : ''}` : `<p class="muted" style="margin:0">${teams.length ? (iq ? t('no_result') : t('empty_title')) : t('no_teams_short')}</p>`;
    { const ib = ia.querySelector('#ia-all'); if(ib) ib.onclick = () => { iaAll = true; renderAccess(); }; }
    $$('tr[data-i]', ia).forEach(tr => { const i = S.instrs.find(x=>x.id===tr.dataset.i); $$('[data-tm]', tr).forEach(cb => cb.onchange = async () => { i.teams = (i.teams||[]).filter(x=>x!==cb.dataset.tm); if(cb.checked) i.teams.push(cb.dataset.tm); await saveInstr(i); toast(t('saved')); }); });
  }
  renderUsers(); renderTeams(); renderAccess();
  { let tmr = 0; const deb = f => () => { clearTimeout(tmr); tmr = setTimeout(f, 120); };
    const tq = v.querySelector('#team-q'); if(tq) tq.oninput = deb(renderTeams);
    const fq = v.querySelector('#fa-q'); if(fq) fq.oninput = deb(() => { faAll = false; renderAccess(); });
    const iq = v.querySelector('#ia-q'); if(iq) iq.oninput = deb(() => { iaAll = false; renderAccess(); }); }
}

export { renderAdmin };
