import { render } from './router.js';
import { loadProfile } from '../core/auth.js';
import { APP_VERSION } from '../core/config.js';
import { $, $$, el, modal, toast } from '../core/helpers.js';
import { t } from '../core/i18n.js';
import { G, S } from '../core/state.js';

/* ---------- PWA: service worker + install ---------- */

const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints > 1);

async function doInstall(){ if(!G.installPrompt){ if(isIOS()) toast(t('install_ios')); return false; } G.installPrompt.prompt(); const r = await G.installPrompt.userChoice.catch(() => null); G.installPrompt = null; return !!(r && r.outcome==='accepted'); }

function installNote(){ // dashboard card, once per device, never inside the installed app
  if(isStandalone() || isPhone()) return null; try{ if(localStorage.getItem('gg_inst_dismissed')) return null; }catch(e){} // phones get the banner (or asked for quiet)
  // v12.38: the same eye-catching gradient banner as on phones – a plain grey card was easy to overlook
  const n = el(`<div class="inst-banner desk" id="inst-note"><button class="x" data-later aria-label="close">×</button><div class="ib-ico">📲</div><div class="ib-txt"><b>${t('install_app')}</b><span>${t('install_sub')}</span></div><div class="ib-acts"><button class="ib-btn" data-guide>${t('install_how')}</button><button class="ib-later" data-later>${t('later')}</button></div></div>`);
  n.querySelector('[data-guide]').onclick = () => installGuide();
  n.querySelectorAll('[data-later]').forEach(b => b.onclick = () => { try{ localStorage.setItem('gg_inst_dismissed', '1'); }catch(e){} n.remove(); });
  return n;
}

// v12.44: once the big note was dismissed, a slim one-line strip stays on the dashboard as long as the app is not installed
function installStrip(){
  if(isStandalone()) return null;
  const n = el(`<button class="inst-strip" id="inst-strip">📲 <span>${t('inst_strip')}</span><b>${t('inst_strip_how')} →</b></button>`);
  n.onclick = () => { if(G.installPrompt) doInstall(); else installGuide(); }; return n;
}

// iPhone: the mail link always opens Safari, never the home-screen app – say so once after a link login
function linkNote(){
  let via = false; try{ via = !!sessionStorage.getItem('gg_via_link'); sessionStorage.removeItem('gg_via_link'); }catch(e){}
  if(!via || !isIOS() || isStandalone()) return null;
  const n = el(`<div class="card inst-note" id="link-note"><span class="big">📲</span><div><b>${t('link_note_t')}</b><div class="muted">${t('link_note')}</div></div><div class="row"><button class="btn ghost sm" data-ok>${t('close')}</button></div></div>`);
  n.querySelector('[data-ok]').onclick = () => n.remove(); return n;
}

// v12.47.1: ONE banner for PC and phone at the very top of the dashboard, every time the app is opened in a browser tab
// ("Später" hides it for this tab only – the next start shows it again); says plainly that the installed app works offline
function installTop(){
  if(isStandalone()) return null; try{ if(sessionStorage.getItem('gg_inst_hide')) return null; }catch(e){}
  const n = el(`<div class="inst-top" id="inst-top"><div class="it-ico">📲</div><div class="it-txt"><b>${t('it_title')}</b><span>${t('it_sub')}</span></div><div class="it-acts"><button class="it-btn" data-go>${t('it_btn')}</button><button class="it-later" data-later>${t('later')}</button></div></div>`);
  n.querySelector('[data-go]').onclick = () => { if(G.installPrompt) doInstall(); else installGuide(); };
  n.querySelector('[data-later]').onclick = () => { try{ sessionStorage.setItem('gg_inst_hide', '1'); }catch(e){} n.remove(); };
  return n;
}

// phones: a banner that cannot be missed (login), until dismissed – then quiet for 7 days
const isPhone = () => isIOS() || isAndroid() || (matchMedia('(pointer:coarse)').matches && matchMedia('(max-width:900px)').matches);
function installBanner(){
  if(isStandalone() || !isPhone()) return null; try{ const until = +(localStorage.getItem('gg_inst_snooze')||0); if(until > Date.now()) return null; }catch(e){}
  const n = el(`<div class="inst-banner" id="inst-banner"><button class="x" data-later aria-label="close">×</button><div class="ib-ico">📲</div><div class="ib-txt"><b>${t('ib_title')}</b><span>${t('ib_sub')}</span></div><button class="ib-btn" data-guide>${t('ib_btn')}</button></div>`);
  n.querySelector('[data-guide]').onclick = () => { if(G.installPrompt) doInstall(); else installGuide(); };
  n.querySelector('[data-later]').onclick = () => { try{ localStorage.setItem('gg_inst_snooze', String(Date.now() + 7*864e5)); }catch(e){} n.remove(); };
  return n;
}

