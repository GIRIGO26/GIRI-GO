// v0.32 – import from GIRI Classic: connect (wrong + right password), tree, import of 3 instructions (chapters, loose step,
// quality variants, hidden step, icons → symbols, published stays published, too-large media → empty step), re-entry marks done
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const page = await (await browser.newContext({viewport:{width:1100,height:1000}})).newPage(); const errs=[];
page.on('pageerror', e => errs.push(e.message+' '+(e.stack||'').split('\n').slice(0,3).join('|')));
await page.goto(BASE+'/index3.html'); await page.waitForTimeout(1800);
// entry points: admin card + dashboard ⋯ menu
await page.goto(BASE+'/index3.html#/admin'); await page.waitForTimeout(900);
console.log('admin card:', await page.evaluate(()=>!!document.querySelector('#imp-card') && document.querySelector('#imp-card h3').textContent.trim()));
await page.click('#imp-open'); await page.waitForTimeout(700);
console.log('route:', await page.evaluate(()=>location.hash), '| server default:', await page.inputValue('#imp-srv'));
await page.goto(BASE+'/index3.html#/'); await page.waitForTimeout(700); await page.click('#tbmenu'); await page.waitForTimeout(200);
console.log('dash menu entry:', await page.evaluate(()=>!!document.querySelector('[data-m="import"]'))); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.goto(BASE+'/index3.html#/admin/import'); await page.waitForTimeout(700);
// wrong password → readable error, no tree
await page.fill('#imp-mail', 'bjoern@ar-giri.com'); await page.fill('#imp-pw', 'falsch'); await page.click('#imp-go'); await page.waitForTimeout(500);
console.log('wrong pw:', await page.textContent('#imp-cstat'), '| select hidden:', await page.evaluate(()=>document.querySelector('#imp-select').hidden));
// http server refused
await page.fill('#imp-srv', 'http://ar-giri.rocks'); await page.fill('#imp-pw', 'geheim'); await page.click('#imp-go'); await page.waitForTimeout(500);
console.log('http server:', await page.textContent('#imp-cstat'));
// connect
await page.fill('#imp-srv', 'https://ar-giri.rocks/'); await page.fill('#imp-pw', 'geheim'); await page.click('#imp-go'); await page.waitForTimeout(900);
console.log('connected:', await page.textContent('#imp-cstat'), '| pw cleared:', (await page.inputValue('#imp-pw'))==='');
console.log('tree groups:', await page.evaluate(()=>[...document.querySelectorAll('.imp-gh b')].map(b=>b.textContent.trim()).join(' / ')), '| items:', await page.evaluate(()=>document.querySelectorAll('.imp-it').length), '| checked:', await page.evaluate(()=>document.querySelectorAll('.imp-it input:checked').length));
console.log('run btn:', await page.textContent('#imp-run'), '| server sent:', await page.evaluate(()=>window.__imp[0].server));
// v0.33 list features: meta line (date · team · creator/approver), older versions hidden, sort, search, collapse, all/none
console.log('meta lines:', await page.evaluate(()=>[...document.querySelectorAll('.imp-sub')].map(e=>e.textContent).join(' | ')));
console.log('older-version chip:', await page.evaluate(()=>[...document.querySelectorAll('.imp-it')].filter(e=>/ältere|older/i.test(e.textContent)).map(e=>e.querySelector('.imp-name').textContent).join(',')), '| items:', await page.evaluate(()=>document.querySelectorAll('.imp-it').length));
await page.check('#imp-oldv'); await page.waitForTimeout(150); console.log('with old versions:', await page.evaluate(()=>document.querySelectorAll('.imp-it').length), '| v1 checked by default:', await page.evaluate(()=>document.querySelector('input[data-id="C1"]').checked)); await page.uncheck('#imp-oldv'); await page.waitForTimeout(150);
await page.selectOption('#imp-sort', 'new'); await page.waitForTimeout(150); console.log('sorted newest first:', await page.evaluate(()=>[...document.querySelectorAll('.imp-name')].map(e=>e.textContent).join(' > ')));
await page.selectOption('#imp-sort', 'name'); await page.fill('#imp-q', 'karton'); await page.waitForTimeout(200); console.log('search karton:', await page.evaluate(()=>document.querySelectorAll('.imp-it').length), '| run btn:', await page.textContent('#imp-run')); await page.fill('#imp-q', ''); await page.waitForTimeout(200);
await page.click('[data-tg="p1"]'); await page.waitForTimeout(100); console.log('collapsed p1:', await page.evaluate(()=>document.querySelector('.imp-grp[data-g="p1"]').classList.contains('coll') && getComputedStyle(document.querySelector('.imp-grp[data-g="p1"] .imp-items')).display==='none')); await page.click('[data-tg="p1"]'); await page.waitForTimeout(100);
await page.click('#imp-none'); await page.waitForTimeout(100); console.log('none:', await page.textContent('#imp-selstat'), '| disabled:', await page.evaluate(()=>document.querySelector('#imp-run').disabled)); await page.click('#imp-all'); await page.waitForTimeout(100); console.log('all:', await page.textContent('#imp-selstat'));
await page.screenshot({path:OUT+'/mig1-tree.png', fullPage:true});
// v0.34 structure: users → roles/invites, teams with members, projects → folders with team access
for(let k=0;k<20;k++){ await page.waitForTimeout(200); if(await page.evaluate(()=>!document.querySelector('#imp-st-run').hidden)) break; }
console.log('structure chip:', await page.textContent('#imp-st-chip'), '| body:', (await page.textContent('#imp-st-body')).replace(/\s+/g,' ').slice(0, 260));
await page.click('#imp-st-run'); for(let k=0;k<30;k++){ await page.waitForTimeout(200); if(/✓/.test(await page.textContent('#imp-st-stat'))) break; }
console.log('structure result:', (await page.textContent('#imp-st-stat')).trim());
console.log('structure tables:', await page.evaluate(()=>{ const ws = window.__tables.workspaces[0]; const anna = window.__tables.profiles.find(p=>p.email==='anna@ar-giri.com'); return JSON.stringify({teams: ws.teams.map(t=>t.name+':'+t.members.map(m=>m.email.split('@')[0]+'='+m.role).join('+')+(t.oldId?'#'+t.oldId:'')), folders: ws.folders.map(f=>f.name+(f.oldId?'#'+f.oldId:'')+'→'+f.teams.map(id => (ws.teams.find(t=>t.id===id)||{}).name).join('/')), invites: ws.invites.map(i=>i.email.split('@')[0]+'='+i.role), anna: anna.role}); }));
await page.screenshot({path:OUT+'/mig0-structure.png', fullPage:true});
// group toggle
await page.click('.imp-gh input[data-grp="p1"]'); await page.waitForTimeout(100); console.log('after group off:', await page.textContent('#imp-selstat')); await page.click('.imp-gh input[data-grp="p1"]'); await page.waitForTimeout(100);
// import all three
await page.click('#imp-run'); for(let k=0;k<60;k++){ await page.waitForTimeout(500); if(await page.evaluate(()=>!document.querySelector('#imp-end').hidden)) break; }
console.log('rows:', await page.evaluate(()=>[...document.querySelectorAll('.imp-row')].map(r=>r.querySelector('b').textContent+' → '+r.querySelector('.imp-st').textContent.trim()).join(' | ')));
await page.screenshot({path:OUT+'/mig2-done.png', fullPage:true});
const res = await page.evaluate(()=>{ const T = window.__tables; const rows = T.instructions.filter(r => r.data.source && r.data.source.kind==='giri-classic'); const ws = T.workspaces[0];
  const A = rows.find(r=>r.data.source.oldId==='A'), B = rows.find(r=>r.data.source.oldId==='B'), C = rows.find(r=>r.data.source.oldId==='C');
  const seq = r => r.data.steps.map(s => s.kind==='chapter' ? '['+s.title+']' : s.type+':'+s.title).join(', ');
  return { n: rows.length, A: A && {status:A.status, version:A.data.version, folder:A.data.folder, seq:seq(A), appr:A.data.approvals, hist:A.data.history.length, note:(A.data.history[0]||{}).note, ann:(A.data.steps.find(s=>s.title==='Box öffnen')||{}).ann, video:A.data.steps.find(s=>s.type==='video'), photo:A.data.steps.find(s=>s.type==='photo'), src:A.data.source, created:A.data.createdAt},
    B: B && {status:B.status, version:B.data.version, folder:B.data.folder, seq:seq(B), hist:B.data.history.length, ann2:(B.data.steps[1].ann||[]).length},
    C: C && {status:C.status, folder:C.data.folder, seq:seq(C), appr:C.data.approvals},
    folders: ws.folders.map(f=>f.name), symbols: (ws.symbols||[]).map(s=>s.name+':'+s.oldId+':'+s.path), copies: window.__copies, tokenLeak: Object.keys(localStorage).some(k => String(localStorage.getItem(k)).includes('old-session-token')) || Object.keys(sessionStorage).some(k => String(sessionStorage.getItem(k)).includes('old-session-token')),
    inMem: window.__tables.instructions.length }; });
