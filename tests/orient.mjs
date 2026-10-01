// v12.48 – orientation: breadcrumb in the top bar (and the trail line on the phone), the back arrow one level up, edit / preview /
// analytics as tabs of one instruction (analytics → back to the instruction), profile behind the avatar, app menu behind ≡,
// BETA visible on every page on the phone
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const ctx = await browser.newContext({viewport:{width:1366,height:900}}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_inst_hide','1'); });
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2000);
const crumbs = async p => (p||d).$eval('.topbar .crumbs', e => [...e.querySelectorAll('.crumb')].map(c => (c.tagName==='A' ? '→' : '') + c.textContent.trim()).join(' › ')).catch(() => 'none');
console.log('dashboard crumbs:', await crumbs(), '| back arrow:', !!(await d.$('.topbar [data-back]')));
// put the example into a folder → folder › instruction trail
const id = await d.evaluate(() => { const r = window.__tables.instructions[0]; r.data.folder = 'f2'; r.updated_at = new Date(Date.now()+5000).toISOString(); return r.id; });
await d.goto(BASE+'/index3.html#/p/f2'); await d.waitForTimeout(2200);
console.log('folder crumbs:', await crumbs());
await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(1500);
console.log('editor crumbs:', await crumbs(), '| tabs:', await d.$$eval('.ed-head .itab', xs => xs.map(x => (x.classList.contains('on') ? '*' : '') + x.textContent.trim()).join(' | ')));
console.log('editor head actions:', await d.$$eval('.ed-head .ed-acts > *', xs => xs.filter(x => !x.hidden).map(x => x.id || x.className).join(',')), '| meta:', await d.$eval('.ed-meta', e => e.textContent.replace(/\s+/g,' ').trim()));
await d.screenshot({path:OUT+'/shots/orient-editor.png'});
// status chip → approvals
await d.click('#stchip'); await d.waitForTimeout(500); console.log('status chip opens approvals:', await d.$eval('#tab-settings', e => !e.hidden));
await d.click('[data-sback]'); await d.waitForTimeout(300);
// analytics tab and back to the instruction
await d.click('.itab[data-itab="results"]'); await d.waitForTimeout(1200);
console.log('analytics:', await d.evaluate(() => location.hash), '| crumbs:', await crumbs(), '| active tab:', await d.$eval('.itab.on', e => e.textContent.trim()));
await d.screenshot({path:OUT+'/shots/orient-results.png'});
await d.click('.itab[data-itab="edit"]'); await d.waitForTimeout(1200); console.log('back to the instruction via tab:', await d.evaluate(() => location.hash));
await d.goto(BASE+'/index3.html#/results/'+id); await d.waitForTimeout(1200);
await d.click('.topbar [data-back]'); await d.waitForTimeout(1000); console.log('back arrow from analytics goes one level up to:', await d.evaluate(() => location.hash));
// preview: its back arrow leads to the editor tab
await d.goto(BASE+'/index3.html#/preview/'+id); await d.waitForTimeout(1500); console.log('preview back link:', await d.$eval('#vback, #ov-back', e => e.getAttribute('href')));
// menus: avatar → profile, ≡ → app menu (no "new folder" any more; branding under administration)
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(1500);
await d.click('[data-profile]'); await d.waitForTimeout(300); console.log('profile menu:', await d.$eval('.modal-bg', e => [...e.querySelectorAll('button, label.btn')].map(b => b.textContent.trim()).filter(Boolean).join(' | ')));
await d.click('.modal-bg [data-x]'); await d.waitForTimeout(300);
await d.click('[data-menu]'); await d.waitForTimeout(300); console.log('app menu:', await d.$$eval('.modal-bg [data-m]', xs => xs.map(x => x.dataset.m).join(',')));
await d.keyboard.press('Escape'); await d.waitForTimeout(200);
// phone: BETA + current place on every page, trail line below
await d.setViewportSize({width:390, height:844});
const id2 = await d.evaluate(() => { const r = window.__tables.instructions[0]; r.data.folder = 'f2'; r.updated_at = new Date(Date.now()+9000).toISOString(); return r.id; }); // the reload above made a new example
for(const h of ['', 'p/f2', 'edit/'+id2, 'results/'+id2, 'trash', 'stats', 'admin']){
  await d.goto(BASE+'/index3.html#/'+h); await d.waitForTimeout(1100);
  const r = await d.evaluate(() => { const b = document.querySelector('.topbar .beta'); const br = b && b.getBoundingClientRect(); const cur = document.querySelector('.topbar .crumb.cur'); const cb = document.querySelector('.crumbbar'); return {beta: !!br && br.width > 0 && br.right <= innerWidth, cur: cur ? cur.textContent.trim().slice(0, 24) : '', bar: cb && getComputedStyle(cb).display !== 'none' ? cb.textContent.replace(/\s+/g,' ').trim().slice(0, 60) : '', overflow: document.documentElement.scrollWidth > innerWidth + 1}; });
  console.log(`phone #/${h.split('/')[0]}:`, JSON.stringify(r));
  if(h === 'edit/'+id2) await d.screenshot({path:OUT+'/shots/orient-phone-editor.png'});
}
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
