// v12.45.1 – PC: the docked symbol library under the picture – emoji tab shows the grid without scrolling inside, tabs switch fast,
// switching steps does not rebuild every 3D tile (timings printed), video shows its poster at once
import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const ctx = await browser.newContext({viewport:{width:1366,height:900}});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_symtab','emoji'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2000);
const id = await d.evaluate(() => window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(1800);
const rows = await d.$$('.srow'); console.log('steps:', rows.length);
const t0 = Date.now(); await rows[1].click(); await d.waitForSelector('#symdock .ss-tile', {timeout:5000}); console.log('step → dock tiles ready:', Date.now()-t0, 'ms');
const info = await d.evaluate(() => { const dock = document.querySelector('#symdock'); const body = dock.querySelector('.ss-body'); const grid = dock.querySelector('.ss-grid.emo:last-of-type'); const sel = dock.querySelector('.ss-grp select'); const r = body.getBoundingClientRect(); const g = grid && grid.getBoundingClientRect(); return {tab: dock.querySelector('.ss-tab.on').dataset.tab, bodyH: Math.round(r.height), bodyScroll: body.scrollHeight, bodyClient: body.clientHeight, gridTop: g && Math.round(g.top - r.top), gridBottom: g && Math.round(g.bottom - r.top), tiles: dock.querySelectorAll('.ss-tile.emo').length, groups: sel && sel.options.length, dockTop: Math.round(dock.getBoundingClientRect().top), vh: innerHeight}; });
console.log('emoji tab:', JSON.stringify(info));
await d.screenshot({path:OUT+'/shots/dock-emoji.png', fullPage:false});
const dock = await d.$('#symdock'); await dock.screenshot({path:OUT+'/shots/dock-emoji-panel.png'});
// tab switch timings
for(const tb of ['mark','status','safety','emoji']){ const t1 = Date.now(); await d.click(`#symdock [data-tab="${tb}"]`); await d.waitForSelector('#symdock .ss-tile'); console.log('tab', tb, ':', Date.now()-t1, 'ms, tiles', await d.$$eval('#symdock .ss-tile', x => x.length)); }
// step switch timings (3D tiles rebuilt?)
for(let k=0;k<3;k++){ const t2 = Date.now(); await rows[k].click(); await d.waitForSelector('#symdock .ss-tile'); console.log('step', k, 'switch → dock:', Date.now()-t2, 'ms'); }
// tab click brings the whole panel into view inside the scrolling stage column
await d.click('#symdock [data-tab="emoji"]'); await d.waitForTimeout(700);
console.log('dock fully visible after tab click:', await d.evaluate(() => { const r = document.querySelector('#symdock').getBoundingClientRect(); return r.top >= 60 && r.bottom <= innerHeight + 2 ? 'yes' : `no (${Math.round(r.top)}–${Math.round(r.bottom)} of ${innerHeight})`; }), '| body max-height:', await d.$eval('#symdock .ss-body', e => getComputedStyle(e).maxHeight));
// a pick scrolls the picture back
await d.click('#symdock .ss-tile.emo'); await d.waitForTimeout(800);
console.log('picture visible after pick:', await d.evaluate(() => { const r = document.querySelector('#mbox').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight ? 'yes' : `no (${Math.round(r.top)}–${Math.round(r.bottom)})`; }), '| placed:', await d.evaluate(() => { const st = window.__tables.instructions[0].data.steps.filter(x=>!x.kind)[0]; return st.ann.length; }));
// video step: poster + spinner (a webm imported as a new step, then re-selected – the poster is known from the list thumbnail)
await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(1200);
await d.setInputFiles('.addstep input[type=file]', TESTS+'/test.webm'); await d.waitForTimeout(6000);
const rows2 = await d.$$('.srow'); await rows2[0].click(); await d.waitForTimeout(400); await rows2[rows2.length-1].click(); await d.waitForTimeout(300);
console.log('video:', await d.$eval('#med', e => e.tagName+' poster='+((e.getAttribute('poster')||'').slice(0,10)||'-')+' loading='+e.closest('.media-box').classList.contains('loading')));
await d.waitForTimeout(1500); console.log('after load: spinner gone =', !(await d.$eval('#mbox', e => e.classList.contains('loading'))));
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
