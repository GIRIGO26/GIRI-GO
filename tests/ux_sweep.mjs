// v12.48 – UX sweep over devices: every page on five screen sizes. Measures what a person feels, not what code does:
// sideways scroll, text pushed out of its box, tap targets under 44 px (touch), empty/untranslated labels, broken images, console errors.
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const DEV = [
  {n:'iPhone SE', w:375, h:667, touch:true}, {n:'iPhone 13 Pro', w:390, h:844, touch:true}, {n:'Android 412', w:412, h:915, touch:true},
  {n:'iPad', w:820, h:1180, touch:true}, {n:'Desktop', w:1366, h:900, touch:false}];
const browser = await chromium.launch(launchArgs([])); const errs = []; const rows = [];
for(const dev of DEV){
  for(const lang of ['de','en']){
    if(lang==='en' && dev.n!=='iPhone 13 Pro' && dev.n!=='Desktop') continue;
    const ctx = await browser.newContext({viewport:{width:dev.w,height:dev.h}, isMobile:dev.touch && dev.w<600, hasTouch:dev.touch});
    await ctx.addInitScript(l => { localStorage.setItem('gg_lang', l); sessionStorage.setItem('gg_inst_hide','1'); }, lang);
    const d = await ctx.newPage(); d.on('pageerror', e => errs.push(dev.n+' '+e.message));
    await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2000);
    const id = await d.evaluate(() => window.__tables.instructions[0].id);
    const pages = ['#/', '#/trash', '#/stats', '#/admin', '#/admin/import', '#/edit/'+id, '#/preview/'+id, '#/results/'+id, '#/rec/'+id];
    for(const p of pages){
      await d.goto(BASE+'/index3.html'+p); await d.waitForTimeout(1500);
      const r = await d.evaluate(({touch}) => {
        const vw = document.documentElement.clientWidth, vis = e => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return s.visibility!=='hidden' && s.display!=='none' && b.width>0 && b.height>0 && !e.closest('[hidden]'); };
        const out = {scrollX: document.documentElement.scrollWidth - vw, small: [], clipped: [], noImg: 0, empty: [], raw: []};
        document.querySelectorAll('button, a[href], [role=button], input:not([type=hidden]), select, summary, [data-act], .itab').forEach(e => { if(!vis(e)) return; const b = e.getBoundingClientRect(); const af = getComputedStyle(e,'::after'); const ah = af.content!=='none' ? parseFloat(af.height)||0 : 0;
          if(touch && Math.max(b.height, ah) < 36 && !(e.tagName==='A' && e.closest('p, .l-legal, .crumbs, footer')) && e.type!=='checkbox' && e.type!=='radio') out.small.push((e.id||e.className||e.tagName).toString().slice(0,30)+' '+Math.round(b.width)+'x'+Math.round(b.height)); });
        document.querySelectorAll('h1,h2,h3,button,.btn,.chip,.itab,label,.title').forEach(e => { if(vis(e) && e.scrollWidth > e.clientWidth+2 && getComputedStyle(e).overflow!=='visible' && getComputedStyle(e).textOverflow!=='ellipsis') out.clipped.push(e.textContent.trim().slice(0,30)); });
        document.querySelectorAll('img').forEach(i => { if(vis(i) && i.complete && !i.naturalWidth) out.noImg++, out.src=i.outerHTML.slice(0,90); });
        document.querySelectorAll('button, .btn, label, h1, h2, h3').forEach(e => { if(vis(e) && !e.textContent.trim() && !e.querySelector('svg, img, i, span[class*=ic]') && !e.getAttribute('aria-label') && !e.title) out.empty.push(e.id||e.className); });
        const txt = document.body.innerText; (txt.match(/\b[a-z]{2,8}_[a-z0-9_]{2,}\b/g)||[]).forEach(m => out.raw.push(m));
        return out; }, {touch: dev.touch});
      const issues = [];
      if(r.scrollX > 1) issues.push('sideways scroll +'+r.scrollX+'px'); if(r.small.length) issues.push('small taps: '+[...new Set(r.small)].slice(0,4).join(', ')+(r.small.length>4?' …('+r.small.length+')':''));
      if(r.clipped.length) issues.push('clipped: '+[...new Set(r.clipped)].slice(0,3).join(' | ')); if(r.noImg) issues.push('broken images '+r.noImg+' '+r.src); if(r.empty.length) issues.push('empty labels: '+[...new Set(r.empty)].slice(0,3).join(',')); if(r.raw.length) issues.push('raw keys: '+[...new Set(r.raw)].slice(0,4).join(','));
      rows.push({dev:dev.n, lang, page:p.replace(id,'<id>'), issues});
      if(issues.length) await d.screenshot({path:OUT+'/shots/ux-'+dev.n.replace(/\W+/g,'')+'-'+lang+'-'+p.replace(/\W+/g,'_').replace(id,'id')+'.png'}).catch(() => {});
    }
    await ctx.close();
  }
}
let bad = 0; for(const r of rows){ if(r.issues.length){ bad++; console.log(`${r.dev} ${r.lang} ${r.page}: ${r.issues.join(' ; ')}`); } }
console.log(`checked ${rows.length} page views, ${bad} with findings`); console.log(errs.join('\n') || 'NO ERRORS'); await browser.close();
