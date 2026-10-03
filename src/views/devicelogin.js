/* ---------- v12.50: sign in on the phone with a QR code from the PC – no second e-mail ----------
   PC (signed in): profile → "Sign in on your phone" shows a QR code (3 minutes, one use). The phone scans it – inside GIRI
   ("Scan QR code from the PC" on the sign-in page) or with its normal camera app – and shows a two-digit number. The PC shows which phone
   it is and the same number and must allow it (number matching, as Microsoft and WhatsApp Web do it: someone who photographs the screen
   cannot slip in unnoticed). Then the phone gets a one-time sign-in token from the edge function device-login and has its own session.
   No external service: QR drawing (qrcodejs, already in the app), QR reading (BarcodeDetector where the browser has it, else the
   bundled jsQR in vendor/), the hand-over in our own edge function + table (migration v014). */
import { render } from '../app/router.js';
import { el, esc, modal, toast, confirmM } from '../core/helpers.js';
import { t } from '../core/i18n.js';
import { G, S } from '../core/state.js';
import { loadProfile, signOutAll } from '../core/auth.js';
import { IC } from '../ui/icons.js';
import { topbar } from '../ui/topbar.js';

const QR_RE = /#\/qr\/([0-9a-f-]{36})\/([A-Za-z0-9_-]{32,64})/i;
const qrUrl = (id, secret) => `${location.origin}${location.pathname}#/qr/${id}/${secret}`;

// one call of the edge function; errors come back as {error:'…'} (never throws)
async function call(action, body){
  try{
    const {data, error} = await G.sb.functions.invoke('device-login', {body: Object.assign({action}, body || {})});
    if(error){ let d = null; try{ d = await error.context.json(); }catch(e){} return d && (d.error || d.status) ? d : {error: 'net'}; }
    return data || {error: 'net'};
  }catch(e){ return {error: 'net'}; }
}

// "iPhone · Safari", "Android · Chrome", "iPhone · GIRI-App" – what the PC shows before it allows the sign-in
function deviceName(){
  const u = navigator.userAgent || '';
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : t('dl_device');
  const app = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  const br = app ? 'GIRI-App' : /EdgA?\//.test(u) ? 'Edge' : /SamsungBrowser/.test(u) ? 'Samsung Internet' : /(CriOS|Chrome)\//.test(u) ? 'Chrome' : /(FxiOS|Firefox)\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ');
}

const errText = e => t({not_ready:'dl_not_ready', too_many:'dl_too_many', login_required:'dl_login', expired:'qr_err_expired', used:'qr_err_used', replaced:'qr_err_replaced', invalid:'qr_err_invalid', denied:'qr_err_denied', net:'dl_net'}[e] || 'dl_net');

