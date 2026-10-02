import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const m = await (await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true})).newPage(); const errs=[];
m.on('pageerror', e => errs.push(e.message+' '+(e.stack||'').split('\n').slice(0,2).join('|')));
m.on('console', msg => { if(msg.type()==='error') errs.push('console: '+msg.text()); });
await m.goto(BASE+'/index3.html'); await m.waitForTimeout(2000);
await m.evaluate(()=>{ const r = window.__tables.instructions[0]; r.status='published'; r.data.checklist = true; r.data.checkMode = 'chapter'; r.updated_at = new Date(Date.now()+5000).toISOString(); }); // v12.48: a change on the server has a newer date – the app syncs only what changed
const vid = await m.evaluate(()=>window.__tables.instructions[0].id);
await m.goto(BASE+'/index3.html#/'); await m.waitForTimeout(600);
// 1) overview on open (3 chapters)
await m.goto(BASE+'/index3.html#/v/'+vid); await m.waitForTimeout(1800);
console.log('overview tiles:', await m.$$eval('.ch-tile', t => t.map(x => x.textContent.trim().replace(/\s+/g,' '))));
console.log('posters loaded:', await m.$$eval('.ch-tile img', t => t.filter(i => i.complete && i.naturalWidth>0).length));
await m.screenshot({path:OUT+'/c1-overview.png'});
// 2) pick chapter 2 → URL /2, start card, then chapter-mode buttons
await m.click('.ch-tile[data-g="1"]'); await m.waitForTimeout(600);
console.log('hash after pick:', await m.evaluate(()=>location.hash));
console.log('start card visible:', await m.isVisible('.vw-start'));
await m.fill('#wname', 'Anna'); await m.click('#begin'); await m.waitForTimeout(800);
// v12.48: no OK button per step any more – the steps that need an answer carry data-need, the fixed bar answers the step in view
console.log('steps that need an answer (chapter mode):', await m.$$eval('.vstep[data-need]', b => b.map(x => x.dataset.i)), '| locked sections:', await m.$$eval('.vstep.locked', b => b.length), '| bar label:', await m.$eval('#va-okl', e => e.textContent).catch(() => 'none'));
console.log('feedback buttons:', await m.$$eval('.vstep [data-fb]', b => b.length));
console.log('current step in view:', await m.evaluate(()=>document.querySelector('#vcnt').textContent));
await m.screenshot({path:OUT+'/c2-chapter2.png'});
// confirm the chapter-2 step → overview shows progress
await m.$eval('.vstep[data-i="3"]', e => e.scrollIntoView()); await m.waitForTimeout(700); await m.click('#va-ok'); await m.waitForTimeout(500);
await m.click('.tt-wrap'); await m.waitForTimeout(600);
console.log('reopened overview:', await m.$$eval('.ch-tile', t => t.map(x => (x.querySelector('.done')?'✓ ':'')+x.querySelector('.txt span').textContent.trim())));
await m.screenshot({path:OUT+'/c3-overview-progress.png'});
await m.click('#ov-close'); await m.waitForTimeout(400);
console.log('overlay closed:', !(await m.$('.vw-chap')));
// 3) direct chapter URL → no overview, scrolled to chapter 3
await m.goto(BASE+'/index3.html#/'); await m.waitForTimeout(400);
await m.goto(BASE+'/index3.html#/v/'+vid+'/3'); await m.waitForTimeout(1500);
console.log('direct /3: overview?', !!(await m.$('.vw-chap')), 'start card?', await m.isVisible('.vw-start'));
await m.fill('#wname', 'Anna'); await m.click('#begin'); await m.waitForTimeout(300); const rs = await m.$('[data-restart]'); if(rs){ await rs.click(); await m.waitForTimeout(300); }
await m.waitForTimeout(600); console.log('cnt after /3:', await m.evaluate(()=>document.querySelector('#vcnt').textContent), 'hash:', await m.evaluate(()=>location.hash));
// 4) lang + chapter in URL
await m.goto(BASE+'/index3.html#/'); await m.waitForTimeout(400);
await m.goto(BASE+'/index3.html#/v/'+vid+'/2/en'); await m.waitForTimeout(1500);
console.log('/2/en: hash', await m.evaluate(()=>location.hash), 'title', await m.evaluate(()=>document.querySelector('#vttl').textContent));
// 5) custom mode with one marked step; all-mode counts
await m.evaluate(()=>{ localStorage.clear(); const r = window.__tables.instructions[0]; r.data.checkMode = 'custom'; r.data.steps.filter(s=>!s.kind)[1].confirm = true; r.updated_at = new Date(Date.now()+15000).toISOString(); });
await m.goto(BASE+'/index3.html#/'); await m.waitForTimeout(400);
await m.goto(BASE+'/index3.html#/v/'+vid+'/1'); await m.waitForTimeout(1500);
await m.fill('#wname', 'Anna'); await m.click('#begin'); await m.waitForTimeout(500);
console.log('custom mode steps that need an answer:', await m.$$eval('.vstep[data-need]', b => b.map(x => x.dataset.i)));
await m.$eval('.vstep[data-i="1"]', e => e.scrollIntoView()); await m.waitForTimeout(700); await m.click('#va-ok'); await m.waitForTimeout(500);
console.log('end sum:', await m.evaluate(()=>document.querySelector('#vend-sum').textContent));
await m.goto(BASE+'/index3.html#/'); await m.waitForTimeout(600);
console.log('local run cleared after auto-finish:', await m.evaluate(()=>!localStorage.getItem('gg_run_'+window.__tables.instructions[0].id)));
// 6) editor: settings radios + per-step checkbox + access card
await m.evaluate(()=>{ sessionStorage.setItem('gg_dash','all'); });
await m.goto(BASE+'/index3.html#/edit/'+vid); await m.waitForTimeout(1500);
await m.click('.itab[data-itab="settings"]'); await m.waitForTimeout(1000);
console.log('radios:', await m.$$eval('input[name="cm"]', r => r.map(x => x.value+(x.checked?'*':''))), 'access teams:', await m.$$eval('[data-itm]', r => r.length));
await m.click('[data-itm]'); await m.waitForTimeout(300); console.log('instr.teams:', JSON.stringify(await m.evaluate(()=>window.__tables.instructions[0].data.teams)));
{ const tb = await m.$('[data-tab=\"steps\"]'); if(tb && await tb.isVisible()) await tb.click(); } await m.waitForTimeout(500);
console.log('sconf checkbox present (custom):', !!(await m.$('#sconf')), 'row marks:', await m.$$eval('.srow small', s => s.filter(x => x.textContent.includes('☑')).length));
await m.screenshot({path:OUT+'/c4-editor-settings.png', fullPage:true});
// 7) desktop overview look
const d = await (await browser.newContext({viewport:{width:1280,height:800}})).newPage(); d.on('pageerror', e => errs.push('desk: '+e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(1500);
await d.evaluate(()=>{ const r = window.__tables.instructions[0]; r.status='published'; });
const vid2 = await d.evaluate(()=>window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/v/'+vid2); await d.waitForTimeout(1800); await d.screenshot({path:OUT+'/c5-overview-desktop.png'});
// admin matrix
await d.goto(BASE+'/index3.html#/admin'); await d.waitForTimeout(1200);
console.log('admin instr matrix rows:', await d.$$eval('#iaccess2 tr[data-i]', r => r.length));
await d.screenshot({path:OUT+'/c6-admin.png', fullPage:true});
// v0.28.3: the first chapter (with the selected step inside) must stay collapsed across redraws; admin AI card + dashboard entry
{ const iid = await d.evaluate(() => { const T = window.__tables.instructions; return (T.find(r => (r.data.steps||[]).filter(s => s.kind==='chapter').length > 1) || T[0]).id; });
  await d.goto(BASE+'/index3.html#/edit/'+iid); await d.waitForTimeout(1200);
  await d.click('.chrow >> nth=0 >> .chev'); await d.waitForTimeout(250);
  await d.evaluate(() => { const i = document.querySelector('#stitle'); i.value = i.value + ' x'; i.dispatchEvent(new Event('input')); }); await d.waitForTimeout(900);
  console.log('first chapter stays collapsed after redraw:', await d.$eval('.chrow >> nth=0', e => e.classList.contains('coll')) ? 'YES' : 'NO – BUG');
  await d.goto(BASE+'/index3.html#/admin/ai'); await d.waitForTimeout(1500);
  const box = await d.$eval('#ai-card', e => e.getBoundingClientRect()); console.log('AI config card on screen:', box.top >= 0 && box.top < 400 && box.height > 200 ? 'YES' : JSON.stringify(box));
  await d.fill('#ai-guide', 'Mein Leitfaden: kurz.'); await d.click('#ai-save'); await d.waitForTimeout(400);
  console.log('AI guide saved to workspace:', await d.evaluate(() => (window.__tables.workspaces[0].settings||{}).pdfGuide)); }
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
