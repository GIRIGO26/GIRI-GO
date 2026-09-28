// KI-PDF-Import: new instruction → "Aus PDF erstellen" → real model answer (fixture) → review (edit, delete, picture choice) → instruction with chapters + pictures
import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs'; import path from 'node:path';
const browser = await chromium.launch(launchArgs(['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']));
const errs = []; const ctx = await browser.newContext({viewport:{width:1280,height:900}}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_inst_dismissed','1'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2500);
const before = await d.evaluate(() => window.__tables.instructions.length);
await d.click('#new'); await d.waitForTimeout(300);
const pick = await d.$('.modal-bg [data-fid="none"]'); if(pick){ await pick.click(); await d.waitForTimeout(300); }
console.log('dialog has pdf option:', !!(await d.$('.modal-bg [data-pdf]')));
await d.screenshot({path:OUT+'/shots/ai1-new.png'});
await d.click('.modal-bg [data-pdf]'); await d.waitForSelector('.pdfi-guide', {timeout:5000});
console.log('start sheet: rules', await d.$$eval('.pdfi-rules li', x => x.length), '| guide prefilled:', await d.$eval('.pdfi-guide textarea', t => t.value.includes('Box öffnen')));
await d.click('.pdfi-guide summary'); await d.screenshot({path:OUT+'/shots/ai0-start.png'});
const [fc] = await Promise.all([d.waitForEvent('filechooser'), d.click('.modal-bg [data-ok]')]);
await fc.setFiles(path.join(TESTS, 'sample_ai.pdf'));
await d.waitForSelector('.pdfi-review', {timeout:20000}); await d.waitForTimeout(500);
console.log('pdf sent to function:', await d.evaluate(() => window.__pdfCalls), 'calls,', await d.evaluate(() => window.__pdfBytes > 1000 ? 'base64 ok' : 'empty'));
const rows = await d.$$eval('.pdfi-step', x => x.map(r => r.querySelector('.pdfi-title').value + ' | img:' + (r.querySelector('.pdfi-pick .on')||{}).textContent));
console.log('review steps:', JSON.stringify(rows));
console.log('chapters:', JSON.stringify(await d.$$eval('.pdfi-ch', x => x.map(e => e.textContent))));
console.log('warnings cleaned:', JSON.stringify(await d.$$eval('.pdfi-warn', x => x.map(e => e.value))));
// crop really contains the figure: the cut-out of step 1 is mostly the dark fixture drawing, not white paper
const dark = await d.evaluate(() => { const c = document.querySelector('.pdfi-step canvas'); const x = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let w = 0; for(let i=0;i<x.length;i+=4) if(x[i]>240 && x[i+1]>240 && x[i+2]>240) w++; return {w:c.width, h:c.height, whiteShare: +(w/(x.length/4)).toFixed(2)}; });
console.log('crop step 1:', JSON.stringify(dark), dark.whiteShare < 0.2 ? 'CROP OK' : 'CROP WHITE');
await d.screenshot({path:OUT+'/shots/ai2-review.png'});
// edit: rename step 1, delete last step, whole page for step 3
await d.fill('.pdfi-step >> nth=0 >> .pdfi-title', 'Werkstück einlegen');
await d.dispatchEvent('.pdfi-step >> nth=0 >> .pdfi-title', 'input');
await d.click('.pdfi-step >> nth=5 >> [data-del]'); await d.waitForTimeout(150);
await d.click('.pdfi-step >> nth=2 >> [data-p="page"]'); await d.waitForTimeout(150);
console.log('take-over button:', await d.$eval('.pdfi-review [data-ok]', e => e.textContent));
await d.click('.pdfi-review [data-ok]'); await d.waitForTimeout(2500);
console.log('now in editor:', await d.evaluate(() => /#\/edit\//.test(location.hash)));
const res = await d.evaluate(b => { const T = window.__tables.instructions; const r = T[T.length-1]; return {count: T.length - b, title: r.title, steps: r.data.steps.map(s => s.kind==='chapter' ? '# '+s.title : `${s.title} [${s.mediaId ? s.w+'x'+s.h : 'EMPTY'}]${s.warn?' ⚠':''}`), source: r.data.source && r.data.source.kind}; }, before);
console.log('created:', JSON.stringify(res));
await d.screenshot({path:OUT+'/shots/ai3-editor.png'});
// steps still to film: empty ones AND document pictures (placeholders); bar above the list, camera walks through them with the step text on top
const iid = await d.evaluate(() => location.hash.split('/').pop());
console.log('placeholders:', await d.evaluate(() => { const i = window.__tables.instructions; const r = i[i.length-1]; return r.data.steps.filter(s => s.placeholder).length + ' with pdf picture, ' + r.data.steps.filter(s => !s.kind && !s.mediaId).length + ' empty'; }));
console.log('noshot bar:', await d.$eval('#noshot-bar', e => e.hidden ? 'HIDDEN' : e.textContent.trim()));
console.log('list: empty thumbs', await d.$$eval('.srow .th-wrap.noshot', x => x.length), '| PDF tags', await d.$$eval('.srow .phtag', x => x.length));
console.log('placeholder banner on step 1:', await d.$eval('.ph-banner', e => e.textContent.trim().slice(0, 40)));
await d.click('.srow:has(.th-wrap.noshot)'); await d.waitForTimeout(400);
console.log('empty stage:', await d.$eval('.noshot-stage', e => e.querySelector('.ns-title').textContent + ' | shot: ' + !!e.querySelector('.ns-shot')));
await d.screenshot({path:OUT+'/shots/ai4-empty-stage.png'});
// "keep picture" on the last placeholder → no longer counted
await d.click('.srow:has(.phtag) >> nth=3'); await d.waitForTimeout(400); await d.click('#ph-keep'); await d.waitForTimeout(500);
console.log('after keep → bar:', await d.$eval('#noshot-bar', e => e.textContent.trim()));
await d.click('#noshot-bar'); await d.waitForTimeout(1500);
const card = async () => d.$eval('.modebar', e => (e.classList.contains('script') ? 'SCRIPT ' : 'PILL ') + e.querySelector('.cs-meta').textContent + ' | ' + e.querySelector('.cs-title').textContent + (e.querySelector('.cs-doc') ? ' | doc-thumb' : ''));
console.log('camera card:', await card());
console.log('strip: dashed', await d.$$eval('#strip .st.noshot', x => x.length), '| pdf-tagged', await d.$$eval('#strip .st.ph', x => x.length));
await d.click('.modebar [data-next]'); await d.waitForTimeout(300); console.log('next →', await card());
await d.click('.modebar [data-prev]'); await d.waitForTimeout(300); console.log('prev →', await card());
await d.screenshot({path:OUT+'/shots/ai5-camera.png'});
await d.click('#shutter'); await d.waitForTimeout(1800);
console.log('after photo → camera card:', await card());
console.log('still to film:', await d.evaluate(() => { const i = window.__tables.instructions; const r = i[i.length-1]; return r.data.steps.filter(s => !s.kind && (!s.mediaId || s.placeholder)).length; }));
// viewer placeholder for a step that is still empty
await d.goto(BASE+'/index3.html#/preview/'+iid); await d.waitForTimeout(1500);
console.log('viewer placeholders:', await d.$$eval('.vnoshot', x => x.length));
// error path: daily limit
await d.evaluate(() => { window.__pdfErr = 'daily_limit'; }); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(800);
await d.click('#new'); await d.waitForTimeout(300); const pk = await d.$('.modal-bg [data-fid="none"]'); if(pk){ await pk.click(); await d.waitForTimeout(300); }
await d.click('.modal-bg [data-pdf]'); await d.waitForSelector('.pdfi-guide'); const [fc2] = await Promise.all([d.waitForEvent('filechooser'), d.click('.modal-bg [data-ok]')]); await fc2.setFiles(path.join(TESTS, 'sample_ai.pdf')); await d.waitForTimeout(1500);
console.log('limit message:', await d.$eval('.pdfi', e => e.textContent.trim().slice(0, 90)));
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
