// v12.48.1 – two people, one instruction: Björn (browser A) and Felix (browser B) work in the same workspace at the same time.
// Both browsers share one database (mock shared mode, kept by the test server); changes reach the other browser like realtime.
// Expected: different steps/fields are merged automatically, only the same field on both sides asks; nothing is lost silently.
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([])); const errs = [];
await fetch(BASE+'/__db', {method:'DELETE'});
const mk = async uid => { const c = await browser.newContext({viewport:{width:1280,height:860}}); await c.addInitScript(u => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_shared','1'); if(u) localStorage.setItem('gg_uid', u); sessionStorage.setItem('gg_inst_hide','1'); }, uid); return c; };
const ctxA = await mk(''), ctxB = await mk('u3');
const A = await ctxA.newPage(); A.on('pageerror', e => errs.push('A '+e.message)); await A.goto(BASE+'/index3.html'); await A.waitForTimeout(2500);
const B = await ctxB.newPage(); B.on('pageerror', e => errs.push('B '+e.message)); await B.goto(BASE+'/index3.html'); await B.waitForTimeout(2500);
const db = async () => (await (await fetch(BASE+'/__db')).json()).db;
const id = (await db()).instructions[0].id;
const row = async () => (await db()).instructions.find(x => x.id===id);
const ids = async () => (await row()).data.steps.filter(s => !s.kind).map(s => s.id);
const txt = async n => { const r = await row(); const s = r.data.steps.filter(s => !s.kind)[n-1]; return s ? (s.desc||'') : '(gone)'; };
const ui = p => p.evaluate(() => (document.querySelector('.modal h2')||{}).textContent || (document.querySelector('#rt-trash') ? 'banner "moved to trash"' : document.querySelector('#rt-note') ? 'banner "changed elsewhere"' : (document.querySelector('.toast') ? 'toast: '+document.querySelector('.toast').textContent.trim() : '-')));
const open = async () => { for(const p of [A, B]){ await p.goto(BASE+'/index3.html#/edit/'+id); await p.reload(); } await A.waitForTimeout(1800); await B.waitForTimeout(1800); };
const step = async (p, n) => { await p.click(`#slist .srow[data-id="${(await ids())[n-1]}"]`); await p.waitForTimeout(300); };
const type = async (p, s, blur=true) => { await p.click('#sdesc'); await p.keyboard.press('End'); await p.keyboard.type(s); if(blur){ await p.locator('#sdesc').blur(); } await p.waitForTimeout(2500); };
const has = async (n, s) => (await txt(n)).includes(s) ? 'kept' : 'LOST';
console.log('A =', await A.evaluate(() => window.__tables.profiles.find(x => x.id==='u1').name), '| B =', await B.evaluate(() => window.__tables.profiles.find(x => x.id==='u3').name));

await open();
// 1. A renames, B only looks → B shows the new title by itself
await A.fill('#ititle', 'Titel von Björn'); await A.locator('#ititle').blur(); await A.waitForTimeout(2500);
console.log('1 rename while the other only looks: B shows', JSON.stringify(await B.$eval('#ititle', e => e.value)), '| B:', await ui(B));

// 2. same time, different steps: B types in step 2 (and autosaves), A changes step 1
await open(); await step(A, 1); await step(B, 2);
await type(B, ' FELIX-2', false); await type(A, ' BJOERN-1');
console.log('2 different steps at once: step 1 Björn', await has(1, 'BJOERN-1'), '| step 2 Felix', await has(2, 'FELIX-2'), '| A:', await ui(A), '| B:', await ui(B));
await B.locator('#sdesc').blur(); await B.waitForTimeout(2000);

// 3. same step, same field, neither sees the other (B is offline while both type) → a real conflict: the dialog asks
await open(); await step(A, 3); await step(B, 3);
await ctxB.setOffline(true); await B.evaluate(() => { window.__mockOffline = true; window.dispatchEvent(new Event('offline')); });
await type(B, ' B-3'); await type(A, ' A-3');
await ctxB.setOffline(false); await B.evaluate(() => { window.__mockOffline = false; window.dispatchEvent(new Event('online')); }); await B.waitForTimeout(4000);
const d3 = await ui(B); console.log('3 same step + field, both blind: B sees', JSON.stringify(d3), '| server still has Björn\'s', await has(3, 'A-3'));
await B.screenshot({path: OUT+'/shots/collab-conflict.png'});
if(await B.$('.modal [data-ok="mine"]')){ await B.click('.modal [data-ok="mine"]'); await B.waitForTimeout(1500); }
console.log('  B chose "my version" → step 3 =', JSON.stringify((await txt(3)).slice(-24)), '| other steps untouched: step 1', await has(1, 'BJOERN-1'));

// 4. same step, different fields: A changes the step title, B the text
await open(); await step(A, 4); await step(B, 4);
const t4 = await A.$('#stitle, .stitle, [data-f="title"]');
if(t4){ await t4.fill('Neuer Schritttitel A'); await t4.evaluate(e => e.blur()); await A.waitForTimeout(2500); }
await type(B, ' B-4');
const r4 = (await row()).data.steps.filter(s => !s.kind)[3]; console.log('4 same step, A title / B text:', t4 ? (r4.title === 'Neuer Schritttitel A' ? 'title kept' : 'title LOST') : '(no step title field)', '|', r4.desc.includes('B-4') ? 'text kept' : 'text LOST', '| B:', await ui(B));

// 5. B works offline, A changes another step online, B comes back
await open(); await step(B, 2); await step(A, 1);
await ctxB.setOffline(true); await B.evaluate(() => { window.__mockOffline = true; window.dispatchEvent(new Event('offline')); });
await type(B, ' OFFLINE-B');
await type(A, ' ONLINE-A');
await ctxB.setOffline(false); await B.evaluate(() => { window.__mockOffline = false; window.dispatchEvent(new Event('online')); }); await B.waitForTimeout(5000);
console.log('5 offline edit meets online edit: Björn online', await has(1, 'ONLINE-A'), '| Felix offline', await has(2, 'OFFLINE-B'), '| B:', await ui(B));

// 6. adding / deleting / reordering steps on both sides: see tests/mergeunit.mjs

// 7. A moves it to the trash while B still has it open and keeps typing
await open(); await step(B, 1);
await A.goto(BASE+'/index3.html#/'); await A.waitForTimeout(1500);
await A.click(`#list article.instr[data-sid="${id}"] .imore`); await A.waitForTimeout(400); await A.click('.menu [data-m="del"]'); await A.waitForTimeout(400); await A.click('.modal [data-ok]').catch(() => {}); await A.waitForTimeout(2500);
console.log('7 A trashes it while B has it open: in trash', !!(await row()).deleted_at, '| B:', await ui(B));
await type(B, ' B-7');
console.log('  B keeps typing → B:', await ui(B), '| still in trash', !!(await row()).deleted_at, '| B on', await B.evaluate(() => location.hash.replace(/[a-z0-9]{10,}/, '<id>')));
await A.evaluate(async id => {}, id);

// 8. A creates a new instruction → B's list shows it without reload
await A.goto(BASE+'/index3.html#/'); await B.goto(BASE+'/index3.html#/'); await A.waitForTimeout(1500); await B.waitForTimeout(1500);
const nb = await B.$$eval('#list article.instr', x => x.length);
await A.click('#new'); await A.waitForTimeout(300); await A.fill('#ni-t', 'Neu von Björn'); await A.click('.modal-bg [data-ok]'); await A.waitForTimeout(3000);
console.log('8 new instruction appears on B without reload:', nb, '→', await B.$$eval('#list article.instr', x => x.length));
console.log(errs.join('\n') || 'NO ERRORS'); await browser.close();
