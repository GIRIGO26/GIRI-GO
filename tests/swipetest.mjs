// v12.47 – phone: a quick horizontal swipe over the picture switches to the next / previous step; a tap still sets the mark;
// dragging a selected symbol never switches steps
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = []; const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(1800);
const id = await d.evaluate(() => { const r = window.__tables.instructions[0]; r.data.steps.filter(s=>!s.kind).forEach(s => { s.type = 'photo'; }); return r.id; });
await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(1500);
await d.click('.srow .tt'); await d.waitForTimeout(700);
const cur = () => d.$eval('.stepbar b', e => e.textContent.trim());
console.log('start:', await cur());
const bb = await (await d.$('#acv')).boundingBox(); const y = bb.y + bb.height*0.5;
const swipe = async (dir) => { const x0 = bb.x + bb.width*(dir<0 ? 0.8 : 0.2); await d.mouse.move(x0, y); await d.mouse.down(); for(let k=1;k<=6;k++){ await d.mouse.move(x0 + dir*k*22, y + k, {steps:1}); await d.waitForTimeout(20); } await d.mouse.up(); await d.waitForTimeout(600); };
await swipe(-1); console.log('after swipe left:', await cur(), '(expected 2 von 5)');
await swipe(-1); console.log('after second swipe left:', await cur(), '(expected 3 von 5)');
await swipe(+1); console.log('after swipe right:', await cur(), '(expected 2 von 5)');
// vertical move = no switch
{ const x = bb.x + bb.width*0.5; await d.mouse.move(x, bb.y+30); await d.mouse.down(); for(let k=1;k<=6;k++){ await d.mouse.move(x+k*3, bb.y+30+k*25); await d.waitForTimeout(20); } await d.mouse.up(); await d.waitForTimeout(400); console.log('after vertical drag:', await cur(), '(expected 2 von 5)'); }
// a tap still shows the mark chip
await d.touchscreen.tap(bb.x + bb.width*0.3, bb.y + bb.height*0.6); await d.waitForTimeout(400); console.log('tap mark:', !!(await d.$('.tapmark')));
// a placed symbol dragged sideways moves, the step stays
await d.click('#tools-open'); await d.waitForTimeout(600); await d.click('[data-tab="mark"]'); await d.waitForTimeout(300); await d.click('.ss-tile[data-tool="circle"]'); await d.waitForTimeout(700);
const a0 = await d.evaluate(() => { const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[1]; const a = st.ann[st.ann.length-1]; return {id:a.id, x:a.x, y:a.y}; });
const bb2 = await (await d.$('#acv')).boundingBox(); const cx = bb2.x + bb2.width*a0.x, cy = bb2.y + bb2.height*a0.y;
await d.mouse.move(cx, cy); await d.mouse.down(); for(let k=1;k<=6;k++){ await d.mouse.move(cx - k*22, cy, {steps:1}); await d.waitForTimeout(20); } await d.mouse.up(); await d.waitForTimeout(600);
console.log('after dragging the symbol:', await cur(), '| symbol x:', a0.x.toFixed(2), '→', await d.evaluate(id => { const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[1]; const a = st.ann.find(x => x.id===id); return a && a.x.toFixed(2); }, a0.id), '(moved left, step unchanged)');
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
