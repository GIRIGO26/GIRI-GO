import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const page = await (await browser.newContext({viewport:{width:1200,height:900}})).newPage(); const errs=[];
page.on('pageerror', e => errs.push(e.message+' '+(e.stack||'').split('\n').slice(0,3).join('|')));
await page.goto(BASE+'/index3.html'); await page.waitForTimeout(2000);
await page.evaluate(()=>sessionStorage.setItem('gg_dash','all')); await page.goto(BASE+'/index3.html#/'); await page.waitForTimeout(800);
await page.click('.card.instr .title'); await page.waitForTimeout(1200); { const tb = await page.$('[data-tab=\"steps\"]'); if(tb && await tb.isVisible()) await tb.click(); } await page.waitForTimeout(300);
const before = await page.evaluate(()=>window.__tables.instructions[0].data.steps.map(s=>s.kind||s.type).join(','));
// file picker import (2 photos + 1 video) after selected step 1
await page.setInputFiles('.addstep input[type=file]', [TESTS+'/imp1.jpg', TESTS+'/test.webm', TESTS+'/imp2.jpg']); await page.waitForTimeout(3500);
const after = await page.evaluate(()=>window.__tables.instructions[0].data.steps.map(s=>s.kind||s.type).join(','));
console.log('before:', before); console.log('after :', after);
console.log('new step sizes:', await page.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind).slice(1,4).map(s=>s.type+' '+s.w+'x'+s.h+' d='+s.duration+' te='+s.trimEnd)));
await page.screenshot({path:OUT+'/i1-after-import.png', fullPage:true});
// drag & drop overlay + drop
const dt = await page.evaluateHandle(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(10)], 'x.jpg', {type:'image/jpeg'})); return dt; });
await page.dispatchEvent('body', 'dragenter', {dataTransfer: dt}); await page.waitForTimeout(300);
console.log('dropzone visible:', await page.evaluate(()=>!document.querySelector('.dropzone').hidden), '|', await page.evaluate(()=>document.querySelector('#dz-sub').textContent));
await page.screenshot({path:OUT+'/i2-dropzone.png'});
// real drop with a valid image
const dt2 = await page.evaluateHandle(async (src) => { const r = await fetch(src); const b = await r.blob(); const dt = new DataTransfer(); dt.items.add(new File([b], 'drop.jpg', {type:'image/jpeg', lastModified: Date.now()})); return dt; }, BASE+'/tests/imp1.jpg').catch(()=>null);
if(dt2){ await page.dispatchEvent('body', 'drop', {dataTransfer: dt2}); await page.waitForTimeout(2500); console.log('after drop:', await page.evaluate(()=>window.__tables.instructions[0].data.steps.filter(s=>!s.kind).length)); }
else { await page.dispatchEvent('body', 'dragleave', {dataTransfer: dt}); console.log('drop skipped (fetch file:// blocked)'); }
console.log('dropzone hidden now:', await page.evaluate(()=>document.querySelector('.dropzone').hidden));
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
