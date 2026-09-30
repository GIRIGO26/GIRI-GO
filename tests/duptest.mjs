// v12.47 – duplicate an instruction from the card menu and from the editor: new ids, draft without approvals/history/link key,
// media copied inside the bucket into the copy's own folder (retakes/deletions of the original cannot hit the copy)
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = []; const ctx = await browser.newContext({viewport:{width:1366,height:900}});
await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_dash','all'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200);
const src = await d.evaluate(() => { const r = window.__tables.instructions[0]; r.status = 'published'; r.data.status = 'published'; r.data.approvals = {tech:{by:'X', at:1}, dsgvo:{by:'Y', at:2}}; r.data.history = [{version:1}]; r.data.steps.filter(s=>!s.kind).forEach((s, i) => { s.mediaUrl = 'https://hcomtmogkuxxchrnticq.supabase.co/storage/v1/object/public/media/ar-giri.com/'+r.id+'/m'+i+'.mp4'; s.mediaPath = 'ar-giri.com/'+r.id+'/m'+i+'.mp4'; s.posterUrl = 'https://hcomtmogkuxxchrnticq.supabase.co/storage/v1/object/public/media/ar-giri.com/'+r.id+'/m'+i+'.poster.jpg'; }); return {id:r.id, title:r.title, steps:r.data.steps.length, n:window.__tables.instructions.length}; });
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1500);
await d.click(`[data-sid="${src.id}"] [data-a="more"]`); await d.waitForTimeout(400);
console.log('menu has Duplizieren:', !!(await d.$('.modal-bg [data-m="dup"]')));
await d.click('.modal-bg [data-m="dup"]'); await d.waitForTimeout(2500);
const res = await d.evaluate(src => { const rows = window.__tables.instructions; const c = rows.find(r => r.id !== src.id && r.title.startsWith('Kopie von')); if(!c) return {copy:null}; const o = rows.find(r => r.id===src.id); const st = c.data.steps.filter(s=>!s.kind); return {copy:c.title, status:c.status, approvals:c.data.approvals, history:(c.data.history||[]).length, keyDiffers:c.data.shareKey !== o.data.shareKey, steps:c.data.steps.length, idsDiffer: st.every((s,i) => s.id !== o.data.steps.filter(x=>!x.kind)[i].id && s.mediaId !== o.data.steps.filter(x=>!x.kind)[i].mediaId), pathsInCopyFolder: st.every(s => s.mediaPath.startsWith('ar-giri.com/'+c.id+'/')), posterInCopyFolder: st.every(s => s.posterUrl.includes('/'+c.id+'/')), copied: (window.__copied||[]).length, source: c.data.source && c.data.source.of === src.id, hash: location.hash.split('/')[1] === c.id ? 'editor opened' : location.hash}; }, src);
console.log('copy:', JSON.stringify(res));
console.log('original untouched:', await d.evaluate(src => { const o = window.__tables.instructions.find(r => r.id===src.id); return o.status==='published' && o.data.steps.length===src.steps; }, src));
// from the editor menu too
await d.goto(BASE+'/index3.html#/edit/'+src.id); await d.waitForTimeout(1500); await d.click('#more'); await d.waitForTimeout(300); console.log('editor menu has Duplizieren:', !!(await d.$('.modal-bg [data-m="dup"]')));
await d.screenshot({path:OUT+'/shots/dup-menu.png'});
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
