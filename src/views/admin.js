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
import { debounce } from './editor.js';
import { defaultGuide } from '../media/pdfimport.js';


/* ---------- Admin panel: users, teams, project access ---------- */
async function renderAdmin(app, sub){
  topbar(app, {back:'/', sub:t('admin')});
  if(!S.user.isAdmin){ app.appendChild(el(`<main class="page page-narrow"><div class="card empty"><h2>${t('admin')}</h2><div>${t('only_admin')}</div></div></main>`)); return; }
  const ws = await loadWs(true); const {data:prows} = await G.sb.from('profiles').select('*').eq('ws', S.user.ws).order('created_at');
  const people = prows||[]; const ROLES = ['admin','creator','reviewer','viewer']; const TROLES = ['creator','reviewer','viewer'];
  const v = el(`<main class="page"><div class="dash-head"><div><h1>${t('admin')}</h1><div class="sub">${t('admin_sub')} · ${esc(S.user.ws)}</div></div></div>
    <div class="settings" style="max-width:900px">
      <div class="card side-info"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">${t('users')} <span class="muted tnum">${people.length}</span></h3><button class="btn sm" id="invite">${IC.plus} ${t('invite')}</button></div>
        <div class="tbl-wrap" style="margin-top:10px"><table class="res" id="utable"><thead><tr><th>${t('name')}</th><th>${t('email')}</th><th>${t('role')}</th><th></th></tr></thead><tbody></tbody></table></div>
        <div id="invites"></div></div>
      <div class="card side-info"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">${t('teams')}</h3><button class="btn ghost sm" id="newteam">${IC.plus} ${t('new_team')}</button></div><div id="teams" style="margin-top:10px"></div></div>
      <div class="card side-info"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">${t('folder_access')}</h3><button class="btn ghost sm" id="del-empty">${IC.trash} ${t('del_empty_folders')}</button></div><p class="muted" style="margin:8px 0 10px">${t('folder_access_sub')}</p><div id="faccess"></div></div>
      <div class="card side-info"><h3>${t('instr_access')}</h3><p class="muted" style="margin:0 0 10px">${t('instr_access_admin_sub')}</p><div id="iaccess2"></div></div>
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
    const tb = v.querySelector('#utable tbody'); tb.innerHTML = people.map(p => `<tr data-id="${p.id}"><td><b>${esc(p.name||'')}</b>${p.id===S.user.id?` <span class="muted">(${t('you')})</span>`:''}</td><td>${esc(p.email)}</td><td><select data-role ${p.id===S.user.id?'disabled':''}>${ROLES.map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${roleLbl(r)}</option>`).join('')}</select></td><td>${p.id!==S.user.id?`<button class="btn ghost sm del" data-rm title="${t('remove_user')}">${IC.trash}</button>`:''}</td></tr>`).join('');
    $$('tr[data-id]', tb).forEach(tr => { const p = people.find(x=>x.id===tr.dataset.id);
      tr.querySelector('[data-role]').onchange = async e => { const role = e.target.value; const {error} = await G.sb.from('profiles').update({role, is_admin: role==='admin'}).eq('id', p.id); if(error){ toast(error.message); e.target.value = p.role; return; } p.role = role; p.is_admin = role==='admin'; toast(t('saved')); };
      const rm = tr.querySelector('[data-rm]'); if(rm) rm.onclick = async () => { if(!(await confirmM(t('remove_user_q',{e:p.email})))) return; const {error} = await G.sb.from('profiles').delete().eq('id', p.id); if(error){ toast(error.message); return; } people.splice(people.indexOf(p),1); renderUsers(); toast(t('deleted')); }; });
    const inv = (ws.invites||[]); v.querySelector('#invites').innerHTML = inv.length ? `<div class="lbl" style="margin:12px 0 6px">${t('pending_invites')}</div><div class="row" style="flex-wrap:wrap;gap:6px">${inv.map((i,k)=>`<span class="chip draft">${esc(i.email)} · ${roleLbl(i.role)} <button data-rminv="${k}" style="margin-left:4px;font-weight:800">×</button></span>`).join('')}</div>` : '';
    $$('[data-rminv]', v).forEach(b => b.onclick = async () => { ws.invites.splice(+b.dataset.rminv, 1); await saveWs({invites:ws.invites}); renderUsers(); });
  }
  v.querySelector('#invite').onclick = async () => {
    const r = await modal(`<h2>${t('invite_title')}</h2><p class="muted" style="margin:0 0 12px">${t('invite_sub')}</p><div class="field"><label for="iv-mail">${t('email')}</label><input id="iv-mail" type="email" placeholder="name@${esc(S.user.ws)}"></div><div class="field"><label for="iv-role">${t('role')}</label><select id="iv-role">${ROLES.map(r=>`<option value="${r}">${roleLbl(r)}</option>`).join('')}</select></div><div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${t('invite')}</button></div>`, (bg, close) => { bg.querySelector('[data-x]').onclick = () => close(null); bg.querySelector('[data-ok]').onclick = () => close({email:bg.querySelector('#iv-mail').value.trim().toLowerCase(), role:bg.querySelector('#iv-role').value}); });
    if(!r || !r.email) return; if(r.email.split('@')[1] !== S.user.ws){ toast(t('ws_note')); return; }
    ws.invites = (ws.invites||[]).filter(i => i.email !== r.email); ws.invites.push({email:r.email, role:r.role, at:Date.now(), by:S.user.email}); await saveWs({invites:ws.invites});
    const {error} = await G.sb.auth.signInWithOtp({email:r.email, options:{shouldCreateUser:true, emailRedirectTo: location.href.split('#')[0]}}); if(error) toast(error.message); else toast(t('invited',{e:r.email}));
    renderUsers();
  };
  function renderTeams(){
    const tw = v.querySelector('#teams'); const teams = ws.teams||[];
    tw.innerHTML = teams.length ? teams.map(tm => `<div class="team" data-t="${tm.id}"><div class="row" style="justify-content:space-between;align-items:center"><input class="tname" value="${esc(tm.name)}" placeholder="${t('team_ph')}"><button class="btn ghost sm" data-tpw title="${t('link_pw')}">${tm.pw?'🔒':'🔓'} ${t('link_pw_short')}</button><button class="btn ghost sm del" data-delt title="${t('delete')}">${IC.trash}</button></div>
      <div class="members">${(tm.members||[]).map((m,k)=>`<div class="mem"><span>${esc(m.email)}</span><select data-mrole="${k}">${TROLES.map(r=>`<option value="${r}" ${m.role===r?'selected':''}>${roleLbl(r)}</option>`).join('')}</select><button data-mrm="${k}" title="${t('remove')}">×</button></div>`).join('')}</div>
      <div class="row" style="margin-top:8px"><input class="madd" list="dl-emails" placeholder="${t('member_email')}" style="flex:1;min-width:0"><button class="btn ghost sm" data-madd>${IC.plus} ${t('add_member')}</button></div></div>`).join('') + `<datalist id="dl-emails">${emails().map(e=>`<option value="${esc(e)}">`).join('')}</datalist>` : `<p class="muted" style="margin:0">${t('no_teams')}</p>`;
    $$('.team', tw).forEach(box => { const tm = teams.find(x=>x.id===box.dataset.t);
      box.querySelector('.tname').oninput = e => { tm.name = e.target.value; debounce('team'+tm.id, () => saveWs({teams}).then(renderAccess)); };
      box.querySelector('[data-tpw]').onclick = async () => { const r = await pwDialog(tm.name, !!tm.pw); if(r===undefined) return; if(r) tm.pw = r; else delete tm.pw; await saveWs({teams}); toast(t('saved')); renderTeams(); };
      box.querySelector('[data-delt]').onclick = async () => { if(!(await confirmM(t('delete')+': '+tm.name))) return; teams.splice(teams.indexOf(tm),1); (ws.folders||[]).forEach(f => f.teams = (f.teams||[]).filter(x=>x!==tm.id)); await saveWs({teams, folders:ws.folders}); renderTeams(); renderAccess(); };
      $$('[data-mrole]', box).forEach(sel => sel.onchange = async () => { tm.members[+sel.dataset.mrole].role = sel.value; await saveWs({teams}); toast(t('saved')); });
      $$('[data-mrm]', box).forEach(b => b.onclick = async () => { tm.members.splice(+b.dataset.mrm, 1); await saveWs({teams}); renderTeams(); });
      const addI = box.querySelector('.madd'); const add = async () => { const em = addI.value.trim().toLowerCase(); if(!em || !em.includes('@')) return; tm.members = tm.members||[]; if(!tm.members.find(m=>m.email===em)) tm.members.push({email:em, role:'viewer'}); await saveWs({teams}); renderTeams(); };
      box.querySelector('[data-madd]').onclick = add; addI.onkeydown = e => { if(e.key==='Enter') add(); }; });
  }
  v.querySelector('#newteam').onclick = async () => { const name = await promptM(t('new_team'), t('team_ph'), ''); if(!name || !name.trim()) return; ws.teams = ws.teams||[]; ws.teams.push({id:uid(), name:name.trim(), members:[]}); await saveWs({teams:ws.teams}); renderTeams(); renderAccess(); };
  function renderAccess(){
    const fa = v.querySelector('#faccess'); const folders = ws.folders||[], teams = ws.teams||[];
    fa.innerHTML = folders.length ? `<div class="tbl-wrap"><table class="res"><thead><tr><th>${t('folder')}</th>${teams.map(tm=>`<th>${esc(tm.name)}</th>`).join('')}<th class="muted">${t('instructions')}</th></tr></thead><tbody>${folders.map(f=>`<tr data-f="${f.id}"><td><b>${IC.folder} ${esc(f.name)}</b></td>${teams.map(tm=>`<td><input type="checkbox" data-tm="${tm.id}" ${(f.teams||[]).includes(tm.id)?'checked':''}></td>`).join('')}<td class="tnum muted">${S.instrs.filter(i=>i.folder===f.id).length}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted" style="margin:0">${t('no_folders')}</p>`;
    $$('tr[data-f]', fa).forEach(tr => { const f = folders.find(x=>x.id===tr.dataset.f); $$('[data-tm]', tr).forEach(cb => cb.onchange = async () => { f.teams = f.teams||[]; if(cb.checked){ if(!f.teams.includes(cb.dataset.tm)) f.teams.push(cb.dataset.tm); } else f.teams = f.teams.filter(x=>x!==cb.dataset.tm); await saveWs({folders}); toast(t('saved')); }); });
    // single instructions → teams (in addition to the project's teams)
    const ia = v.querySelector('#iaccess2'); if(!ia) return; const list = [...S.instrs].sort((a,b) => (folderName(a.folder)||'').localeCompare(folderName(b.folder)||'') || a.title.localeCompare(b.title));
    ia.innerHTML = (teams.length && list.length) ? `<div class="tbl-wrap"><table class="res"><thead><tr><th>${t('instruction')}</th><th class="muted">${t('folder')}</th>${teams.map(tm=>`<th>${esc(tm.name)}</th>`).join('')}</tr></thead><tbody>${list.map(i=>`<tr data-i="${i.id}"><td><b>${esc(i.title)}</b></td><td class="muted">${esc(folderName(i.folder)||'–')}</td>${teams.map(tm=>`<td><input type="checkbox" data-tm="${tm.id}" ${(i.teams||[]).includes(tm.id)?'checked':''} ${folderTeams(i.folder).includes(tm.id)?'disabled title="'+t('via_project')+'"':''}></td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="muted" style="margin:0">${teams.length ? t('empty_title') : t('no_teams_short')}</p>`;
    $$('tr[data-i]', ia).forEach(tr => { const i = S.instrs.find(x=>x.id===tr.dataset.i); $$('[data-tm]', tr).forEach(cb => cb.onchange = async () => { i.teams = (i.teams||[]).filter(x=>x!==cb.dataset.tm); if(cb.checked) i.teams.push(cb.dataset.tm); await saveInstr(i); toast(t('saved')); }); });
  }
  renderUsers(); renderTeams(); renderAccess();
}

export { renderAdmin };
