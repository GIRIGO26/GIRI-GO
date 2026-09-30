/* ---------- v12.47: Master admin (platform) – every workspace, its plan, its people; move users, merge workspaces, demo accounts.
   Only for platform admins (public.platform_admins → is_master()); everything runs through SECURITY DEFINER RPCs that check
   is_master() themselves, so the page is only a window – nothing here grants anything. ---------- */
import { go } from '../app/router.js';
import { $$, confirmM, el, esc, modal, toast } from '../core/helpers.js';
import { t } from '../core/i18n.js';
import { G, S } from '../core/state.js';
import { IC } from '../ui/icons.js';
import { topbar } from '../ui/topbar.js';

const fmtD = v => v ? new Date(v).toLocaleDateString('de-DE') : '–';
const ago = v => { if(!v) return '–'; const d = Math.floor((Date.now() - new Date(v)) / 864e5); return d <= 0 ? t('today') : d === 1 ? t('yesterday') : t('days_ago', {n:d}); };
const planChip = w => { const days = w.plan_until ? Math.ceil((new Date(w.plan_until) - Date.now()) / 864e5) : null; const cls = w.plan === 'suspended' ? 'draft' : (days != null && days <= 0) ? 'review' : w.plan === 'active' ? 'published' : 'review'; return `<span class="chip dot ${cls}">${esc(w.plan)}${days != null && w.plan !== 'active' ? ` · ${days <= 0 ? t('plan_over') : days + ' d'}` : ''}</span>`; };
const rpc = async (fn, args) => { const {data, error} = await G.sb.rpc(fn, args || {}); if(error) throw new Error(error.message || String(error)); return data; };

