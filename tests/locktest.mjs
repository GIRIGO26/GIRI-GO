// v12.39 – two editors: a save that finds a newer server row asks (take theirs / overwrite) instead of silently overwriting
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs=[]; const ctx = await browser.newContext({viewport:{width:1200,height:900}});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2500);
const id = await d.evaluate(() => window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(1500);
// "colleague" saves a newer version straight into the table (other device)
await d.evaluate(id => { const r = window.__tables.instructions.find(x => x.id===id); r.title = 'Von Kollegin geändert'; r.data.title = r.title; r.data.lastBy = 'Kollegin'; const at = Date.now() + 5000; r.data.updatedAt = at; r.updated_at = new Date(at).toISOString(); }, id);
// I type a new title → autosave → conflict dialog
await d.fill('#ititle', 'Mein Titel'); await d.waitForTimeout(1800);
const dlg = await d.evaluate(() => { const m = document.querySelector('.modal'); return m ? {h: (m.querySelector('h2')||{}).textContent, btns: [...m.querySelectorAll('[data-ok]')].map(b => b.dataset.ok).join('/'), text: (m.querySelector('p')||{}).textContent} : null; });
console.log('conflict dialog:', dlg ? dlg.h : 'NONE', '|', dlg && dlg.btns, '|', dlg && dlg.text.slice(0, 80));
// choose "take theirs" → server version wins, my title is gone
await d.click('.modal [data-ok="theirs"]'); await d.waitForTimeout(1200);
console.log('after "theirs": table title =', await d.evaluate(id => window.__tables.instructions.find(x => x.id===id).title, id), '| editor title =', await d.$eval('#ititle', e => e.value));
// second round: colleague saves again, I choose "overwrite"
await d.evaluate(id => { const r = window.__tables.instructions.find(x => x.id===id); r.title = 'Kollegin nochmal'; r.data.title = r.title; const at = Date.now() + 9000; r.data.updatedAt = at; r.updated_at = new Date(at).toISOString(); }, id);
await d.fill('#ititle', 'Ich bestehe darauf'); await d.waitForTimeout(1800);
console.log('second dialog:', !!(await d.$('.modal [data-ok="mine"]')));
await d.click('.modal [data-ok="mine"]'); await d.waitForTimeout(1200);
console.log('after "mine": table title =', await d.evaluate(id => window.__tables.instructions.find(x => x.id===id).title, id));
// no conflict when nobody else wrote: a normal save goes through silently
await d.fill('#ititle', 'Ruhig gespeichert'); await d.waitForTimeout(1800);
console.log('quiet save:', await d.evaluate(id => window.__tables.instructions.find(x => x.id===id).title, id), '| dialog:', !!(await d.$('.modal')));
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
