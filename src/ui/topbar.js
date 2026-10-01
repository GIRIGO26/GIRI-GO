import { signOutAll } from '../core/auth.js';
import { installGuide, isStandalone } from '../app/pwa.js';
import { go, render } from '../app/router.js';
import { APP_VERSION, LEGAL } from '../core/config.js';
import { $$, el, esc, modal, toast } from '../core/helpers.js';
import { I18N, langMenu, loadUiLang, t } from '../core/i18n.js';
import { G, S } from '../core/state.js';
import { PUBLIC_MEDIA } from '../core/supabase.js';
import { FLAGS } from '../core/translate.js';
import { IC } from './icons.js';
import { initials, roleLbl } from '../views/dashboard.js';
import { brandModal } from '../views/branding.js';


/* ---------- Top bar ----------
   v12.48: where am I – a breadcrumb (Instructions › folder › instruction) instead of one word; the back arrow goes one level up.
   On the phone the bar keeps logo, BETA and the current place; the full trail sits in a slim line below when it is deeper than two.
   Right side: the avatar opens the profile (photo, name, language, sign out), the ≡ next to it the app menu. */
const avatarHtml = (u, cls='') => u && u.avatar ? `<span class="avatar ${cls} img"><img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer"></span>` : `<span class="avatar ${cls}">${esc(initials(u ? u.name : '?'))}</span>`;
const crumbHref = c => c.href == null ? null : '#/' + String(c.href).replace(/^#?\/?/, '');

function topbar(app, opts={}){
  // v12.47.2: "BETA" next to the logo – customers should know the app still changes a lot; a tap explains it
  const betaInfo = () => modal(`<h2>${t('beta_title')}</h2><p class="muted" style="margin:0 0 14px;line-height:1.5">${t('beta_sub')}</p><div class="actions"><button class="btn" data-x>${t('close')}</button></div>`, (bg, close) => { bg.querySelector('[data-x]').onclick = () => close(); });
  const crumbs = opts.crumbs || (opts.sub ? [{label: opts.sub}] : []);
  const parent = crumbs.length > 1 ? crumbs[crumbs.length-2] : null;
  const back = opts.back !== undefined ? opts.back : (parent && parent.href != null ? parent.href : null);
  const trail = crumbs.map((c, k) => { const last = k === crumbs.length-1; const h = crumbHref(c); return `${k ? `<span class="cr-sep" aria-hidden="true">›</span>` : ''}${!last && h ? `<a class="crumb" href="${h}">${esc(c.label)}</a>` : `<span class="crumb ${last ? 'cur' : ''}" ${last ? 'aria-current="page"' : ''}>${esc(c.label)}</span>`}`; }).join('');
  const tb = el(`<header class="topbar">
    ${back != null ? `<button class="tb-btn" data-back aria-label="${esc(t('back'))}${parent ? ': ' + esc(parent.label) : ''}" title="${parent ? esc(parent.label) : esc(t('back'))}">${IC.back}</button>` : ''}
    <div class="brand"><a class="logo" href="#/" role="img" aria-label="GIRI"></a><span class="wordmark">GIRI</span><button class="beta" type="button" data-beta title="${t('beta_title')}">BETA</button>${crumbs.length ? `<nav class="where crumbs" aria-label="${esc(t('you_are_here'))}"><span class="sep"></span>${trail}</nav>` : ''}</div>
    <div class="spacer"></div>
    <button class="tb-btn tb-lang" data-lang title="${t('language')}">${FLAGS[G.LANG.toUpperCase()]||''} <span class="tb-langc">${G.LANG.toUpperCase()}</span></button>
    ${S.user ? `<button class="tb-btn tb-user" id="tbprofile" data-profile title="${esc(t('menu_profile'))}">${avatarHtml(S.user)}<span class="tb-name">${esc(S.user.name.split(' ')[0])}</span></button><button class="tb-btn tb-menu" id="tbmenu" data-menu aria-haspopup="menu" title="${t('menu')}">${IC.menu}</button>` : ''}
  </header>`);
  const lb = tb.querySelector('[data-lang]'); if(lb) lb.onclick = pickLang;
  { const b = tb.querySelector('[data-beta]'); if(b) b.onclick = betaInfo; }
  if(back != null) tb.querySelector('[data-back]').onclick = () => go(String(back).replace(/^#?\/?/, ''));
  const mb = tb.querySelector('[data-menu]'); if(mb) mb.onclick = appMenu;
  const pb = tb.querySelector('[data-profile]'); if(pb) pb.onclick = profileModal;
  app.appendChild(tb);
  // phone: the full trail as a slim line under the bar (only when there is more than "list › here")
  if(crumbs.length > 2){ const cb = el(`<nav class="crumbbar" aria-hidden="true">${trail}</nav>`); app.appendChild(cb); requestAnimationFrame(() => { cb.scrollLeft = cb.scrollWidth; }); }
}
const pickLang = () => langMenu(async l => { const ll = l.toLowerCase(); if(!I18N[ll]) toast(t('translating')); if(!(await loadUiLang(ll))) return; G.LANG = ll; try{localStorage.setItem('gg_lang', G.LANG);}catch(e){} render(); });

// the app menu (≡): workspace things, administration, platform, app
function appMenu(){
  const u = S.user;
  modal(`<div class="appmenu">
    <div class="menu">
      <div class="menu-h">${t('workspace')}</div>
      <button data-m="stats">${IC.eye} ${t('global_stats')}</button><button data-m="trash">${IC.trash} ${t('trash')}</button>
      ${u.isAdmin?`<div class="menu-h">${t('menu_admin')}</div><button data-m="admin">${IC.gear} ${t('ws_admin')}</button><button data-m="brand">${IC.brand} ${t('branding')}</button><button data-m="ai"><span class="emo">✦</span> ${t('ai_cfg')}</button><button data-m="import">${IC.upload} ${t('imp_title')}</button>`:''}
      ${u.isMaster?`<div class="menu-h">${t('master')}</div><button data-m="master">${IC.users} ${t('master')}</button>`:''}
      <div class="menu-h">${t('menu_app')}</div>
      ${isStandalone()?'':`<button data-m="install"><span class="emo">📲</span> ${t('install_app')}</button>`}<button data-m="lang"><span class="emo">${FLAGS[G.LANG.toUpperCase()]||'🌐'}</span> ${t('language')}</button><button data-m="beta"><span class="emo">β</span> ${t('beta_title')}</button>
    </div>
    <div class="menu-foot app-ver">GIRI v${APP_VERSION} · BETA · ${esc(u.ws)}</div><div class="menu-legal"><a href="${LEGAL.imprint}" target="_blank" rel="noopener">${t('imprint')}</a> · <a href="${LEGAL.legal}" target="_blank" rel="noopener">${t('privacy_dpa')}</a></div></div>`, (bg, close) => {
    $$('[data-m]', bg).forEach(b => b.onclick = async () => { const m = b.dataset.m; close();
      if(m==='lang') pickLang(); else if(m==='stats') go('stats'); else if(m==='trash') go('trash'); else if(m==='brand') brandModal(); else if(m==='admin') go('admin'); else if(m==='master') go('master'); else if(m==='ai') go('admin/ai'); else if(m==='import') go('admin/import'); else if(m==='install') installGuide();
      else if(m==='beta') modal(`<h2>${t('beta_title')}</h2><p class="muted" style="margin:0 0 14px;line-height:1.5">${t('beta_sub')}</p><div class="actions"><button class="btn" data-x>${t('close')}</button></div>`, (b2, c2) => { b2.querySelector('[data-x]').onclick = () => c2(); }); });
  });
}

// v12.48: a square, centred JPEG of at most 320 px from any picture – small enough for the top bar on every device
const avatarBlob = file => new Promise((res, rej) => { const url = URL.createObjectURL(file); const im = new Image(); im.onload = () => { const s = Math.min(im.naturalWidth, im.naturalHeight); const out = Math.min(320, s); const c = document.createElement('canvas'); c.width = c.height = out; c.getContext('2d').drawImage(im, (im.naturalWidth-s)/2, (im.naturalHeight-s)/2, s, s, 0, 0, out, out); URL.revokeObjectURL(url); c.toBlob(b => b ? res(b) : rej(new Error('image')), 'image/jpeg', .86); }; im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); }; im.src = url; });

// the profile (avatar in the top bar): photo, name, language, sign out – the role is shown, changed only by an admin
async function profileModal(){
  const u = S.user; let newAvatar;
  const r = await modal(`<div class="me prof"><label class="avatar-edit" title="${esc(t('avatar_change'))}">${avatarHtml(u, 'big')}<span class="cam">${IC.cam}</span><input type="file" accept="image/*" hidden id="pf-file"></label><div><b>${esc(u.name)}</b><span>${esc(u.email||'')}</span><span class="chip dot published" style="margin-top:6px">${roleLbl(u.role)}</span></div></div>
    <div class="row" style="gap:8px;margin:-6px 0 14px;flex-wrap:wrap"><label class="btn ghost sm" style="cursor:pointer" for="pf-file">${IC.cam} ${t('avatar_change')}</label>${u.avatar ? `<button class="btn ghost sm" data-rmav>${t('avatar_remove')}</button>` : ''}</div>
    <div class="field"><label for="pf-name">${t('name')}</label><input id="pf-name" value="${esc(u.name)}" autocomplete="name"></div>
    <button class="menu-row" data-plang><span class="emo">${FLAGS[G.LANG.toUpperCase()]||'🌐'}</span><span>${t('language')}</span><b>${G.LANG.toUpperCase()}</b></button>
    <p class="muted" style="margin:12px 0 0;font-size:12.5px">${t('role_note2')}</p>
    <div class="actions"><button class="btn ghost" data-logout2 style="margin-right:auto">${IC.close} ${t('logout')}</button><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${t('save')}</button></div>`, (bg, close) => {
    const fi = bg.querySelector('#pf-file');
    fi.onchange = async e => { const f = e.target.files[0]; if(!f) return; try{ newAvatar = await avatarBlob(f); const prev = URL.createObjectURL(newAvatar); bg.querySelector('.avatar-edit .avatar').outerHTML = `<span class="avatar big img"><img src="${prev}" alt=""></span>`; }catch(x){ toast(t('avatar_fail')); } };
    const rm = bg.querySelector('[data-rmav]'); if(rm) rm.onclick = () => { newAvatar = null; bg.querySelector('.avatar-edit .avatar').outerHTML = `<span class="avatar big">${esc(initials(u.name))}</span>`; rm.remove(); };
    bg.querySelector('[data-plang]').onclick = () => { close(null); pickLang(); };
    bg.querySelector('[data-logout2]').onclick = async () => { close(null); await signOutAll(); go(''); render(); };
    bg.querySelector('[data-x]').onclick = () => close(null); bg.querySelector('[data-ok]').onclick = () => close({name: bg.querySelector('#pf-name').value.trim()}); });
  if(!r) return;
  try{
    if(r.name && r.name !== u.name){ const {error} = await G.sb.from('profiles').update({name:r.name}).eq('id', u.id); if(error) throw error; u.name = r.name; }
    if(newAvatar !== undefined){ let url = null;
      if(newAvatar){ const path = `${u.ws}/avatars/${u.id}-${Date.now().toString(36)}.jpg`; const up = await G.sb.storage.from('media').upload(path, newAvatar, {contentType:'image/jpeg'}); if(up.error) throw up.error; url = PUBLIC_MEDIA(path); }
      const {error} = await G.sb.auth.updateUser({data:{avatar_url: url}}); if(error) throw error; u.avatar = url || ''; }
    toast(t('saved')); render();
  }catch(e){ toast(e.message||String(e)); }
}

export { topbar, profileModal, appMenu, avatarHtml };