/* ---------- Install guide: pictures instead of a sentence – iPhone (share sheet), Android (menu / native prompt), PC ---------- */
const isAndroid = () => /Android/i.test(navigator.userAgent);
const isSafari = () => /Safari/i.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|Chrome|OPiOS/i.test(navigator.userAgent);
// phone-screen drawings (SVG, portrait 180×300) that look like the real thing – one per step; the app icon is the real one
const FF = 'font-family="-apple-system,BlinkMacSystemFont,Roboto,Montserrat,system-ui"';
const IG = {
  phone: inner => `<svg class="ig" viewBox="0 0 180 300" aria-hidden="true"><defs><clipPath id="igc"><rect x="0" y="0" width="180" height="300" rx="22"/></clipPath></defs><g clip-path="url(#igc)"><rect x="0" y="0" width="180" height="300" fill="#fff"/>${inner}</g><rect x="0.75" y="0.75" width="178.5" height="298.5" rx="22" fill="none" stroke="#111" stroke-width="1.5"/></svg>`,
  hl: (x,y,w,h,r=8) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="#004EAD" stroke-width="3"/>`,
  tap: (x,y) => `<circle cx="${x}" cy="${y}" r="9" fill="rgba(0,78,173,.18)"/><circle cx="${x}" cy="${y}" r="4.5" fill="#004EAD"/>`,
  icon: (x,y,size) => `<image href="icons/icon-192.png" x="${x}" y="${y}" width="${size}" height="${size}" style="border-radius:${size*.22}px" clip-path="inset(0 round ${size*.22}px)"/>`,
  // faint page behind sheets: a GIRI dashboard sketch
  page: () => `<rect x="0" y="0" width="180" height="46" fill="#000"/><image href="icons/icon-192.png" x="12" y="12" width="22" height="22"/><text x="40" y="28" font-size="11" font-weight="800" fill="#fff" ${FF}>GIRI</text><circle cx="160" cy="23" r="9" fill="#0A63D6"/><rect x="12" y="62" width="156" height="26" rx="8" fill="#F1F3F6"/><rect x="12" y="98" width="156" height="60" rx="10" fill="#F1F3F6"/><rect x="12" y="168" width="156" height="60" rx="10" fill="#F1F3F6"/>`,
  shareIcon: (x,y,c='#0A7AFF') => `<g transform="translate(${x} ${y})" stroke="${c}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M0 -8V6M-5 -3l5-5 5 5"/><path d="M-6 2h-3v12h18V2h-3"/></g>`,
  row: (y, txt, ico, on) => `${on ? `<rect x="10" y="${y-13}" width="160" height="26" rx="6" fill="#E8F0FC"/>` : ''}<text x="20" y="${y+4}" font-size="9.5" font-weight="${on?'700':'500'}" fill="${on?'#004EAD':'#111'}" ${FF}>${txt}</text>${ico}`,
  sym: (x,y,kind,c='#333') => ({ copy:`<rect x="${x}" y="${y-5}" width="8" height="10" rx="1.5" fill="none" stroke="${c}" stroke-width="1.4"/><rect x="${x+3}" y="${y-8}" width="8" height="10" rx="1.5" fill="#fff" stroke="${c}" stroke-width="1.4"/>`, list:`<circle cx="${x+5}" cy="${y-2}" r="4.5" fill="none" stroke="${c}" stroke-width="1.4"/><circle cx="${x+5}" cy="${y-2}" r="1.3" fill="${c}"/>`, book:`<path d="M${x} ${y-6}h9v11h-9zM${x} ${y-6}l4.5 3 4.5-3" fill="none" stroke="${c}" stroke-width="1.4"/>`, star:`<path d="M${x+5} ${y-7}l1.8 3.8 4.2.6-3 3 .7 4.2-3.7-2-3.7 2 .7-4.2-3-3 4.2-.6z" fill="none" stroke="${c}" stroke-width="1.3"/>`, find:`<circle cx="${x+4}" cy="${y-3}" r="3.8" fill="none" stroke="${c}" stroke-width="1.4"/><path d="M${x+7} ${y}l3.5 3.5" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`, plus:`<rect x="${x}" y="${y-7}" width="11" height="11" rx="2.5" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M${x+5.5} ${y-4.5}v6M${x+2.5} ${y-1.5}h6" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`, dl:`<path d="M${x+5} ${y-7}v9M${x+1.5} ${y-1.5}l3.5 3.5 3.5-3.5M${x} ${y+5}h10" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`, dots:`<circle cx="${x+5}" cy="${y-6}" r="1.6" fill="${c}"/><circle cx="${x+5}" cy="${y-1}" r="1.6" fill="${c}"/><circle cx="${x+5}" cy="${y+4}" r="1.6" fill="${c}"/>` })[kind] || ''
};
const iosSteps = () => [
  // 1 – Safari: address bar at the bottom, the share icon in the toolbar
  {t: t('ig_ios1'), s: IG.phone(`${IG.page()}<rect x="0" y="222" width="180" height="78" fill="#F6F6F8"/><rect x="0" y="222" width="180" height=".8" fill="#D9D9DE"/><rect x="12" y="232" width="156" height="26" rx="9" fill="#fff" stroke="#DADCE2"/><text x="90" y="249" font-size="9" text-anchor="middle" fill="#111" ${FF}>go.ar-giri.de</text><g fill="none" stroke="#0A7AFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M28 274l-6 6 6 6M62 274l6 6-6 6"/><path d="M122 274v12h4M120 286l6 6"/><rect x="146" y="275" width="10" height="10" rx="2"/><rect x="150" y="279" width="10" height="10" rx="2" fill="#F6F6F8"/></g>${IG.shareIcon(90, 281)}${IG.hl(75,264,30,32,10)}${IG.tap(108,294)}`)},
  // 2 – share sheet with the entry "Add to Home Screen"
  {t: t('ig_ios2'), s: IG.phone(`${IG.page()}<rect x="0" y="0" width="180" height="300" fill="rgba(0,0,0,.35)"/><rect x="0" y="52" width="180" height="248" rx="16" fill="#F2F2F7"/><rect x="72" y="58" width="36" height="4" rx="2" fill="#C7C7CC"/><g transform="translate(12 68)"><rect x="0" y="0" width="30" height="30" rx="7" fill="#000"/><image href="icons/icon-192.png" x="0" y="0" width="30" height="30"/><text x="38" y="13" font-size="9.5" font-weight="700" fill="#111" ${FF}>GIRI</text><text x="38" y="25" font-size="8" fill="#6E6E73" ${FF}>go.ar-giri.de</text></g><g transform="translate(0 108)">${[0,1,2,3].map(i => `<circle cx="${28+i*42}" cy="12" r="14" fill="${['#DDE7F5','#5AC466','#3A82F7','#8E8E93'][i]}"/><rect x="${16+i*42}" y="30" width="24" height="4" rx="2" fill="#C7C7CC"/>`).join('')}</g><rect x="10" y="150" width="160" height="150" rx="10" fill="#fff"/>${IG.row(166, t('ig_copy'), IG.sym(148,166,'copy'))}<rect x="18" y="178" width="152" height=".8" fill="#E5E5EA"/>${IG.row(191, t('ig_readlist'), IG.sym(148,191,'list'))}<rect x="18" y="203" width="152" height=".8" fill="#E5E5EA"/>${IG.row(216, t('ig_bookmark'), IG.sym(148,216,'book'))}<rect x="18" y="228" width="152" height=".8" fill="#E5E5EA"/>${IG.row(241, t('ig_find'), IG.sym(148,241,'find'))}<rect x="18" y="253" width="152" height=".8" fill="#E5E5EA"/>${IG.row(266, t('ig_add_home'), IG.sym(148,266,'plus','#004EAD'), true)}<rect x="18" y="278" width="152" height=".8" fill="#E5E5EA"/>${IG.row(291, t('ig_fav'), IG.sym(148,291,'star'))}${IG.hl(8,251,164,30,8)}${IG.tap(126,276)}`)},
  // 3 – confirm: "Add" top right
  {t: t('ig_ios3'), s: IG.phone(`<rect x="0" y="0" width="180" height="300" fill="#F2F2F7"/><rect x="0" y="0" width="180" height="40" fill="#fff"/><rect x="0" y="40" width="180" height=".8" fill="#D9D9DE"/><text x="10" y="25" font-size="8" fill="#0A7AFF" ${FF}>${t('cancel')}</text><text x="92" y="25" font-size="8.5" font-weight="700" text-anchor="middle" fill="#111" ${FF}>${t('ig_add_home')}</text><text x="170" y="25" font-size="9" font-weight="700" text-anchor="end" fill="#0A7AFF" ${FF}>${t('ig_add')}</text>${IG.hl(140,10,36,30,9)}${IG.tap(168,44)}<rect x="10" y="56" width="160" height="60" rx="10" fill="#fff"/><g transform="translate(20 66)"><rect x="0" y="0" width="40" height="40" rx="9" fill="#000"/><image href="icons/icon-192.png" x="0" y="0" width="40" height="40"/></g><text x="70" y="83" font-size="11" font-weight="700" fill="#111" ${FF}>GIRI</text><text x="70" y="99" font-size="8" fill="#8E8E93" ${FF}>https://go.ar-giri.de</text><text x="16" y="146" font-size="8.5" fill="#6E6E73" ${FF}>${t('ig_home_note')}</text><g transform="translate(0 180)"><rect x="0" y="0" width="180" height="120" fill="#D1D3D9"/>${[0,1,2,3].map(i => `<rect x="${10+i*44}" y="10" width="30" height="8" rx="3" fill="#fff" opacity=".7"/>`).join('')}</g>`)}
];
const androidSteps = () => [
  // 1 – Chrome: the three dots
  {t: t('ig_and1'), s: IG.phone(`<rect x="0" y="0" width="180" height="46" fill="#fff"/><rect x="8" y="10" width="164" height="26" rx="13" fill="#EEF1F5"/><text x="20" y="27" font-size="9" fill="#202124" ${FF}>go.ar-giri.de</text>${IG.sym(155,23,'dots','#444')}${IG.hl(148,7,26,32,10)}${IG.tap(160,23)}<g transform="translate(0 46)">${IG.page()}</g>`)},
  // 2 – Chrome menu with "Install app"
  {t: t('ig_and2'), s: IG.phone(`<rect x="0" y="0" width="180" height="300" fill="#fff"/><g transform="translate(0 0)">${IG.page()}</g><rect x="0" y="0" width="180" height="300" fill="rgba(0,0,0,.18)"/><rect x="42" y="8" width="132" height="288" rx="6" fill="#fff" stroke="#DADCE0"/><g transform="translate(42 8)"><g fill="none" stroke="#5F6368" stroke-width="1.6" stroke-linecap="round"><path d="M18 14l-6 6 6 6M36 14l6 6-6 6"/><path d="M60 16v8l4-4-4-4M60 20h8"/><circle cx="90" cy="20" r="6"/><path d="M118 15v10M113 20h10"/></g></g>${['ig_newtab','ig_incognito','ig_history','ig_downloads','ig_bookmark','ig_share','ig_find','ig_translate'].map((k,i) => `<text x="52" y="${62+i*20}" font-size="8.5" fill="#202124" ${FF}>${t(k)}</text>`).join('')}<rect x="44" y="${62+8*20-13}" width="128" height="22" rx="4" fill="#E8F0FC"/>${IG.sym(52,62+8*20-1,'dl','#004EAD')}<text x="68" y="${62+8*20+2}" font-size="8.5" font-weight="700" fill="#004EAD" ${FF}>${t('ig_install_app')}</text>${IG.hl(43,62+8*20-15,130,26,6)}${IG.tap(150,62+8*20)}<text x="52" y="${62+9*20+4}" font-size="8.5" fill="#202124" ${FF}>${t('ig_desktop')}</text><text x="52" y="${62+10*20+4}" font-size="8.5" fill="#202124" ${FF}>${t('ig_settings')}</text>`)},
  // 3 – install dialog
  {t: t('ig_and3'), s: IG.phone(`${IG.page()}<rect x="0" y="0" width="180" height="300" fill="rgba(0,0,0,.35)"/><rect x="14" y="96" width="152" height="100" rx="14" fill="#fff"/><g transform="translate(26 110)"><rect x="0" y="0" width="34" height="34" rx="8" fill="#000"/><image href="icons/icon-192.png" x="0" y="0" width="34" height="34"/></g><text x="70" y="124" font-size="11" font-weight="700" fill="#202124" ${FF}>GIRI</text><text x="70" y="138" font-size="8" fill="#5F6368" ${FF}>go.ar-giri.de</text><text x="104" y="174" font-size="9" font-weight="600" text-anchor="end" fill="#1A73E8" ${FF}>${t('cancel')}</text><rect x="112" y="160" width="46" height="22" rx="11" fill="#1A73E8"/><text x="135" y="174.5" font-size="9" font-weight="700" text-anchor="middle" fill="#fff" ${FF}>${t('ig_install')}</text>${IG.hl(108,156,54,30,14)}${IG.tap(135,182)}`)}
];
const pcSteps = () => [
  {t: t('ig_pc1'), s: `<svg class="ig ig-pc" viewBox="0 0 300 120" aria-hidden="true"><rect x="0.75" y="0.75" width="298.5" height="118.5" rx="10" fill="#fff" stroke="#111" stroke-width="1.5"/><rect x="0" y="0" width="300" height="34" rx="10" fill="#F1F3F4"/><rect x="0" y="20" width="300" height="14" fill="#F1F3F4"/><rect x="10" y="8" width="70" height="20" rx="6" fill="#fff"/><text x="18" y="21" font-size="8.5" font-weight="600" fill="#202124" ${FF}>GIRI</text><rect x="0" y="34" width="300" height="30" fill="#fff"/><rect x="40" y="40" width="240" height="18" rx="9" fill="#F1F3F4"/><text x="52" y="52" font-size="8.5" fill="#202124" ${FF}>go.ar-giri.de</text><g transform="translate(258 42)" fill="none" stroke="#1A73E8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="0" y="0" width="14" height="10" rx="2"/><path d="M4 13h6M7 3v5M5 6l2 2 2-2"/></g><rect x="250" y="36" width="30" height="26" rx="8" fill="none" stroke="#004EAD" stroke-width="3"/>${IG.tap(265,60)}<rect x="0" y="64" width="300" height="56" fill="#000"/><image href="icons/icon-192.png" x="14" y="78" width="26" height="26"/><text x="48" y="96" font-size="12" font-weight="800" fill="#fff" ${FF}>GIRI</text></svg>`},
  {t: t('ig_pc2'), s: `<svg class="ig ig-pc" viewBox="0 0 300 120" aria-hidden="true"><rect x="0.75" y="0.75" width="298.5" height="118.5" rx="10" fill="#fff" stroke="#111" stroke-width="1.5"/><rect x="0" y="0" width="300" height="34" rx="10" fill="#F1F3F4"/><rect x="0" y="20" width="300" height="14" fill="#F1F3F4"/><rect x="0" y="34" width="300" height="30" fill="#fff"/><rect x="40" y="40" width="240" height="18" rx="9" fill="#F1F3F4"/><rect x="0" y="64" width="300" height="56" fill="#000"/><rect x="130" y="44" width="160" height="66" rx="8" fill="#fff" stroke="#DADCE0"/><g transform="translate(140 54)"><rect x="0" y="0" width="22" height="22" rx="5" fill="#000"/><image href="icons/icon-192.png" x="0" y="0" width="22" height="22"/></g><text x="170" y="64" font-size="9" font-weight="700" fill="#202124" ${FF}>${t('ig_install_q')}</text><text x="170" y="76" font-size="7.5" fill="#5F6368" ${FF}>go.ar-giri.de</text><text x="226" y="98" font-size="8.5" font-weight="600" text-anchor="end" fill="#1A73E8" ${FF}>${t('cancel')}</text><rect x="236" y="86" width="46" height="18" rx="9" fill="#1A73E8"/><text x="259" y="98" font-size="8.5" font-weight="700" text-anchor="middle" fill="#fff" ${FF}>${t('ig_install')}</text><rect x="232" y="82" width="54" height="26" rx="12" fill="none" stroke="#004EAD" stroke-width="3"/>${IG.tap(259,104)}</svg>`}
];
async function installGuide(){
  if(isStandalone()){ toast(t('install_done')); return; }
  try{ localStorage.setItem('gg_inst_seen', '1'); }catch(e){}
  let plat = isIOS() ? 'ios' : isAndroid() ? 'android' : 'pc';
  const r = await modal(`<div class="ig-wrap"><div class="ig-head"><span class="big">📲</span><div><h2 style="margin:0">${t('install_app')}</h2><p class="muted" style="margin:4px 0 0">${t('ig_why')}</p></div></div>
    <div class="seg ig-seg" id="ig-plat"><button type="button" data-p="ios">iPhone / iPad</button><button type="button" data-p="android">Android</button><button type="button" data-p="pc">PC</button></div>
    <div id="ig-body"></div>
    <div class="actions"><button class="btn ghost" data-x>${t('close')}</button><button class="btn" data-native hidden>${t('ig_install_now')}</button></div></div>`, (bg, close) => {
    const body = bg.querySelector('#ig-body'), nat = bg.querySelector('[data-native]'); const box = bg.querySelector('.modal'); if(box) box.classList.add('ig-modal');
    const draw = () => { $$('#ig-plat button', bg).forEach(b => b.classList.toggle('on', b.dataset.p===plat));
      const steps = plat==='ios' ? iosSteps() : plat==='android' ? androidSteps() : pcSteps();
      const note = plat==='ios' ? (isIOS() && !isSafari() ? t('ig_ios_safari') : t('ig_ios_note')) : plat==='android' ? (G.installPrompt ? t('ig_and_prompt') : t('ig_and_note')) : t('ig_pc_note');
      body.innerHTML = `<ol class="ig-steps">${steps.map(s => `<li>${s.s}<span>${s.t}</span></li>`).join('')}</ol><p class="muted ig-note">${note}</p>`;
      nat.hidden = !(plat==='android' && G.installPrompt); };
    $$('#ig-plat button', bg).forEach(b => b.onclick = () => { plat = b.dataset.p; draw(); });
    nat.onclick = () => close('native'); bg.querySelector('[data-x]').onclick = () => close(null); draw(); });
  if(r==='native') doInstall();
}

