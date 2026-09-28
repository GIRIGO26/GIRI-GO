import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const d = await (await browser.newContext({viewport:{width:1280,height:900}})).newPage(); const errs=[]; d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
await d.evaluate(()=>{ localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_dash','all'); const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0]; st.ann = [{id:'a1', type:'arrow', x:.2, y:.2, x2:.45, y2:.45, color:'blue', t:0, size:.14}]; });
const vid = await d.evaluate(()=>window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1500); { const tb = await d.$('[data-tab=\"steps\"]'); if(tb && await tb.isVisible()) await tb.click(); } await d.waitForTimeout(600);
console.log('panel hidden before select:', await d.$eval('#ann3d', e => e.hidden));
await d.click('.ann-pill'); await d.waitForTimeout(400);
console.log('panel hidden after select:', await d.$eval('#ann3d', e => e.hidden), 'sliders:', await d.$$eval('#ann3d input[data-k]', x => x.map(i=>i.dataset.k)), 'chips:', await d.$$eval('#ann3d [data-anim]', x => x.map(b=>b.textContent)));
// tilt via slider
await d.$eval('#ann3d input[data-k="tx"]', i => { i.value = 40; i.dispatchEvent(new Event('input', {bubbles:true})); i.dispatchEvent(new Event('change', {bubbles:true})); });
await d.waitForTimeout(300);
console.log('tx stored:', await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0].ann[0].tx));
await d.click('#ann3d [data-anim="bounce"]'); await d.waitForTimeout(400);
console.log('anim stored:', await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0].ann[0].anim), 'chip on:', await d.$eval('#ann3d [data-anim="bounce"]', b => b.className));
const ed = await d.$('.ed-main'); await ed.screenshot({path:OUT+'/shots/anim-panel.png'});
// redraw loop running? count frames by monkeypatching
const frames = await d.evaluate(async () => { const cv = document.querySelector('#acv'); let n=0; const P = CanvasRenderingContext2D.prototype, orig = P.clearRect; P.clearRect = function(...a){ if(this.canvas===cv) n++; return orig.apply(this, a); }; await new Promise(r=>setTimeout(r, 1000)); P.clearRect = orig; return n; });
console.log('anim redraws in 1s (editor):', frames);
await d.click('#ann3d [data-flat]'); await d.waitForTimeout(200);
console.log('after flat tx:', await d.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0].ann[0].tx));
// viewer
await d.evaluate(()=>{ window.__tables.instructions[0].status='published'; const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0]; st.ann[0].anim='pulse'; });
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(500);
await d.goto(BASE+'/index3.html#/v/'+vid+'/1'); await d.waitForTimeout(1500);
const vf = await d.evaluate(async () => { const cvs = [...document.querySelectorAll('.vstep canvas')]; const cv = cvs.find(c => c._redraw); if(!cv) return 'no animated canvas'; let n=0; const P = CanvasRenderingContext2D.prototype, orig = P.clearRect; P.clearRect = function(...a){ if(this.canvas===cv) n++; return orig.apply(this, a); }; await new Promise(r=>setTimeout(r, 1000)); P.clearRect = orig; return n; });
console.log('anim redraws in 1s (viewer):', vf);
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
