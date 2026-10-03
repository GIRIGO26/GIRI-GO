// v12.49 – Björn's round of 2 Oct (evening): every piece of information once in the worker view, Spanish really Spanish, the editor
// head with three sub-pages (edit · settings · analytics) and the preview at the far right, PDF in ⋯, approvals as one dialog that
// shows what this person may do, only "retake / replace file" under a step, one scroll for the whole page (editor + start page),
// and a hint on the phone before "follow" (tracking) runs
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([])); const errs = [];

// ---- 1. worker view (phone, checklist on) ----
{ const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
  await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_worker','Anna'); sessionStorage.setItem('gg_inst_hide','1'); });
  const m = await ctx.newPage(); m.on('pageerror', e => errs.push('viewer: '+e.message));
  await m.goto(BASE+'/index3.html'); await m.waitForTimeout(2200);
  const id = await m.evaluate(() => { const r = window.__tables.instructions[0]; r.status = 'published'; r.data.checklist = true; return r.id; });
  await m.goto(BASE+'/index3.html#/v/'+id); await m.waitForTimeout(1600);
  await m.click('#ov-start'); await m.waitForTimeout(500); await m.click('#begin'); await m.waitForTimeout(800);
  const once = await m.evaluate(() => { const vis = e => e && e.offsetParent !== null && getComputedStyle(e).display !== 'none'; const txt = document.body.innerText;
    return {counter: (document.querySelector('#vcnt')||{}).textContent, chapterTop: (document.querySelector('#vch')||{}).textContent, stepKickers: [...document.querySelectorAll('.vstep .num')].filter(e => e.textContent && vis(e)).length, barText: document.querySelector('#vw-act').innerText.replace(/\n+/g,' | '), stepWords: (txt.match(/Schritt \d/g)||[]).length}; });
  console.log('step 1 – counter only in the top bar:', once.counter, '| chapter only in the top bar:', once.chapterTop, '| step kickers under the picture:', once.stepKickers, '| answer bar:', once.barText, '| "Schritt n" anywhere:', once.stepWords);
  await m.click('#va-ok'); await m.waitForTimeout(900); await m.click('#va-ok'); await m.waitForTimeout(900);
  console.log('chapter card – top bar does not repeat it:', await m.evaluate(() => JSON.stringify({ch: document.querySelector('#vch').textContent, pill: getComputedStyle(document.querySelector('#vcnt')).display})), '| card:', await m.$eval('.vchap[data-g="1"]', e => e.innerText.replace(/\n+/g,' · ')));
  // Spanish: all ~1100 UI strings in parts of 500 (the edge function takes 600 at most)
  await m.click('#langbtn'); await m.waitForTimeout(400); await m.click('.modal [data-l="ES"]'); await m.waitForTimeout(2500);
  console.log('UI translation calls:', await m.evaluate(() => JSON.stringify((window.__invoked||[]).filter(x => x.ui).map(x => x.ui))));
  await m.$eval('.vchap[data-g="1"]', e => e.nextElementSibling.scrollIntoView()); await m.waitForTimeout(900);
  await m.evaluate(() => { const b = [...document.querySelectorAll('[data-fb]')].find(x => x.offsetParent); if(b) b.click(); }); await m.waitForTimeout(700);
  const fbTexts = await m.$$eval('.modal button, .modal label.btn, .modal .lbl', xs => xs.map(x => x.textContent.trim()).filter(Boolean));
  console.log('ES feedback dialog – all buttons translated:', fbTexts.every(x => x.startsWith('[ES]')) ? 'yes' : 'NO: ' + fbTexts.filter(x => !x.startsWith('[ES]')).join(', '));
  await m.click('.modal [data-x]'); await m.waitForTimeout(300);
  console.log('ES answer bar:', await m.evaluate(() => document.querySelector('#vw-act').innerText.replace(/\n+/g,' | ')));
  await ctx.close(); }