console.log('imported rows:', res.n, '| folders:', res.folders.join(','), '| symbols:', res.symbols.join(';'), '| token in storage:', res.tokenLeak);
console.log('A:', res.A.status, 'v'+res.A.version, 'folder='+res.A.folder, '| teams:', await page.evaluate(()=>{ const ws = window.__tables.workspaces[0]; const A = window.__tables.instructions.find(r=>r.data.source && r.data.source.oldId==='A'); return (A.data.teams||[]).map(id => (ws.teams.find(t=>t.id===id)||{}).name).join(','); }), '| seq:', res.A.seq);
console.log('A approvals:', JSON.stringify(res.A.appr), '| history:', res.A.hist, res.A.note, '| createdAt:', new Date(res.A.created).toISOString().slice(0,10));
console.log('A sticker:', JSON.stringify((res.A.ann||[]).map(a=>[a.type, a.style, a.name])), '| video:', res.A.video && [res.A.video.w+'x'+res.A.video.h, 'd='+res.A.video.duration, 'te='+res.A.video.trimEnd, res.A.video.mediaPath, 'poster='+(res.A.video.posterUrl?'yes':'no')].join(' '), '| photo:', res.A.photo && [res.A.photo.w+'x'+res.A.photo.h, res.A.photo.mediaPath, 'poster='+(res.A.photo.posterUrl?'yes':'no')].join(' '));
console.log('B:', res.B.status, 'v'+res.B.version, 'folder='+res.B.folder, '| seq:', res.B.seq, '| hist:', res.B.hist, '| shared symbol on step 2:', res.B.ann2);
console.log('C:', res.C.status, 'folder='+res.C.folder, '| seq:', res.C.seq, '| appr by:', res.C.appr.tech && res.C.appr.tech.by);
console.log('C robustness:', await page.evaluate(()=>{ const C = window.__tables.instructions.find(r=>r.data.source && r.data.source.oldId==='C'); return C.data.steps.map(s => s.title+':'+s.type+(s.origin && s.origin.failed ? '('+s.origin.failed+')' : '')).join(' | ') + ' · copy attempts flaky=' + window.__flaky + ' · total copies=' + window.__imp.filter(x=>x.action==='copy').length; }));
console.log('copies:', res.copies.length, res.copies.join(' '));
const pat = await page.evaluate(()=>{ const T = window.__tables; const A = T.instructions.find(r=>r.data.source && r.data.source.oldId==='A'), B = T.instructions.find(r=>r.data.source && r.data.source.oldId==='B');
  const parts = A.data.steps.filter(s => s.origin && s.origin.step==='s5'); const tz = B.data.steps.filter(s => s.origin && s.origin.step==='b3'); const cap = B.data.steps.find(s => s.origin && s.origin.step==='b4');
  return {vn: parts.map(s => s.title+' ['+s.origin.slot+'/'+s.origin.of+' '+s.origin.label+'] desc='+s.desc+' ann='+s.ann.length+' media='+s.mediaPath.split('/').pop().replace(/\..*/, '').length), tz: tz.map(s => s.title+' ['+s.origin.label+'] desc='+s.desc), cap: cap && cap.title+' ['+JSON.stringify(cap.origin)+']', plain: A.data.steps.find(s => s.title==='Box öffnen').origin}; });
