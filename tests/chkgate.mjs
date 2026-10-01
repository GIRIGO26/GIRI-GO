// v12.48 – worker view with the checklist: a fixed OK / Not OK bar, no way past an unanswered step, chapter cards between chapters,
// an honest end screen (all OK / not OK / open), readable buttons on the brand colour, no check marks in the language list
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const ctx = await browser.newContext({viewport:{width:430,height:900}, isMobile:true, hasTouch:true});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_worker','Anna'); });
const m = await ctx.newPage(); m.on('pageerror', e => errs.push(e.message));
await m.goto(BASE+'/index3.html'); await m.waitForTimeout(2200);
const id = await m.evaluate(() => { const r = window.__tables.instructions[0]; r.status = 'published'; r.data.checklist = true; return r.id; });
await m.goto(BASE+'/index3.html#/v/'+id); await m.waitForTimeout(1600);
const visibleSecs = () => m.$$eval('#vs > .vstep', xs => xs.filter(x => getComputedStyle(x).display !== 'none').map(x => x.classList.contains('vend') ? 'END' : x.classList.contains('vchap') ? 'CH'+(+x.dataset.g+1) : 'S')).then(a => a.join(' '));
console.log('overview before the start – every chapter can be chosen:', await m.$$eval('.ch-tile', xs => xs.map(x => x.classList.contains('locked') ? 'L' : 'o').join('')), '(expected ooo)');
await m.click('#ov-start'); await m.waitForTimeout(500);
await m.click('#begin'); await m.waitForTimeout(600);
console.log('after start – visible:', await visibleSecs(), '| bar:', await m.$eval('#vw-act', e => e.hidden ? 'hidden' : e.textContent.replace(/\s+/g,' ').trim()));
// once started, the overview locks the chapters behind the open step
await m.click('.tt-wrap'); await m.waitForTimeout(500); console.log('overview after the start:', await m.$$eval('.ch-tile', xs => xs.map(x => x.classList.contains('locked') ? 'L' : 'o').join('')), '(expected oLL)'); await m.click('#ov-close'); await m.waitForTimeout(400);
// jump ahead through the side list → refused
await m.click('#menu'); await m.waitForTimeout(400); await m.$$eval('#sidelist [data-go]', xs => xs[3].click()); await m.waitForTimeout(500);
console.log('jump past the gate refused:', await m.$eval('#toast', e => e.textContent));
// answer step 1 + 2 → chapter card 2
await m.click('#va-ok'); await m.waitForTimeout(900);
console.log('after OK on step 1 – visible:', await visibleSecs());
await m.click('#va-ok'); await m.waitForTimeout(900);
console.log('after OK on step 2 – visible:', await visibleSecs(), '| bar hidden on the chapter card:', await m.$eval('#vw-act', e => e.hidden));
const card = await m.$eval('.vchap[data-g="1"]', e => e.textContent.replace(/\s+/g,' ').trim());
console.log('chapter card:', card);
await m.screenshot({path:OUT+'/shots/chk-chapter.png'});
await m.$eval('.vchap[data-g="1"]', e => e.nextElementSibling.scrollIntoView()); await m.waitForTimeout(700);
// step 3: Not OK with a note
await m.click('#va-nok'); await m.waitForTimeout(400); await m.fill('#nk-note', 'Schraube fehlt'); await m.click('.modal-bg [data-ok]'); await m.waitForTimeout(900);
console.log('after Not OK on step 3 – visible:', await visibleSecs());
await m.screenshot({path:OUT+'/shots/chk-bar.png'});
await m.click('#va-ok'); await m.waitForTimeout(900);
await m.$eval('.vchap[data-g="2"]', e => e.nextElementSibling.scrollIntoView()); await m.waitForTimeout(700);
await m.click('#va-ok'); await m.waitForTimeout(1000);
console.log('all answered – visible:', await visibleSecs());
await m.$eval('.vend', e => e.scrollIntoView()); await m.waitForTimeout(600);
const end = await m.evaluate(() => { const e = document.querySelector('.vend'); const gh = e.querySelector('.btn.ghost'); return {state: e.dataset.state, h: e.querySelector('#vend-h').textContent, warnIcon: !!e.querySelector('.bigcheck svg path'), ghost: gh ? getComputedStyle(gh).color : null, bg: getComputedStyle(e).backgroundColor}; });
console.log('end screen:', JSON.stringify(end));
await m.screenshot({path:OUT+'/shots/chk-end.png'});
await m.click('#finish2'); await m.waitForTimeout(1200);
console.log('result card:', await m.$eval('.vw-end h1', e => e.textContent), '| run saved:', await m.evaluate(() => { const r = (window.__tables.runs||[])[0]; return r ? Object.values(r.items).map(i => i.ok ? 'ok' : 'nok').join(',') + ' finished=' + !!r.finished_at : 'none'; }));
// language list without check marks
await m.goto(BASE+'/index3.html#/v/'+id); await m.waitForTimeout(1500);
await m.evaluate(() => { const r = window.__tables.instructions[0]; }); const lb = await m.$('#ov-lang') || await m.$('#langbtn'); await lb.click(); await m.waitForTimeout(300);
console.log('language list has ✓:', await m.$eval('.langmenu', e => e.textContent.includes('✓')), '(expected false)');
await m.keyboard.press('Escape');
// a light brand colour: dark text on the end screen
const ctx2 = await browser.newContext({viewport:{width:430,height:900}});
await ctx2.addInitScript(() => { localStorage.setItem('gg_lang','de'); Object.defineProperty(window, '__tables', {configurable:true, set(t){ t.workspaces[0].brand = Object.assign({}, t.workspaces[0].brand, {color:'#FFD400'}); this._t = t; }, get(){ return this._t; }}); });
const y = await ctx2.newPage(); y.on('pageerror', e => errs.push('Y '+e.message)); await y.goto(BASE+'/index3.html'); await y.waitForTimeout(2000);
const id2 = await y.evaluate(() => { const r = window.__tables.instructions[0]; r.status = 'published'; r.data.checklist = false; return r.id; });
await y.goto(BASE+'/index3.html#/v/'+id2+'/3'); await y.waitForTimeout(1500); await y.$eval('.vend', e => e.scrollIntoView()); await y.waitForTimeout(500);
console.log('yellow brand – end text colour:', await y.$eval('.vend #vend-h', e => getComputedStyle(e).color), '| button text:', await y.$eval('.vend .btn:not(.ghost)', e => getComputedStyle(e).color + ' on ' + getComputedStyle(e).backgroundColor));
await y.screenshot({path:OUT+'/shots/chk-yellow.png'});
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
