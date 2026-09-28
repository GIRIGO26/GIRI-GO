import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs=[];
const d = await (await browser.newContext({viewport:{width:1280,height:800}})).newPage(); d.on('pageerror', e => errs.push('D '+e.message));
await d.goto(BASE+'/index3.html'); await d.evaluate(()=>localStorage.setItem('gg_nosess','1')); await d.reload(); await d.waitForTimeout(1800); await d.screenshot({path:OUT+'/u1-login.png'});
await d.fill('#li-email','bjoern@ar-giri.com'); await d.click('#li-go'); await d.waitForTimeout(500); await d.screenshot({path:OUT+'/u2-login-sent.png'});
const m = await (await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true})).newPage(); m.on('pageerror', e => errs.push('M '+e.message));
await m.goto(BASE+'/index3.html'); await m.evaluate(()=>localStorage.setItem('gg_nosess','1')); await m.reload(); await m.waitForTimeout(1800); await m.screenshot({path:OUT+'/u3-login-mobile.png', fullPage:true});
await m.evaluate(()=>localStorage.removeItem('gg_nosess')); await d.evaluate(()=>localStorage.removeItem('gg_nosess'));
// editor stage on mobile with the video step
await m.goto(BASE+'/index3.html'); await m.waitForTimeout(2000);
await m.evaluate((url)=>{ const r = window.__tables.instructions[0]; r.data.steps.splice(1,0,{id:'vstep1', type:'video', mediaId:'m-vid1', mediaUrl:url, w:640, h:360, duration:4, trimStart:0, trimEnd:4, title:'Video Schritt', desc:'', warn:'', ann:[{id:'a1', type:'arrow', color:'blue', size:0.14, x:0.3,y:0.6,x2:0.6,y2:0.35, t:1.0},{id:'a2', type:'emoji', emoji:'🔧', size:0.16, x:0.7,y:0.7, t:1.05}]}); sessionStorage.setItem('gg_dash','all'); r.updated_at = new Date(Date.now()+1000).toISOString(); }, BASE+'/tests/test.webm');
await m.goto(BASE+'/index3.html#/'); await m.waitForTimeout(800); await m.click('.card.instr .title'); await m.waitForTimeout(1200); { const tb = await m.$('[data-tab=\"steps\"]'); if(tb && await tb.isVisible()) await tb.click(); } await m.waitForTimeout(200);
await m.click('.srow[data-id="vstep1"]'); await m.waitForTimeout(1500);
await m.evaluate(()=>{ const s=document.querySelector('#stage'); s.scrollIntoView(); }); await m.waitForTimeout(300);
await m.click('.ann-pill[data-id="a1"]'); await m.waitForTimeout(400);
await m.screenshot({path:OUT+'/u4-editor-mobile.png', fullPage:true});
// desktop editor stage
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2000);
await d.evaluate((url)=>{ const r = window.__tables.instructions[0]; r.data.steps.splice(1,0,{id:'vstep1', type:'video', mediaId:'m-vid1', mediaUrl:url, w:640, h:360, duration:4, trimStart:0, trimEnd:4, title:'Video Schritt', desc:'', warn:'', ann:[{id:'a1', type:'arrow', color:'blue', size:0.14, x:0.3,y:0.6,x2:0.6,y2:0.35, t:1.0},{id:'a2', type:'emoji', emoji:'🔧', size:0.16, x:0.7,y:0.7, t:1.05}]}); sessionStorage.setItem('gg_dash','all'); r.updated_at = new Date(Date.now()+1000).toISOString(); }, BASE+'/tests/test.webm');
await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(800); await d.click('.card.instr .title'); await d.waitForTimeout(1200); { const tb = await d.$('[data-tab=\"steps\"]'); if(tb && await tb.isVisible()) await tb.click(); } await d.waitForTimeout(200);
await d.click('.srow[data-id="vstep1"]'); await d.waitForTimeout(1200);
const samples = []; for(let i=0;i<20;i++){ samples.push(await d.evaluate(()=>{ const v=document.querySelector('#med'); return (v.paused?'P':'>')+v.currentTime.toFixed(2); })); await d.waitForTimeout(150); }
console.log('playback:', samples.join(' '));
await d.click('.ann-pill[data-id="a1"]'); await d.waitForTimeout(400);
await d.screenshot({path:OUT+'/u5-editor-desktop.png', fullPage:true});
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
