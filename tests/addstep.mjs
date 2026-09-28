import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const d = await (await browser.newContext({viewport:{width:1366,height:900}})).newPage(); const errs=[]; d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
await d.evaluate(()=>{ localStorage.setItem('gg_lang','de'); });
const vid = await d.evaluate(()=>window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1800); { const tb = await d.$('[data-tab=\"steps\"]'); if(tb && await tb.isVisible()) await tb.click(); } await d.waitForTimeout(600);
const panel = await d.$('.steps-panel'); await panel.screenshot({path:OUT+'/shots/addstep.png'});
console.log('add card:', await d.$eval('.addstep', e => e.textContent.replace(/\s+/g,' ').trim()));
// import via the card: two fake image files → appended at the end
const before = await d.evaluate(()=>window.__tables.instructions[0].data.steps.map(s=>s.kind||s.type).join(','));
const inp = await d.$('.addstep input[type=file]');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGACcEAwGb9Y0CAAAAAElFTkSuQmCC','base64');
await inp.setInputFiles([{name:'a.png', mimeType:'image/png', buffer:png},{name:'b.png', mimeType:'image/png', buffer:png}]); await d.waitForTimeout(2500);
const after = await d.evaluate(()=>window.__tables.instructions[0].data.steps.map(s=>s.kind||s.type).join(','));
console.log('before:', before); console.log('after :', after);
console.log('selected row is last?', await d.$eval('.srow.sel', e => e.nextElementSibling && e.nextElementSibling.className));
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