async function renderMaster(app){
  topbar(app, {back:'/', sub:t('master')});
  if(!S.user || !S.user.isMaster){ app.appendChild(el(`<main class="page page-narrow"><div class="card empty"><h2>${t('master')}</h2><div>${t('master_only')}</div></div></main>`)); return; }
  const v = el(`<main class="page"><div class="dash-head"><div><h1>${t('master')}</h1><div class="sub">${t('master_sub')}</div></div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm" id="m-demo">${IC.plus} ${t('master_demo')}</button><button class="btn ghost sm" id="m-admin">${IC.users} ${t('master_add_admin')}</button></div></div>
    <div class="card side-info" style="margin-bottom:12px"><div class="row" style="gap:10px;align-items:center;flex-wrap:wrap"><label class="searchwrap" style="flex:1;min-width:220px">${IC.search}<input id="m-q" type="search" placeholder="${t('master_search')}"></label><span class="muted tnum" id="m-n"></span></div></div>
    <div class="tbl-wrap card side-info" style="padding:0"><table class="res" id="m-table"><thead><tr><th>${t('workspace')}</th><th>${t('plan')}</th><th>${t('users')}</th><th>${t('instructions')}</th><th>${t('master_last')}</th><th>${t('master_owner')}</th><th></th></tr></thead><tbody></tbody></table></div>
    <div id="m-detail"></div></main>`);
  app.appendChild(v);
  let rows = []; let open = null;
  const load = async () => { try{ rows = await rpc('master_overview'); }catch(e){ toast(e.message); rows = []; } draw(); };
  const draw = () => {
    const q = (v.querySelector('#m-q').value || '').trim().toLowerCase();
    const list = rows.filter(w => !q || [w.ws, w.name, w.owner_email, w.plan_note].some(x => (x || '').toLowerCase().includes(q)));
    v.querySelector('#m-n').textContent = t('master_count', {n:list.length, total:rows.length});
    const tb = v.querySelector('#m-table tbody'); tb.innerHTML = list.map(w => `<tr data-ws="${esc(w.ws)}" class="${open === w.ws ? 'sel' : ''}"><td><b>${esc(w.name || w.ws)}</b><br><span class="muted" style="font-size:12px">${esc(w.ws)}${w.open_domain ? ' · ' + t('master_open_domain') : ''}</span></td><td>${planChip(w)}${w.seats ? `<br><span class="muted" style="font-size:12px">${w.users}/${w.seats} ${t('master_seats')}</span>` : ''}</td><td class="tnum">${w.users}</td><td class="tnum">${w.instructions}<span class="muted"> · ${w.published} ${t('published_short')}</span></td><td class="muted" style="font-size:12.5px">${t('master_login')} ${ago(w.last_login)}<br>${t('master_edit')} ${ago(w.last_activity)}</td><td class="muted" style="font-size:12.5px">${esc(w.owner_email || '')}<br>${t('since')} ${fmtD(w.created_at)}</td><td><button class="btn ghost sm" data-open="${esc(w.ws)}">${open === w.ws ? t('close') : t('master_manage')}</button></td></tr>`).join('') || `<tr><td colspan="7" class="muted">${t('no_result')}</td></tr>`;
    $$('[data-open]', tb).forEach(b => b.onclick = () => { open = open === b.dataset.open ? null : b.dataset.open; draw(); detail(); });
  };
  v.querySelector('#m-q').oninput = draw;
  // ---- detail: plan form, users, move / merge ----
  async function detail(){
    const box = v.querySelector('#m-detail'); box.innerHTML = ''; if(!open) return; const w = rows.find(x => x.ws === open); if(!w) return;
    const until = w.plan_until ? new Date(w.plan_until).toISOString().slice(0, 10) : '';
    const others = rows.filter(x => x.ws !== w.ws);
    const d = el(`<div class="card side-info" style="margin-top:12px"><div class="row" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h3 style="margin:0">${esc(w.name || w.ws)} <span class="muted" style="font-weight:500">· ${esc(w.ws)}</span></h3><span class="muted" style="font-size:12.5px">${t('since')} ${fmtD(w.created_at)} · ${esc(w.owner_email || '')}</span></div>
      <div class="two" style="margin-top:12px">
        <div class="field"><label>${t('master_name')}</label><input id="p-name" value="${esc(w.name || '')}"></div>
        <div class="field"><label>${t('plan')}</label><select id="p-plan">${['trial', 'active', 'demo', 'suspended'].map(p => `<option value="${p}" ${p === w.plan ? 'selected' : ''}>${t('plan_' + p + '_l')}</option>`).join('')}</select></div>
        <div class="field"><label>${t('master_until')}</label><input id="p-until" type="date" value="${until}"></div>
        <div class="field"><label>${t('master_seats')}</label><input id="p-seats" type="number" min="1" step="1" value="${w.seats || ''}" placeholder="∞"></div>
        <div class="field"><label>${t('master_note')}</label><input id="p-note" value="${esc(w.plan_note || '')}"></div>
        <div class="field"><label class="toggle" style="margin-top:22px"><input type="checkbox" id="p-open" ${w.open_domain ? 'checked' : ''}> <span>${t('master_open_domain_l')}<br><span class="muted" style="font-weight:500">${t('master_open_domain_sub')}</span></span></label></div>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm" id="p-save">${t('save')}</button><button class="btn ghost sm" id="p-move">${IC.users} ${t('master_move')}</button>${others.length ? `<button class="btn ghost sm" id="p-merge">${IC.folder} ${t('master_merge')}</button>` : ''}</div>
      <h4 style="margin:18px 0 6px">${t('users')} <span class="muted tnum" id="u-n"></span></h4>
      <div class="tbl-wrap"><table class="res" id="u-table"><thead><tr><th>${t('name')}</th><th>${t('email')}</th><th>${t('role')}</th><th>${t('master_login')}</th><th>${t('instructions')}</th><th></th></tr></thead><tbody><tr><td colspan="6" class="muted">…</td></tr></tbody></table></div></div>`);
    box.appendChild(d); d.scrollIntoView({block:'nearest', behavior:'smooth'});
    d.querySelector('#p-save').onclick = async () => { const b = d.querySelector('#p-save'); b.disabled = true; try{
        const un = d.querySelector('#p-until').value; const seats = +d.querySelector('#p-seats').value || null;
        await rpc('master_set_plan', {p_ws:w.ws, p_plan:d.querySelector('#p-plan').value, p_until: un ? new Date(un + 'T23:59:59').toISOString() : null, p_seats:seats, p_note:d.querySelector('#p-note').value.trim() || null, p_open_domain:d.querySelector('#p-open').checked, p_name:d.querySelector('#p-name').value.trim() || null});
        toast(t('saved')); await load(); detail(); }catch(e){ toast(e.message); } b.disabled = false; };
    d.querySelector('#p-move').onclick = async () => {
      const r = await modal(`<h2>${t('master_move')}</h2><p class="muted" style="margin:0 0 12px">${t('master_move_sub', {w: w.name || w.ws})}</p><div class="field"><label for="mv-mail">${t('email')}</label><input id="mv-mail" type="email" placeholder="name@firma.de"></div><label class="toggle"><input type="checkbox" id="mv-with" checked> <span>${t('master_move_with')}</span></label><div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${t('master_move')}</button></div>`, (bg, close) => { bg.querySelector('[data-x]').onclick = () => close(null); bg.querySelector('[data-ok]').onclick = () => close({email:bg.querySelector('#mv-mail').value.trim().toLowerCase(), with:bg.querySelector('#mv-with').checked}); });
      if(!r || !r.email) return; try{ const res = await rpc('master_move_user', {p_email:r.email, p_ws:w.ws, p_with_instructions:r.with}); toast(res && res.moved ? t('master_moved', {n:res.instructions || 0}) : t('master_move_same')); await load(); detail(); }catch(e){ toast(e.message); } };
    const mg = d.querySelector('#p-merge'); if(mg) mg.onclick = async () => {
      const r = await modal(`<h2>${t('master_merge')}</h2><p class="muted" style="margin:0 0 12px">${t('master_merge_sub', {w: w.name || w.ws})}</p><div class="field"><label for="mg-into">${t('master_merge_into')}</label><select id="mg-into">${others.map(x => `<option value="${esc(x.ws)}">${esc(x.name || x.ws)} (${esc(x.ws)} · ${x.users} ${t('users')})</option>`).join('')}</select></div><div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn danger" data-ok>${t('master_merge')}</button></div>`, (bg, close) => { bg.querySelector('[data-x]').onclick = () => close(null); bg.querySelector('[data-ok]').onclick = () => close(bg.querySelector('#mg-into').value); });
      if(!r) return; if(!(await confirmM(t('master_merge_q', {a: w.name || w.ws, b: r}), t('master_merge')))) return;
      try{ const res = await rpc('master_merge_workspace', {p_from:w.ws, p_into:r}); toast(t('master_merged', {n:res.instructions || 0, u:res.users || 0})); open = r; await load(); detail(); }catch(e){ toast(e.message); } };
    try{ const users = await rpc('master_users', {p_ws:w.ws}); d.querySelector('#u-n').textContent = users.length;
      d.querySelector('#u-table tbody').innerHTML = users.map(u => `<tr><td><b>${esc(u.name || '')}</b></td><td>${esc(u.email)}</td><td>${esc(u.role)}${u.is_admin ? ' <span class="chip dot published" style="font-size:11px">Admin</span>' : ''}</td><td class="muted">${u.last_login ? fmtD(u.last_login) : t('master_never')}</td><td class="tnum">${u.instructions}</td><td><button class="btn ghost sm" data-link="${esc(u.email)}" title="${t('master_link_sub')}">${IC.mail} ${t('master_link')}</button></td></tr>`).join('') || `<tr><td colspan="6" class="muted">${t('no_result')}</td></tr>`;
      $$('[data-link]', d).forEach(b => b.onclick = () => sendLink(b.dataset.link, b)); }catch(e){ d.querySelector('#u-table tbody').innerHTML = `<tr><td colspan="6" class="muted">${esc(e.message)}</td></tr>`; }
  }
  // a login code/link for someone (also the way to hand a demo account over)
  const sendLink = async (email, b) => { if(b) b.disabled = true; const {error} = await G.sb.auth.signInWithOtp({email, options:{shouldCreateUser:true, emailRedirectTo: location.href.split('#')[0]}}); if(b) b.disabled = false; toast(error ? error.message : t('invited', {e:email})); };
  v.querySelector('#m-demo').onclick = async () => {
    const r = await modal(`<h2>${t('master_demo')}</h2><p class="muted" style="margin:0 0 12px">${t('master_demo_sub')}</p><div class="field"><label for="dm-mail">${t('email')}</label><input id="dm-mail" type="email" placeholder="kunde@firma.de"></div><div class="field"><label for="dm-name">${t('master_name')}</label><input id="dm-name" placeholder="Firma GmbH"></div><div class="field" style="max-width:160px"><label for="dm-days">${t('master_days')}</label><input id="dm-days" type="number" min="1" max="365" value="30"></div><div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${t('master_demo')}</button></div>`, (bg, close) => { bg.querySelector('[data-x]').onclick = () => close(null); bg.querySelector('[data-ok]').onclick = () => close({email:bg.querySelector('#dm-mail').value.trim().toLowerCase(), name:bg.querySelector('#dm-name').value.trim(), days:+bg.querySelector('#dm-days').value || 30}); });
    if(!r || !r.email) return;
    try{ const ws = await rpc('master_create_demo', {p_email:r.email, p_name:r.name, p_days:r.days}); toast(t('master_demo_done', {w:ws})); await load(); open = ws; detail(); if(await confirmM(t('master_demo_link_q', {e:r.email}), t('master_link'))) sendLink(r.email); }catch(e){ toast(e.message); } };
  v.querySelector('#m-admin').onclick = async () => {
    const r = await modal(`<h2>${t('master_add_admin')}</h2><p class="muted" style="margin:0 0 12px">${t('master_add_admin_sub')}</p><div class="field"><label for="ma-mail">${t('email')}</label><input id="ma-mail" type="email"></div><div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${t('add')}</button></div>`, (bg, close) => { bg.querySelector('[data-x]').onclick = () => close(null); bg.querySelector('[data-ok]').onclick = () => close(bg.querySelector('#ma-mail').value.trim().toLowerCase()); });
    if(!r) return; try{ await rpc('master_add_admin', {p_email:r}); toast(t('saved')); }catch(e){ toast(e.message); } };
  await load();
  void go;
}

export { renderMaster };
