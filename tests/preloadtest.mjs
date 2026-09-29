// v12.46 – editor media cache: the clips of the opened instruction are fetched in the background (PC: all, current step last;
// phone: only the next two), stored with cache:true, the rows get a dot, switching steps then plays a blob: URL; pruning drops
// entries older than 14 days but keeps clips a worker's offline copy still uses
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = []; const clip = readFileSync(TESTS + '/test.webm'); const served = [];
const route = async ctx => { await ctx.route('https://x/m/**', r => { served.push(r.request().url().split('/').pop()); r.fulfill({status:200, contentType:'video/webm', body:clip, headers:{'access-control-allow-origin':'*'}}); }); };
// ---- PC ----
const ctx = await browser.newContext({viewport:{width:1366,height:900}}); await route(ctx);
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(1800);
const id = await d.evaluate(() => { const r = window.__tables.instructions[0]; r.data.steps.filter(s => !s.kind).forEach((s, i) => { s.type = 'video'; s.duration = 2; s.mediaId = 'pre' + i; s.mediaUrl = 'https://x/m/pre' + i + '.webm'; }); return r.id; });
await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(1500);
const first = await d.evaluate(() => document.querySelector('.srow.sel').dataset.id);
console.log('stage src before cache:', await d.$eval('#med', e => e.src.split(':')[0]));
await d.waitForTimeout(6000);
console.log('served order:', served.join(' '), '| current step served last:', served.at(-1) === (await d.evaluate(s => window.__tables.instructions[0].data.steps.find(x => x.id===s).mediaId, first)) + '.webm');
console.log('rows with local dot:', await d.$$eval('.srow.local', x => x.length), 'of', await d.$$eval('.srow', x => x.length));
const rows = await d.$$('.srow'); await rows[2].click(); await d.waitForTimeout(700);
console.log('stage src after cache:', await d.$eval('#med', e => e.src.split(':')[0]), '(blob = from the device)');
console.log('index entries:', await d.evaluate(() => JSON.parse(localStorage.getItem('gg_ecache')||'[]').length));
// pruning: make every entry 20 days old; one clip is also part of a worker's offline copy and must stay
const pruned = await d.evaluate(async () => { const l = JSON.parse(localStorage.getItem('gg_ecache')||'[]'); l.forEach(x => x.at = Date.now() - 20*864e5); localStorage.setItem('gg_ecache', JSON.stringify(l));
  const r = window.__tables.instructions[0]; await window.__vcachePut({id:r.id, ws:r.ws, title:r.title, instr:{id:r.id, steps:[{id:'k', mediaId:'pre1'}]}, at:Date.now(), openedAt:Date.now()});
  const n = await window.__pruneEditorCache(); const left = JSON.parse(localStorage.getItem('gg_ecache')||'[]').map(x => x.id); const has = await window.__mediaHas('pre1'), gone = await window.__mediaHas('pre0'); return {n, left, has, gone}; });
console.log('pruned:', JSON.stringify(pruned), '(pre1 kept for the offline copy, pre0 gone)');
await d.screenshot({path:OUT+'/shots/preload-pc.png'});
// ---- phone: only two clips ----
served.length = 0;
const ctx2 = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true}); await route(ctx2);
await ctx2.addInitScript(() => { localStorage.setItem('gg_lang','de'); });
const m = await ctx2.newPage(); m.on('pageerror', e => errs.push('M '+e.message));
await m.goto(BASE+'/index3.html'); await m.waitForTimeout(1800);
const id2 = await m.evaluate(() => { const r = window.__tables.instructions[0]; r.data.steps.filter(s => !s.kind).forEach((s, i) => { s.type = 'video'; s.duration = 2; s.mediaId = 'pho' + i; s.mediaUrl = 'https://x/m/pho' + i + '.webm'; }); return r.id; });
await m.goto(BASE+'/index3.html#/edit/'+id2); await m.waitForTimeout(6500);
console.log('phone served:', served.filter(x => x.startsWith('pho')).join(' '), '(expected: the two steps after the current one)');
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
