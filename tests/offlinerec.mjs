// v12.47 – recording offline: a new instruction with three clips added without network keeps all three in the list (also after
// leaving and re-entering the editor while still offline), nothing is reported as an error, and after reconnecting the rows and
// clips go up without a false "changed on another device" – also after a reload
import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = []; const toasts = [];
const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); const o = window.toast; });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2000);
// watch every toast text
await d.evaluate(() => { window.__toasts = []; const el = document.querySelector('#toast'); new MutationObserver(() => { if(el.textContent) window.__toasts.push(el.textContent); }).observe(el, {childList:true, characterData:true, subtree:true}); });
// ---- offline ----
await d.evaluate(() => { window.__mockOffline = true; }); await ctx.setOffline(true); await d.waitForTimeout(300);
await d.click('#new'); await d.waitForTimeout(400); await d.fill('#ni-t', 'Offline aufgenommen'); await d.click('.modal-bg [data-ok]'); await d.waitForTimeout(1200);
console.log('after new instruction (offline): hash =', await d.evaluate(() => location.hash));
const nid = await d.evaluate(() => location.hash.split('/').pop());
// the camera view needs a real camera – add the three clips through the editor's file input instead (same saveInstr path)
await d.goto(BASE+'/index3.html#/edit/'+nid); await d.waitForTimeout(1200);
for(let k=0;k<3;k++){ await d.setInputFiles('.addstep input[type=file]', TESTS+'/imp1.jpg'); await d.waitForTimeout(1500); }
console.log('steps in list (offline):', await d.$$eval('.srow', x => x.length), '| toasts:', JSON.stringify(await d.evaluate(() => window.__toasts.filter(t => /Fehler|Error|failed|Failed/i.test(t)))), '(no error toasts expected)');
// leave and come back while offline (the background sync runs its offline fallback)
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1200); await d.goto(BASE+'/index3.html#/edit/'+nid); await d.waitForTimeout(1500);
console.log('steps after leave/re-enter (offline):', await d.$$eval('.srow', x => x.length), '| conflict dialog:', !!(await d.$('.modal-bg')));
console.log('server rows for it (offline):', await d.evaluate(id => window.__tables.instructions.filter(i => i.id===id).length, nid));
// ---- online ----
await ctx.setOffline(false); await d.evaluate(() => { window.__mockOffline = false; window.dispatchEvent(new Event('online')); }); await d.waitForTimeout(4000);
console.log('server steps after sync:', await d.evaluate(id => { const r = window.__tables.instructions.find(i => i.id===id); return r ? r.data.steps.filter(s => !s.kind).map(s => s.mediaUrl ? 'url' : 'nourl').join(',') : 'NO ROW'; }, nid), '| conflict dialog:', !!(await d.$('.modal-bg')), '| list:', await d.$$eval('.srow', x => x.length), '| pill:', await d.$eval('#netpill', e => e.hidden ? 'hidden' : e.textContent));
// ---- reload, edit the title: no "changed on another device" ----
const toastsBefore = await d.evaluate(() => window.__toasts);
await d.reload(); await d.waitForTimeout(2200); await d.goto(BASE+'/index3.html#/edit/'+nid); await d.waitForTimeout(1500);
await d.evaluate(prev => { window.__toasts = prev; const el = document.querySelector('#toast'); new MutationObserver(() => { if(el.textContent) window.__toasts.push(el.textContent); }).observe(el, {childList:true, characterData:true, subtree:true}); }, toastsBefore);
await d.fill('#ititle', 'Offline aufgenommen – fertig'); await d.dispatchEvent('#ititle', 'input'); await d.waitForTimeout(1500);
console.log('after reload + edit: conflict dialog:', !!(await d.$('.modal-bg')), '| server title:', await d.evaluate(id => (window.__tables.instructions.find(i => i.id===id)||{}).title, nid), '| steps:', await d.$$eval('.srow', x => x.length));
console.log('error toasts overall:', JSON.stringify(await d.evaluate(() => window.__toasts.filter(t => /Fehler|Error|failed|Failed|anderen Gerät/i.test(t)))));
await d.screenshot({path:OUT+'/shots/offlinerec.png'});
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
