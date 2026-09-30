import { LEGAL } from '../core/config.js';
import { go, render } from '../app/router.js';
import { confirmM, el, esc, toast } from '../core/helpers.js';
import { cacheDel, cacheList } from '../core/viewcache.js';
import { online } from '../core/offline.js';
import { installBanner, installGuide, isStandalone } from '../app/pwa.js';
import { loadProfile, noteLogin, realSteps } from '../core/auth.js';
import { nOf, stepPoster } from './dashboard.js';
import { t } from '../core/i18n.js';
import { G, S } from '../core/state.js';
import { CFG, initSb } from '../core/supabase.js';
import { IC } from '../ui/icons.js';
import { topbar } from '../ui/topbar.js';
import { debounce } from './editor.js';


/* ---------- Login ---------- */
function renderLogin(app){
  topbar(app);
  const v = el(`<main class="login2">
    <section class="l-form">
      <h1>${t('hero_h1')}</h1>
      <p class="l-sub">${t('hero_p')}</p>
      <ul class="l-proof"><li>${IC.cam}<span>${t('hero_p1')}</span></li><li>${IC.checkc}<span>${t('hero_p2')}</span></li><li>${IC.upload}<span>${t('hero_p3')}</span></li></ul>
      <div class="l-card card">
        <div class="field"><label for="li-email">${t('email')}</label><input id="li-email" type="email" placeholder="max@firma.de" autocomplete="email" inputmode="email"></div>
        <button class="l-new" id="li-newtoggle" type="button">${t('new_here')}</button>
        <div class="field" id="li-namewrap" hidden><label for="li-name">${t('name')} <span style="font-weight:500;text-transform:none;letter-spacing:0">(${t('first_time')})</span></label><input id="li-name" placeholder="Max Mustermann" autocomplete="name"></div>
        <button class="btn" id="li-go" style="width:100%;padding:14px;font-size:15px">${t('login')}</button>
        <div class="l-or" id="l-or" hidden><span>${t('or')}</span></div>
        <button class="btn ghost gbtn" id="li-ms" hidden style="width:100%;padding:12px;font-size:14px;margin-bottom:8px"><svg width="18" height="18" viewBox="0 0 23 23"><rect x="1" y="1" width="10" height="10" fill="#F35325"/><rect x="12" y="1" width="10" height="10" fill="#81BC06"/><rect x="1" y="12" width="10" height="10" fill="#05A6F0"/><rect x="12" y="12" width="10" height="10" fill="#FFBA08"/></svg> ${t('login_ms')}</button>
        <button class="btn ghost gbtn" id="li-google" hidden style="width:100%;padding:12px;font-size:14px"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.4 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.7l-7.5-5.8c-2.1 1.4-4.8 2.3-8 2.3-6.3 0-11.6-3.9-13.5-9.5l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg> ${t('login_google')}</button>
        <p class="muted" id="login-note" style="margin:10px 0 0;font-size:12px">${t('login_note')}</p>
        <div class="wait ${isStandalone() ? 'app' : ''}" id="magic" hidden><div class="env" id="magic-ic">${IC.mail}</div><b id="magic-t"></b><p class="muted" id="magic-sub">${isStandalone() ? t('magic_sub_app') : t('magic_sub')}</p>
          <div class="otp" style="width:100%"><label for="li-code">${isStandalone() ? t('otp_label_app') : t('otp_label')}</label><div class="row" style="flex-wrap:nowrap"><input id="li-code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="8"><button class="btn sm" id="li-verify">${t('otp_go')}</button></div></div>
          <div class="again"><span id="again-hint">${t('again_q')}</span> <button id="li-again" disabled>${t('again_send')}</button> <span id="again-in" class="tnum"></span></div>
          <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px;justify-content:center"><button class="btn ghost sm" id="li-other">${t('other_email')}</button><button class="btn ghost sm" id="li-google2" hidden>${t('login_google')}</button></div></div>
      </div>
      <div class="l-trust"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg><div><b>${t('iso_t')}</b><span>${t('iso_sub')}</span></div></div>
    </section>
    <section class="l-visual" aria-hidden="true" ${isStandalone() ? 'hidden' : ''}><img id="l-img" src="login.jpg" alt=""><div class="l-cap"><b>${t('hero_kicker')}</b><span>${t('hero_cap')}</span></div></section>
    <footer class="l-legal"><a href="${LEGAL.imprint}" target="_blank" rel="noopener">${t('imprint')}</a><span>·</span><a href="${LEGAL.legal}" target="_blank" rel="noopener">${t('privacy_dpa')}</a><span>·</span><span>© AR-Experts GmbH</span></footer>
  </main>`);
  const img = v.querySelector('#l-img'); img.onerror = () => { img.remove(); v.querySelector('.l-visual').classList.add('fallback'); };
  try{ v.querySelector('#li-email').value = localStorage.getItem('gg_email')||''; }catch(e){}
  v.querySelector('#li-email').addEventListener('focus', e => e.target.select());
  v.querySelector('#li-newtoggle').onclick = () => { const w = v.querySelector('#li-namewrap'); w.hidden = false; v.querySelector('#li-newtoggle').hidden = true; setTimeout(() => v.querySelector('#li-name').focus(), 50); };
  const emailOf = () => v.querySelector('#li-email').value.trim().toLowerCase();
  // the form (fields + buttons) vs. the waiting card: only one of them is visible
  const formEls = () => ['#li-email','#li-name','#li-newtoggle','#li-go','#l-or','#li-google','#li-ms','#login-note'].map(q => v.querySelector(q)).filter(Boolean).map(e => e.closest('.field') || e);
  let againTimer = null;
  const showWait = (email, err) => {
    formEls().forEach(e => { if(e.id==='l-or' || e.id==='li-google' || e.id==='li-ms'){ e.dataset.wasHidden = e.hidden ? '1' : ''; } e.hidden = true; });
    const w = v.querySelector('#magic'); w.hidden = false;
    if(err){ v.querySelector('#magic-ic').innerHTML = err.cool ? '⏳' : '⚠️'; v.querySelector('#magic-t').textContent = err.title; v.querySelector('#magic-sub').textContent = err.sub; }
    else { v.querySelector('#magic-ic').innerHTML = IC.mail; v.querySelector('#magic-t').textContent = t(isStandalone() ? 'magic_sent_app' : 'magic_sent',{e:email}); v.querySelector('#magic-sub').textContent = t(isStandalone() ? 'magic_sub_app' : 'magic_sub'); }
    // re-send only after a pause – every new link invalidates the previous mail
    const ab = v.querySelector('#li-again'), ai = v.querySelector('#again-in'); let left = err && err.secs ? Math.max(5, err.secs) : 90; ab.disabled = true; clearInterval(againTimer);
    const tick = () => { ai.textContent = left > 0 ? t('again_in',{s:left}) : ''; if(left <= 0){ ab.disabled = false; clearInterval(againTimer); } left--; }; tick(); againTimer = setInterval(tick, 1000);
    setTimeout(() => v.querySelector('#li-code').focus({preventScroll:true}), 200);
  };
  const showForm = () => { clearInterval(againTimer); v.querySelector('#magic').hidden = true; formEls().forEach(e => { e.hidden = (e.id==='l-or' || e.id==='li-google' || e.id==='li-ms') ? !!e.dataset.wasHidden : false; }); v.querySelector('#li-email').focus(); };
  const sendLink = async () => {
    const email = emailOf(); const name = v.querySelector('#li-name').value.trim();
    if(!email.includes('@')){ v.querySelector('#li-email').focus(); return; }
    const btn = v.querySelector('#li-go'); btn.disabled = true; v.querySelector('#li-again').disabled = true;
    const redirect = location.href.split('#')[0];
    const {error} = await G.sb.auth.signInWithOtp({email, options:{emailRedirectTo: redirect, data: name ? {name} : undefined}});
    btn.disabled = false;
    if(error){ const m = /after (\d+) seconds/i.exec(error.message||''); const cool = !!(m || /once every|only request this/i.test(error.message||'')); const rl = !cool && (/rate limit/i.test(error.message||'') || error.status===429);
      showWait(email, {cool: cool||rl, secs: m ? +m[1] : (cool ? 60 : 300), title: cool ? t('cooldown',{s: m ? m[1] : 60}) : (rl ? t('rate_limit') : error.message), sub: cool ? t('cooldown_sub') : (rl ? t('rate_limit_sub') : '')}); return; }
    try{ localStorage.setItem('gg_email', email); }catch(e){}
    showWait(email, null);
  };
  v.querySelector('#li-go').onclick = sendLink; v.querySelector('#li-again').onclick = sendLink; v.querySelector('#li-other').onclick = showForm;
  // code from the same e-mail – the way in when the link would open in another browser (installed app on the phone)
  v.querySelector('#li-verify').onclick = async () => {
    const token = v.querySelector('#li-code').value.replace(/\D/g,''); const email = emailOf(); if(!token || !email) return;
    const b = v.querySelector('#li-verify'); b.disabled = true;
    const {error} = await G.sb.auth.verifyOtp({email, token, type:'email'}); b.disabled = false;
    if(error){ toast(error.message); return; }
    await loadProfile(); go(''); render();
  };
  v.querySelector('#li-code').addEventListener('keydown', e => { if(e.key==='Enter') v.querySelector('#li-verify').click(); });
  v.querySelector('#li-code').addEventListener('input', e => { const d = e.target.value.replace(/\D/g,''); if(d.length >= 6) debounce('otp-auto', () => v.querySelector('#li-verify').click(), 350); });
  // Google sign-in – shown only when the provider is switched on in Supabase (Authentication → Providers → Google)
  // SSO buttons appear automatically for every provider that is switched on in Supabase (Authentication → Providers)
  (async () => { try{ const r = await fetch(`${CFG.SUPABASE_URL}/auth/v1/settings`, {headers:{apikey:CFG.SUPABASE_KEY}}); const j = await r.json(); const ext = (j && j.external) || {};
      const wire = (id, provider, opts) => { [id, id+'2'].forEach(sel => { const b = v.querySelector(sel); if(!b) return; b.hidden = false; if(sel===id) v.querySelector('#l-or').hidden = false;
        b.onclick = async () => { b.disabled = true; const {error} = await G.sb.auth.signInWithOAuth({provider, options:Object.assign({redirectTo: location.href.split('#')[0]}, opts)}); if(error){ toast(error.message); b.disabled = false; } }; }); };
      if(ext.google) wire('#li-google', 'google', {queryParams:{prompt:'select_account'}});
      if(ext.azure) wire('#li-ms', 'azure', {scopes:'email'});
    }catch(e){} })();
  v.querySelector('#li-email').addEventListener('keydown', e => { if(e.key==='Enter') v.querySelector('#li-go').click(); });
  v.querySelector('#li-name').addEventListener('keydown', e => { if(e.key==='Enter') v.querySelector('#li-go').click(); });
  // (the install banner waits until the person is signed in – the first screen is the message, not a setup step)
  app.appendChild(v);
  savedList(v.querySelector('.l-card'));
}

