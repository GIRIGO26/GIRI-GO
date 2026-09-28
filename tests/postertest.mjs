import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs'; import fs from 'fs';
const browser = await chromium.launch(launchArgs([]));
const ctx = await browser.newContext({viewport:{width:1280,height:800}, acceptDownloads:true}); const page = await ctx.newPage(); const errs=[];
page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE+'/index3.html'); await page.waitForTimeout(2000);
// 6 instructions in folder f1 (3 published), plus put brand logo
await page.evaluate(()=>{ const T = window.__tables; const src = T.instructions[0]; localStorage.setItem('gg_lang','de');
  const titles = ['Spannvorrichtung rüsten','Werkzeugwechsel Fräse 2','Sichtprüfung Schweißnaht','Verpackung Endkontrolle','Schmierplan Linie 3','Not-Aus Test'];
  for(let k=0;k<6;k++){ const c = JSON.parse(JSON.stringify(src)); c.id = 'p'+k; c.title = titles[k]; c.status = k<3 ? 'published' : (k===3?'review':'draft'); c.data.folder='f1'; c.data.title = titles[k]; c.data.status=c.status; c.data.version = k+1; T.instructions.push(c); }
});
await page.goto(BASE+'/index3.html#/'); await page.waitForTimeout(800); await page.goto(BASE+'/index3.html#/p/f1'); await page.waitForTimeout(1200);
console.log('folder menu:', !!(await page.$('#fmore')));
await page.click('#fmore'); await page.waitForTimeout(300); console.log('menu:', await page.$$eval('.menu [data-m]', x => x.map(b=>b.dataset.m)));
await page.click('.menu [data-m="poster"]'); await page.waitForTimeout(400);
console.log('dialog:', await page.$eval('#po-pub', e => e.checked + ' ' + e.parentElement.textContent.trim()));
for(const [name, onlyPub] of [['pub', true], ['all', false]]){
  if(name==='all'){ await page.click('#fmore'); await page.waitForTimeout(200); await page.click('.modal-bg [data-m="poster"]'); await page.waitForTimeout(300); await page.$eval('#po-pub', e => { e.checked = false; }); }
  const [dl] = await Promise.all([ page.waitForEvent('download', {timeout:90000}), page.click('.modal [data-ok]') ]);
  const p = OUT+'/poster-'+name+'.pdf'; await dl.saveAs(p); console.log(name, 'bytes', fs.statSync(p).size); await page.waitForTimeout(500);
}
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
