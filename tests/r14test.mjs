import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs=[]; const hook = p => { p.on('pageerror', e => errs.push(e.message+' '+(e.stack||'').split('\n').slice(0,2).join('|'))); };
// ---- 1) password gate (anonymous viewer) ----
const anonCtx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
const a = await anonCtx.newPage(); hook(a);
await a.goto(BASE+'/index3.html'); await a.waitForTimeout(500); await a.evaluate(()=>sessionStorage.setItem('gg_dash','all')); await a.goto(BASE+'/index3.html#/'); await a.waitForSelector('[data-a="more"]', {timeout:20000}); await a.waitForTimeout(500);
const vid = await a.evaluate(()=>{ const r = window.__tables.instructions[0]; r.status='published'; return r.id + '/' + (r.data.shareKey||''); }); // v0.33: public links carry the share key
// simulate anonymous: no session → the mock always has a session; emulate "not readable" by making from('instructions') return nothing for this id
await a.evaluate(()=>{ window.__mockPw = 'geheim'; const r = window.__tables.instructions[0]; window.__hidden = r; window.__tables.instructions = []; window.__tables.instructions_hidden = [r]; });
await a.goto(BASE+'/index3.html#/p/none'); await a.waitForTimeout(800); await a.goto(BASE+'/index3.html#/'); await a.waitForTimeout(800);
console.log('dashboard cards after hiding:', await a.$$eval('[data-a="more"]', x => x.length));
await a.goto(BASE+'/index3.html#/v/'+vid); await a.waitForTimeout(1200);
console.log('gate shown:', !!(await a.$('#vpw')), 'rpc calls:', JSON.stringify(await a.evaluate(()=>window.__rpc)));
await a.screenshot({path:OUT+'/t1-pwgate.png'});
// wrong then right password
await a.fill('#vpw', 'falsch'); await a.click('#vpw-go'); await a.waitForTimeout(400); console.log('wrong pw msg:', await a.textContent('#vpw-err'));
await a.fill('#vpw', 'geheim'); await a.click('#vpw-go'); await a.waitForTimeout(1500);
console.log('opened after pw:', !!(await a.$('.vw-chap, .vw-start, .vstep')), 'remembered:', await a.evaluate(()=>localStorage.getItem('gg_pw_'+window.__hidden.id)));
await anonCtx.close();
// ---- 2) editor: video marks + title fmtbar ----
const d = await (await browser.newContext({viewport:{width:1280,height:900}})).newPage(); hook(d);
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(1800);
await d.evaluate(()=>{ sessionStorage.setItem('gg_dash','all'); });
const id2 = await d.evaluate(()=>window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+id2); await d.waitForTimeout(1500); { const tb = await d.$('[data-tab=\"steps\"]'); if(tb && await tb.isVisible()) await tb.click(); } await d.waitForTimeout(400);
console.log('title fmtbar buttons:', await d.$$eval('[data-tf]', b => b.map(x => x.dataset.tf)));
await d.click('#stitle'); await d.evaluate(()=>{ const i = document.querySelector('#stitle'); i.setSelectionRange(0, 9); });
await d.click('[data-tf="keep"]'); await d.waitForTimeout(600);
console.log('title after keep:', await d.inputValue('#stitle'), '| list row html has keep:', await d.$eval('.srow.sel .tt', e => e.innerHTML.includes('class="keep"')));
// add a video step via import to test marks
await d.setInputFiles('.addstep input[type=file]', TESTS+'/test.webm'); await d.waitForTimeout(6000);
const vsel = await d.$('#trimbar'); console.log('video stage present:', !!vsel);
if(vsel){
  await d.click('#symdock [data-tab="status"]'); await d.waitForTimeout(200); await d.click('[data-tool="check"]'); await d.waitForTimeout(300);
  await d.evaluate(()=>{ const bar = document.querySelector('#trimbar'); const r = bar.getBoundingClientRect(); const ev = t => new PointerEvent(t, {clientX:r.left + r.width*0.7, clientY:r.top+20, bubbles:true, pointerId:1}); bar.dispatchEvent(ev('pointerdown')); bar.dispatchEvent(ev('pointerup')); });
  await d.waitForTimeout(300);
  console.log('after seek: selected pill?', !!(await d.$('.ann-pill.on')), 'visible anns at new time:', await d.evaluate(()=>{ return document.querySelectorAll('.mark').length; }));
  await d.click('[data-tool="cross"]'); await d.waitForTimeout(400);
  console.log('marks:', await d.$$eval('.mark', m => m.map(x => x.style.left+(x.classList.contains('on')?'*':''))));
  const ts = await d.evaluate(()=>{ const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind).find(s=>s.type==='video'); return st.ann.map(a=>a.type+'@'+a.t); }); console.log('ann times:', ts);
  await d.screenshot({path:OUT+'/t2-marks.png', clip:{x:400,y:150,width:880,height:750}});
}
// ---- 3) viewer titles with keep + h2 html ----
await d.evaluate(()=>{ window.__tables.instructions[0].status='published'; });
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(600);
await d.goto(BASE+'/index3.html#/v/'+id2+'/1'); await d.waitForTimeout(1500);
const b = await d.$('#ov-start'); if(b){ await b.click(); await d.waitForTimeout(300); }
console.log('viewer h2:', await d.$eval('.vstep[data-i="0"] h2', e => e.innerHTML));
// ---- 4) login page mobile layout ----
const m = await (await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true})).newPage(); hook(m);
await m.goto(BASE+'/index3.html'); await m.waitForTimeout(1500);
await m.evaluate(()=>{ localStorage.clear(); localStorage.setItem('gg_nosess','1'); });
await m.goto(BASE+'/index3.html#/x'); await m.waitForTimeout(300); await m.reload(); await m.waitForTimeout(1500);
await m.waitForTimeout(800);
console.log('login order (top→):', await m.evaluate(()=>{ const els = [...document.querySelectorAll('.l-visual, .l-form h1, .l-card')]; return els.map(e => e.className+'@'+Math.round(e.getBoundingClientRect().top)); }), 'err:', await m.evaluate(()=>document.body.dataset.err||''));
await m.screenshot({path:OUT+'/t3-login-mobile.png', fullPage:true});
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
