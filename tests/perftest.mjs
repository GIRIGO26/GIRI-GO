// load performance: after the first load only id+updated_at is asked for (delta sync); posters move from the row into Storage
import { chromium } from 'playwright'; import { BASE, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = []; const ctx = await browser.newContext({viewport:{width:1366,height:900}}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_dash','all'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2500);
const png = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
// legacy row: posters as data URLs, media already uploaded
await d.evaluate(png => { const r = window.__tables.instructions[0]; r.data.steps.forEach(s => { if(s.kind) return; s.mediaUrl = 'https://x/m/'+s.mediaId+'.jpg'; s.poster = png; }); r.updated_at = new Date(Date.now()+1000).toISOString(); window.__sel = []; }, png);
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(5000);
const sel1 = await d.evaluate(() => window.__sel.filter(x => x.startsWith('instructions')));
console.log('selects on changed row:', JSON.stringify(sel1));
console.log('posters migrated:', JSON.stringify(await d.evaluate(() => { const r = window.__tables.instructions[0]; const st = r.data.steps.filter(s=>!s.kind); return {withUrl: st.filter(s=>s.posterUrl).length, withData: st.filter(s=>s.poster).length, total: st.length, size: JSON.stringify(r.data).length}; })));
await d.evaluate(() => { window.__sel = []; }); await d.goto(BASE+'/index3.html#/stats'); await d.waitForTimeout(800); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1200);
const sel2 = await d.evaluate(() => window.__sel.filter(x => x.startsWith('instructions')));
console.log('selects when nothing changed:', JSON.stringify(sel2), 'full rows fetched:', sel2.filter(x => x==='instructions:*').length);
console.log('thumbs use posterUrl:', await d.$$eval('.instr .thumb', x => x.filter(e => /^https:\/\/x\//.test(e.src) || e.src.includes('.poster.jpg')).length));
// v0.29: a cold start (page reload) draws the local mirror at once ("lokal"), the dashboard never waits for the stats queries
await d.reload(); await d.waitForTimeout(2500);
const first = await d.evaluate(() => (window.__perfLog||[])[0]);
console.log('cold start mode:', first && first.mode, '| total', first && first.total, 'ms | cards:', await d.$$eval('.card.instr', x => x.length), '| stat slots:', await d.$$eval('[data-stx]', x => x.length));
// telemetry is present and quiet: no rows sent for a fast start, error hook installed
console.log('telemetry hooks:', await d.evaluate(() => typeof window.onerror !== 'undefined'), '| perf entries:', await d.evaluate(() => (window.__perfLog||[]).length));
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
