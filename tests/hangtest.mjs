// v12.43 – the device store hangs (as iOS does after the app was in the background): the editor must still move between steps
// (step bar first, watchdog on the store, server copy as fallback) instead of leaving dead buttons behind
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); });
const d = await ctx.newPage(); const errs=[]; d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(1800);
const vid = await d.evaluate(()=>{ const r = window.__tables.instructions[0]; r.data.steps.filter(s=>!s.kind).forEach((s, i) => { s.mediaUrl = 'https://x/m/'+s.mediaId+'.jpg'; }); return r.id; });
await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1500);
await d.click('.srow.sel .tt'); await d.waitForTimeout(600);
console.log('step 1 open:', await d.$eval('.stepbar b', e => e.textContent.trim()));
// from now on every store request stays silent forever
await d.evaluate(() => { const never = () => { const r = {}; setTimeout(() => {}, 0); return r; }; IDBObjectStore.prototype.get = never; IDBObjectStore.prototype.getKey = never; IDBObjectStore.prototype.getAll = never; IDBObjectStore.prototype.put = never; });
// step 2 gets a media id nobody has cached – the editor has to ask the (hanging) store and fall back to the server copy
await d.evaluate(() => { const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[1]; st.mediaId = 'nocache1'; st.mediaUrl = 'https://x/m/nocache1.jpg'; });
const t0 = Date.now(); await d.click('[data-next]');
await d.waitForSelector('.stepbar b:has-text("2 von")', {timeout: 3000}); console.log('step bar moved to 2 after', Date.now()-t0, 'ms (before the picture is there)');
await d.waitForFunction(() => document.querySelector('#mbox, .noshot-stage'), null, {timeout: 9000}); const dt = Date.now()-t0; console.log('stage rendered after', dt, 'ms', dt > 3500 && dt < 7000 ? '(watchdog fallback)' : '', '| media src:', await d.$eval('#med', e => (e.currentSrc||e.getAttribute('src')||'').slice(0, 30)).catch(() => 'n/a'));
await d.click('[data-next]'); await d.waitForSelector('.stepbar b:has-text("3 von")', {timeout: 3000}); console.log('step 3 reachable:', await d.$eval('.stepbar b', e => e.textContent.trim()));
await d.click('#stage [data-back]'); await d.waitForTimeout(400); console.log('back to the list:', await d.evaluate(() => location.hash + ' pane=' + (document.querySelector('#tab-steps') ? document.querySelector('#tab-steps').dataset.pane : 'no editor')));
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
