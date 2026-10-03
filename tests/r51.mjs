// v12.51 – round of 3 Oct (midday), the last one before go-live:
//  1. editor (PC): the step column (picture + texts) scrolls with the page, the step list keeps its place and scrolls in its own box;
//     picking a step far down / deleting a step does not make anything jump
//  2. approval dialog stays open until everything is given; reject with the reason inside the dialog
//  3. head of a published instruction: "Link & QR code" instead of "Preview"
//  4. checklist result card: readable in the dark and the light theme, with notes and photos
//  5. start page: "news" – completed checklists (job done), approvals waiting for me, open feedback
//  6. version on the sign-in page
import { chromium } from 'playwright'; import { BASE, OUT, ROOT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([])); const errs = [];
const only = (process.env.R51 || '').split(',').filter(Boolean); const want = k => !only.length || only.includes(k);

// ---- 1. editor scrolling (PC) ----
if(want('scroll')){ const ctx = await browser.newContext({viewport:{width:1366,height:820}});
  await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_inst_hide','1'); });
  const d = await ctx.newPage(); d.on('pageerror', e => errs.push('scroll: '+e.message));
  await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
  const id = await d.evaluate(() => { const r = window.__tables.instructions[0]; const s0 = r.data.steps.filter(s=>!s.kind)[0]; for(let k=0;k<22;k++){ const c = JSON.parse(JSON.stringify(s0)); c.id = 'sx'+k; c.title = 'Schritt extra '+k; c.desc = 'Beschreibung '+k; r.data.steps.push(c); } r.updated_at = new Date(Date.now()+9e5).toISOString(); return r.id; });
  await d.goto(BASE+'/index3.html#/trash'); await d.waitForTimeout(300); await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(2200);
  const st = () => d.evaluate(() => { const p = document.querySelector('.steps-panel'), m = document.querySelector('.ed-main'), ta = document.querySelector('#sdesc'), sg = document.querySelector('#stage'), h = document.querySelector('.ed-head');
    const r = x => x.getBoundingClientRect(); return {y: Math.round(scrollY), pTop: Math.round(r(p).top), pScroll: Math.round(p.scrollTop), pOwn: p.scrollHeight > p.clientHeight + 2, mTop: Math.round(r(m).top), taTop: Math.round(r(ta).top), taBottom: Math.round(r(ta).bottom), stageTop: Math.round(r(sg).top), headBottom: Math.round(r(h).bottom), vh: innerHeight, sel: (document.querySelector('.srow.sel')||{}).dataset?.id}; });
  const s0 = await st(); console.log('long list in its own box:', s0.pOwn, '| description field below the window at the start:', s0.taBottom > s0.vh);
  // wheel over the step column → the page scrolls, the description field comes into view, the list stays in place
  await d.mouse.move(900, 500); for(let k=0;k<6;k++){ await d.mouse.wheel(0, 250); await d.waitForTimeout(70); } await d.waitForTimeout(400);
  const s1 = await st(); console.log('wheel over the step → page scrolled:', s1.y > 200, '| description field reachable:', s1.taBottom <= s1.vh && s1.taTop >= s1.headBottom - 2, '| list stays under the head:', Math.abs(s1.pTop - s1.headBottom) < 24, '| list box not scrolled:', s1.pScroll === 0);
  // wheel over the list → the list scrolls in its box, the page stays
  await d.mouse.move(200, 500); for(let k=0;k<4;k++){ await d.mouse.wheel(0, 300); await d.waitForTimeout(70); } await d.waitForTimeout(400);
  const s2 = await st(); console.log('wheel over the list → list scrolled:', s2.pScroll > 300, '| page unchanged:', Math.abs(s2.y - s1.y) <= 2);
  // pick a step far down in the list while the page is scrolled into the texts → the list keeps its place, the picture comes into view
  const pickId = await d.evaluate(() => { const p = document.querySelector('.steps-panel').getBoundingClientRect(); const rows = [...document.querySelectorAll('.srow')].filter(r => { const b = r.getBoundingClientRect(); return b.top >= p.top && b.bottom <= p.bottom; }); return rows[rows.length-1].dataset.id; });
  const before = s2.pScroll; await d.click(`.srow[data-id="${pickId}"]`); await d.waitForTimeout(1200);
  const s3 = await st(); console.log('pick step far down → list kept its place:', Math.abs(s3.pScroll - before) <= 2, '| picture of the step in view (under the head):', s3.stageTop >= s3.headBottom - 2 && s3.stageTop < s3.headBottom + 40, '| selected:', s3.sel === pickId);
  // the page at the top: picking another step moves nothing
  await d.evaluate(() => scrollTo(0, 0)); await d.waitForTimeout(500); const s4a = await st();
  const pick2 = await d.evaluate(() => { const p = document.querySelector('.steps-panel').getBoundingClientRect(); const rows = [...document.querySelectorAll('.srow:not(.sel)')].filter(r => { const b = r.getBoundingClientRect(); return b.top >= p.top && b.bottom <= p.bottom; }); return rows[0].dataset.id; });
  await d.click(`.srow[data-id="${pick2}"]`); await d.waitForTimeout(900); const s4 = await st();
  console.log('page at the top, pick a step → page does not move:', s4.y === s4a.y, '| list does not move:', Math.abs(s4.pScroll - s4a.pScroll) <= 2);
  // delete a step further down from the list → the list and the page stay where they are, the next step is selected
  await d.mouse.move(900, 500); for(let k=0;k<3;k++){ await d.mouse.wheel(0, 250); await d.waitForTimeout(70); } await d.waitForTimeout(400);
  const s5a = await st(); const s5next = await d.evaluate(() => { const r = document.querySelector('.srow.sel'); let n = r.nextElementSibling; while(n && !n.classList.contains('srow')) n = n.nextElementSibling; return n && n.dataset.id; }); const delId = await d.evaluate(() => document.querySelector('.srow.sel').dataset.id); await d.hover('.srow.sel'); await d.click('.srow.sel [data-rowdel]'); await d.waitForTimeout(300); await d.click('.modal-bg [data-ok]');
  const ys = []; for(let k=0;k<12;k++){ await d.waitForTimeout(80); ys.push(await d.evaluate(() => Math.round(scrollY))); } const s5 = await st();
  console.log('delete a step → list stays:', Math.abs(s5.pScroll - s5a.pScroll) <= 40, '| page never jumped below the step top:', ys.every(y => y <= s5a.y + 2), '| the step that moved up is selected (not one further down):', s5.sel !== delId && s5.sel === s5next);
  // keyboard: arrow down through the list → the selected row stays visible inside the box, the page does not scroll
  await d.focus('.srow.sel'); const y0 = (await st()).y; for(let k=0;k<4;k++){ await d.keyboard.press('ArrowDown'); await d.waitForTimeout(250); }
  const vis = await d.evaluate(() => { const p = document.querySelector('.steps-panel').getBoundingClientRect(), r = document.querySelector('.srow.sel').getBoundingClientRect(); return r.top >= p.top - 1 && r.bottom <= p.bottom + 1; });
  console.log('arrow keys → selected row visible in the list:', vis, '| selected:', (await st()).sel);
  await d.screenshot({path: OUT+'/shots/r51-editor-scroll.png'});
  await ctx.close(); }

