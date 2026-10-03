// v12.50 – sign in on the phone with a QR code from the PC: the PC (Björn, signed in) shows the code in the profile, the phone (signed
// out) scans it – once through the link (camera app), once with GIRI's own scanner (a fake camera that films the QR code) – the phone
// shows a number, the person types it on the PC; the phone is signed in without an e-mail. Also: a wrong number, decline, cancel on
// the phone, expiry, a second scan, switching accounts on the phone, signing out on the phone keeps the PC signed in (this device only),
// and "sign out on all devices".
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs'; import fs from 'node:fs'; import path from 'node:path';
const errs = [];
await fetch(BASE+'/__db', {method:'DELETE'});
const browser = await chromium.launch(launchArgs([]));
const mk = async (b, opts, init) => { const c = await b.newContext(opts); await c.addInitScript(init.fn, init.arg); return c; };
const pcCtx = await mk(browser, {viewport:{width:1366,height:860}}, {fn: () => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_shared','1'); sessionStorage.setItem('gg_inst_hide','1'); }});
const pc = await pcCtx.newPage(); pc.on('pageerror', e => errs.push('PC '+e.message));
await pc.goto(BASE+'/index3.html'); await pc.waitForTimeout(2400);
const phoneOpts = {viewport:{width:390,height:844}, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'};
const phoneInit = {fn: () => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_shared','1'); if(!sessionStorage.getItem('gg_started')){ localStorage.setItem('gg_nosess','1'); sessionStorage.setItem('gg_started','1'); } }};

const openQr = async () => { await pc.click('[data-profile]'); await pc.waitForTimeout(300); await pc.click('.modal [data-qrlogin]'); await pc.waitForSelector('#dl-qr', {timeout:5000}); await pc.waitForTimeout(300); return pc.$eval('#dl-qr', e => e.dataset.url); };
const typeNumber = async n => { await pc.waitForSelector('#dl-in', {timeout:6000}); await pc.fill('#dl-in', String(n)); await pc.waitForTimeout(150); await pc.click('.modal [data-allow]'); };
const closePc = async () => { const x = await pc.$('.modal [data-x]'); if(x) await x.click(); await pc.waitForTimeout(300); };

// 1. through the link (the phone's camera app opens it)
const url = await openQr();
console.log('PC profile → QR shown:', /#\/qr\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{32,64}$/.test(url) || url, '| validity line:', await pc.$eval('#dl-left', e => e.textContent), '| QR drawn:', await pc.$eval('#dl-qr', e => !!e.querySelector('img, canvas')));
await pc.screenshot({path:OUT+'/shots/qr-pc.png'});
const phCtx = await mk(browser, phoneOpts, phoneInit); const ph = await phCtx.newPage(); ph.on('pageerror', e => errs.push('PHONE '+e.message));
await ph.goto(url.replace(/^https?:\/\/[^/]+\//, BASE+'/').replace(/\/[^/#]*#/, '/index3.html#')); await ph.waitForTimeout(2200);
const code = await ph.$eval('#qrl-code', e => e.textContent).catch(() => null);
console.log('phone after the scan:', await ph.$eval('#qrl-h', e => e.textContent), '| number:', code, '|', await ph.$eval('#qrl-as', e => e.textContent).catch(() => ''), '| secret gone from the address bar:', await ph.evaluate(() => location.hash.split('/').length === 3));
// a redraw of the page while waiting (e.g. the language) resumes – it does not lose the hand-over
await ph.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange'))); await ph.waitForTimeout(600); console.log('after a redraw still waiting with the same number:', await ph.$eval('#qrl-code', e => e.textContent).catch(() => 'LOST'));
await ph.screenshot({path:OUT+'/shots/qr-phone-wait.png'});
await pc.waitForSelector('#dl-in', {timeout:6000});
console.log('PC asks:', await pc.$eval('.dl-ask', e => e.innerText.replace(/\n+/g,' | ')), '| the PC does not show the number:', !(await pc.evaluate(c => document.querySelector('.modal').innerText.includes(c), code)), '| allow disabled until 2 digits:', await pc.$eval('.modal [data-allow]', e => e.disabled));
await pc.fill('#dl-in', String(code)); await pc.screenshot({path:OUT+'/shots/qr-pc-ask.png'});
await pc.click('.modal [data-allow]'); await pc.waitForSelector('.modal .dl-end.ok', {timeout:8000}).catch(() => {}); const pcSays = await pc.$eval('.modal .dl-end', e => e.textContent.trim()).catch(() => 'none'); await ph.waitForTimeout(2500);
console.log('phone signed in:', await ph.evaluate(() => !!document.querySelector('#list, .dash-head')), '| as:', await ph.evaluate(() => (document.querySelector('.tb-name')||{}).textContent), '| token redeemed:', JSON.stringify(await ph.evaluate(() => (window.__verify||[]).map(v => v.type))));
console.log('PC says:', pcSays);
await pc.waitForTimeout(2600); console.log('PC dialog closes by itself:', !(await pc.$('.modal .dl')));
// signing out on the phone: this device only
await ph.click('[data-profile]'); await ph.waitForTimeout(300); await ph.click('.modal [data-logout2]'); await ph.waitForTimeout(800);
console.log('phone signed out with scope:', JSON.stringify(await ph.evaluate(() => window.__signOut)), '| PC still signed in:', await pc.evaluate(() => !!document.querySelector('[data-profile]')));
// a second scan of a used code
await ph.goto(url.replace(/^https?:\/\/[^/]+\//, BASE+'/').replace(/\/[^/#]*#/, '/index3.html#')); await ph.waitForTimeout(1600);
console.log('same code again:', await ph.$eval('#qrl-h', e => e.textContent));
await phCtx.close();

// 2. declined on the PC
const url2 = await openQr();
const ph2Ctx = await mk(browser, phoneOpts, phoneInit); const ph2 = await ph2Ctx.newPage(); ph2.on('pageerror', e => errs.push('PHONE2 '+e.message));
await ph2.goto(url2.replace(/^https?:\/\/[^/]+\//, BASE+'/').replace(/\/[^/#]*#/, '/index3.html#')); await ph2.waitForTimeout(1800);
await pc.waitForSelector('#dl-in', {timeout:6000}); await pc.click('.modal [data-deny]'); await ph2.waitForTimeout(3000);
console.log('declined → phone:', await ph2.$eval('#qrl-h', e => e.textContent), '| PC:', await pc.$eval('.modal .dl-end', e => e.textContent.trim()));
// 2b. a wrong number on the PC ends the code (someone else's phone cannot be allowed by guessing or a careless click)
await pc.click('.modal [data-new]'); await pc.waitForSelector('#dl-qr'); const urlW = await pc.$eval('#dl-qr', e => e.dataset.url);
await ph2.goto(urlW.replace(/^https?:\/\/[^/]+\//, BASE+'/').replace(/\/[^/#]*#/, '/index3.html#')); await ph2.waitForTimeout(1600); const realN = await ph2.$eval('#qrl-code', e => e.textContent);
await typeNumber(realN === '99' ? '98' : String(+realN + 1)); await pc.waitForTimeout(500); await ph2.waitForTimeout(2500);
console.log('wrong number → PC:', await pc.$eval('.modal .dl-end', e => e.textContent.trim()), '| phone:', await ph2.$eval('#qrl-h', e => e.textContent));
// 2c. "not me" on the phone
await pc.click('.modal [data-new]'); await pc.waitForSelector('#dl-qr'); const urlC = await pc.$eval('#dl-qr', e => e.dataset.url);
await ph2.goto(urlC.replace(/^https?:\/\/[^/]+\//, BASE+'/').replace(/\/[^/#]*#/, '/index3.html#')); await ph2.waitForTimeout(1600);
await ph2.click('.qrl-cancel'); await ph2.waitForTimeout(800); await pc.waitForTimeout(2200);
console.log('cancelled on the phone → PC:', await pc.$eval('.modal .dl-end', e => e.textContent.trim()).catch(() => 'none'), '| phone back at:', await ph2.evaluate(() => location.hash || '#/'));
// 3. a new code on the PC replaces the open one; expiry
await pc.click('.modal [data-new]'); await pc.waitForSelector('#dl-qr'); const url3 = await pc.$eval('#dl-qr', e => e.dataset.url);
await closePc();
const url4 = await openQr(); await closePc();
await ph2.goto(url3.replace(/^https?:\/\/[^/]+\//, BASE+'/').replace(/\/[^/#]*#/, '/index3.html#')); await ph2.waitForTimeout(1500);
console.log('older code after a newer one:', await ph2.$eval('#qrl-h', e => e.textContent));
await pc.evaluate(() => { window.__dlTTL = 1500; }); const url5 = await openQr(); await pc.waitForTimeout(2600);
console.log('PC after expiry:', await pc.$eval('.modal .dl-end', e => e.textContent.trim()).catch(() => 'none')); await closePc(); await pc.evaluate(() => { window.__dlTTL = 0; });
await ph2Ctx.close();

// 4. GIRI's own scanner: a fake camera films the QR code on the PC
const url6 = await openQr();
const px = await pc.evaluate(() => { const c = document.querySelector('#dl-qr canvas'); const x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data; const g = []; for(let i = 0; i < d.length; i += 4) g.push(d[i]); return {w:c.width, h:c.height, g}; });
const W = 640, H = 480, S = 320, ox = (W-S)/2, oy = (H-S)/2; const Y = Buffer.alloc(W*H, 235);
for(let y = 0; y < S; y++) for(let x = 0; x < S; x++){ const sx = Math.floor(x*px.w/S), sy = Math.floor(y*px.h/S); Y[(oy+y)*W + ox + x] = px.g[sy*px.w + sx] < 128 ? 16 : 235; }
const UV = Buffer.alloc(W*H/4, 128); const frames = []; for(let k = 0; k < 20; k++) frames.push(Buffer.from('FRAME\n'), Y, UV, UV);
const y4m = path.join(OUT, 'qr-camera.y4m'); fs.writeFileSync(y4m, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...frames]));
const camBrowser = await chromium.launch(launchArgs(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture='+y4m]));
const ph3Ctx = await mk(camBrowser, Object.assign({permissions:['camera']}, phoneOpts), phoneInit); const ph3 = await ph3Ctx.newPage(); ph3.on('pageerror', e => errs.push('PHONE3 '+e.message));
await ph3.goto(BASE+'/index3.html'); await ph3.waitForTimeout(2200);
console.log('phone sign-in page – scan button:', await ph3.$eval('#li-qr', e => !e.hidden && e.textContent.trim()));
await ph3.screenshot({path:OUT+'/shots/qr-phone-login.png'});
await ph3.click('#li-qr'); await ph3.waitForTimeout(500); await ph3.screenshot({path:OUT+'/shots/qr-phone-scanner.png'});
for(let k = 0; k < 40 && !(await ph3.$('#qrl-code:not([hidden])')); k++) await ph3.waitForTimeout(250);
console.log('scanner read the code → number on the phone:', await ph3.$eval('#qrl-code', e => e.textContent).catch(() => 'NOT READ'), '| camera stopped:', await ph3.evaluate(() => !document.querySelector('.scan video')));
await typeNumber(await ph3.$eval('#qrl-code', e => e.textContent)); await ph3.waitForTimeout(4500);
console.log('signed in after scanning:', await ph3.evaluate(() => !!document.querySelector('#list, .dash-head')));
await ph3Ctx.close(); await camBrowser.close(); await pc.waitForTimeout(3000);

// 5. the phone is signed in as someone else (Felix) → asks before switching, signs out only there
const url7 = await openQr();
const ph4Ctx = await mk(browser, phoneOpts, {fn: () => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_shared','1'); if(!sessionStorage.getItem('gg_started')){ localStorage.setItem('gg_uid','u3'); sessionStorage.setItem('gg_started','1'); } }});
const ph4 = await ph4Ctx.newPage(); ph4.on('pageerror', e => errs.push('PHONE4 '+e.message));
await ph4.goto(BASE+'/index3.html'); await ph4.waitForTimeout(2000);
await ph4.goto(url7.replace(/^https?:\/\/[^/]+\//, BASE+'/').replace(/\/[^/#]*#/, '/index3.html#')); await ph4.waitForTimeout(1500);
console.log('phone signed in as Felix → asks:', await ph4.$eval('.modal', e => e.innerText.replace(/\n+/g,' | ')).catch(() => 'no question'));
await ph4.click('.modal [data-ok]'); await ph4.waitForTimeout(1500);
await typeNumber(await ph4.$eval('#qrl-code', e => e.textContent)); await ph4.waitForTimeout(5000);
console.log('after switching: signed out', JSON.stringify(await ph4.evaluate(() => JSON.parse(localStorage.getItem('gg_signout_log')||'[]'))), '| page reloaded fresh, now:', await ph4.evaluate(() => (document.querySelector('.tb-name')||{}).textContent));
await ph4Ctx.close();

// 5b. "sign out on all devices" in the profile
await closePc(); await pc.waitForTimeout(500); await pc.click('[data-profile]'); await pc.waitForTimeout(300);
console.log('profile offers sign-out everywhere:', await pc.$eval('.modal [data-logoutall]', e => e.textContent.trim()), '| and the QR entry:', await pc.$eval('.modal [data-qrlogin]', e => e.innerText.replace(/\n+/g,' · ')));
await pc.keyboard.press('Escape'); await pc.waitForTimeout(300);
// 6. without the database update the PC says so instead of a broken code
await closePc(); await pc.waitForTimeout(3000); await pc.evaluate(() => { window.__dlNotReady = true; }); await pc.click('[data-profile]'); await pc.waitForTimeout(300); await pc.click('.modal [data-qrlogin]'); await pc.waitForTimeout(800);
console.log('not set up yet:', await pc.$eval('.modal .dl-end', e => e.textContent.trim()).catch(() => 'none'));
console.log(errs.join('\n') || 'NO ERRORS'); await browser.close();
