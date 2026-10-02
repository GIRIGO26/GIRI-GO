import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const d = await (await browser.newContext({viewport:{width:1366,height:900}})).newPage(); d.on('pageerror', e => errs.push('D '+e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200); await d.evaluate(()=>{ localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_dash','all'); }); await d.reload(); await d.waitForTimeout(2200);
const vid = await d.evaluate(()=>window.__tables.instructions[0].id);
// ---- step trash in the editor ----
await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1500);
console.log('panel header buttons:', await d.$$eval('.steps-panel .ph button, .steps-panel .ph label', x => x.length), 'add card buttons:', await d.$$eval('.addstep .as-b > *', x => x.map(b => b.textContent.trim())));
console.log('row delete on selected:', !!(await d.$('.srow.sel [data-rowdel]')));
await d.click('.srow.sel [data-rowdel]'); await d.waitForTimeout(300); await d.click('.modal [data-ok]'); await d.waitForTimeout(600);
console.log('steps after trash:', await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind).length), 'trash:', await d.evaluate(()=>(window.__tables.instructions[0].data.trash||[]).map(t => t.title+'@'+t.at)));
console.log('trash box:', await d.$eval('.trashbox summary', e => e.textContent.trim()), '| no panel heading any more:', !(await d.$('.steps-panel .ph')));
await d.click('.trashbox summary'); await d.waitForTimeout(200); await d.screenshot({path:OUT+'/shots/t1-editor-trash.png'});
await d.click('.trashbox [data-restore]'); await d.waitForTimeout(600);
console.log('steps after restore:', await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind).length), 'first title:', await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0].title), 'trash box gone:', !(await d.$('.trashbox')));
// chapter add from the card
await d.click('.addstep [data-ch]'); await d.waitForTimeout(300); await d.fill('#pm-in', 'Neues Kapitel'); await d.click('.modal [data-ok]'); await d.waitForTimeout(500);
console.log('chapters:', await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>s.kind==='chapter').map(s=>s.title)));
// ---- instruction trash ----
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(800);
await d.click('[data-a="more"]'); await d.waitForTimeout(300); await d.click('[data-m="del"]'); await d.waitForTimeout(300); await d.click('.modal [data-ok]'); await d.waitForTimeout(800);
console.log('dashboard cards:', await d.$$eval('.instr', x => x.length), 'deleted_at set:', await d.evaluate(()=>!!window.__tables.instructions[0].deleted_at));
await d.click('#tbmenu'); await d.waitForTimeout(200); await d.click('[data-m="trash"]'); await d.waitForTimeout(1200);
console.log('trash page cards:', await d.$$eval('.instr.trash', x => x.length), 'meta:', await d.$eval('.instr.trash .meta', e => e.textContent.trim()));
await d.screenshot({path:OUT+'/shots/t2-trash-page.png'});
await d.click('.instr.trash [data-a="restore"]'); await d.waitForTimeout(800);
console.log('restored deleted_at:', await d.evaluate(()=>window.__tables.instructions[0].deleted_at), 'empty state:', !!(await d.$('#tlist .empty')));
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(800); console.log('dashboard cards after restore:', await d.$$eval('.instr', x => x.length));
// ---- feedback dialog on desktop: only file picker; end page with a big logo (brand injected before the app boots) ----
const LOGO = 'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" rx="12" fill="#004EAD"/><text x="150" y="62" font-size="40" font-family="sans-serif" font-weight="800" fill="#fff" text-anchor="middle">ACME</text></svg>').toString('base64');
const ctx2 = await browser.newContext({viewport:{width:1366,height:900}}); await ctx2.addInitScript((logo) => { let tb = null; Object.defineProperty(window, '__tables', {configurable:true, set(v){ tb = v; v.workspaces[0].brand.logo = logo; }, get(){ return tb; }}); }, LOGO);
const d2 = await ctx2.newPage(); d2.on('pageerror', e => errs.push('D2 '+e.message));
await d2.goto(BASE+'/index3.html'); await d2.waitForTimeout(2200); await d2.evaluate(()=>localStorage.setItem('gg_lang','de'));
const vid3 = await d2.evaluate(()=>{ window.__tables.instructions[0].status = 'published'; return window.__tables.instructions[0].id; });
// v12.48: a checklist keeps the end hidden until every step is answered – switch it off in the editor (approval & settings)
await d2.goto(BASE+'/index3.html#/edit/'+vid3); await d2.waitForTimeout(1300); await d2.goto(BASE+'/index3.html#/settings/'+vid3); await d2.waitForTimeout(1200); await d2.$eval('#chk', e => { if(e.checked){ e.checked = false; e.dispatchEvent(new Event('change')); } }); await d2.waitForTimeout(500); await d2.goto(BASE+'/index3.html#/p/none'); await d2.waitForTimeout(500);
await d2.goto(BASE+'/index3.html#/v/'+vid3+'/1'); await d2.waitForTimeout(1500); if(await d2.$('#wname')){ await d2.fill('#wname','Anna'); await d2.click('#begin'); await d2.waitForTimeout(600); }
await d2.click('.vstep[data-i="0"] [data-fb]'); await d2.waitForTimeout(400);
console.log('desktop attach options:', await d2.$$eval('.modal [data-att]', x => x.map(i => i.dataset.att)), 'label:', await d2.$eval('.modal label.btn', e => e.textContent.trim()));
await d2.keyboard.press('Escape'); await d2.waitForTimeout(200);
await d2.evaluate(()=>{ document.querySelector('.vend').scrollIntoView(); }); await d2.waitForTimeout(600); const endEl = await d2.$('.vend'); await endEl.screenshot({path:OUT+'/shots/t3-end-logo.png'});
console.log('end logo big:', !!(await d2.$('.vend-logo.big img')), 'top logo:', !!(await d2.$('.vlogo')));
// ---- capture: no back/import, delete in replace bar ----
const m = await (await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2})).newPage(); m.on('pageerror', e => errs.push('M '+e.message));
await m.goto(BASE+'/index3.html'); await m.waitForTimeout(2200); await m.evaluate(()=>localStorage.setItem('gg_lang','de'));
const vid2 = await m.evaluate(()=>window.__tables.instructions[0].id);
await m.goto(BASE+'/index3.html#/'); await m.waitForTimeout(800);
console.log('version on mobile visible:', await m.evaluate(()=>{ const e = document.querySelector('.brand .ver'); return e ? getComputedStyle(e).display !== 'none' : 'n/a'; }));
await m.goto(BASE+'/index3.html#/rec/'+vid2); await m.waitForTimeout(2000);
console.log('capture top buttons:', await m.$$eval('.cap-top > *', x => x.map(e => e.id || e.className)), 'done button:', !!(await m.$('#done')));
await m.click('#strip2 .st'); await m.waitForTimeout(400);
console.log('modebar:', await m.$eval('#modebar', e => e.hidden ? 'hidden' : e.textContent.trim().slice(0,60)), '| delete button in camera (removed in v0.30.1, lives in the editor):', !!(await m.$('#modedel')));
await m.screenshot({path:OUT+'/shots/t4-capture.png'});
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
