// v12.48 – airplane mode: "new instruction" opens the camera at once (before: it waited for the network, and a second tap on OK
// landed in the recording of a second, duplicate instruction); the start page draws without waiting; nothing hangs
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_inst_hide','1'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
const before = await d.$$eval('#list article.instr', x => x.length);
// airplane mode
await d.evaluate(() => { window.__mockOffline = true; }); await ctx.setOffline(true); await d.waitForTimeout(300);
// the start page while offline: drawn from memory at once
let t0 = Date.now(); await d.goto(BASE+'/index3.html#/trash'); await d.waitForTimeout(200); t0 = Date.now(); await d.goto(BASE+'/index3.html#/');
await d.waitForSelector('#list article.instr', {timeout: 5000}); console.log('start page offline drawn in:', (Date.now()-t0) < 1500 ? 'under 1.5 s' : (Date.now()-t0)+' ms');
// new instruction: OK → camera route right away; a quick second tap creates nothing more
await d.click('#new'); await d.waitForTimeout(300); await d.fill('#ni-t', 'Flugmodus-Test');
t0 = Date.now(); await d.click('.modal-bg [data-ok]');
let ms = -1; for(let k=0;k<60;k++){ if(/^#\/?rec\//.test(await d.evaluate(() => location.hash))){ ms = Date.now()-t0; break; } await d.waitForTimeout(50); }
console.log('camera route after OK:', ms >= 0 && ms < 1000 ? 'under 1 s' : (ms < 0 ? 'NEVER' : ms+' ms'), '| hash:', (await d.evaluate(() => location.hash)).replace(/[a-z0-9]{8,}/, '<id>'));
const firstId = await d.evaluate(() => location.hash.replace(/^#\/?/, '').split('/')[1]);
// the capture page is up (no spinner waiting for the network)
await d.waitForTimeout(800); console.log('capture page shown:', await d.evaluate(() => !!document.querySelector('.cap, .capture, #shutter, [data-cap]') || document.querySelector('#app').textContent.length > 20));
// back to the list: exactly one new card with the title, saved on the device
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(900);
console.log('cards before/after:', before, '/', await d.$$eval('#list article.instr', x => x.length), '| cards titled "Flugmodus-Test":', await d.$$eval('#list article.instr .title', x => x.filter(e => e.textContent.trim()==='Flugmodus-Test').length));
// a second new instruction right after (the 2 s guard must not swallow a deliberate second one later)
await d.waitForTimeout(2200); await d.click('#new'); await d.waitForTimeout(300); await d.fill('#ni-t', 'Zweite offline'); await d.click('.modal-bg [data-ok]'); await d.waitForTimeout(600);
console.log('second instruction opened:', await d.evaluate(() => /^#\/?rec\//.test(location.hash)), '| different id:', await d.evaluate(id => location.hash.replace(/^#\/?/, '').split('/')[1] !== id, firstId));
// back online: both go up
await ctx.setOffline(false); await d.evaluate(() => { window.__mockOffline = false; window.dispatchEvent(new Event('online')); }); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(4000);
console.log('on the server after reconnect:', await d.evaluate(() => window.__tables.instructions.filter(r => /Flugmodus-Test|Zweite offline/.test(r.title)).map(r => r.title).sort().join(' + ')));
console.log(errs.join('\n') || 'NO ERRORS'); await browser.close();