// worker without login: instructions saved on this device (opened before) – the reason to put GIRI Go on the home screen
async function savedList(before){
  let rows = []; try{ rows = await cacheList(); }catch(e){} if(!rows.length || !before || !before.isConnected) return;
  const box = el(`<section class="offl card"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">${t('off_saved_title')}</h3><span class="muted" style="font-size:12px">${online() ? '' : t('offline')}</span></div><p class="muted" style="margin:2px 0 10px">${t('off_saved_sub')}</p><div class="offl-list"></div>${isStandalone() ? '' : `<button class="btn ghost sm" id="offl-inst" style="margin-top:10px">📲 ${t('install_app')}</button>`}</section>`);
  const list = box.querySelector('.offl-list');
  rows.forEach(r => { const st = realSteps(r.instr); const m = r.media||{}; const ok = m.total && m.done>=m.total; const it = el(`<a class="offl-it" href="#/v/${r.id}${r.instr && r.instr.shareKey ? '/'+r.instr.shareKey : ''}"><img alt="" src=""><span><b>${esc(r.title||r.instr.title||'')}</b><small>${nOf(st.length,'step','steps')} · ${ok ? '✓ '+t('off_ready') : (m.total ? t('off_saving',{n:m.done||0,total:m.total}) : t('off_title'))}</small></span><button class="x" data-rm title="${t('off_remove')}">×</button></a>`);
    if(st[0]) stepPoster(st[0]).then(u => { if(u) it.querySelector('img').src = u; }).catch(() => {});
    it.querySelector('[data-rm]').onclick = async e => { e.preventDefault(); e.stopPropagation(); if(!(await confirmM(t('off_remove_q'), t('off_remove')))) return; await cacheDel(r.id); it.remove(); if(!list.children.length) box.remove(); };
    list.appendChild(it); });
  const ib = box.querySelector('#offl-inst'); if(ib) ib.onclick = () => installGuide();
  before.parentNode.insertBefore(box, before.nextSibling); // v12.47: below the login card – it is the worker's list, not a login note
}

function attachAuth(){ G.sb.auth.onAuthStateChange((ev, session) => {
  if(ev==='SIGNED_IN' && session) noteLogin(session);
  if(ev==='SIGNED_IN' || ev==='INITIAL_SESSION'){
    if(location.hash.includes('access_token=') || location.hash.startsWith('#error')){ try{ if(location.hash.includes('access_token=')) sessionStorage.setItem('gg_via_link', '1'); }catch(e){} history.replaceState(null, '', location.pathname + location.search + '#/'); }
    // never await Supabase inside this callback: it runs while the auth lock is held and getSession()/queries would deadlock.
    // Hand off to the next tick and reuse the session the event already carries.
    if(session && !S.user) setTimeout(async () => { if(S.user) return; try{ await loadProfile(session); }catch(e){} if(S.user){ G.authReady = true; render(); } }, 0);
  }
  if(ev==='SIGNED_OUT'){ S.user = null; }
}); }

export { renderLogin, attachAuth };
