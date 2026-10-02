// v12.47.1 – install banner at the top of the dashboard (every browser start, "Später" = this tab only), add-step tiles with
// sized icons, warning field below the description, separate formatting buttons, trash chevron, live version label,
// and the worker end screens in the light theme (readable subtitle, chips and close button)
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const ctx = await browser.newContext({viewport:{width:1366,height:900}}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_inst_dismissed','1'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2000);
// ---- banner: first child of the page, above the h1, even though the old "dismissed" flag is set ----
console.log('banner first in page:', await d.evaluate(() => { const m = document.querySelector('main.dash'); return m && m.firstElementChild && m.firstElementChild.id; }), '| text:', await d.$eval('#inst-top b', e => e.textContent), '| mentions offline:', await d.$eval('#inst-top', e => /offline/i.test(e.textContent)));
await d.screenshot({path:OUT+'/shots/inst-top.png'});
await d.click('#inst-top [data-later]'); await d.waitForTimeout(200); console.log('after Später:', !!(await d.$('#inst-top')), '(expected false)');
await d.goto(BASE+'/index3.html#/stats'); await d.waitForTimeout(500); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(800); console.log('same tab, back on dashboard:', !!(await d.$('#inst-top')), '(expected false)');
const d2 = await ctx.newPage(); d2.on('pageerror', e => errs.push(e.message)); await d2.goto(BASE+'/index3.html'); await d2.waitForTimeout(2000);
console.log('new tab (= new start):', !!(await d2.$('#inst-top')), '(expected true)'); await d2.close();
// ---- editor ----
const id = await d.evaluate(() => window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(1800);
console.log('add-step icons:', JSON.stringify(await d.$$eval('.addstep .as-b .btn svg', x => x.map(e => Math.round(e.getBoundingClientRect().width)))));
const first = await d.$('.srow'); await first.click(); await d.waitForTimeout(600);
const order = await d.$$eval('.props > .field', x => x.map(e => e.querySelector('label') ? e.querySelector('label').textContent.trim() : '?'));
console.log('field order:', JSON.stringify(order), '| warn closed & last:', await d.evaluate(() => { const f = [...document.querySelectorAll('.props > .field')]; const w = f.find(e => e.classList.contains('warnf')); return w === f[f.length-1] && w.classList.contains('closed'); }));
console.log('fmt buttons title/desc:', await d.$$eval('.props .fmtbar', x => x.map(b => b.querySelectorAll('button').length).join('/')), '| gap between first two:', await d.evaluate(() => { const b = document.querySelectorAll('.props .fmtbar button'); return Math.round(b[1].getBoundingClientRect().left - b[0].getBoundingClientRect().right); }));
await d.click('[data-addwarn]'); await d.waitForTimeout(200); await d.fill('#swarn', 'Heiß!'); await d.waitForTimeout(1800);
console.log('warning saved:', await d.evaluate(id => { const r = window.__tables.instructions.find(i => i.id===id); return r.data.steps.some(x => x.warn==='Heiß!'); }, id));
await d.screenshot({path:OUT+'/shots/editor-props.png', fullPage:true});
// trash: delete a step → box with chevron + hint, opens on click
const delBefore = await d.$$eval('.srow', x => x.length); d.once('dialog', dg => dg.accept()); await d.click('#del'); await d.waitForTimeout(300); const ok = await d.$('.modal-bg [data-ok]'); if(ok){ await ok.click(); await d.waitForTimeout(600); }
console.log('steps', delBefore, '→', await d.$$eval('.srow', x => x.length), '| trash summary:', await d.$eval('.trashbox summary', e => e.textContent.replace(/\s+/g,' ').trim()), '| chevron:', !!(await d.$('.trashbox summary .chev')));
await d.click('.trashbox summary'); await d.waitForTimeout(200); console.log('open:', await d.$eval('.trashbox', e => e.open), '| hint hidden when open:', await d.$eval('.trashbox summary .hint', e => getComputedStyle(e).display==='none'));
// version label follows a publish
console.log('version before:', await d.$eval('#vchip', e => e.textContent));
// CTA: draft → "zur Prüfung" (prompt) → review → "freigeben & veröffentlichen" (confirm) – the header label must show the new version at once
await d.click('#cta'); await d.waitForTimeout(300); { const ok = await d.$('.modal-bg [data-ok]'); if(ok){ await ok.click(); await d.waitForTimeout(600); } }
console.log('after submit – chip:', await d.$eval('#stchip', e => e.textContent), '| cta:', await d.$eval('#cta', e => e.hidden ? 'hidden' : e.textContent));
await d.click('#cta'); await d.waitForTimeout(300); { const ok = await d.$('.modal-bg #ap-both'); if(ok){ await ok.click(); await d.waitForTimeout(800); } } // v12.49: "Approve" opens the approval dialog
console.log('version after publish:', await d.$eval('#vchip', e => e.textContent), '| status chip:', await d.$eval('#stchip', e => e.textContent));
// ---- worker end screens, light theme ----
// (the brand is cached per page as soon as the dashboard loads → set the light theme before the page starts)
const ctx2 = await browser.newContext({viewport:{width:430,height:900}}); await ctx2.addInitScript(() => { localStorage.setItem('gg_lang','de'); Object.defineProperty(window, '__tables', {configurable:true, set(t){ t.workspaces[0].brand = Object.assign({}, t.workspaces[0].brand, {theme:'light'}); this._t = t; }, get(){ return this._t; }}); });
const m = await ctx2.newPage(); m.on('pageerror', e => errs.push('M '+e.message));
await m.goto(BASE+'/index3.html'); await m.waitForTimeout(2000);
const vid = await m.evaluate(() => { const r = window.__tables.instructions[0]; r.status='published'; r.data.checklist = true; return r.id; }); // (the example instruction is seeded by the app after login)
await m.goto(BASE+'/index3.html#/v/'+vid); await m.waitForTimeout(1500); const ov = await m.$('#ov-start'); if(ov){ await ov.click(); await m.waitForTimeout(400); }
console.log('light viewer:', !!(await m.$('.viewer.light')));
await m.fill('#wname', 'Björn'); await m.click('#begin'); await m.waitForTimeout(600);
for(const i of await m.$$eval('.vstep[data-need]', xs => xs.map(x => x.dataset.i))){ await m.$eval(`.vstep[data-i="${i}"]`, e => e.scrollIntoView()); await m.waitForTimeout(600); await m.click('#va-ok'); await m.waitForTimeout(350); } // v12.48: the answer bar
await m.evaluate(() => { const e = document.querySelector('.vend'); if(e) e.scrollIntoView(); }); await m.waitForTimeout(600);
const col = await m.evaluate(() => { const p = document.querySelector('#vend-p'); const c = document.querySelector('.vend-sum span'); return {p: p && getComputedStyle(p).color, chip: c && getComputedStyle(c).color + ' on ' + getComputedStyle(c).backgroundColor}; });
console.log('end section – subtitle colour:', col.p, '| chip:', col.chip);
await m.screenshot({path:OUT+'/shots/vend-light.png'});
const fin = await m.$('#finish2'); if(fin){ await fin.click(); await m.waitForTimeout(800); }
const card = await m.evaluate(() => { const s = document.querySelector('.vw-end .sub'); const b = document.querySelector('.vw-end .btn.ghost'); return {sub: s && getComputedStyle(s).color, btn: b && b.textContent.trim() + ' ' + getComputedStyle(b).color}; });
console.log('result card – subtitle:', card.sub, '| close button:', card.btn);
await m.screenshot({path:OUT+'/shots/vw-end-light.png'});
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
