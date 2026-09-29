// renders the whole vector symbol set onto the sample picture (desktop editor) → tests/out/sym-all.png – a visual check, not a test
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const d = await (await browser.newContext({viewport:{width:1400,height:1100}, deviceScaleFactor:2})).newPage();
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2000);
await d.evaluate(()=>{ localStorage.setItem('gg_lang','de'); });
const vid = await d.evaluate(()=>{ const r = window.__tables.instructions[0]; const st = r.data.steps.filter(s=>!s.kind)[0]; st.type='photo';
  const row = (y, items) => items.map((it, i) => Object.assign({id:'s'+y+i, x:0.07 + i*0.86/(items.length-1), y, size:0.13}, it));
  st.ann = [
    ...row(0.16, [{type:'arrow', x:0.03, y:0.25, x2:0.12, y2:0.08, color:'yellow', size:0.13}, {type:'turn', dir:'cw', color:'yellow'}, {type:'turn', dir:'ccw', color:'red'}, {type:'turn', dir:'cw', color:'blue', tx:58}, {type:'pin', color:'mint', y:0.24}, {type:'thumb', dir:'up', color:'yellow'}, {type:'thumb', dir:'down', color:'red'}, {type:'smile', color:'yellow'}]),
    ...row(0.5, [{type:'check'}, {type:'cross'}, {type:'smile', mood:'sad', color:'blue'}, {type:'number', n:3, color:'blue'}, {type:'text', text:'10 Nm', color:'blue', size:0.11}, {type:'thumb', dir:'up', color:'blue', ty:-48}, {type:'turn', dir:'cw', color:'mint', ty:48}, {type:'pin', color:'red', y:0.58, tx:58}]),
    ...row(0.84, [{type:'iso', code:'W012', ar:1.155, size:0.15}, {type:'iso', code:'P002', size:0.15}, {type:'iso', code:'E003', size:0.15}, {type:'iso', code:'F001', size:0.15}, {type:'iso', code:'M009', size:0.15, tx:58}, {type:'circle', x:0.70, y:0.76, x2:0.80, y2:0.94, color:'yellow', size:0.12}, {type:'rect', x:0.86, y:0.76, x2:0.97, y2:0.94, color:'mint', size:0.12}]),
  ]; return r.id; });
await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1500);
{ const tb = await d.$('[data-tab="steps"]'); if(tb && await tb.isVisible()) await tb.click(); } await d.waitForTimeout(1500);
const box = await d.$('#mbox'); await box.screenshot({path:OUT+'/sym-all.png'});
console.log('sym-all.png written');
await browser.close();