// ---- 2. editor head, settings, approvals, step bar (PC) ----
{ const ctx = await browser.newContext({viewport:{width:1366,height:860}});
  await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_inst_hide','1'); });
  const d = await ctx.newPage(); d.on('pageerror', e => errs.push('editor: '+e.message));
  await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
  const id = await d.evaluate(() => window.__tables.instructions[0].id);
  await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(1600);
  const head = await d.evaluate(() => ({tabs: [...document.querySelectorAll('.ed-head .itab')].map(x => (x.classList.contains('on') ? '*' : '') + x.textContent.trim()), acts: [...document.querySelectorAll('.ed-head .ed-acts > *')].filter(x => !x.hidden).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(x => x.id || x.className)}));
  console.log('tabs:', head.tabs.join(' | '), '| actions left→right:', head.acts.join(', '));
  console.log('under the step:', await d.$$eval('.mact button, .mact label', x => x.map(b => b.textContent.trim()).join(' / ')), '| "insert after" gone:', !(await d.$('#after, #after-empty, #after-file')));
  await d.click('#more'); await d.waitForTimeout(300); console.log('⋯ menu:', await d.$$eval('.modal [data-m]', x => x.map(b => b.textContent.trim()).join(' | '))); await d.click('.modal [data-m="pdf"]'); await d.waitForTimeout(400);
  console.log('⋯ → PDF asks for the language:', await d.$eval('.modal h2', e => e.textContent.trim()).catch(() => 'none')); await d.click('.modal [data-x]'); await d.waitForTimeout(300);
  await d.click('#stchip'); await d.waitForTimeout(400); console.log('status chip → dialog:', await d.$eval('.modal h2', e => e.textContent.trim()), '| rows:', await d.$$eval('.modal .appr', x => x.map(r => r.innerText.replace(/\n+/g,' – ')).join(' || ')));
  await d.click('.modal #ap-submit'); await d.waitForTimeout(400); await d.click('.modal #ap-subok'); await d.waitForTimeout(700); await d.click('.modal [data-x]'); await d.waitForTimeout(300); // v12.51: note in the dialog, the dialog stays open
  console.log('submitted – chip:', await d.$eval('#stchip', e => e.textContent), '| CTA:', await d.$eval('#cta', e => e.hidden ? 'hidden' : e.textContent));
  await d.click('#cta'); await d.waitForTimeout(400); console.log('CTA "Freigeben" → dialog with:', await d.$$eval('.modal [data-aok], .modal #ap-both', x => x.map(b => b.id || b.dataset.aok).join(',')));
  await d.click('.modal [data-aok="tech"]'); await d.waitForTimeout(600); console.log('technical given:', await d.$eval('.modal .appr-msg', e => e.textContent.trim()), '| chip:', await d.$eval('#stchip', e => e.textContent));
  await d.click('.modal [data-x]'); await d.waitForTimeout(300);
  await d.click('#cta'); await d.waitForTimeout(400); await d.click('.modal [data-aok="dsgvo"]'); await d.waitForTimeout(700); await d.click('.modal [data-x]'); await d.waitForTimeout(300); console.log('GDPR given → chip:', await d.$eval('#stchip', e => e.textContent), '| version:', await d.$eval('#vchip', e => e.textContent), '| CTA:', await d.$eval('#cta', e => e.hidden ? 'hidden' : e.textContent));
  // settings sub-page: folder (location) + access + checklist + feedback; nothing about approvals or PDF
  await d.click('.itab[data-itab="settings"]'); await d.waitForTimeout(1200);
  console.log('settings:', await d.evaluate(() => location.hash.replace(/[a-z0-9]{10,}/, '<id>')), '| sections:', await d.$$eval('#tab-settings .set-sec', x => x.map(e => e.id).join(',')), '| approvals/PDF on the page:', !!(await d.$('#tab-settings #appr, #tab-settings [data-pdforig], #tab-settings #txcard')));
  await d.click('#set-fmove'); await d.waitForTimeout(400); await d.click('.modal [data-fid="f1"]'); await d.waitForTimeout(1200);
  console.log('folder changed here:', await d.$eval('#set-fname', e => e.textContent), '| crumbs follow:', await d.$eval('.topbar .crumbs', e => e.textContent.replace(/\s+/g,' ').trim()));
  await d.click('.itab[data-itab="results"]'); await d.waitForTimeout(1200);
  console.log('analytics = same head:', await d.evaluate(() => [...document.querySelectorAll('.ed-head .itab')].map(x => (x.classList.contains('on') ? '*' : '') + x.textContent.trim()).join(' | ')), '| head button there too (published → Link & QR):', !!(await d.$('.ed-head #pvw, .ed-head #pvw-share')));
  await ctx.close(); }

