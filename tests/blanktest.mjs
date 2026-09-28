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
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
