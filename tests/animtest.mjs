import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const d = await (await browser.newContext({viewport:{width:1280,height:900}})).newPage(); const errs=[]; d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
await d.evaluate(()=>{ localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_dash','all'); const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0]; st.ann = [{id:'a1', type:'arrow', x:.2, y:.2, x2:.45, y2:.45, color:'blue', t:0, size:.14}]; });
const vid = await d.evaluate(()=>window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1500); { const tb = await d.$('[data-tab=\"steps\"]'); if(tb && await tb.isVisible()) await tb.click(); } await d.waitForTimeout(600);
console.log('panel hidden before select:', await d.$eval('#ann3d', e => e.hidden));
await d.click('.ann-pill'); await d.waitForTimeout(400);
console.log('panel hidden after select:', await d.$eval('#ann3d', e => e.hidden), '| slim bar (no pose/size/dup/delete):', await d.$$eval('#ann3d [data-pose],#ann3d [data-size],#ann3d [data-dup],#ann3d [data-del2]', x => x.length), 'chips:', await d.$$eval('#ann3d [data-anim]', x => x.map(b=>b.textContent)));
// v12.44: tilt only via the orbit handle on the picture (the pose chips are gone)
await d.evaluate(()=>{ const a = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0].ann[0]; a.tx = 58; }); await d.click('.ann-pill'); await d.waitForTimeout(300);
console.log('tx stored (set for the test):', await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0].ann[0].tx));
// … and via the orbit handle on the picture: drag it sideways → turn (ty), up → more tilt
{ const cvb = await d.$('#acv'); const bb = await cvb.boundingBox(); const h = await d.evaluate(() => { const cv = document.querySelector('#acv'); return cv._orbitHandle || null; });
  const rr = await d.evaluate(() => { const cv = document.querySelector('#acv'); const b = cv.getBoundingClientRect(); return {l:b.left, t:b.top}; });
  // handle position from the same helper the app uses
  const pos = await d.evaluate(() => { const cv = document.querySelector('#acv'); return window.__orbitPos ? window.__orbitPos() : null; });
  if(pos){ await d.mouse.move(rr.l+pos.x, rr.t+pos.y); await d.mouse.down(); await d.mouse.move(rr.l+pos.x+40, rr.t+pos.y-20, {steps:8}); await d.mouse.up(); await d.waitForTimeout(300);
    console.log('after orbit drag: tx/ty =', await d.evaluate(()=>{ const a = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0].ann[0]; return (a.tx||0)+'/'+(a.ty||0); })); }
  else console.log('orbit handle position not exposed'); }
await d.click('#ann3d [data-anim="bounce"]'); await d.waitForTimeout(400);
console.log('anim stored:', await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0].ann[0].anim), 'chip on:', await d.$eval('#ann3d [data-anim="bounce"]', b => b.className));
const ed = await d.$('.ed-main'); await ed.screenshot({path:OUT+'/shots/anim-panel.png'});
// redraw loop running? count frames by monkeypatching
const frames = await d.evaluate(async () => { const cv = document.querySelector('#acv'); let n=0; const P = CanvasRenderingContext2D.prototype, orig = P.clearRect; P.clearRect = function(...a){ if(this.canvas===cv) n++; return orig.apply(this, a); }; await new Promise(r=>setTimeout(r, 1000)); P.clearRect = orig; return n; });
console.log('anim redraws in 1s (editor):', frames);
// double-tap on the orbit handle = back to flat
{ const pos = await d.evaluate(() => window.__orbitPos()); const rr = await d.evaluate(() => { const b = document.querySelector('#acv').getBoundingClientRect(); return {l:b.left, t:b.top}; }); await d.mouse.click(rr.l+pos.x, rr.t+pos.y, {clickCount:2}); await d.waitForTimeout(300); }
console.log('after double-tap on the grip tx:', await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0].ann[0].tx));
// viewer
await d.evaluate(()=>{ window.__tables.instructions[0].status='published'; const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0]; st.ann[0].anim='pulse'; });
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(500);
await d.goto(BASE+'/index3.html#/v/'+vid+'/1'); await d.waitForTimeout(1500);
const vf = await d.evaluate(async () => { const cvs = [...document.querySelectorAll('.vstep canvas')]; const cv = cvs.find(c => c._redraw); if(!cv) return 'no animated canvas'; let n=0; const P = CanvasRenderingContext2D.prototype, orig = P.clearRect; P.clearRect = function(...a){ if(this.canvas===cv) n++; return orig.apply(this, a); }; await new Promise(r=>setTimeout(r, 1000)); P.clearRect = orig; return n; });
console.log('anim redraws in 1s (viewer):', vf);
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
