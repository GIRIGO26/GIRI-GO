// v0.36 – dashboard with many teams/folders: team is the top filter (select when > 10 teams), folder panel with search + hidden empties, admin bulk delete
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs=[]; const ctx = await browser.newContext({viewport:{width:1300,height:900}});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); Object.defineProperty(window, '__tables', {configurable:true, set(t){ const ws = t.workspaces[0];
  ws.teams = Array.from({length:12}, (_, k) => ({id:'tm'+k, name:'Team '+k, members:[]})); ws.teams[0].members.push({email:'bjoern@ar-giri.com', role:'creator'});
  ws.folders = [{id:'f1', name:'Linie 3', teams:['tm1']}, {id:'f2', name:'Vorrichtungen', teams:[]}, ...Array.from({length:40}, (_, k) => ({id:'ap'+k, name:'Arbeitsplatz '+(100+k), teams: k%2 ? ['tm2'] : []}))];
  this._t = t; }, get(){ return this._t; }}); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2500);
// put the seeded instruction into folder f1 so one folder is non-empty
{ const id0 = await d.evaluate(()=>window.__tables.instructions[0].id); await d.click(`[data-sid="${id0}"] [data-a="more"]`); await d.waitForTimeout(300); await d.click('[data-m="folder"]'); await d.waitForTimeout(300); await d.click('[data-fid="f1"]'); await d.waitForTimeout(800); }
await d.goto(BASE+'/index3.html#/x'); await d.waitForTimeout(200); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1200);
console.log('instruction in f1:', await d.evaluate(()=>window.__tables.instructions[0].data.folder));
console.log('team control:', await d.evaluate(() => document.querySelector('#tsel') ? 'select with '+document.querySelectorAll('#tsel option').length+' options' : 'chips'));
console.log('folder panel many:', await d.evaluate(() => !!document.querySelector('.fpanel.many')), '| chips shown:', await d.$$eval('#fchips .fch:not(.add):not(.ghost)', x => x.length), '| hide toggle:', await d.$eval('#fhide', e => e.textContent.trim()).catch(() => 'none'));
await d.click('#fhide'); await d.waitForTimeout(200); console.log('after show empties:', await d.$$eval('#fchips .fch:not(.add):not(.ghost)', x => x.length), '| toggle:', await d.$eval('#fhide', e => e.textContent.trim()));
// v12.37.1: one search box for folders AND instructions (full text)
console.log('folder search box gone:', !(await d.$('#fq')), '| one box:', !!(await d.$('#q')), '| placeholder:', await d.$eval('#q', e => e.placeholder));
await d.fill('#q', 'platz 12'); await d.waitForTimeout(200); console.log('search "platz 12":', await d.$$eval('#fchips .fch:not(.add):not(.ghost)', x => x.map(e => e.textContent.trim().replace(/\s+/g,' ')).join(', ')));
// full text: a word that only occurs in a step description of the seeded instruction
const word = await d.evaluate(() => { const i = window.__tables.instructions[0]; const st = (i.data.steps||[]).find(s => s.desc && s.desc.trim().split(/\s+/).length > 2); const w = st && st.desc.trim().split(/\s+/).find(x => x.length > 5 && /^[a-zäöüß]+$/i.test(x)); return w ? w.toLowerCase() : ''; });
if(word){ await d.fill('#q', word); await d.waitForTimeout(250); console.log('full-text "'+word+'":', await d.$$eval('#list article.instr', x => x.length), 'result(s) | folder chip of hit shown:', await d.$$eval('#fchips .fch:not(.add):not(.ghost)', x => x.map(e => e.textContent.trim().replace(/\s+/g,' ')).join(', '))); }
else console.log('full-text: no step description in seed to test with');
await d.fill('#q', ''); await d.waitForTimeout(200);
await d.screenshot({path:OUT+'/fo1-many.png', fullPage:true});
// team select scopes the folders: tm2 owns the odd Arbeitsplatz folders (20) + folders without team are NOT shown under a team
await d.selectOption('#tsel', 'tm2'); await d.waitForTimeout(800);
console.log('team tm2 folders:', await d.$$eval('#fchips .fch:not(.add):not(.ghost)', x => x.length), '| first:', await d.$$eval('#fchips .fch:not(.add):not(.ghost)', x => x.slice(0,3).map(e => e.textContent.trim().replace(/\s+/g,' ')).join(', ')), '| session team:', await d.evaluate(() => sessionStorage.getItem('gg_team')));
await d.selectOption('#tsel', 'none'); await d.waitForTimeout(800);
console.log('no-team folders:', await d.$$eval('#fchips .fch:not(.add):not(.ghost)', x => x.length));
await d.selectOption('#tsel', ''); await d.waitForTimeout(800);
// admin: delete empty folders
await d.goto(BASE+'/index3.html#/admin'); await d.waitForTimeout(1200);
d.once('dialog', dlg => dlg.accept());
await d.click('#del-empty'); await d.waitForTimeout(300); const ok = await d.$('.modal [data-ok]'); if(ok) await ok.click(); await d.waitForTimeout(600);
console.log('folders after cleanup:', await d.evaluate(() => window.__tables.workspaces[0].folders.map(f => f.name).join(', ')));
// v12.37.1: delete a folder WITH its instructions → they go to the trash
await d.goto(BASE+'/index3.html#/p/f1'); await d.waitForTimeout(1200);
await d.click('#fmore'); await d.waitForTimeout(300); await d.click('[data-m="del"]'); await d.waitForTimeout(300);
console.log('delete dialog offers:', await d.$$eval('.modal [data-ok]', x => x.map(e => e.dataset.ok).join('/')));
await d.click('.modal [data-ok="all"]'); await d.waitForTimeout(900);
console.log('f1 gone:', await d.evaluate(() => !window.__tables.workspaces[0].folders.some(f => f.id==='f1')), '| instruction trashed:', await d.evaluate(() => !!window.__tables.instructions[0].deleted_at), '| hash:', await d.evaluate(() => location.hash));
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