// ---- 3. one scroll for the page (PC): editor with 25 steps, start page with 30 folders ----
{ const ctx = await browser.newContext({viewport:{width:1366,height:820}});
  await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_inst_hide','1'); });
  const d = await ctx.newPage(); d.on('pageerror', e => errs.push('scroll: '+e.message));
  await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
  await d.evaluate(() => { const T = window.__tables; const base = T.instructions[0]; for(let k=0;k<40;k++){ const c = JSON.parse(JSON.stringify(base)); c.id = 'x'+k; c.title = 'Anleitung '+k; c.updated_at = new Date(Date.now()-k*1e6).toISOString(); c.data.folder = 'ff'+(k%30); T.instructions.push(c); }
    const w = T.workspaces[0]; for(let k=0;k<30;k++) w.folders.push({id:'ff'+k, name:'Ordner '+k, teams:[]}); const r = T.instructions[0]; const s0 = r.data.steps.filter(s=>!s.kind)[0]; for(let k=0;k<20;k++){ const c = JSON.parse(JSON.stringify(s0)); c.id = 'sx'+k; c.title = 'Schritt extra '+k; r.data.steps.push(c); } r.updated_at = new Date(Date.now()+9e5).toISOString(); });
  const boxes = () => d.evaluate(() => [...document.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 50; }).map(e => (e.id || e.className).toString().slice(0, 30)));
  await d.goto(BASE+'/index3.html#/trash'); await d.waitForTimeout(300); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(2000);
  const nav = await d.$('#dnav'); const nb = await nav.boundingBox();
  await d.mouse.move(nb.x + 60, 400); for(let k=0;k<8;k++){ await d.mouse.wheel(0, 300); await d.waitForTimeout(80); } await d.waitForTimeout(300);
  console.log('start page: own scroll boxes:', JSON.stringify(await boxes()), '| wheel over the navigator scrolls the page:', await d.evaluate(() => scrollY) > 1000);
  const id = await d.evaluate(() => window.__tables.instructions[0].id);
  await d.goto(BASE+'/index3.html#/trash'); await d.waitForTimeout(300); await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(2000);
  // v12.51: the editor changed – the step column scrolls with the page, the list in its own box (details: tests/r51.mjs)
  await d.mouse.move(250, 500); for(let k=0;k<6;k++){ await d.mouse.wheel(0, 300); await d.waitForTimeout(60); } await d.waitForTimeout(400);
  console.log('editor: own scroll boxes:', JSON.stringify(await boxes()), '| wheel over the list scrolls the list, not the page:', await d.evaluate(() => scrollY) < 5 && await d.evaluate(() => document.querySelector('.steps-panel').scrollTop) > 300);
  await d.mouse.move(900, 500); for(let k=0;k<6;k++){ await d.mouse.wheel(0, 300); await d.waitForTimeout(60); } await d.waitForTimeout(400);
  console.log('wheel over the step scrolls the page:', await d.evaluate(() => scrollY) > 200);
  const pick = await d.evaluate(() => { const p = document.querySelector('.steps-panel').getBoundingClientRect(); const rows = [...document.querySelectorAll('.srow')].filter(r => { const b = r.getBoundingClientRect(); return b.top >= p.top && b.bottom <= p.bottom; }); return rows[rows.length-1].dataset.id; });
  await d.click(`.srow[data-id="${pick}"]`); await d.waitForTimeout(1200);
  console.log('pick a step far down → its picture is in view (under the head):', await d.evaluate(() => { const h = document.querySelector('.ed-head').getBoundingClientRect().bottom, s = document.querySelector('#stage').getBoundingClientRect().top; return s >= h - 2 && s < h + 40; }));
  await ctx.close(); }

// ---- 4. "follow" (tracking) on the phone: a hint first ----
{ const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
  await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_inst_hide','1'); });
  const d = await ctx.newPage(); d.on('pageerror', e => errs.push('track: '+e.message));
  await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
  const url = BASE+'/tests/move.webm';
  const vid = await d.evaluate(url => { const r = window.__tables.instructions[0]; r.data.steps.push({id:'trkstep', type:'video', mediaId:'m-trk', mediaUrl:url, w:320, h:240, duration:3, trimStart:0, trimEnd:3, title:'Tracking', desc:'', warn:'', ann:[{id:'arr1', type:'arrow', color:'blue', size:0.14, x:0.35, y:0.75, x2:(40+0.2*70+3)/320, y2:93/240, t:0.2}]}); r.updated_at = new Date(Date.now()+1000).toISOString(); return r.id; }, url);
  await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1500); await d.click('.srow[data-id="trkstep"]'); await d.waitForTimeout(1500);
  await d.click('.ann-pill[data-id="arr1"]'); await d.waitForTimeout(600); await d.click('[data-trk="on"]'); await d.waitForTimeout(500);
  console.log('phone → hint:', await d.$eval('.modal h2', e => e.textContent.trim()).catch(() => 'none'), '| choices:', await d.$$eval('.modal .actions button', x => x.map(b => b.textContent.trim()).join(' / ')));
  await d.click('.modal [data-ok]'); await d.waitForTimeout(400); console.log('"do it on the PC" → nothing tracked:', await d.evaluate(() => !window.__tables.instructions[0].data.steps.find(s => s.id==='trkstep').ann[0].track));
  await d.click('[data-trk="on"]'); await d.waitForTimeout(400); await d.click('.modal [data-try]'); await d.waitForTimeout(12000);
  console.log('"try here anyway" → tracked points:', await d.evaluate(() => { const a = window.__tables.instructions[0].data.steps.find(s => s.id==='trkstep').ann[0]; return a.track ? a.track.pts.length : 0; }));
  await ctx.close(); }

await browser.close(); console.log(errs.join('\n') || 'NO ERRORS');
