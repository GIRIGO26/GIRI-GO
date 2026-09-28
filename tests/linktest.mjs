// v0.33 – public links carry a share key: share dialog shows a clickable link + QR, anon viewer needs the key, old links are stale
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const ctx = await browser.newContext({viewport:{width:1200,height:900}}); const errs=[];
// one context: the mock tables survive navigations through a localStorage snapshot (same trick as vcachetest)
await ctx.addInitScript(() => { Object.defineProperty(window, '__tables', {configurable:true, set(t){ const snap = localStorage.getItem('gg_test_tables'); if(snap){ const o = JSON.parse(snap); Object.keys(o).forEach(k => { t[k] = o[k]; }); } this._t = t; }, get(){ return this._t; }}); });
const d = await ctx.newPage();
const hook = p => p.on('pageerror', e => errs.push(e.message+' '+(e.stack||'').split('\n').slice(0,3).join('|'))); hook(d);
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
// the seeded example instruction has a key from birth; publish it
const info = await d.evaluate(() => { const r = window.__tables.instructions[0]; r.status='published'; r.data.status='published'; return {id:r.id, key:r.data.shareKey||''}; });
console.log('key from birth:', info.key.length, 'chars', /^[A-Za-z0-9_-]{24}$/.test(info.key) ? '(url-safe)' : '(BAD: '+info.key+')');
// share dialog from the editor
await d.goto(BASE+'/index3.html#/edit/'+info.id); await d.waitForTimeout(1500);
await d.click('#share'); await d.waitForTimeout(600);
const dlg = await d.evaluate(() => { const a = document.querySelector('#lnk'); const q = document.querySelector('#qr'); return {tag:a && a.tagName, href:a && a.getAttribute('href'), target:a && a.getAttribute('target'), text:a && a.textContent.trim(), qrTag:q && q.tagName, qrHref:q && q.getAttribute('href'), qrImg:!!(q && q.querySelector('img, canvas')), copy:!!document.querySelector('#cp'), openBtns:[...document.querySelectorAll('.modal a.btn[target=_blank], .dlg a.btn[target=_blank], a.btn[target=_blank]')].length}; });
console.log('link element:', dlg.tag, dlg.target, '| href has id/key:', dlg.href && dlg.href.includes('#/v/'+info.id+'/'+info.key), '| text:', dlg.text.slice(0, 70)+'…');
console.log('qr is a link:', dlg.qrTag, dlg.qrHref === dlg.href, '| qr drawn:', dlg.qrImg, '| copy button:', dlg.copy, '| open buttons:', dlg.openBtns);
await d.screenshot({path:OUT+'/l1-share.png'});
await d.keyboard.press('Escape'); await d.waitForTimeout(200);
// worker (no login): old link → stale, right key → opens, chapter arg keeps working, wrong key → stale
await d.evaluate(() => { localStorage.setItem('gg_nosess','1'); localStorage.setItem('gg_test_tables', JSON.stringify(window.__tables)); });
const m = await ctx.newPage(); await m.setViewportSize({width:390, height:844}); hook(m);
const open = async h => { await m.goto(BASE+'/index3.html?w=1'+h); await m.waitForTimeout(1600); return m.evaluate(() => ({stale: /veraltet|outdated/i.test(document.body.textContent), viewer: !!document.querySelector('.viewer, .vw, #ov-start, .vstep'), h1:(document.querySelector('h1,h2')||{}).textContent||''})); };
const r1 = await open('#/v/'+info.id); console.log('old link (no key):', r1.stale ? 'STALE page' : 'opened?!', '|', r1.h1.slice(0,40));
await m.screenshot({path:OUT+'/l2-stale.png'});
const r2 = await open('#/v/'+info.id+'/'+info.key); console.log('keyed link:', r2.viewer ? 'viewer' : 'NO VIEWER', r2.stale ? '(stale?!)' : '', '|', r2.h1.slice(0,40));
const rpc = await m.evaluate(() => (window.__rpc||[]).filter(x => x.name==='open_instr').map(x => (x.args.p_key||'').length)); console.log('open_instr called with key lengths:', rpc.join(','));
const r3 = await open('#/v/'+info.id+'/'+info.key+'/1'); console.log('keyed link + chapter:', r3.viewer ? 'viewer' : 'NO VIEWER', '| url now:', await m.evaluate(() => location.hash.replace(/[A-Za-z0-9_-]{24}/, '<key>')));
const r4 = await open('#/v/'+info.id+'/'+'x'.repeat(24)); console.log('wrong key:', r4.stale ? 'STALE page' : 'opened?!');
// signed-in member: plain #/v/<id> still opens (own workspace) and the address bar gains the key
await m.close(); await d.evaluate(() => { localStorage.removeItem('gg_nosess'); }); await d.goto(BASE+'/index3.html#/v/'+info.id); await d.waitForTimeout(1500);
console.log('member without key:', await d.evaluate(() => !!document.querySelector('#ov-start, .vstep')), '| url:', await d.evaluate(() => location.hash.replace(/[A-Za-z0-9_-]{24}/, '<key>')));
// anonymous REST read of the table is empty (mock emulates the dropped policy)
await d.evaluate(() => { localStorage.setItem('gg_nosess','1'); }); console.log('anon table read:', await d.evaluate(async () => { const sb = window.supabase.createClient('x','y'); const {data} = await sb.from('instructions').select('id'); return Array.isArray(data) ? data.length+' rows' : String(data); }));
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
