// team filter on the dashboard: admin sees every team as a chip, a member only their own; filter narrows projects and the flat list
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
// ---- admin ----
const ctx = await browser.newContext({viewport:{width:1366,height:900}}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); Object.defineProperty(window, '__tables', {configurable:true, set(t){ t.workspaces[0].teams.push({id:'t2', name:'Qualität', members:[{email:'bjoern@ar-giri.com', role:'creator'}]}); t.workspaces[0].folders.push({id:'f3', name:'Prüfplatz', teams:['t2']}); this._t = t; }, get(){ return this._t; }}); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push('A '+e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2500);
console.log('admin chips:', JSON.stringify(await d.$$eval('#tfilter .fch', x => x.map(e => e.textContent.trim()))));
console.log('folder chips all:', JSON.stringify(await d.$$eval('#fchips .fch:not(.add)', x => x.map(e => e.textContent.trim()))));
await d.click('#tfilter [data-t="t2"]'); await d.waitForTimeout(300);
console.log('folder chips Qualität:', JSON.stringify(await d.$$eval('#fchips .fch:not(.add)', x => x.map(e => e.textContent.trim()))), '| cards:', await d.$$eval('.card.instr', x => x.length));
await d.screenshot({path:OUT+'/shots/tm1-admin-filter.png'});
await d.click('#tfilter [data-t="none"]'); await d.waitForTimeout(300);
console.log('cards Ohne Team:', await d.$$eval('.card.instr', x => x.length));
// ---- member of one team only (viewer Anna in team t1) ----
const ctx2 = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true}); await ctx2.addInitScript(() => { localStorage.setItem('gg_lang','de'); Object.defineProperty(window, '__tables', {configurable:true, set(t){ t.profiles[0].role='viewer'; t.profiles[0].is_admin=false; t.profiles[0].email='anna@ar-giri.com'; t.workspaces[0].teams.push({id:'t2', name:'Qualität', members:[]}); t.workspaces[0].folders.push({id:'f3', name:'Prüfplatz', teams:['t2']}); t.workspaces[0].folders[0].teams=['t1','t2']; this._t = t; }, get(){ return this._t; }}); });
const m = await ctx2.newPage(); m.on('pageerror', e => errs.push('M '+e.message));
await m.goto(BASE+'/index3.html'); await m.waitForTimeout(2500);
console.log('member chips:', JSON.stringify(await m.$$eval('#tfilter .fch', x => x.map(e => e.textContent.trim()))));
console.log('member folder chips:', JSON.stringify(await m.$$eval('#fchips .fch:not(.add)', x => x.map(e => e.textContent.trim()))), '| cards:', await m.$$eval('.card.instr', x => x.length), '| team filter shown:', !!(await m.$('#tfilter')));
await m.screenshot({path:OUT+'/shots/tm2-member.png'});
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
