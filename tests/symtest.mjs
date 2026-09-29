import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
import fs from 'fs';
const browser = await chromium.launch(launchArgs([]));
const d = await (await browser.newContext({viewport:{width:1280,height:900}})).newPage(); const errs=[];
d.on('pageerror', e => errs.push(e.message+' '+(e.stack||'').split('\n').slice(0,2).join('|')));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(1800);
await d.evaluate(()=>{ sessionStorage.setItem('gg_dash','all'); });
const vid = await d.evaluate(()=>window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1500);
{ const tb = await d.$('[data-tab=\"steps\"]'); if(tb && await tb.isVisible()) await tb.click(); } await d.waitForTimeout(400);
console.log('tools:', await d.$$eval('[data-tool]', b => b.map(x => x.dataset.tool)));
// open the picker via the tool → empty state → upload two files → first becomes... (two files → stays open)
await d.click('#symdock [data-tab="own"]'); await d.waitForTimeout(300); await d.click('#symdock .ss-tile.add'); await d.waitForTimeout(400);
console.log('picker empty text:', (await d.textContent('#sym-grid')).trim().slice(0,60));
await d.setInputFiles('#sym-file', [TESTS+'/sym_wrench.png', TESTS+'/sym_part.jpg']); await d.waitForTimeout(1500);
console.log('symbols in ws:', JSON.stringify(await d.evaluate(()=>window.__tables.workspaces[0].symbols.map(s=>({n:s.name, ar:+s.ar.toFixed(2), alpha:s.alpha, url:s.url.slice(0,40)})))));
await d.screenshot({path:OUT+'/s1-picker.png'});
// the mock storage has no real files: point the urls at data URLs so the canvas can draw them
const wrench = 'data:image/png;base64,'+fs.readFileSync(TESTS+'/sym_wrench.png').toString('base64');
const part = 'data:image/jpeg;base64,'+fs.readFileSync(TESTS+'/sym_part.jpg').toString('base64');
await d.evaluate(([w,p]) => { const syms = window.__tables.workspaces[0].symbols; syms[0].url = w; syms[1].url = p; }, [wrench, part]);
await d.click('.sym[data-id]'); await d.waitForTimeout(600);   // pick wrench → placed (glow)
console.log('ann after pick:', JSON.stringify(await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0].ann.filter(a=>a.type==='img').map(a=>({style:a.style, ar:+a.ar.toFixed(2), size:a.size, name:a.name})))));
await d.click('#symdock .ss-tile.add'); await d.waitForTimeout(400); await d.click('.sym[data-id]:nth-of-type(3)'); await d.waitForTimeout(600); // part.jpg → sticker
// move the second one to the right and make it bigger (keyboard)
await d.evaluate(()=>{ const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0]; const im = st.ann.filter(a=>a.type==='img'); im[0].x = 0.3; im[0].y = 0.35; im[0].size = 0.26; im[1].x = 0.72; im[1].y = 0.62; im[1].size = 0.22; im[1].color = 'mint'; });
await d.keyboard.press(']'); await d.waitForTimeout(300);
await d.waitForTimeout(800); await d.screenshot({path:OUT+'/s2-stage.png', clip:{x:0,y:0,width:1280,height:900}});
console.log('pills:', await d.$$eval('.ann-pill', p => p.map(x => x.textContent.trim().replace(/\s+/g,' '))));
// toggle style on the selected pill
const st = await d.$('.ann-pill.on [data-style]'); if(st){ await st.click(); await d.waitForTimeout(400); }
console.log('styles now:', JSON.stringify(await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0].ann.filter(a=>a.type==='img').map(a=>a.style))));
await d.screenshot({path:OUT+'/s3-stage-toggled.png'});
// viewer renders the symbols too
await d.evaluate(()=>{ window.__tables.instructions[0].status='published'; });
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(500);
await d.goto(BASE+'/index3.html#/v/'+vid+'/1'); await d.waitForTimeout(1800);
await d.screenshot({path:OUT+'/s4-viewer.png'});
// drag ghost for emoji + img tools must not throw
await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1200); { const tb = await d.$('[data-tab=\"steps\"]'); if(tb && await tb.isVisible()) await tb.click(); } await d.waitForTimeout(300);
await d.click('#symdock [data-tab="emoji"]'); await d.waitForTimeout(300); const tb = await d.$('#symdock .ss-tile.emo'); const bb = await tb.boundingBox(); await d.mouse.move(bb.x+10, bb.y+10); await d.mouse.down(); await d.mouse.move(bb.x+60, bb.y-200, {steps:5}); await d.mouse.up(); await d.waitForTimeout(300); await d.keyboard.press('Escape');
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
