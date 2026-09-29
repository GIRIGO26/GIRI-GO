// v12.45 – the client side of server-side authorisation: admin GDPR export/erase via RPC, and a refused write (42501) is not
// retried as "saved offline" but replaced by the server's version; rolesIn() gives no rights in foreign teams
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const ctx = await browser.newContext({viewport:{width:1366,height:900}, acceptDownloads:true});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); Object.defineProperty(window, '__tables', {configurable:true, set(t){ t.workspaces[0].teams.push({id:'t9', name:'Fremdes Team', members:[{email:'someone@ar-giri.com', role:'creator'}]}); t.workspaces[0].folders.push({id:'f9', name:'Fremder Ordner', teams:['t9']}); this._t = t; }, get(){ return this._t; }}); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html#/admin'); await d.waitForTimeout(2500);
console.log('user rows:', await d.$$eval('#utable tbody tr', x => x.length), '| gdpr buttons:', await d.$$eval('#utable [data-gdpr]', x => x.length), '| erase buttons:', await d.$$eval('#utable [data-rm]', x => x.length), '(not for myself)');
// export Anna → a JSON download
const [dl] = await Promise.all([d.waitForEvent('download'), d.click('#utable tr[data-id="u2"] [data-gdpr]')]);
const path = await dl.path(); const json = JSON.parse((await import('node:fs')).readFileSync(path, 'utf8'));
console.log('download:', dl.suggestedFilename(), '| email:', json.email, '| keys:', Object.keys(json).length, '| rpc:', await d.evaluate(() => (window.__rpc||[]).map(r => r.name).join(',')));
// erase Anna → confirm → row gone, rpc called
await d.click('#utable tr[data-id="u2"] [data-rm]'); await d.waitForTimeout(400);
console.log('confirm text mentions Gelöschter Nutzer:', (await d.$eval('.modal-bg p', e => e.textContent)).includes('Gelöschter Nutzer'));
await d.click('.modal-bg [data-ok]'); await d.waitForTimeout(600);
console.log('rows after erase:', await d.$$eval('#utable tbody tr', x => x.length), '| profiles in mock:', await d.evaluate(() => window.__tables.profiles.length), '| toast:', await d.$eval('#toast', e => e.textContent));
await d.screenshot({path:OUT+'/shots/authz-admin.png'});
// ---- refused write ----
const id = await d.evaluate(() => window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(1800);
const before = await d.$eval('#ititle', e => e.value);
await d.evaluate(() => { window.__mockRefuse = true; });
await d.fill('#ititle', before + ' XYZ'); await d.waitForTimeout(2500);
console.log('toast after refused save:', await d.$eval('#toast', e => e.textContent));
console.log('title reloaded from server:', await d.$eval('#ititle', e => e.value) === before, '| server title unchanged:', await d.evaluate(() => window.__tables.instructions[0].title) === before);
await d.evaluate(() => { window.__mockRefuse = false; });
// ---- rolesIn: creator (not admin) has no rights in a foreign team's folder ----
const ctx2 = await browser.newContext({viewport:{width:1366,height:900}});
await ctx2.addInitScript(() => { localStorage.setItem('gg_lang','de'); Object.defineProperty(window, '__tables', {configurable:true, set(t){ t.profiles[0].role='creator'; t.profiles[0].is_admin=false; t.workspaces[0].teams.push({id:'t9', name:'Fremdes Team', members:[{email:'someone@ar-giri.com', role:'creator'}]}); t.workspaces[0].folders.push({id:'f9', name:'Fremder Ordner', teams:['t9']}); this._t = t; }, get(){ return this._t; }}); });
const c = await ctx2.newPage(); c.on('pageerror', e => errs.push('C '+e.message));
await c.goto(BASE+'/index3.html'); await c.waitForTimeout(2500);
console.log('creator sees foreign folder in navigator:', !!(await c.$('#dnav a[data-f="f9"]')), '(expected false – not a member)');
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