// ---- 2 + 3. approval dialog stays open; published → "Link & QR code" in the head ----
if(want('appr')){ const ctx = await browser.newContext({viewport:{width:1366,height:860}});
  await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_inst_hide','1'); });
  const d = await ctx.newPage(); d.on('pageerror', e => errs.push('appr: '+e.message));
  await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
  const id = await d.evaluate(() => window.__tables.instructions[0].id);
  await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(1600);
  console.log('draft – head shows preview:', !!(await d.$('.ed-acts #pvw')), '| no share button:', !(await d.$('.ed-acts #pvw-share')));
  await d.click('#cta'); await d.waitForTimeout(500);
  console.log('"submit" opens the dialog with the note field:', !!(await d.$('.modal #ap-note')), '| note prefilled:', await d.$eval('.modal #ap-note', e => e.value));
  await d.click('.modal #ap-subok'); await d.waitForTimeout(700);
  const open1 = await d.evaluate(() => ({open: !!document.querySelector('.modal .approve-box'), msg: (document.querySelector('.modal .appr-msg')||{}).textContent || '', btns: [...document.querySelectorAll('.modal [data-aok]')].map(b => b.dataset.aok).join(',')}));
  console.log('submitted – dialog still open:', open1.open, '| message:', open1.msg.trim(), '| approve buttons:', open1.btns, '| chip:', await d.$eval('#stchip', e => e.textContent));
  await d.click('.modal [data-aok="tech"]'); await d.waitForTimeout(700);
  const open2 = await d.evaluate(() => ({open: !!document.querySelector('.modal .approve-box'), msg: ((document.querySelector('.modal .appr-msg')||{}).textContent || '').trim(), techOk: document.querySelector('.modal [data-appr="tech"]').classList.contains('ok'), dsgvoBtn: !!document.querySelector('.modal [data-aok="dsgvo"]')}));
  console.log('technical approval given – dialog still open:', open2.open, '| ✓ technical:', open2.techOk, '| GDPR still to give:', open2.dsgvoBtn, '| message:', open2.msg);
  await d.click('.modal [data-aok="dsgvo"]'); await d.waitForTimeout(800);
  const open3 = await d.evaluate(() => ({open: !!document.querySelector('.modal .approve-box'), live: ((document.querySelector('.modal .appr-live b')||{}).textContent || '').trim(), share: !!document.querySelector('.modal #ap-share')}));
  console.log('both given – dialog open with:', open3.live, '| Link & QR button in the dialog:', open3.share, '| chip:', await d.$eval('#stchip', e => e.textContent), '| head: share instead of preview:', !!(await d.$('.ed-acts #pvw-share')) && !(await d.$('.ed-acts #pvw')));
  await d.screenshot({path: OUT+'/shots/r51-appr-done.png'});
  await d.click('.modal #ap-share'); await d.waitForTimeout(700);
  console.log('Link & QR from the dialog → share window:', await d.$eval('.modal h2', e => e.textContent.trim()), '| QR drawn:', !!(await d.$('.modal #qr canvas, .modal #qr img')));
  await d.click('.modal [data-x]'); await d.waitForTimeout(300);
  await d.click('.ed-acts #pvw-share'); await d.waitForTimeout(600); console.log('head button → share window:', !!(await d.$('.modal #qr'))); await d.click('.modal [data-x]'); await d.waitForTimeout(300);
  await d.click('.itab[data-itab="results"]'); await d.waitForTimeout(1200); console.log('analytics head: share button too:', !!(await d.$('.ed-head #pvw-share')));
  // reject: the reason goes in the row, an empty reason is not accepted
  const id2 = await d.evaluate(() => { const r = window.__tables.instructions[1] || window.__tables.instructions[0]; r.status = 'review'; r.data.approvals = {tech:null, dsgvo:null}; r.updated_at = new Date(Date.now()+5e6).toISOString(); return r.id; });
  await d.goto(BASE+'/index3.html#/trash'); await d.waitForTimeout(300); await d.goto(BASE+'/index3.html#/edit/'+id2); await d.waitForTimeout(1600);
  await d.click('#stchip'); await d.waitForTimeout(400); await d.click('.modal [data-rej="tech"]'); await d.waitForTimeout(300);
  console.log('reject → reason field in the row:', !!(await d.$('.modal [data-appr="tech"] #ap-why')), '| other buttons hidden meanwhile:', !(await d.$('.modal #ap-both')));
  await d.click('.modal [data-rejok]'); await d.waitForTimeout(300); console.log('empty reason refused:', await d.$eval('.modal #ap-why', e => e.classList.contains('need')));
  await d.fill('.modal #ap-why', 'Schritt 3: Drehmoment fehlt'); await d.click('.modal [data-rejok]'); await d.waitForTimeout(700);
  console.log('rejected – dialog open:', !!(await d.$('.modal .approve-box')), '| message:', (await d.$eval('.modal .appr-msg', e => e.textContent)).trim(), '| chip:', await d.$eval('#stchip', e => e.textContent), '| reason in the history:', await d.$eval('.modal .hist', e => e.textContent.includes('Drehmoment fehlt')));
  await d.click('.modal [data-x]'); await d.waitForTimeout(300); console.log('"Fertig" closes:', !(await d.$('.modal-bg')));
  await ctx.close(); }

