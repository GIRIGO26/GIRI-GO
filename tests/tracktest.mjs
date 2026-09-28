// motion tracking: an arrow on a moving square follows it (editor "Mitlaufen"), the viewer draws it shifted
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = []; const ctx = await browser.newContext({viewport:{width:1280,height:800}}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_dash','all'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2500);
// video step with a white square moving right (40→250 px of 320) and an arrow whose tip sits on it at t=0.2
const url = BASE+'/tests/move.webm';
const ids = await d.evaluate(url => { const r = window.__tables.instructions[0]; const st = {id:'trkstep', type:'video', mediaId:'m-trk', mediaUrl:url, w:320, h:240, duration:3, trimStart:0, trimEnd:3, title:'Tracking', desc:'', warn:'', ann:[{id:'arr1', type:'arrow', color:'blue', size:0.14, x:0.35, y:0.75, x2:(40+0.2*70+3)/320, y2:93/240, t:0.2}]}; r.data.steps.push(st); r.updated_at = new Date(Date.now()+1000).toISOString(); return {vid:r.id}; }, url);
await d.goto(BASE+'/index3.html#/edit/'+ids.vid); await d.waitForTimeout(1500); { const tb = await d.$('[data-tab=\"steps\"]'); if(tb && await tb.isVisible()) await tb.click(); } await d.waitForTimeout(300);
await d.click('.srow[data-id="trkstep"]'); await d.waitForTimeout(1500);
await d.click('.ann-pill[data-id="arr1"]'); await d.waitForTimeout(600);
console.log('panel has track option:', !!(await d.$('[data-trk="on"]')));
await d.click('[data-trk="on"]'); await d.waitForTimeout(12000);
const res = await d.evaluate(() => { const r = window.__tables.instructions[0]; const st = r.data.steps.find(s => s.id==='trkstep'); const a = st.ann[0]; return a.track ? {n:a.track.pts.length, last:a.track.pts[a.track.pts.length-1], mid:a.track.pts[Math.floor(a.track.pts.length/2)]} : null; });
console.log('track:', JSON.stringify(res));
if(res){ const expectDx = (res.n-1)*0.1*70/320; console.log('expected dx ≈', expectDx.toFixed(3), 'got', res.last[0].toFixed(3), 'dy', res.last[1].toFixed(3), Math.abs(res.last[0]-expectDx) < 0.04 && Math.abs(res.last[1]) < 0.03 ? 'TRACK OK' : 'TRACK OFF'); }
console.log('toast:', await d.$eval('#toast', e => e.textContent), '| chip:', await d.$eval('[data-trk="on"]', e => e.textContent));
await d.screenshot({path:OUT+'/shots/trk1-editor.png'});
// viewer: at ~2 s the arrow is drawn shifted (canvas has ink right of the original tip)
await d.evaluate(() => { const r = window.__tables.instructions[0]; r.status='published'; r.data.status='published'; r.data.checklist=false; });
await d.goto(BASE+'/index3.html#/preview/'+ids.vid); await d.waitForTimeout(1200); const ov = await d.$('#ov-start'); if(ov){ await ov.click(); await d.waitForTimeout(300); }
await d.evaluate(() => { const sec = document.querySelector('.vstep[data-id="trkstep"]'); sec.scrollIntoView(); }); await d.waitForTimeout(2600);
const ink = await d.evaluate(() => { const sec = document.querySelector('.vstep[data-id="trkstep"]'); const v = sec.querySelector('video'); const cv = sec.querySelector('canvas'); const x = cv.getContext('2d'); const d = x.getImageData(0,0,cv.width,cv.height).data; let minx=1e9,maxx=-1; for(let i=0;i<d.length;i+=4){ if(d[i+3]>120 && d[i+2]>120 && d[i]<80){ const px=(i/4)%cv.width; if(px<minx) minx=px; if(px>maxx) maxx=px; } } return {t:v.currentTime.toFixed(2), cw:cv.width, minx, maxx}; });
console.log('viewer arrow ink at t=' + ink.t + ':', JSON.stringify(ink), 'shifted right of start:', ink.minx > ink.cw*0.3 ? 'YES' : 'no');
await d.screenshot({path:OUT+'/shots/trk2-viewer.png'});
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
