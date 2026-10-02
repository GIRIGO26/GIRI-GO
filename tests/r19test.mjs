import { chromium } from 'playwright'; import { BASE, OUT, TESTS, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const d = await (await browser.newContext({viewport:{width:1366,height:900}})).newPage(); d.on('pageerror', e => errs.push('D '+e.message));
await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2200); await d.evaluate(()=>localStorage.setItem('gg_lang','de')); await d.reload(); await d.waitForTimeout(2200);
const vid = await d.evaluate(()=>window.__tables.instructions[0].id);
await d.goto(BASE+'/index3.html#/edit/'+vid); await d.waitForTimeout(1500);
console.log('head buttons:', await d.$$eval('.ed-acts > button', x => x.filter(b => !b.hidden).map(b => b.id)));
await d.click('.itab[data-itab="settings"]'); await d.waitForTimeout(1000);
console.log('settings order:', await d.$$eval('#tab-settings label.toggle, #tab-settings .chkmodes', x => x.slice(0, 6).map(e => e.className+':'+((e.querySelector('input')||{}).id||''))));
console.log('location & access section (v12.49):', await d.$eval('#set-place', e => e.querySelector('h3').textContent.trim() + ' · ' + e.querySelectorAll('[data-itm]').length + ' team(s)'));
console.log('no PDF block in the settings (v12.49, it is in ⋯):', !(await d.$('#txcard, [data-pdforig]')), '| ⋯ has it:', await (async () => { await d.click('#more'); await d.waitForTimeout(200); const has = !!(await d.$('.modal-bg [data-m="pdf"]')); await d.keyboard.press('Escape'); await d.waitForTimeout(200); const bg = await d.$('.modal-bg'); if(bg) await d.mouse.click(5, 5); await d.waitForTimeout(200); return has; })());
await d.screenshot({path:OUT+'/shots/r19-settings.png', fullPage:true});
// viewer: no note button, feedback present, chk buttons only on confirm steps
const m = await (await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2})).newPage(); m.on('pageerror', e => errs.push('M '+e.message));
await m.goto(BASE+'/index3.html'); await m.waitForTimeout(2200); await m.evaluate(()=>{ localStorage.setItem('gg_lang','de'); window.__tables.instructions[0].status='published'; }); await m.goto(BASE+'/index3.html#/'); await m.waitForTimeout(500);
const vid2 = await m.evaluate(()=>window.__tables.instructions[0].id);
await m.goto(BASE+'/index3.html#/v/'+vid2+'/1'); await m.waitForTimeout(1500); await m.fill('#wname', 'Anna'); await m.click('#begin'); await m.waitForTimeout(800);
console.log('note buttons:', await m.$$eval('[data-note]', x=>x.length), 'fb buttons:', await m.$$eval('[data-fb]', x=>x.length), 'steps that need an answer (v12.48: answered in the fixed bar):', await m.$$eval('.vstep[data-need]', x=>x.length), '| bar:', await m.$eval('#vw-act', e => e.hidden ? 'hidden' : 'shown'));
await m.click('.vstep[data-i="0"] [data-fb]'); await m.waitForTimeout(400);
console.log('attach options:', await m.$$eval('.modal [data-att]', x => x.map(i => i.dataset.att+':'+i.accept+':'+(i.hasAttribute('capture')?'cap':'lib'))));
await m.screenshot({path:OUT+'/shots/r19-fbdialog.png'});
await m.keyboard.press('Escape'); await m.waitForTimeout(300);
// not OK still opens the note dialog
await m.$eval('.vstep[data-i="0"]', e => e.scrollIntoView()); await m.waitForTimeout(600); await m.click('#va-nok'); await m.waitForTimeout(400); console.log('nok dialog textarea:', !!(await m.$('#nk-note'))); await m.keyboard.press('Escape');
await m.screenshot({path:OUT+'/shots/r19-viewer.png'});
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
