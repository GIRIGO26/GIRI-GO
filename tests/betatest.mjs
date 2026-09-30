// v12.47.2 – "GIRI" (not "GIRI Go") in the UI, BETA chip in the top bar with an explanation, ISO note on the login page
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const ctx = await browser.newContext({viewport:{width:1366,height:900}}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_nosess','1'); });
const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE+'/index3.html'); await p.waitForTimeout(1800);
const onLogin = !!(await p.$('#li-email'));
console.log('login page:', onLogin, '| BETA chip:', await p.$eval('.brand .beta', e => e.textContent.trim()).catch(() => 'MISSING'), '| ISO note:', await p.$eval('.l-trust', e => e.textContent.replace(/\s+/g,' ').trim().slice(0, 120)).catch(() => 'MISSING'));
await p.screenshot({path:OUT+'/shots/login-beta.png'});
await p.click('.brand .beta'); await p.waitForTimeout(300); console.log('beta modal:', await p.$eval('.modal-bg h2', e => e.textContent).catch(() => 'MISSING')); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
await ctx.close();
// signed in: chip present, no "GIRI Go" anywhere in the dashboard, the install banner says GIRI
const ctx2 = await browser.newContext({viewport:{width:1366,height:900}}); await ctx2.addInitScript(() => { localStorage.setItem('gg_lang','de'); });
const d = await ctx2.newPage(); d.on('pageerror', e => errs.push(e.message)); await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2000);
console.log('dashboard BETA chip:', !!(await d.$('.brand .beta')), '| "GIRI Go" in page:', await d.evaluate(() => document.body.innerText.includes('GIRI Go')), '(expected false) | banner:', await d.$eval('#inst-top b', e => e.textContent));
await d.click('[data-menu]'); await d.waitForTimeout(300); console.log('menu footer:', await d.$eval('.menu-foot', e => e.textContent.trim().slice(0, 30))); await d.keyboard.press('Escape');
// phone: chip still fits next to the logo
await d.setViewportSize({width:390, height:800}); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(800);
console.log('phone – chip visible:', await d.$eval('.brand .beta', e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right < innerWidth; }));
await d.screenshot({path:OUT+'/shots/phone-beta.png'});
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
