// offline viewing for workers: instruction + media are saved on the device, the viewer works without network, login page lists the copies
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = []; const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); Object.defineProperty(window, '__tables', {configurable:true, set(t){ const snap = localStorage.getItem('gg_test_tables'); if(snap){ const o = JSON.parse(snap); Object.keys(o).forEach(k => { t[k] = o[k]; }); } this._t = t; }, get(){ return this._t; }}); });
const m = await ctx.newPage(); m.on('pageerror', e => errs.push('M '+e.message));
// seed as creator, then publish with remote media URLs (served by the test server)
await m.goto(BASE+'/index3.html'); await m.waitForTimeout(2500);
const vid = await m.evaluate(base => { const r = window.__tables.instructions[0]; r.status='published'; r.data.status='published'; r.data.checklist=false; let k=0; r.data.steps.forEach(s => { if(s.kind) return; s.mediaUrl = base+'/tests/'+(k++%2 ? 'imp2.jpg' : 'imp1.jpg'); s.mediaPath = 'x/'+s.mediaId+'.jpg'; }); return r.id; }, BASE);
// drop the local (creator) media so the viewer must download – like a worker's phone
await m.evaluate(async () => { const db = await new Promise(r => { const q = indexedDB.open('giri-go'); q.onsuccess = e => r(e.target.result); }); await new Promise(r => { const tx = db.transaction('media','readwrite'); tx.objectStore('media').clear(); tx.oncomplete = r; }); });
await m.evaluate(() => { localStorage.setItem('gg_nosess','1'); localStorage.setItem('gg_test_tables', JSON.stringify(window.__tables)); });
const vkey = await m.evaluate(() => window.__tables.instructions[0].data.shareKey); console.log('share key:', vkey ? vkey.length+' chars' : 'MISSING');
await m.goto(BASE+'/index3.html?w=1#/v/'+vid+'/'+vkey); await m.waitForTimeout(1500);
const skipOv = async () => { const b = await m.$('#ov-start'); if(b){ await b.click(); await m.waitForTimeout(400); } }; await skipOv();
await m.waitForTimeout(2500);
console.log('pill:', await m.$eval('#vw-off', e => e.textContent).catch(() => 'none'));
const stored = await m.evaluate(async () => { const db = await new Promise(r => { const q = indexedDB.open('giri-go'); q.onsuccess = e => r(e.target.result); }); const all = s => new Promise(r => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); }); const vc = await all('vcache'), md = await all('media'); return {vc: vc.map(r => ({id:r.id, title:r.title, media:r.media})), media: md.filter(x => x.cache).length}; });
console.log('vcache:', JSON.stringify(stored));
await m.screenshot({path:OUT+'/shots/vc1-online.png'});
await m.click('#menu'); await m.waitForTimeout(500); console.log('side offline line:', await m.$eval('#side-off-t', e => e.textContent)); await m.screenshot({path:OUT+'/shots/vc2-side.png'}); await m.click('#sclose');
// ---- offline: reload the viewer ----
await m.evaluate(() => { window.__mockOffline = true; }); await ctx.setOffline(true);
await m.evaluate(() => { location.hash = '#/'; }); await m.waitForTimeout(800); await m.evaluate(id => { location.hash = '#/v/'+id; }, vid+'/'+vkey); await m.waitForTimeout(2500); await skipOv(); await m.waitForTimeout(800);
console.log('offline steps rendered:', await m.$$eval('.vstep[data-id]', x => x.length), 'first img src:', await m.$eval('.vstep[data-id] img', e => e.src.slice(0,5)));
console.log('offline pill:', await m.$eval('#vw-off', e => e.textContent).catch(() => 'none'));
await m.screenshot({path:OUT+'/shots/vc3-offline.png'});
// login page lists the copy
await m.evaluate(() => { location.hash = '#/'; }); await m.waitForTimeout(1500);
console.log('saved list entries:', JSON.stringify(await m.$$eval('.offl-it', x => x.map(e => e.querySelector('b').textContent+' | '+e.querySelector('small').textContent))));
await m.screenshot({path:OUT+'/shots/vc4-login-saved.png'});
// install guide from the saved box
await m.click('#offl-inst'); await m.waitForTimeout(400); console.log('guide steps:', await m.$$eval('.ig-steps li', x => x.length), 'platform on:', await m.$eval('#ig-plat .on', e => e.textContent));
await m.screenshot({path:OUT+'/shots/vc5-guide.png'}); await m.click('#ig-plat [data-p="android"]'); await m.waitForTimeout(200); await m.screenshot({path:OUT+'/shots/vc6-guide-android.png'}); await m.keyboard.press('Escape');
// remove the copy
await ctx.setOffline(false); await m.evaluate(() => { window.__mockOffline = false; });
m.once('dialog', d => d.accept());
await m.click('.offl-it [data-rm]'); await m.waitForTimeout(300); const ok = await m.$('.modal-bg [data-ok]'); if(ok) await ok.click(); await m.waitForTimeout(600);
const after = await m.evaluate(async () => { const db = await new Promise(r => { const q = indexedDB.open('giri-go'); q.onsuccess = e => r(e.target.result); }); const all = s => new Promise(r => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); }); return {vc:(await all('vcache')).length, media:(await all('media')).filter(x=>x.cache).length}; });
console.log('after remove:', JSON.stringify(after));
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
