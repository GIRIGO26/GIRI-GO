import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
import fs from 'fs';
// mock is built by build_mock.mjs (single source of truth)

const browser = await chromium.launch(launchArgs([]));
const ctx = await browser.newContext({viewport:{width:1280,height:800}});
const page = await ctx.newPage(); const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
page.on('console', m => { if(m.type()==='error' && !m.text().includes('ERR_TUNNEL') && !m.text().includes('net::')) errs.push(m.text()); });
await page.goto(BASE+'/index3.html'); await page.waitForTimeout(2500);
await page.screenshot({path:OUT+'/e1-projects.png'});
// new project via card, then project page
await page.click('#dnav [data-fadd]'); await page.waitForTimeout(300); await page.fill('#pm-in', 'Testprojekt'); await page.click('[data-ok]'); await page.waitForTimeout(900);
console.log('hash after new project:', await page.evaluate(()=>location.hash));
await page.screenshot({path:OUT+'/e2-project-empty.png'});
await page.click('#new'); await page.waitForTimeout(300); await page.fill('#ni-t', 'Anleitung im Projekt'); await page.click('.modal [data-ok]'); await page.waitForTimeout(800);
console.log('hash after new instr:', await page.evaluate(()=>location.hash), 'folder:', await page.evaluate(()=>window.__tables.instructions.map(r=>r.data.folder)));
await page.goto(BASE+'/index3.html#/'); await page.waitForTimeout(1000); await page.screenshot({path:OUT+'/e3-all.png'});
const id0 = await page.evaluate(()=>window.__tables.instructions[0].id);
await page.click(`[data-sid="${id0}"] [data-a="more"]`); await page.waitForTimeout(300); await page.click('[data-m="folder"]'); await page.waitForTimeout(300); await page.click('[data-fid="f2"]'); await page.waitForTimeout(600);
console.log('folder set:', await page.evaluate(()=>window.__tables.instructions[0].data.folder));
await page.click('#dnav a[data-f="f2"]'); await page.waitForTimeout(1000); await page.screenshot({path:OUT+'/e4-project.png'});
console.log('folder view:', await page.$eval('.dash h1', e => e.textContent.trim()), '| cards:', await page.$$eval('.card.instr', x => x.length));
// editor: rich text + rotation + emoji picker
await page.click(`[data-sid="${id0}"] .title`); await page.waitForTimeout(1200);
{ const tb = await page.$('[data-tab=\"steps\"]'); if(tb && await tb.isVisible()) await tb.click(); } await page.waitForTimeout(200);
await page.fill('#sdesc', 'Drehmoment **10 Nm**\n- Schraube ==M6== einsetzen'); await page.waitForTimeout(500);
await page.click('#symdock [data-tab="mark"]'); await page.waitForTimeout(200); await page.click('[data-tool="rect"]'); await page.waitForTimeout(200); await page.keyboard.press(']'); await page.keyboard.press('+'); await page.waitForTimeout(200);
await page.click('#symdock [data-tab="emoji"]'); await page.waitForTimeout(300); await page.screenshot({path:OUT+'/e5-emoji.png'});
await page.selectOption('#symdock .ss-grp select', '6'); await page.waitForTimeout(300); await page.screenshot({path:OUT+'/e6-emoji-objects.png'});
await page.fill('#symdock #ss-q', 'wrench'); await page.waitForTimeout(400); await page.screenshot({path:OUT+'/e7-emoji-search.png'});
const hits = await page.evaluate(()=>[...document.querySelectorAll('#symdock [data-e]')].map(b=>b.dataset.e)); console.log('wrench hits:', hits.join(' '));
await page.click('#symdock [data-e]'); await page.waitForTimeout(400);
await page.screenshot({path:OUT+'/e8-editor.png', fullPage:true});
// stats with filter
await page.evaluate(()=>{ const id = window.__tables.instructions[0].id; for(let k=0;k<25;k++){ window.__tables.views.push({id:'v'+k, instr_id:id, ws:'ar-giri.com', started_at:new Date(Date.now()-k*7e7).toISOString(), duration_s:30+k, completed:k%3===0, reload:k%5===0, steps_seen:3, steps_total:5, device:'iOS'}); } window.__tables.instr_stats.push({instr_id:id, ws:'ar-giri.com', views:25, reloads:5, avg_duration_s:42, completed:8, avg_steps_seen:3.2}); window.__tables.runs.push({id:'r1', instr_id:id, ws:'ar-giri.com', worker:'Anna', version:1, started_at:new Date(Date.now()-3e5).toISOString(), finished_at:null, items:{x:{ok:true, at:Date.now()-1e5}}}); });
await page.goto(BASE+'/index3.html#/stats'); await page.waitForTimeout(1500); await page.screenshot({path:OUT+'/e9-stats.png', fullPage:true});
await page.selectOption('#ifilter', {index:1}); await page.waitForTimeout(500); await page.screenshot({path:OUT+'/e10-stats-filter.png', fullPage:true});
await page.click('[data-tab="runs"]'); await page.waitForTimeout(300); await page.screenshot({path:OUT+'/e11-stats-runs.png'});
await page.goto(BASE+'/index3.html#/results/'+(await page.evaluate(()=>window.__tables.instructions[0].id))); await page.waitForTimeout(1500); await page.screenshot({path:OUT+'/e12-results.png', fullPage:true});
// admin
await page.goto(BASE+'/index3.html#/admin'); await page.waitForTimeout(1500); await page.screenshot({path:OUT+'/e13-admin.png', fullPage:true});
// mobile viewer: checklist → run upsert while in progress, language switch, resume
const m = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
const mp = await m.newPage();
mp.on('pageerror', e => errs.push('MOBILE PAGEERROR: '+e.message+' '+(e.stack||'').split('\n').slice(0,3).join(' | ')));
await mp.goto(BASE+'/index3.html'); await mp.waitForTimeout(2500);
await mp.evaluate(()=>{ const r = window.__tables.instructions[0]; r.status='published'; r.data.checklist = true; });
const vid = await mp.evaluate(()=>window.__tables.instructions[0].id);
await mp.goto(BASE+'/index3.html#/v/'+vid); await mp.waitForTimeout(1500);
{ const b = await mp.$('#ov-start'); if(b){ await b.click(); await mp.waitForTimeout(400); } }
await mp.fill('#wname', 'Anna'); await mp.click('#begin'); await mp.waitForTimeout(500);
await mp.click('[data-ok]'); await mp.waitForTimeout(1200);
console.log('runs in db:', JSON.stringify(await mp.evaluate(()=>window.__tables.runs.map(r=>({w:r.worker, fin:r.finished_at, n:Object.keys(r.items).length})))));
await mp.click('#langbtn'); await mp.waitForTimeout(300); await mp.click('[data-l="PL"]'); await mp.waitForTimeout(1200); await mp.screenshot({path:OUT+'/e14-viewer-pl.png'});
await mp.evaluate(()=>{ const vs=document.querySelector('#vs'); vs.scrollTo(0, vs.scrollHeight); }); await mp.waitForTimeout(800); await mp.click('#finish2'); await mp.waitForTimeout(1000);
console.log('runs after finish:', JSON.stringify(await mp.evaluate(()=>window.__tables.runs.map(r=>({w:r.worker, fin:!!r.finished_at, n:Object.keys(r.items).length})))));
await mp.screenshot({path:OUT+'/e15-finished.png'});
await mp.evaluate(()=>{ localStorage.setItem('gg_vlang',''); });
await mp.goto(BASE+'/index3.html#/'); await mp.waitForTimeout(1200); await mp.screenshot({path:OUT+'/e16-dash-mobile.png', fullPage:true});
await mp.goto(BASE+'/index3.html#/p/f2'); await mp.waitForTimeout(1200); await mp.screenshot({path:OUT+'/e17-project-mobile.png', fullPage:true});
const sw2 = await mp.evaluate(()=>document.documentElement.scrollWidth+'/'+window.innerWidth);
console.log('mobile scrollWidth/innerWidth', sw2);
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
