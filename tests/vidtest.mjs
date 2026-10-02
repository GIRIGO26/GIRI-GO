// v12.43 – video editing: a tap pauses (never resumes) and offers "mark here", the play button is reliable during the auto-pause,
// timeline marks can be dragged to move a symbol's moment, and the DOM around the canvas is not rebuilt on every frame
import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const d = await (await browser.newContext({viewport:{width:1280,height:1000}})).newPage(); const errs=[]; d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(1800); await d.evaluate(()=>{ localStorage.setItem('gg_lang','de'); });
const vid = await d.evaluate(()=>window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1500);
await d.setInputFiles('.addstep input[type=file]', TESTS+'/test.webm'); await d.waitForTimeout(6000);
console.log('video stage:', !!(await d.$('#trimbar')), '| add-step buttons:', await d.$$eval('.addstep .as-b > *', x => x.map(b => b.textContent.trim()).join(' · ')));
console.log('actions under the picture (v12.49: only this step, no "insert after"):', await d.$$eval('.mact button, .mact label', x => x.map(b => b.textContent.trim()).join(' / ')));
// place two symbols at different moments
await d.click('#symdock [data-tab="status"]'); await d.waitForTimeout(200); await d.click('[data-tool="check"]'); await d.waitForTimeout(300);
const stepId = await d.evaluate(() => { const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind).find(s=>s.type==='video'); return st.id; });
const ann = () => d.evaluate(id => { const st = window.__tables.instructions[0].data.steps.find(s=>s.id===id); return st.ann.map(a => a.type+'@'+a.t); }, stepId);
console.log('first symbol:', await ann());
// playing? then a tap on the picture pauses it and shows the chip; a second tap does not resume
const playing = await d.evaluate(() => { const m = document.querySelector('#med'); return m && !m.paused; });
const cv = await d.$('#acv'); const bb = await cv.boundingBox();
await d.mouse.click(bb.x + bb.width*0.3, bb.y + bb.height*0.3); await d.waitForTimeout(300);
console.log('was playing:', playing, '| after tap paused:', await d.evaluate(() => document.querySelector('#med').paused), '| chip:', await d.$eval('.tapchip', e => e.textContent.trim()).catch(() => 'none'));
await d.mouse.click(bb.x + bb.width*0.5, bb.y + bb.height*0.5); await d.waitForTimeout(300);
console.log('after 2nd tap still paused:', await d.evaluate(() => document.querySelector('#med').paused));
// play button: play → pause → play
// (the symbol sits at the current moment, so playback auto-pauses there for a second – the button still shows "running")
await d.click('#playbtn'); await d.waitForTimeout(400); const b1 = await d.$eval('#playbtn', e => e.classList.contains('on'));
await d.click('#playbtn'); await d.waitForTimeout(300); const b2 = await d.$eval('#playbtn', e => e.classList.contains('on')); const p2 = await d.evaluate(() => document.querySelector('#med').paused);
await d.waitForTimeout(1200); const p3 = await d.evaluate(() => document.querySelector('#med').paused);
console.log('play button: running after play =', b1, '| after pause: running =', b2, 'paused =', p2, '| still paused 1.2 s later (auto-resume cancelled) =', p3);
// no DOM churn while playing: the pill list must not be rebuilt per frame
await d.click('#playbtn'); await d.waitForTimeout(200);
const churn = await d.evaluate(() => new Promise(res => { const l = document.querySelector('#annlist'); let n = 0; const mo = new MutationObserver(ms => { n += ms.length; }); mo.observe(l, {childList:true, subtree:true}); setTimeout(() => { mo.disconnect(); res(n); }, 900); }));
console.log('pill mutations in 0.9 s of playback:', churn, churn < 3 ? '(quiet)' : '(REBUILT PER FRAME)');
await d.click('#playbtn'); await d.waitForTimeout(300);
// drag the mark to the right → the symbol's moment moves
const mk = await d.$('#marks .mark'); const mb = await mk.boundingBox(); const tb = await (await d.$('#trimbar')).boundingBox();
await d.mouse.move(mb.x + mb.width/2, mb.y + 10); await d.mouse.down(); await d.mouse.move(mb.x + mb.width/2 + tb.width*0.3, mb.y + 10, {steps:8}); await d.mouse.up(); await d.waitForTimeout(400);
console.log('after mark drag:', await ann(), '| selected pill:', !!(await d.$('.ann-pill.on')));
// empty step after this one
await d.click('.addstep [data-empty]'); await d.waitForTimeout(600); // v12.49: new steps come from the card at the end of the list
console.log('steps now:', await d.evaluate(() => window.__tables.instructions[0].data.steps.filter(s=>!s.kind).map(s => s.type).join(',')), '| stage shows no-picture panel:', !!(await d.$('.noshot-stage')), '| title focused:', await d.evaluate(() => document.activeElement && document.activeElement.id));
await d.screenshot({path:OUT+'/vid-empty.png'});
// text formatting over several lines: bold marks every selected line, a second click removes it, the list prefix stays outside
await d.fill('#sdesc', 'Erste Zeile\nZweite Zeile\n- Dritte als Liste'); await d.evaluate(() => { const ta = document.querySelector('#sdesc'); ta.focus(); ta.setSelectionRange(0, ta.value.length); });
await d.click('[data-f="b"]'); await d.waitForTimeout(150); const bold = await d.inputValue('#sdesc');
await d.evaluate(() => { const ta = document.querySelector('#sdesc'); ta.focus(); ta.setSelectionRange(0, ta.value.length); }); await d.click('[data-f="b"]'); await d.waitForTimeout(150); const plain = await d.inputValue('#sdesc');
console.log('bold 3 lines:', JSON.stringify(bold), '| toggled back:', JSON.stringify(plain));
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