// ---- 4. checklist result card: contrast in both themes ----
if(want('end')){ for(const theme of ['dark', 'light']){
  const ctx = await browser.newContext({viewport:{width:430,height:900}, isMobile:true, hasTouch:true});
  await ctx.addInitScript(th => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_worker','Anna'); Object.defineProperty(window, '__tables', {configurable:true, set(t){ t.workspaces[0].brand = Object.assign({}, t.workspaces[0].brand, {theme: th}); this._t = t; }, get(){ return this._t; }}); }, theme);
  const m = await ctx.newPage(); m.on('pageerror', e => errs.push('end '+theme+': '+e.message));
  await m.goto(BASE+'/index3.html'); await m.waitForTimeout(2000);
  const id = await m.evaluate(() => { const r = window.__tables.instructions[0]; r.status = 'published'; r.data.checklist = true; return r.id; });
  await m.goto(BASE+'/index3.html#/v/'+id); await m.waitForTimeout(1500);
  await m.click('#ov-start'); await m.waitForTimeout(500); await m.click('#begin'); await m.waitForTimeout(600);
  await m.click('#va-ok'); await m.waitForTimeout(900); await m.click('#va-ok'); await m.waitForTimeout(900);
  await m.$eval('.vchap[data-g="1"]', e => e.nextElementSibling.scrollIntoView()); await m.waitForTimeout(700);
  await m.click('#va-nok'); await m.waitForTimeout(400); await m.fill('#nk-note', 'Schraube M6 fehlt – bitte nachbestellen'); await m.setInputFiles('#nk-ph', ROOT + '/icons/icon-192.png'); await m.click('.modal-bg [data-ok]'); await m.waitForTimeout(1200);
  await m.click('#va-ok'); await m.waitForTimeout(900); await m.$eval('.vchap[data-g="2"]', e => e.nextElementSibling.scrollIntoView()); await m.waitForTimeout(700);
  await m.click('#va-ok'); await m.waitForTimeout(1000); await m.$eval('.vend', e => e.scrollIntoView()); await m.waitForTimeout(600);
  await m.click('#finish2'); await m.waitForTimeout(1500);
  const audit = await m.evaluate(() => { const L = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126*r + 0.7152*g + 0.0722*b; };
    const rgb = s => (s.match(/[\d.]+/g) || []).map(Number); const bgOf = el => { for(let e = el; e; e = e.parentElement){ const c = rgb(getComputedStyle(e).backgroundColor); if(c.length >= 3 && (c.length < 4 || c[3] > 0.9)) return c.slice(0, 3); } return [255, 255, 255]; };
    const out = []; document.querySelectorAll('.vw-end .card *').forEach(e => { const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if(!own || e.closest('svg')) return; const cs = getComputedStyle(e); if(cs.visibility === 'hidden' || cs.display === 'none') return;
      const fg = rgb(cs.color).slice(0, 3), bg = bgOf(e); const a = L(fg), b = L(bg); const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); out.push({t: e.textContent.trim().slice(0, 24), r: Math.round(ratio * 10) / 10}); });
    return {min: Math.min(...out.map(x => x.r)), worst: out.sort((a, b) => a.r - b.r).slice(0, 3), photo: !!document.querySelector('.vw-end img.nk-ph'), state: document.querySelector('.vw-end').className}; });
  console.log(`result card ${theme}: lowest text contrast`, audit.min, audit.min >= 4.5 ? '(≥ 4.5 ✓)' : '(TOO LOW: ' + JSON.stringify(audit.worst) + ')', '| photo shown:', audit.photo, '|', audit.state);
  await m.screenshot({path: OUT+`/shots/r51-end-${theme}.png`});
  await ctx.close(); } }

