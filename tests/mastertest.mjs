// v12.47 – platform: the master view (only for platform admins), plan editing, moving a user, merging, demo accounts; the plan
// banner on the dashboard (trial / expired / suspended); invitations accept any e-mail domain
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
// ---- a normal admin: no master entry, no access ----
const ctx0 = await browser.newContext({viewport:{width:1366,height:900}}); await ctx0.addInitScript(() => { localStorage.setItem('gg_lang','de'); });
const n = await ctx0.newPage(); n.on('pageerror', e => errs.push('N '+e.message));
await n.goto(BASE+'/index3.html'); await n.waitForTimeout(2000);
await n.click('[data-menu]'); await n.waitForTimeout(300); console.log('normal admin – master entry in menu:', !!(await n.$('.modal-bg [data-m="master"]')), '(expected false)'); await n.keyboard.press('Escape');
await n.goto(BASE+'/index3.html#/master'); await n.waitForTimeout(800); console.log('normal admin – /master shows:', await n.$eval('main .card h2, main h1', e => e.textContent.trim()), '|', await n.$eval('main .card.empty div, main .sub', e => e.textContent.trim().slice(0, 40)));
await ctx0.close();
// ---- the platform admin ----
const ctx = await browser.newContext({viewport:{width:1366,height:900}});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); window.__mockMaster = true; Object.defineProperty(window, '__tables', {configurable:true, set(t){ t.workspaces.push({ws:'kunde-de-ab12c', name:'Kunde GmbH', brand:{}, folders:[], teams:[], invites:[], symbols:[], settings:{}, plan:'trial', plan_until:new Date(Date.now()+12*864e5).toISOString(), open_domain:false, owner_email:'chef@kunde.de', created_at:new Date(Date.now()-2*864e5).toISOString()}); t.profiles.push({id:'u9', email:'chef@kunde.de', name:'Chef', role:'admin', ws:'kunde-de-ab12c', is_admin:true, created_at:new Date().toISOString()}); this._t = t; }, get(){ return this._t; }}); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2000);
await d.click('[data-menu]'); await d.waitForTimeout(300); console.log('master entry in menu:', !!(await d.$('.modal-bg [data-m="master"]'))); await d.click('.modal-bg [data-m="master"]'); await d.waitForTimeout(1200);
console.log('rows:', await d.$$eval('#m-table tbody tr', x => x.length), '| first:', await d.$eval('#m-table tbody tr td', e => e.textContent.trim().replace(/\s+/g,' ')), '| chips:', JSON.stringify(await d.$$eval('#m-table .chip', x => x.map(e => e.textContent.trim()))));
await d.fill('#m-q', 'kunde'); await d.waitForTimeout(200); console.log('filter kunde →', await d.$$eval('#m-table tbody tr', x => x.length));
await d.click('#m-table [data-open="kunde-de-ab12c"]'); await d.waitForTimeout(800);
console.log('detail open:', !!(await d.$('#m-detail #p-plan')), '| users listed:', await d.$$eval('#u-table tbody tr', x => x.map(r => r.textContent.trim().split(/\s+/)[0]).join(',')));
await d.selectOption('#p-plan', 'active'); await d.fill('#p-seats', '25'); await d.fill('#p-note', 'Vertrag ab Oktober'); await d.click('#p-save'); await d.waitForTimeout(800);
console.log('after save:', await d.evaluate(() => { const w = window.__tables.workspaces.find(x => x.ws==='kunde-de-ab12c'); return w.plan+'/'+w.seats+'/'+w.plan_note; }), '| toast:', await d.$eval('#toast', e => e.textContent));
// move Anna from ar-giri.com into the customer workspace
await d.click('#p-move'); await d.waitForTimeout(300); await d.fill('#mv-mail', 'anna@ar-giri.com'); await d.click('.modal-bg [data-ok]'); await d.waitForTimeout(800);
console.log('anna moved:', await d.evaluate(() => window.__tables.profiles.find(p => p.email==='anna@ar-giri.com').ws), '| toast:', await d.$eval('#toast', e => e.textContent));
// demo account
await d.click('#m-demo'); await d.waitForTimeout(300); await d.fill('#dm-mails', 'test@interessent.de\nzwei@interessent.de\ndrei@interessent.de'); await d.fill('#dm-name', 'Interessent AG'); await d.click('.modal-bg [data-ok]'); await d.waitForTimeout(1500);
console.log('demo created (v12.48.1: up to 5 admins, one team):', await d.evaluate(() => { const w = window.__tables.workspaces.find(x => x.plan==='demo'); return w ? w.invites.map(i => i.email.split('@')[0]+':'+i.role).join(',')+' | team '+w.teams[0].name+' with '+w.teams[0].members.length : 'none'; }), '| invitation mails:', await d.evaluate(() => (window.__invites||[]).length), '| toast:', await d.$eval('#toast', e => e.textContent));
// a 6th address is refused, an address that already has an account too
await d.click('#m-demo'); await d.waitForTimeout(300); await d.fill('#dm-mails', 'a@x.de b@x.de c@x.de d@x.de e@x.de f@x.de'); await d.click('.modal-bg [data-ok]'); await d.waitForTimeout(800); console.log('6 addresses →', await d.$eval('#toast', e => e.textContent));
await d.click('#m-demo'); await d.waitForTimeout(300); await d.fill('#dm-mails', 'anna@ar-giri.com'); await d.click('.modal-bg [data-ok]'); await d.waitForTimeout(800); console.log('existing account →', await d.$eval('#toast', e => e.textContent));
// open invitations of the demo: withdraw one
await d.fill('#m-q', 'interessent'); await d.waitForTimeout(200); if(!(await d.$('#m-detail #m-inv .inv-row'))){ await d.click('#m-table [data-open]'); await d.waitForTimeout(800); }
console.log('open invitations listed:', await d.$$eval('#m-inv .inv-row', x => x.length)); await d.click('#m-inv [data-iwd="drei@interessent.de"]'); await d.waitForTimeout(800);
console.log('after withdraw:', await d.$$eval('#m-inv .inv-row', x => x.length), '| toast:', await d.$eval('#toast', e => e.textContent));
// delete a person (header button) and a platform admin (refused)
await d.click('#m-deluser'); await d.waitForTimeout(300); await d.fill('#du-mail', 'bjoern@ar-giri.com'); await d.click('.modal-bg [data-ok]'); await d.waitForTimeout(400); const cf = await d.$('.modal-bg [data-ok]'); if(cf) await cf.click(); await d.waitForTimeout(800); console.log('delete platform admin →', await d.$eval('#toast', e => e.textContent));
await d.fill('#m-q', ''); await d.waitForTimeout(200);
await d.screenshot({path:OUT+'/shots/master.png', fullPage:true});
// merge the demo into the customer
await d.fill('#m-q', 'interessent'); await d.waitForTimeout(200); if(!(await d.$('#m-detail #p-merge'))){ await d.click('#m-table [data-open]'); await d.waitForTimeout(600); } await d.click('#p-merge'); await d.waitForTimeout(300); await d.selectOption('#mg-into', 'kunde-de-ab12c'); await d.click('.modal-bg [data-ok]'); await d.waitForTimeout(300); await d.click('.modal-bg [data-ok]'); await d.waitForTimeout(800);
console.log('after merge – workspaces:', await d.evaluate(() => window.__tables.workspaces.map(w => w.ws).join(',')));
// ---- plan banner on the dashboard for a trial / expired / suspended workspace ----
// (a reload rebuilds the mock tables, so every case gets its own context whose init script patches the workspace row)
for(const [plan, days, expect] of [['trial', 12, 'Testphase: noch 12 Tage'], ['trial', -1, 'Testphase abgelaufen'], ['suspended', null, 'pausiert'], ['active', null, '']]){
  const cx = await browser.newContext({viewport:{width:1366,height:900}});
  await cx.addInitScript(([plan, days]) => { localStorage.setItem('gg_lang','de'); Object.defineProperty(window, '__tables', {configurable:true, set(t){ const w = t.workspaces.find(x => x.ws==='ar-giri.com'); w.plan = plan; w.plan_until = days == null ? null : new Date(Date.now()+days*864e5-3600e3).toISOString(); this._t = t; }, get(){ return this._t; }}); }, [plan, days]);
  const b = await cx.newPage(); b.on('pageerror', e => errs.push('B '+e.message));
  await b.goto(BASE+'/index3.html'); await b.waitForTimeout(2000);
  const txt = await b.evaluate(() => { const el = document.querySelector('.plan-banner'); return el ? el.textContent.trim() : ''; });
  const ok = expect ? txt.includes(expect) : txt === '';
  console.log(`banner ${plan}/${days}:`, ok ? 'ok' : 'MISSING', '→', txt.slice(0, 60) || '(none)');
  if(plan === 'trial' && days === 12) await b.screenshot({path:OUT+'/shots/plan-banner.png'});
  await cx.close();
}
// ---- invites accept any domain ----
await d.goto(BASE+'/index3.html#/admin'); await d.waitForTimeout(1500); await d.click('#invite'); await d.waitForTimeout(300); await d.fill('#iv-mail', 'partner@lieferant.org'); await d.click('.modal-bg [data-ok]'); await d.waitForTimeout(800);
console.log('invite other domain stored:', await d.evaluate(() => (window.__tables.workspaces.find(x => x.ws==='ar-giri.com').invites||[]).some(i => i.email==='partner@lieferant.org')));
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