/* ---------- Update check (GitHub Pages / Safari cache) ---------- */
 // busyCheck: set by viewer/editor while work is in progress
const reloadForUpdate = async () => { const v = G.pendingUpdate; if(!v) return; try{ if(navigator.serviceWorker && navigator.serviceWorker.controller) await Promise.race([caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))), new Promise(r => setTimeout(r, 1500))]); }catch(e){} location.replace(location.pathname + '?v=' + v + location.hash); };

const updateSafe = () => { const view = location.hash.replace(/^#\/?/, '').split('/')[0]; if(!S.user && view!=='v') return true; if(['', 'p', 'admin', 'stats', 'results'].includes(view)) return true; return !!(G.busyCheck && !G.busyCheck()); };

function applyUpdateIfSafe(){ if(G.pendingUpdate && updateSafe()) reloadForUpdate(); }

async function checkUpdate(force){
  if(!force && Date.now() - G.lastUpdCheck < 60000) return; G.lastUpdCheck = Date.now();
  // v12.37.1: this used to be one line with the code after a "//" comment – the version check silently never ran, installed apps stayed on old versions
  try{ const r = await fetch(location.pathname + '?v=check' + Date.now(), {cache:'no-store'}); // ?v= → the service worker goes to the network; v12.38: '/' not '/index.html' (Cloudflare redirects that)
    const txt = await r.text(); const m = /APP_VERSION = '([^']+)'/.exec(txt); if(!m || m[1]===APP_VERSION) return;
    G.pendingUpdate = m[1]; if(updateSafe()){ reloadForUpdate(); return; }
    if($('#upd-note')) return; const n = el(`<div class="sync show" id="upd-note" style="pointer-events:auto;cursor:pointer;background:var(--blue)">${t('update_avail',{v:m[1]})}</div>`); n.onclick = reloadForUpdate; document.body.appendChild(n);
  }catch(e){}
}

// installed app: iOS/Android keep the page alive for days – re-check whenever it comes back to the front

// magic link opened in the browser next to the installed app (Android/desktop share the storage): pick the session up without a reload

async function pickupSession(){ if(!G.sb || S.user || G.pickingUp || !G.authReady) return; G.pickingUp = true; try{ const {data:{session}} = await G.sb.auth.getSession(); if(session){ await loadProfile(); if(S.user) render(); } }catch(e){} G.pickingUp = false; }

export { isStandalone, isIOS, isAndroid, isPhone, doInstall, installNote, installBanner, installStrip, installTop, linkNote, installGuide, reloadForUpdate, updateSafe, applyUpdateIfSafe, checkUpdate, pickupSession };