// ---- 5. start page news: checklist completed, one approval waiting ----
if(want('news')){ const ctx = await browser.newContext({viewport:{width:1366,height:860}});
  await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_inst_hide','1'); });
  const d = await ctx.newPage(); d.on('pageerror', e => errs.push('news: '+e.message));
  await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
  const id = await d.evaluate(() => { const T = window.__tables; const r = T.instructions[0]; r.status = 'published'; const now = Date.now(); T.runs = T.runs || [];
    T.runs.push({id:'run-a', instr_id:r.id, ws:r.ws, worker:'Anna', version:1, started_at:new Date(now-9e5).toISOString(), finished_at:new Date(now-6e5).toISOString(), items:{a:{ok:true}, b:{ok:false, note:'fehlt'}}});
    T.runs.push({id:'run-b', instr_id:r.id, ws:r.ws, worker:'Mehmet', version:1, started_at:new Date(now-4e5).toISOString(), finished_at:new Date(now-1.2e5).toISOString(), items:{a:{ok:true}}});
    T.runs.push({id:'run-old', instr_id:r.id, ws:r.ws, worker:'Alt', version:1, started_at:new Date(now-9e8).toISOString(), finished_at:new Date(now-9e8).toISOString(), items:{}});
    const r2 = JSON.parse(JSON.stringify(r)); r2.id = 'rev1'; r2.title = 'Prüfstand kalibrieren'; r2.status = 'review'; r2.data.approvals = {tech:null, dsgvo:null}; r2.updated_at = new Date(now+5e6).toISOString(); T.instructions.push(r2); return r.id; });
  await d.goto(BASE+'/index3.html#/trash'); await d.waitForTimeout(300); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(2200);
  const nw = () => d.$$eval('#inbox .nwx', x => x.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log('news on the start page:', JSON.stringify(await nw()));
  console.log('approval task names the instruction:', await d.$eval('#todo', e => e.textContent.replace(/\s+/g,' ').trim()).catch(() => 'none'));
  await d.screenshot({path: OUT+'/shots/r51-news.png'});
  await d.click('#inbox .nwx [data-nwx]'); await d.waitForTimeout(400); console.log('hidden with × →', JSON.stringify(await nw()));
  await d.goto(BASE+'/index3.html#/trash'); await d.waitForTimeout(300); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1500); console.log('stays hidden after a redraw:', (await nw()).length === 0);
  // a worker finishes another checklist while the page is open → it pops up
  await d.evaluate(id => { const T = window.__tables; const r = T.instructions.find(x => x.id === id); T.runs.push({id:'run-c', instr_id:id, ws:r.ws, worker:'Lena', version:1, started_at:new Date(Date.now()-6e4).toISOString(), finished_at:new Date().toISOString(), items:{a:{ok:true}}}); document.dispatchEvent(new Event('visibilitychange')); }, id);
  await d.waitForTimeout(1200);
  console.log('new one pops up:', JSON.stringify(await nw()), '| highlighted:', !!(await d.$('#inbox .nwx.pop')), '| message:', await d.$eval('#toast', e => e.textContent));
  await d.click('#inbox .nwx [data-nwgo]'); await d.waitForTimeout(1300);
  console.log('"Protokoll" → analytics on the job-done tab:', await d.evaluate(() => location.hash.replace(/[a-z0-9]{8,}/i, '<id>')), '| tab:', await d.$eval('#rtabs .on', e => e.dataset.tab).catch(() => '?'));
  await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1500); console.log('opened = read:', (await nw()).length === 0);
  // one approval waiting → straight into the approval dialog
  const t1 = await d.$('#todo[data-r1]'); if(t1){ await t1.click(); await d.waitForTimeout(1600); console.log('one approval → editor with the dialog open:', !!(await d.$('.modal .approve-box')), '|', await d.evaluate(() => location.hash.split('/')[1])); } else console.log('one approval → (no single approval in this mock)');
  await ctx.close(); }

