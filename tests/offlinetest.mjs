import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = []; const ctx = await browser.newContext({viewport:{width:1366,height:900}}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_dash','all'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push('D '+e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2500);
const vid = await d.evaluate(()=>window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1500);
// ---- go offline ----
await d.evaluate(()=>{ window.__mockOffline = true; }); await ctx.setOffline(true); await d.waitForTimeout(400);
await d.fill('#ititle', 'Offline geändert'); await d.dispatchEvent('#ititle', 'input'); await d.waitForTimeout(1200);
console.log('toast after offline save:', await d.$eval('#toast', e => e.textContent));
const dirty = await d.evaluate(async () => { const db = await new Promise(r => { const q = indexedDB.open('giri-go'); q.onsuccess = e => r(e.target.result); }); return await new Promise(r => { const q = db.transaction('instr').objectStore('instr').getAll(); q.onsuccess = () => r(q.result.map(m => ({id:m.id, dirty:m.dirty, title:m.row.title}))); }); });
console.log('mirror:', JSON.stringify(dirty));
console.log('server title still old:', await d.evaluate(()=>window.__tables.instructions[0].title));
await d.waitForTimeout(500); console.log('pill:', await d.$eval('#netpill', e => e.hidden ? 'hidden' : e.textContent));
// dashboard while offline → local copy with the new title
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1500);
console.log('offline dashboard cards:', await d.$$eval('.instr', x => x.length), 'title shown:', await d.$eval('.instr .title', e => e.textContent.trim()));
await d.screenshot({path:OUT+'/shots/o1-offline-dash.png'});
// ---- back online ----
await ctx.setOffline(false); await d.evaluate(()=>{ window.__mockOffline = false; window.dispatchEvent(new Event('online')); }); await d.waitForTimeout(1500);
console.log('server title after sync:', await d.evaluate(()=>window.__tables.instructions[0].title), 'pill:', await d.$eval('#netpill', e => e.hidden ? 'hidden' : e.textContent));
// ---- orphan recovery ----
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGACcEAwGb9Y0CAAAAAElFTkSuQmCC';
await d.evaluate(async ({png, vid}) => { const bin = Uint8Array.from(atob(png), c => c.charCodeAt(0)); const db = await new Promise(r => { const q = indexedDB.open('giri-go'); q.onsuccess = e => r(e.target.result); }); await new Promise(r => { const tx = db.transaction('media','readwrite'); tx.objectStore('media').put({id:'orph1', ws:'ar-giri.com', instrId:vid, type:'photo', buf:bin.buffer, mime:'image/png', w:2, h:2}); tx.oncomplete = r; }); }, {png, vid});
await d.goto(BASE+'/index3.html#/trash'); await d.waitForTimeout(1500);
console.log('orphans listed:', await d.$$eval('#olist .instr', x => x.length));
await d.screenshot({path:OUT+'/shots/o2-orphans.png'});
const before = await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind).length);
await d.click('#olist [data-a="take"]'); await d.waitForTimeout(1200);
console.log('steps before/after take:', before, await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind).length), 'orphans left:', await d.$$eval('#olist .instr', x => x.length));
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
