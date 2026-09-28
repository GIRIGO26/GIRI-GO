// login on the phone: installed app → code first; browser → link + code; capture screen: count left, done right, no title
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const mk = async standalone => { const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true}); await ctx.addInitScript(sa => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_nosess','1'); if(sa){ const mm = window.matchMedia; window.matchMedia = q => q.includes('standalone') ? {matches:true, addEventListener(){}, addListener(){}} : mm.call(window, q); } }, standalone); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); return p; };
const a = await mk(true); await a.goto(BASE+'/index3.html'); await a.waitForTimeout(1500);
console.log('app: visual hidden:', await a.$eval('.l-visual', e => e.hidden), 'caption GIRI Go gone:', !(await a.$('.l-cap b')));
await a.fill('#li-email', 'anna@ar-giri.com'); await a.click('#li-go'); await a.waitForTimeout(600);
console.log('app wait title:', await a.$eval('#magic-t', e => e.textContent), '| label:', await a.$eval('.otp label', e => e.textContent), '| code focused:', await a.evaluate(() => document.activeElement && document.activeElement.id));
await a.screenshot({path:OUT+'/shots/lg1-app-code.png'});
const b = await mk(false); await b.goto(BASE+'/index3.html'); await b.waitForTimeout(1500);
console.log('browser: visual shown:', await b.$eval('.l-visual', e => !e.hidden && e.offsetHeight), 'px high');
await b.screenshot({path:OUT+'/shots/lg2-browser.png'});
await b.fill('#li-email', 'anna@ar-giri.com'); await b.click('#li-go'); await b.waitForTimeout(600); console.log('browser wait title:', await b.$eval('#magic-t', e => e.textContent)); await b.screenshot({path:OUT+'/shots/lg3-browser-wait.png'});
// capture header
const c = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true}); await c.addInitScript(() => localStorage.setItem('gg_lang','de')); const m = await c.newPage(); m.on('pageerror', e => errs.push('C '+e.message));
await m.goto(BASE+'/index3.html'); await m.waitForTimeout(2500); const vid = await m.evaluate(() => window.__tables.instructions[0].id);
await m.goto(BASE+'/index3.html#/rec/'+vid); await m.waitForTimeout(4000);
console.log('capture top:', JSON.stringify(await m.$$eval('.cap-top > *', x => x.map(e => e.id+':'+e.textContent.trim()))), 'title gone:', !(await m.$('#cap-title')), 'bottom done gone:', !(await m.$('.cap-ctrls #done')));
await m.screenshot({path:OUT+'/shots/lg4-capture.png'});
await m.evaluate(() => document.querySelector('#done').click()); await m.waitForTimeout(500); console.log('done → editor:', await m.evaluate(() => /^#\/?edit\//.test(location.hash)));
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