// ---- 6. version on the sign-in page ----
if(want('login')){ const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true});
  await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_nosess','1'); });
  const d = await ctx.newPage(); d.on('pageerror', e => errs.push('login: '+e.message)); await d.goto(BASE+'/index3.html'); await d.waitForTimeout(1800);
  console.log('version on the sign-in page:', await d.$eval('#l-ver', e => e.textContent).catch(() => 'missing'), '| = app version:', await d.evaluate(() => (document.querySelector('#l-ver')||{}).textContent === 'v' + window.APP_VERSION));
  await ctx.close(); }

// ---- 7. the approved version stays live while the next one is edited (v015) – and what happens without v015 ----
if(want('live')){ await fetch(BASE+'/__db', {method:'DELETE'});
  const mk = async (signedIn, noLive) => { const c = await browser.newContext({viewport:{width:1280,height:860}}); await c.addInitScript(([si, nl]) => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_shared','1'); sessionStorage.setItem('gg_inst_hide','1'); if(!si) localStorage.setItem('gg_nosess','1'); if(nl) window.__noLive = true; }, [signedIn, noLive]); return c; };
  const ed = await (await mk(true, false)).newPage(); ed.on('pageerror', e => errs.push('live editor: '+e.message)); await ed.goto(BASE+'/index3.html'); await ed.waitForTimeout(2500);
  const db = async () => (await (await fetch(BASE+'/__db')).json()).db;
  const id = (await db()).instructions[0].id; const row = async () => (await db()).instructions.find(x => x.id === id);
  await ed.goto(BASE+'/index3.html#/edit/'+id); await ed.waitForTimeout(1800);
  await ed.click('#cta'); await ed.waitForTimeout(400); await ed.click('.modal #ap-subok'); await ed.waitForTimeout(600); await ed.click('.modal #ap-both'); await ed.waitForTimeout(900); await ed.click('.modal [data-x]'); await ed.waitForTimeout(1500);
  const r1 = await row(); console.log('published v1 → live snapshot stored:', !!(r1.data.live && r1.data.live.version === 1 && r1.data.live.steps.length), '| status:', r1.status);
  const key = r1.data.shareKey; const first = r1.data.steps.filter(x => !x.kind)[0]; const oldTitle = first.title;
  // a worker without login opens the QR link
  const wk = await (await mk(false, false)).newPage(); wk.on('pageerror', e => errs.push('live worker: '+e.message));
  const workerSees = async () => { await wk.goto(BASE+'/index3.html#/v/'+id+'/'+key); await wk.reload(); await wk.waitForTimeout(2200); return wk.evaluate(() => { const b = document.body.innerText; return {is404: /\b404\b/.test(b) || /noch nicht veröffentlicht/i.test(b), text: b}; }); };
  const w1 = await workerSees(); console.log('worker before the change: opens:', !w1.is404, '| sees step 1:', w1.text.includes(oldTitle.replace(/\*\*|==/g, '').slice(0, 12)));
  // the creator changes step 1 → the next version starts
  await ed.click(`.srow[data-id="${first.id}"]`); await ed.waitForTimeout(500); await ed.fill('#stitle', 'GEÄNDERTER SCHRITT'); await ed.waitForTimeout(2600);
  const r2 = await row(); console.log('after the change: status', r2.status, '| live kept:', !!(r2.data.live && r2.data.live.version === 1), '| message:', await ed.$eval('#toast', e => e.textContent));
  console.log('editor shows "v1 live" + banner:', await ed.$eval('#livepill', e => e.hidden ? 'hidden' : e.textContent), '|', await ed.$eval('#live-banner', e => e.hidden ? 'hidden' : e.textContent.trim()));
  const w2 = await workerSees(); console.log('worker during the revision: opens:', !w2.is404, '| still the approved step:', w2.text.includes(oldTitle.replace(/\*\*|==/g, '').slice(0, 12)), '| no draft text:', !w2.text.includes('GEÄNDERTER SCHRITT'));
  await ed.goto(BASE+'/index3.html#/preview/'+id); await ed.waitForTimeout(1800); console.log('creator preview shows the draft:', (await ed.evaluate(() => document.body.innerText)).includes('GEÄNDERTER SCHRITT'));
  await ed.goto(BASE+'/index3.html#/'); await ed.waitForTimeout(1500); console.log('start page card:', await ed.$eval(`[data-sid="${id}"] .meta`, e => e.textContent.replace(/\s+/g,' ').trim().slice(0, 60)).catch(() => '?'));
  await ed.screenshot({path: OUT+'/shots/r51-live-card.png'});
  // approve the next version → workers get it
  await ed.goto(BASE+'/index3.html#/edit/'+id); await ed.waitForTimeout(1600); await ed.click('#cta'); await ed.waitForTimeout(400); await ed.click('.modal #ap-subok'); await ed.waitForTimeout(600); await ed.click('.modal #ap-both'); await ed.waitForTimeout(900); await ed.click('.modal [data-x]'); await ed.waitForTimeout(1500);
  const r3 = await row(); const w3 = await workerSees(); console.log('approved v2 → live v' + (r3.data.live && r3.data.live.version), '| worker sees the new step:', w3.text.includes('GEÄNDERTER SCHRITT'));
  // without v015: no snapshot is written, the editor warns, editing takes it offline (as before)
  await fetch(BASE+'/__db', {method:'DELETE'});
  const ed2 = await (await mk(true, true)).newPage(); ed2.on('pageerror', e => errs.push('nolive editor: '+e.message)); await ed2.goto(BASE+'/index3.html'); await ed2.waitForTimeout(2500);
  const id2 = (await db()).instructions[0].id; const row2 = async () => (await db()).instructions.find(x => x.id === id2);
  await ed2.goto(BASE+'/index3.html#/edit/'+id2); await ed2.waitForTimeout(1800);
  await ed2.click('#cta'); await ed2.waitForTimeout(400); await ed2.click('.modal #ap-subok'); await ed2.waitForTimeout(600); await ed2.click('.modal #ap-both'); await ed2.waitForTimeout(900); await ed2.click('.modal [data-x]'); await ed2.waitForTimeout(1500);
  const n1 = await row2(); console.log('without v015: published, no snapshot:', n1.status === 'published' && !n1.data.live, '| warning in the editor:', await ed2.$eval('#live-banner', e => e.hidden ? 'none' : e.textContent.trim().slice(0, 60)));
  const f2 = (await row2()).data.steps.filter(x => !x.kind)[0]; await ed2.click(`.srow[data-id="${f2.id}"]`); await ed2.waitForTimeout(400); await ed2.fill('#stitle', 'ANDERS'); await ed2.waitForTimeout(2600);
  console.log('without v015, after a change: message:', await ed2.$eval('#toast', e => e.textContent));
  await ctxClose(); }
async function ctxClose(){ for(const c of browser.contexts()) await c.close().catch(() => {}); }

console.log(errs.join('\n') || 'NO ERRORS'); await browser.close();
