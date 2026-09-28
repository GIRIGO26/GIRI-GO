// v0.29: screen changes render from memory at once ("sofort"); the delta sync runs in the background and redraws only on real changes; perf chip toggle
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = []; const ctx = await browser.newContext({viewport:{width:1280,height:900}}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_inst_dismissed','1'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
const id = await d.evaluate(() => window.__tables.instructions[0].id);
const perf = () => d.evaluate(() => window.__G ? window.__G.perf.log.map(x => `${x.view}:${x.mode}:${x.total}ms`) : 'no G');
// expose G for the test
await d.evaluate(() => { });
for(const h of ['#/edit/'+id, '#/', '#/trash', '#/', '#/results/'+id, '#/']){ await d.goto(BASE+'/index3.html'+h); await d.waitForTimeout(700); }
const log = await d.evaluate(() => JSON.stringify((window.__perfLog||[]).slice(-7)));
console.log('perf log:', log);
// background sync picks up a change made "elsewhere": rename in the table with a newer updated_at, navigate → dashboard shows the new title
await d.evaluate(id => { const r = window.__tables.instructions.find(x => x.id===id); r.title = 'Umbenannt woanders'; r.data.title = r.title; r.updated_at = new Date(Date.now()+5000).toISOString(); }, id);
await d.goto(BASE+'/index3.html#/trash'); await d.waitForTimeout(300); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1200);
console.log('bg sync picked up remote rename:', await d.evaluate(() => document.body.textContent.includes('Umbenannt woanders')));
// perf chip: tap the version label 5×
await d.click('#tbmenu'); await d.waitForTimeout(300); for(let k=0;k<5;k++){ await d.click('.app-ver'); await d.waitForTimeout(60); } await d.waitForTimeout(300); await d.keyboard.press('Escape'); await d.waitForTimeout(200); // v0.34: version line lives in the menu
console.log('perf chip:', await d.$eval('#perf-chip', e => e.textContent.trim().slice(0, 80)).catch(() => 'MISSING'));
await d.screenshot({path:OUT+'/shots/nav-perf.png'});
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