/* ---- PC: show the QR code, wait for the phone, allow it ---- */
async function qrLoginDialog(){
  let alive = true, timer = null, cur = null, state = '';
  await modal(`<div class="dl"><h2>${t('dl_title')}</h2><p class="muted dl-sub">${t('dl_sub')}</p><div class="dl-body" id="dl-body"></div>
    <div class="actions"><button class="btn ghost" data-x>${t('close')}</button></div></div>`, (bg, close) => {
    bg.querySelector('[data-x]').onclick = () => close(null);
    const body = bg.querySelector('#dl-body');
    const show = html => { body.innerHTML = html; };
    const again = (msg, kind) => { show(`<div class="dl-end ${kind||''}"><p>${esc(msg)}</p><button class="btn" data-new>${IC.refresh || ''} ${t('dl_new')}</button></div>`); body.querySelector('[data-new]').onclick = fresh; };
    const left = () => { const e = body.querySelector('#dl-left'); if(e && cur){ const s = Math.max(0, Math.round((cur.expires_at - Date.now()) / 1000)); e.textContent = t('dl_left', {t: Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')}); } };
    async function fresh(){
      clearTimeout(timer); state = ''; show(`<div class="dl-wait"><div class="spin"></div></div>`);
      const r = await call('create'); if(!alive) return;
      if(r.error || !r.id){ again(errText(r.error), 'err'); return; }
      cur = r; state = 'pending';
      const url = qrUrl(r.id, r.secret);
      show(`<div class="dl-qr" id="dl-qr" data-url="${esc(url)}" aria-label="${esc(t('dl_title'))}"></div><div class="dl-left tnum" id="dl-left"></div><p class="dl-how">${t('dl_how')}</p>`);
      try{ new QRCode(body.querySelector('#dl-qr'), {text: url, width: 232, height: 232, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M}); }catch(e){ body.querySelector('#dl-qr').textContent = 'QR n/a'; }
      left(); poll();
    }
    async function poll(){
      if(!alive || !cur) return; left();
      const r = await call('status', {id: cur.id}); if(!alive) return;
      if(r.status === 'claimed' && state !== 'claimed'){
        // number matching: the phone shows a number, the person types it here – the server never tells the PC the number
        state = 'claimed';
        show(`<div class="dl-ask"><div class="dl-dev">📱 <b>${esc(r.device || t('dl_device'))}</b></div><p class="dl-wants">${t('dl_wants')}</p>
          <label class="dl-lbl" for="dl-in">${t('dl_type')}</label><input id="dl-in" class="dl-in tnum" inputmode="numeric" autocomplete="off" maxlength="2" placeholder="··" aria-describedby="dl-hint"><p class="muted dl-same" id="dl-hint">${t('dl_type_sub')}</p>
          <div class="row dl-btns"><button class="btn ghost" data-deny>${t('dl_deny')}</button><button class="btn" data-allow disabled>${IC.check} ${t('dl_allow')}</button></div></div>`);
        const inp = body.querySelector('#dl-in'), ok = body.querySelector('[data-allow]');
        inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 2); ok.disabled = inp.value.length !== 2; };
        inp.onkeydown = e => { if(e.key === 'Enter' && !ok.disabled) ok.click(); };
        setTimeout(() => inp.focus(), 50);
        ok.onclick = async () => { ok.disabled = true; const a = await call('approve', {id: cur.id, ok: true, code: inp.value}); if(!alive) return;
          if(a.error === 'wrong_code'){ state = 'denied'; again(t('dl_wrong_code'), 'err'); return; }
          if(a.error){ again(errText(a.error), 'err'); return; }
          state = 'approved'; show(`<div class="dl-wait"><div class="spin"></div><p>${t('dl_wait_phone')}</p></div>`); };
        body.querySelector('[data-deny]').onclick = async () => { await call('approve', {id: cur.id, ok: false}); state = 'denied'; again(t('dl_denied'), 'err'); };
      }
      else if(r.status === 'used'){ show(`<div class="dl-end ok"><div class="dl-ok">${IC.check}</div><p>${t('dl_done')}</p></div>`); setTimeout(() => close(null), 2600); return; }
      else if(r.status === 'expired' || r.status === 'replaced'){ again(t('qr_err_expired')); return; }
      else if(r.status === 'denied'){ if(state !== 'denied') again(t('dl_denied'), 'err'); return; }
      else if(r.error && r.error !== 'net'){ again(errText(r.error), 'err'); return; }
      timer = setTimeout(poll, state === 'pending' ? 1500 : 1000);
    }
    fresh();
  });
  alive = false; clearTimeout(timer);
}

/* ---- phone: the page behind the QR link (#/qr/<id>/<secret>) – works signed out, inside the app or in the browser ---- */
async function renderQrLogin(app, id, secret){
  topbar(app);
  const v = el(`<main class="qrl"><div class="card qrl-card"><div class="qrl-ic">📱</div><h1 id="qrl-h">${t('qr_checking')}</h1><p class="muted" id="qrl-p"></p>
    <div class="qrl-code tnum" id="qrl-code" hidden></div><p class="qrl-as" id="qrl-as" hidden></p><div class="qrl-acts" id="qrl-acts"><div class="spin"></div></div></div></main>`);
  app.appendChild(v);
  const set = (h, p, opts = {}) => { v.querySelector('#qrl-h').textContent = h; v.querySelector('#qrl-p').textContent = p || '';
    const c = v.querySelector('#qrl-code'); c.hidden = opts.code == null; if(opts.code != null) c.textContent = opts.code;
    const as = v.querySelector('#qrl-as'); as.hidden = !opts.as; if(opts.as) as.innerHTML = opts.as;
    v.querySelector('#qrl-acts').innerHTML = opts.wait ? '<div class="spin"></div>' : (opts.home ? `<a class="btn" href="#/">${t('qr_to_login')}</a>` : ''); };
  const fail = e => { try{ sessionStorage.removeItem('gg_qr_' + id); }catch(x){} set(errText(e), e === 'expired' || e === 'used' || e === 'replaced' || e === 'denied' ? t('qr_again_pc') : '', {home: true}); };
  // the secret leaves the address bar / history at once (single-use anyway); it waits in this tab only, so a redraw of the page resumes
  const KEY = 'gg_qr_' + id; let st = null; try{ st = JSON.parse(sessionStorage.getItem(KEY) || 'null'); }catch(e){}
  if(secret){ st = {secret}; try{ sessionStorage.setItem(KEY, JSON.stringify(st)); }catch(e){} }
  try{ history.replaceState(null, '', location.pathname + location.search + '#/qr/' + id); }catch(e){}
  if(!st || !QR_RE.test(`#/qr/${id}/${st.secret}`)){ fail('invalid'); return; }
  secret = st.secret;
  let c = st.claim || null, switched = !!st.switched;
  if(!c){
    c = await call('claim', {id, secret, device: deviceName()});
    if(c.error || c.code == null){ fail(c.error || 'net'); return; }
    st.claim = c; try{ sessionStorage.setItem(KEY, JSON.stringify(st)); }catch(e){}
  }
  const cancel = async () => { await call('cancel', {id, secret, claim: c.claim}); try{ sessionStorage.removeItem(KEY); }catch(e){} location.hash = '#/'; };
  // already signed in on this device (as someone else perhaps)? Ask now – the account is known after the claim – and sign out HERE only
  if(S.user && !switched){
    const ok = await confirmM(t('qr_switch_q', {n: S.user.name, m: c.name || c.email || ''}), t('qr_switch'));
    if(!ok){ await cancel(); return; }
    await signOutAll(); switched = st.switched = true; try{ sessionStorage.setItem(KEY, JSON.stringify(st)); }catch(e){}
  }
  set(t('qr_confirm_t'), t('qr_confirm_sub'), {code: c.code, as: t('qr_as', {n: `<b>${esc(c.name || '')}</b>`, e: esc(c.email || '')}), wait: true});
  { const acts = v.querySelector('#qrl-acts'); const b = el(`<button class="btn ghost sm qrl-cancel">${t('qr_not_me')}</button>`); b.onclick = cancel; acts.appendChild(b); }
  const until = (c.expires_at || Date.now() + 180e3) + 120e3;
  const loop = async () => {
    if(!v.isConnected) return;
    const r = await call('poll', {id, secret, claim: c.claim});
    if(!v.isConnected) return;
    if(r.status === 'signed_in' && r.token_hash){
      set(t('qr_signing'), '', {wait: true});
      let res = await G.sb.auth.verifyOtp({token_hash: r.token_hash, type: 'magiclink'});
      if(res.error) res = await G.sb.auth.verifyOtp({token_hash: r.token_hash, type: 'email'});
      if(res.error){ set(t('qr_err_fail'), res.error.message || '', {home: true}); return; }
      try{ if(r.email) localStorage.setItem('gg_email', r.email); sessionStorage.removeItem(KEY); }catch(e){}
      toast(t('qr_ok'));
      // after switching accounts: start fresh, so nothing of the previous person stays in memory on a shared phone
      if(switched){ location.hash = '#/'; location.reload(); return; }
      await loadProfile(); G.authReady = true; location.hash = '#/'; render(); return;
    }
    if(r.status === 'denied' || r.status === 'expired' || r.status === 'used' || r.status === 'replaced'){ fail(r.status); return; }
    if(r.error && r.error !== 'net'){ fail(r.error); return; }
    if(Date.now() > until){ fail('expired'); return; }
    setTimeout(loop, 1500);
  };
  loop();
}

/* ---- phone: scan the QR code inside GIRI (the installed app cannot be opened by the camera app's link on iPhones) ---- */
let jsqrLoad = null;
const loadJsQR = () => jsqrLoad || (jsqrLoad = new Promise((res, rej) => { if(window.jsQR) return res(window.jsQR.default || window.jsQR); const s = document.createElement('script'); s.src = 'vendor/jsQR.min.js'; s.onload = () => res(window.jsQR && (window.jsQR.default || window.jsQR)); s.onerror = () => { jsqrLoad = null; rej(new Error('jsQR')); }; document.head.appendChild(s); }));
// the text of a QR code in a picture (canvas / video frame drawn into a canvas) – BarcodeDetector where the browser has it, else jsQR
async function readQr(cv, bd){
  if(bd){ try{ const codes = await bd.detect(cv); if(codes && codes[0]) return codes[0].rawValue || null; }catch(e){} }
  const jsqr = await loadJsQR(); const cx = cv.getContext('2d', {willReadFrequently: true}); const img = cx.getImageData(0, 0, cv.width, cv.height);
  const c = jsqr(img.data, cv.width, cv.height, {inversionAttempts: 'attemptBoth'}); return c ? c.data : null;
}
async function scanQr(){
  let stream = null, raf = 0, done = false;
  const stop = () => { done = true; cancelAnimationFrame(raf); if(stream){ stream.getTracks().forEach(tr => tr.stop()); stream = null; } };
  let bd = null; try{ if('BarcodeDetector' in window){ const f = await window.BarcodeDetector.getSupportedFormats(); if(f && f.includes('qr_code')) bd = new window.BarcodeDetector({formats: ['qr_code']}); } }catch(e){ bd = null; }
  const r = await modal(`<div class="scan"><h2>${t('scan_t')}</h2><p class="muted scan-sub">${t('scan_sub')}</p><div class="scan-box"><video playsinline muted autoplay></video><i class="scan-frame"></i></div><p class="scan-msg" id="scan-msg" role="status"></p>
    <div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button></div></div>`, async (bg, close) => {
    bg.querySelector('[data-x]').onclick = () => close(null);
    const video = bg.querySelector('video'), msg = bg.querySelector('#scan-msg');
    try{ stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}}, audio: false}); }catch(e){ msg.textContent = t('scan_nocam'); return; }
    if(done){ stop(); return; }
    video.srcObject = stream; try{ await video.play(); }catch(e){}
    if(!bd){ try{ await loadJsQR(); }catch(e){ msg.textContent = t('scan_nocam'); return; } }
    const cv = document.createElement('canvas'); const cx = cv.getContext('2d', {willReadFrequently: true}); let last = 0, busy = false;
    const tick = async ts => {
      if(done) return; raf = requestAnimationFrame(tick);
      if(busy || ts - last < 160 || video.readyState < 2 || !video.videoWidth) return; last = ts; busy = true;
      try{ const w = Math.min(720, video.videoWidth), h = Math.round(w * video.videoHeight / video.videoWidth); cv.width = w; cv.height = h; cx.drawImage(video, 0, 0, w, h);
        const text = await readQr(cv, bd);
        if(text){ const m = QR_RE.exec(text); if(m){ stop(); close({id: m[1], secret: m[2]}); return; } msg.textContent = t('scan_wrong'); } }
      catch(e){} finally{ busy = false; } };
    raf = requestAnimationFrame(tick);
  });
  stop();
  if(r){ location.hash = `#/qr/${r.id}/${r.secret}`; }
}

export { qrLoginDialog, renderQrLogin, scanQr, readQr, deviceName, QR_RE };
