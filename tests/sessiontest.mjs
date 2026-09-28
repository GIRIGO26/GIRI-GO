// session length: signed in for 14 days by default, admin can change it; older sign-ins are signed out
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const ctx = await browser.newContext({viewport:{width:1366,height:900}}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push('A '+e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2500);
console.log('login noted:', JSON.stringify(await d.evaluate(() => JSON.parse(localStorage.getItem('gg_login_at')||'null'))).replace(/"at":\d+/, '"at":…'));
// admin panel: setting present, change to 30 → workspace row
await d.goto(BASE+'/index3.html#/admin'); await d.waitForTimeout(1200);
console.log('setting default:', await d.$eval('#s-days', e => e.value));
await d.fill('#s-days', '30'); await d.dispatchEvent('#s-days', 'change'); await d.waitForTimeout(500);
console.log('saved settings:', JSON.stringify(await d.evaluate(() => window.__tables.workspaces[0].settings)));
// sign-in 20 days ago with a 30-day limit → still in; with default 14 → out
await d.evaluate(() => localStorage.setItem('gg_login_at', JSON.stringify({id:'u1', at: Date.now() - 20*864e5})));
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1500);
console.log('20 days / limit 30 → dashboard:', !!(await d.$('.dash #list')));
await d.evaluate(() => { window.__tables.workspaces[0].settings = {}; });
await d.goto(BASE+'/index3.html#/admin'); await d.waitForTimeout(1200); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1500);
console.log('20 days / limit 14 → login form:', !!(await d.$('#li-email')), 'toast:', await d.$eval('#toast', e => e.textContent), 'login marker cleared:', await d.evaluate(() => localStorage.getItem('gg_login_at')));
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
