// v12.40 – symbol library: sheet with tabs, ISO 7010 signs, search, tap-to-place at the last tapped spot, new 3D types, orbit handle
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs=[]; const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
const id = await d.evaluate(() => { const r = window.__tables.instructions[0]; r.data.steps.filter(s=>!s.kind)[0].type='photo'; return r.id; });
await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(1800);
{ const tb = await d.$('[data-tab="steps"]'); if(tb && await tb.isVisible()) await tb.click(); await d.waitForTimeout(500); }
// phone: the list and the step are two screens – open the selected step so the picture (and its canvas) is on screen
await d.click('.srow.sel .tt'); await d.waitForTimeout(600); console.log('pane:', await d.$eval('#tab-steps', e => e.dataset.pane));
// tap a spot on the picture, then pick a symbol → it lands there
const cv = await d.$('#acv'); const bb = await cv.boundingBox();
await d.touchscreen.tap(bb.x + bb.width*0.25, bb.y + bb.height*0.7); await d.waitForTimeout(300);
console.log('tap mark shown:', !!(await d.$('.tapmark')));
await d.click('#tools-open'); await d.waitForTimeout(700);
console.log('sheet tabs:', await d.$$eval('.ss-tab', x => x.filter(e => !e.hidden).map(e => e.dataset.tab).join(',')), '| mark tiles:', await d.$$eval('.ss-tile', x => x.length));
await d.click('[data-tab="safety"]'); await d.waitForTimeout(1200);
console.log('safety groups:', await d.$$eval('.ss-chip', x => x.map(e => e.textContent.trim()).join('/')), '| warning signs:', await d.$$eval('.ss-grid.iso .ss-tile', x => x.length));
await d.click('.ss-chip[data-g="M"]'); await d.waitForTimeout(800); console.log('mandatory signs:', await d.$$eval('.ss-grid.iso .ss-tile', x => x.length), '| first:', await d.$eval('.ss-grid.iso .ss-tile', e => e.title));
await d.click('.ss-grid.iso .ss-tile:nth-child(3)'); await d.waitForTimeout(700);
const placed = await d.evaluate(() => { const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0]; const a = st.ann[st.ann.length-1]; return a && {type:a.type, code:a.code, name:a.name, x:+a.x.toFixed(2), y:+a.y.toFixed(2), size:a.size}; });
console.log('placed:', JSON.stringify(placed), placed && Math.abs(placed.x-0.25) < 0.03 && Math.abs(placed.y-0.7) < 0.03 ? '(at the tapped spot)' : '(NOT at the tapped spot)');
console.log('selected bar: anim chips', await d.$$eval('#ann3d [data-anim]', x => x.length), '| swatches for ISO:', await d.$$eval('#ann3d [data-col]', x => x.length), '| pill trash:', !!(await d.$('.ann-pill.on [data-del] svg')));
// search
await d.click('#tools-open'); await d.waitForTimeout(500); await d.fill('#ss-q', 'gehör'); await d.waitForTimeout(600);
console.log('search "gehör":', await d.$$eval('.ss-tile', x => x.map(e => e.title).join(' | ')));
await d.click('.ss-tile'); await d.waitForTimeout(600);
// recent tab now exists and holds the two picks
await d.click('#tools-open'); await d.waitForTimeout(500); console.log('recent tab visible:', await d.$eval('[data-tab="recent"]', e => !e.hidden)); await d.click('[data-tab="recent"]'); await d.waitForTimeout(400); console.log('recent tiles:', await d.$$eval('.ss-tile', x => x.map(e => e.title).join(' | ')));
// a 3D object from "status": thumbs up → new type
await d.click('[data-tab="status"]'); await d.waitForTimeout(400); await d.click('.ss-tile[title="Daumen hoch"]'); await d.waitForTimeout(600);
console.log('thumb placed:', await d.evaluate(() => { const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0]; const a = st.ann[st.ann.length-1]; return a.type+'/'+a.dir; }));
// orbit handle: drag → tilt/turn stored; double tap → flat
const pos = await d.evaluate(() => window.__orbitPos());
const rr = await d.evaluate(() => { const b = document.querySelector('#acv').getBoundingClientRect(); return {l:b.left, t:b.top}; });
await d.mouse.move(rr.l+pos.x, rr.t+pos.y); await d.mouse.down(); await d.mouse.move(rr.l+pos.x-50, rr.t+pos.y-30, {steps:10}); await d.mouse.up(); await d.waitForTimeout(400);
console.log('after orbit drag tx/ty:', await d.evaluate(() => { const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0]; const a = st.ann[st.ann.length-1]; return (a.tx||0)+'/'+(a.ty||0); }));
const st = await d.$('#stage'); await st.screenshot({path:OUT+'/lib-phone.png'});
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