console.log('pattern Vorher/Nachher:', pat.vn.join(' | ')); console.log('pattern slug fallback:', pat.tz.join(' | ')); console.log('pattern caption (placeholder → none):', pat.cap, '| plain origin:', JSON.stringify(pat.plain));
console.log('v12.37.1 placeholder slots:', await page.evaluate(()=>{ const B = window.__tables.instructions.find(r=>r.data.source && r.data.source.oldId==='B'); const f = B.data.steps.filter(s => s.origin && s.origin.step==='b6'); return f.length + ' step(s) from b6: ' + f.map(s => '"'+s.title+'"'+(s.type==='empty'?' EMPTY':'')).join(', ') + ' | blank b7 dropped: ' + !B.data.steps.some(s => s.origin && s.origin.step==='b7') + ' | date kept: ' + (B.updated_at.startsWith('2025-02-01') ? 'OK '+B.updated_at.slice(0,10) : 'NO '+B.updated_at); }));
console.log('numeric slots + html desc:', await page.evaluate(()=>{ const B = window.__tables.instructions.find(r=>r.data.source && r.data.source.oldId==='B'); return B.data.steps.filter(s => s.origin && (s.origin.step==='b5' || s.origin.step==='b4')).map(s => s.title + ' | ' + JSON.stringify(s.desc)).join('  ||  '); }));
// re-entry: "import more" → all three marked done and unchecked
await page.click('#imp-more'); await page.waitForTimeout(300);
console.log('re-entry done marks:', await page.evaluate(()=>document.querySelectorAll('.imp-it.done').length), '| checked:', await page.evaluate(()=>document.querySelectorAll('.imp-it input:checked').length), '| run disabled:', await page.evaluate(()=>document.querySelector('#imp-run').disabled));
// the imported instruction opens in the editor and on the dashboard
await page.goto(BASE+'/index3.html#/'); await page.waitForTimeout(900);
console.log('dashboard cards with import:', await page.evaluate(()=>[...document.querySelectorAll('.card.instr .title')].map(t=>t.textContent.trim()).filter(t=>/Spannvorrichtung|Karton|Großes/.test(t)).length));
const aid = await page.evaluate(()=>window.__tables.instructions.find(r=>r.data.source && r.data.source.oldId==='A').id);
await page.goto(BASE+'/index3.html#/edit/'+aid); await page.waitForTimeout(1500); { const tb = await page.$('[data-tab="steps"]'); if(tb && await tb.isVisible()) await tb.click(); } await page.waitForTimeout(300);
console.log('editor rows:', await page.evaluate(()=>document.querySelectorAll('.srow').length+' steps, '+document.querySelectorAll('.chrow').length+' chapters'), '| title:', await page.inputValue('#ititle'));
await page.screenshot({path:OUT+'/mig3-editor.png', fullPage:true});
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
