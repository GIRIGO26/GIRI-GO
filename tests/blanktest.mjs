// v12.37.1 – blank steps are hidden in the viewer; lists beyond 1000 instructions load completely (PostgREST paging)
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs=[]; const ctx = await browser.newContext({viewport:{width:1200,height:900}});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2500);
// baseline: how many .vstep panels does the untouched instruction render (intro/end panels count too)?
const base = await d.evaluate(() => { const r = window.__tables.instructions[0]; r.status='published'; r.data.status='published'; return {id:r.id, key:r.data.shareKey}; });
await d.goto(BASE+'/index3.html#/v/'+base.id+'/'+base.key); await d.waitForTimeout(1800); const shown0 = await d.evaluate(() => document.querySelectorAll('.vstep').length);
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(500);
// 1) blank steps: append two empty steps (one in the middle, one at the end) to the seeded instruction
const info = await d.evaluate(() => { const r = window.__tables.instructions[0]; const mk = id => ({id, type:'empty', w:1280, h:720, duration:0, trimStart:0, trimEnd:0, title:'', desc:'', warn:'', ann:[]});
  const real = r.data.steps.filter(s => s.kind!=='chapter').length; r.data.steps.splice(1, 0, mk('blank1')); r.data.steps.push(mk('blank2')); r.status='published'; r.data.status='published'; r.updated_at = new Date().toISOString(); r.data.updatedAt = Date.now(); return {id:r.id, key:r.data.shareKey, real, total:r.data.steps.filter(s => s.kind!=='chapter').length}; });
await d.goto(BASE+'/index3.html#/x'); await d.waitForTimeout(200); await d.goto(BASE+'/index3.html#/v/'+info.id+'/'+info.key); await d.waitForTimeout(1800);
const shown = await d.evaluate(() => document.querySelectorAll('.vstep').length);
console.log('steps in data:', info.total, '(real', info.real, '+ 2 blank) | panels before:', shown0, '| after adding blanks:', shown, shown===shown0 ? 'OK (blanks hidden)' : 'WRONG');
// the editor still shows them (so they can be filled or deleted)
await d.goto(BASE+'/index3.html#/edit/'+info.id); await d.waitForTimeout(1500);
console.log('editor shows blank steps:', await d.evaluate(() => !!document.querySelector('[data-step="blank2"], [data-sid="blank2"], [data-id="blank2"]') || document.body.innerHTML.includes('blank2')));
// 2) > 1000 instructions: clone the seed 1100 times → the dashboard must count them all
await d.evaluate(() => { const r = window.__tables.instructions[0]; for(let k = 0; k < 1100; k++){ const c = JSON.parse(JSON.stringify(r)); c.id = 'clone'+k; c.data.id = c.id; c.title = 'Klon '+k; c.data.title = c.title; c.updated_at = new Date(Date.now()-k*1000).toISOString(); c.data.updatedAt = Date.now()-k*1000; window.__tables.instructions.push(c); } });
await d.goto(BASE+'/index3.html#/x'); await d.waitForTimeout(200); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(4000);
const all = await d.$eval('[data-f="all"] span', e => e.textContent.trim()).catch(() => 'no chip');
console.log('instructions in table:', await d.evaluate(() => window.__tables.instructions.length), '| dashboard "Alle":', all, +all > 1000 ? 'OK' : 'CUT OFF');
// v12.38.1: the list renders 40 cards at a time; the rest follows on scroll / tap
console.log('cards rendered first:', await d.$$eval('#list article.instr', x => x.length), '| more button:', await d.$eval('#lmore-btn', e => e.textContent.trim()).catch(() => 'none'));
await d.click('#lmore-btn'); await d.waitForTimeout(400); console.log('after tap:', await d.$$eval('#list article.instr', x => x.length));
await d.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await d.waitForTimeout(900); console.log('after scroll to end:', await d.$$eval('#list article.instr', x => x.length));
// 3) v12.38 dashboard order: title → new + search → "for you" (approvals, worker feedback) → install → folders → list
await d.evaluate(() => { const t = window.__tables; const r = t.instructions[0]; const c = JSON.parse(JSON.stringify(r)); c.id='rev1'; c.data.id='rev1'; c.status='review'; c.data.status='review'; c.title='Wartet'; c.data.title='Wartet'; t.instructions.push(c); t.feedback.push({id:'fb1', ws:r.ws, instr_id:r.id, status:'open', kind:'quality', text:'x', created_at:new Date().toISOString()}); });
await d.goto(BASE+'/index3.html#/x'); await d.waitForTimeout(200); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(2500);
console.log('order:', await d.evaluate(() => [...document.querySelectorAll('.dash > *')].map(e => e.id || e.className.split(' ')[0]).join(' > ')));
console.log('h1:', await d.$eval('.dash h1', e => e.textContent.trim()), '| new button primary:', await d.$eval('#new', e => e.classList.contains('primary')), '| search in bar:', !!(await d.$('.dash-bar #q')));
console.log('for you:', await d.$$eval('#inbox .ibx', x => x.map(e => e.textContent.trim().replace(/\s+/g,' ')).join(' | ')));
await d.click('#todo-fb'); await d.waitForTimeout(800); console.log('feedback filter → rows:', await d.$$eval('#list article.instr', x => x.length), '| chip on:', await d.$eval('#todo-fb', e => e.classList.contains('on')));
await d.click('#todo-fb'); await d.waitForTimeout(500);
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
