// v12.41 – import of a video the browser cannot convert and that is over the raw limit → a dialog names the file and why; a normal photo still imports
import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs'; import fs from 'fs';
const browser = await chromium.launch(launchArgs([]));
const d = await (await browser.newContext({viewport:{width:1280,height:900}})).newPage(); const errs=[]; d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(1800);
await d.evaluate(()=>{ localStorage.setItem('gg_lang','de'); });
const vid = await d.evaluate(()=>window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1500);
const before = await d.evaluate(()=>window.__tables.instructions[0].data.steps.length);
const bigPath = OUT+'/IMG_9999.MOV'; fs.writeFileSync(bigPath, Buffer.alloc(81*1048576, 7));
await d.setInputFiles('.addstep input[type=file]', [bigPath, TESTS+'/imp1.jpg']); await d.waitForTimeout(9000);
const dlg = await d.$('.modal ul'); console.log('error dialog:', !!dlg, '|', dlg ? (await dlg.textContent()).trim().slice(0,120) : '');
console.log('hint:', await d.$eval('.modal .muted', e => e.textContent.trim().slice(0,60)).catch(()=>'-'));
await d.click('.modal [data-x]'); await d.waitForTimeout(300);
const after = await d.evaluate(()=>window.__tables.instructions[0].data.steps.length);
console.log('steps before/after:', before, after, '(photo imported, video refused)');
fs.unlinkSync(bigPath); console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
