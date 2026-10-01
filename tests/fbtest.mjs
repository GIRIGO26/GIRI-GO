import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const m = await (await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2})).newPage(); m.on('pageerror', e => errs.push('M '+e.message));
await m.goto(BASE+'/index3.html'); await m.waitForTimeout(2200); await m.evaluate(()=>{ localStorage.setItem('gg_lang','de'); window.__tables.instructions[0].status='published'; }); await m.goto(BASE+'/index3.html#/'); await m.waitForTimeout(500);
const vid = await m.evaluate(()=>window.__tables.instructions[0].id);
await m.goto(BASE+'/index3.html#/v/'+vid+'/1'); await m.waitForTimeout(1500);
await m.fill('#wname', 'Anna'); await m.click('#begin'); await m.waitForTimeout(800);
console.log('fb buttons:', await m.$$eval('[data-fb]', x => x.length), 'end button:', !!(await m.$('#fb-end')));
await m.click('.vstep[data-i="0"] [data-fb]'); await m.waitForTimeout(500);
await m.screenshot({path:OUT+'/shots/fb-dialog.png'});
await m.click('#fb-kind [data-k="process"]'); await m.fill('#fb-text', 'Die Schraube sitzt links, nicht rechts.');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGACcEAwGb9Y0CAAAAAElFTkSuQmCC','base64');
await (await m.$('[data-att="photo"]')).setInputFiles({name:'foto.png', mimeType:'image/png', buffer:png}); await m.waitForTimeout(200);
console.log('att label:', await m.$eval('#fb-att', e => e.textContent));
await m.click('.modal [data-ok]'); await m.waitForTimeout(800);
const rows = await m.evaluate(()=>window.__tables.feedback.map(f => ({kind:f.kind, text:f.text, step_no:f.step_no, worker:f.worker, media:f.media_url, type:f.media_type, status:f.status})));
console.log('feedback rows:', JSON.stringify(rows));
await m.screenshot({path:OUT+'/shots/fb-viewer.png'});
// creator side (desktop)
const d = await (await browser.newContext({viewport:{width:1366,height:900}})).newPage(); d.on('pageerror', e => errs.push('D '+e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
await d.evaluate((row)=>{ localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_dash','all'); const st = window.__tables.instructions[0].data.steps.filter(s=>!s.kind)[0]; window.__tables.feedback.push({id:'fb1', instr_id:window.__tables.instructions[0].id, ws:'ar-giri.com', step_id:st.id, step_no:1, kind:'process', text:'Die Schraube sitzt links, nicht rechts.', worker:'Anna', media_url:'data:image/png;base64,'+row, media_type:'photo', status:'open', created_at:new Date().toISOString()}); window.__tables.feedback.push({id:'fb2', instr_id:window.__tables.instructions[0].id, ws:'ar-giri.com', step_id:null, step_no:null, kind:'quality', text:'Insgesamt gut, Schritt 4 zu schnell.', worker:'Max', media_url:null, media_type:null, status:'open', created_at:new Date(Date.now()-3e6).toISOString()}); }, png.toString('base64'));
await d.goto(BASE+'/index3.html#/p/none'); await d.waitForTimeout(600); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1200);
const vid2 = await d.evaluate(()=>window.__tables.instructions[0].id);
console.log('dash chip:', await d.$eval('.fbchip', e => e.textContent.trim()).catch(()=> 'none'));
await d.click('.fbchip'); await d.waitForTimeout(1200);
console.log('results tab feedback visible:', await d.$eval('#tab-feedback', e => !e.hidden), 'cards:', await d.$$eval('.fbcard', x => x.length), 'adopt links:', await d.$$eval('.fbcard a[href*="/fb/"]', x => x.map(a=>a.textContent.trim())));
await d.screenshot({path:OUT+'/shots/fb-results.png', fullPage:true});
// dismiss the text-only one
await d.click('[data-fb="fb2"] [data-fbs="dismissed"]'); await d.waitForTimeout(400);
console.log('fb2 status:', await d.evaluate(()=>window.__tables.feedback.find(f=>f.id==='fb2').status));
// editor banner
d.on('console', mm => { if(mm.type()==='error' && !/Failed to load|CORS|ERR_/.test(mm.text())) console.log('C', mm.text().slice(0,300)); });
await d.goto(BASE+'/index3.html#/edit/'+vid2); await d.waitForTimeout(2000);
console.log('hash:', await d.evaluate(()=>location.hash), 'editor:', await d.$$eval('.editor', x=>x.length), 'page h1:', await d.$eval('#app', e => (e.querySelector('h1,.title')||{}).value || (e.querySelector('h1')||{}).textContent));
console.log('banner:', await d.$eval('#fb-banner', e => e.hidden ? 'hidden' : e.textContent.trim()));
console.log('settings toggle:', !!(await d.$('#fbk')), '| badge on the analytics tab (v12.48):', await d.$eval('.itab[data-itab="results"] .nbadge', e => e.textContent.trim()).catch(() => 'none'));
// v0.35: where feedback lands + creator mail toggle (default on, saved as fbNotify)
console.log('analytics tab (v12.48, instead of the ⋯ entry):', await d.$eval('.itab[data-itab="results"]', e => e.textContent.trim().replace(/\s+/g,' ')), '| ⋯ entry gone:', await (async () => { await d.click('#more'); await d.waitForTimeout(200); return !(await d.$('.modal-bg [data-m="results"]')); })()); await d.click('.modal-bg [data-m="settings"]'); await d.waitForTimeout(300);
console.log('fb-sub:', await d.$eval('#fb-sub', e => e.hidden ? 'hidden' : e.textContent.trim().replace(/\s+/g,' ').slice(0, 120)), '| notify checked:', await d.$eval('#fbn', e => e.checked));
await d.click('#fbn'); await d.waitForTimeout(500); console.log('fbNotify saved:', await d.evaluate(()=>window.__tables.instructions.find(r=>r.id===location.hash.split('/')[2]).data.fbNotify)); await d.click('#fbn'); await d.waitForTimeout(400);
await d.click('#fbnr'); await d.waitForTimeout(400); console.log('reviewers saved:', await d.evaluate(()=>window.__tables.instructions.find(r=>r.id===location.hash.split('/')[2]).data.fbNotifyReviewers)); await d.click('#fbnr'); await d.waitForTimeout(300);
await d.click('#fbk'); await d.waitForTimeout(300); console.log('feedback off hides sub:', await d.$eval('#fb-sub', e => e.hidden)); await d.click('#fbk'); await d.waitForTimeout(400);
{ const tb = await d.$('[data-tab="steps"]'); if(tb) await tb.click(); await d.waitForTimeout(300); }
const before = await d.evaluate(()=>window.__tables.instructions[0].data.steps.map(s=>s.kind||s.type).join(','));
await d.goto(BASE+'/index3.html#/edit/'+vid2+'/fb/fb1'); await d.waitForTimeout(3000);
const after = await d.evaluate(()=>window.__tables.instructions[0].data.steps.map(s=>s.kind||s.type).join(','));
console.log('before:', before); console.log('after :', after);
console.log('new step:', await d.evaluate(()=>{ const st = window.__tables.instructions[0].data.steps; const s = st[2]; return s ? {title:s.title, desc:s.desc, type:s.type} : null; }), 'fb1 status:', await d.evaluate(()=>window.__tables.feedback.find(f=>f.id==='fb1').status));
await d.screenshot({path:OUT+'/shots/fb-editor.png'});
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
