import { signOutAll } from '../core/auth.js';
import { installGuide, isStandalone } from '../app/pwa.js';
import { go, render } from '../app/router.js';
import { APP_VERSION, LEGAL } from '../core/config.js';
import { $$, el, esc, modal, toast } from '../core/helpers.js';
import { I18N, langMenu, loadUiLang, t } from '../core/i18n.js';
import { G, S } from '../core/state.js';
import { FLAGS } from '../core/translate.js';
import { IC } from './icons.js';
import { initials, newFolderDlg, roleLbl } from '../views/dashboard.js';
import { brandModal } from '../views/branding.js';


/* ---------- Top bar (v0.34): logo · where am I · one menu button ---------- */
function topbar(app, opts={}){
  const tb = el(`<header class="topbar">
    ${opts.back ? `<button class="tb-btn" data-back aria-label="back">${IC.back}</button>` : ''}
    <div class="brand"><span class="logo" role="img" aria-label="GIRI"></span><span class="wordmark">GIRI</span>${opts.sub ? `<span class="where"><span class="sep"></span><span class="where-t">${esc(opts.sub)}</span></span>`:''}</div>
    <div class="spacer"></div>
    <button class="tb-btn tb-lang" data-lang title="${t('language')}">${FLAGS[G.LANG.toUpperCase()]||''} <span class="tb-langc">${G.LANG.toUpperCase()}</span></button>
    ${S.user ? `<button class="tb-btn tb-user" id="tbmenu" data-menu aria-haspopup="menu" title="${t('menu')}"><span class="avatar">${esc(initials(S.user.name))}</span><span class="tb-name">${esc(S.user.name.split(' ')[0])}</span><span class="tb-burger">${IC.menu}</span></button>` : ''}
  </header>`);
  const lb = tb.querySelector('[data-lang]'); if(lb) lb.onclick = pickLang;
  if(opts.back) tb.querySelector('[data-back]').onclick = () => go(opts.back);
  const mb = tb.querySelector('[data-menu]'); if(mb) mb.onclick = appMenu;
  app.appendChild(tb);
}
const pickLang = () => langMenu(async l => { const ll = l.toLowerCase(); if(!I18N[ll]) toast(t('translating')); if(!(await loadUiLang(ll))) return; G.LANG = ll; try{localStorage.setItem('gg_lang', G.LANG);}catch(e){} render(); });
// the one menu behind the avatar: workspace things, administration, app, account
function appMenu(){
  const u = S.user; const isEditor = ['admin','creator','reviewer'].includes(u.role) || u.isAdmin;
  modal(`<div class="appmenu"><div class="me"><span class="avatar big">${esc(initials(u.name))}</span><div><b>${esc(u.name)}</b><span>${esc(u.email||'')}</span><span class="chip dot published" style="margin-top:6px">${roleLbl(u.role)}</span></div></div>
    <div class="menu">
      <div class="menu-h">${t('workspace')}</div>
      ${isEditor?`<button data-m="newf">${IC.folder} ${t('new_folder_menu')}</button>`:''}<button data-m="stats">${IC.eye} ${t('global_stats')}</button><button data-m="trash">${IC.trash} ${t('trash')}</button>${isEditor?`<button data-m="brand">${IC.brand} ${t('branding')}</button>`:''}
      ${u.isAdmin?`<div class="menu-h">${t('menu_admin')}</div><button data-m="admin">${IC.gear} ${t('ws_admin')}</button><button data-m="ai"><span class="emo">✦</span> ${t('ai_cfg')}</button><button data-m="import">${IC.upload} ${t('imp_title')}</button>`:''}
      <div class="menu-h">${t('menu_app')}</div>
      ${isStandalone()?'':`<button data-m="install"><span class="emo">📲</span> ${t('install_app')}</button>`}<button data-m="profile">${IC.edit} ${t('menu_profile')}</button><button data-m="logout">${IC.close} ${t('logout')}</button>
    </div>
    <div class="menu-foot app-ver">GIRI v${APP_VERSION} · ${esc(u.ws)}</div><div class="menu-legal"><a href="${LEGAL.imprint}" target="_blank" rel="noopener">${t('imprint')}</a> · <a href="${LEGAL.legal}" target="_blank" rel="noopener">${t('privacy_dpa')}</a></div></div>`, (bg, close) => {
    $$('[data-m]', bg).forEach(b => b.onclick = async () => { const m = b.dataset.m; if(m==='lang'){ close(); pickLang(); return; } close();
      if(m==='newf'){ const nf = await newFolderDlg(); if(nf) go('p/'+nf.id); } else if(m==='stats') go('stats'); else if(m==='trash') go('trash'); else if(m==='brand') brandModal(); else if(m==='admin') go('admin'); else if(m==='ai') go('admin/ai'); else if(m==='import') go('admin/import'); else if(m==='install') installGuide(); else if(m==='profile') profileModal(); else if(m==='logout'){ await signOutAll(); go(''); render(); } });
  });
}

async function profileModal(){
  const r = await modal(`<div class="me"><span class="avatar big">${esc(initials(S.user.name))}</span><div><b>${esc(S.user.name)}</b><span>${esc(S.user.email||'')}</span><span class="chip dot published" style="margin-top:6px">${roleLbl(S.user.role)}</span></div></div><div class="field"><label for="pf-name">${t('name')}</label><input id="pf-name" value="${esc(S.user.name)}"></div><p class="muted">${t('role_note2')}</p><p class="muted" style="margin-top:8px;opacity:.7">GIRI v${APP_VERSION} · ${esc(S.user.ws)}</p><div class="actions"><button class="btn ghost" data-logout2 style="margin-right:auto">${t('logout')}</button><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${t('save')}</button></div>`, (bg, close) => {
    bg.querySelector('[data-logout2]').onclick = async () => { close(null); await signOutAll(); go(''); render(); };
    bg.querySelector('[data-x]').onclick = () => close(null); bg.querySelector('[data-ok]').onclick = () => close({name: bg.querySelector('#pf-name').value.trim()}); });
  if(!r) return; const {error} = await G.sb.from('profiles').update({name:r.name||S.user.name}).eq('id', S.user.id); if(error){ toast(error.message); return; }
  S.user.name = r.name||S.user.name; toast(t('saved')); render();
}

export { topbar, profileModal, appMenu };
