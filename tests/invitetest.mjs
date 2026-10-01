// v12.48 – invitations: a real invitation mail (edge function invite-notify) instead of the bare sign-in code; the open invitations show
// when they were sent and can be sent again or withdrawn; the plain code mail stays as a fallback when the function is not set up yet;
// the sign-in page opened from the mail (#/join/<e-mail>) has the address filled in and says what happens next
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs = [];
const ctx = await browser.newContext({viewport:{width:1280,height:900}}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); sessionStorage.setItem('gg_inst_hide','1'); });
const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE+'/index3.html#/admin'); await p.waitForTimeout(2200);
const toast = () => p.$eval('#toast', e => e.textContent.trim()).catch(() => '');
const invite = async (email, role, lang) => { await p.click('#invite'); await p.waitForTimeout(300); await p.fill('#iv-mail', email); if(role) await p.selectOption('#iv-role', role); if(lang) await p.selectOption('#iv-lang', lang); await p.click('.modal-bg [data-ok]'); await p.waitForTimeout(700); };
// 1. the dialog: role preset to Creator, language of the mail
await p.click('#invite'); await p.waitForTimeout(300);
console.log('dialog:', await p.evaluate(() => ({sub: document.querySelector('.modal-bg p.muted').textContent.slice(0, 70), role: document.querySelector('#iv-role').value, lang: document.querySelector('#iv-lang').value, focus: document.activeElement && document.activeElement.id})));
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
// 2. invite a new person → invitation mail, no code mail
await invite('neu@kunde.de', 'editor', 'en');
console.log('sent:', await toast(), '| function body:', JSON.stringify((await p.evaluate(() => window.__invites || [])).slice(-1)[0]), '| code mails:', await p.evaluate(() => (window.__otp || []).length));
console.log('stored invite:', await p.evaluate(() => { const i = window.__tables.workspaces[0].invites.find(x => x.email === 'neu@kunde.de'); return i && [i.role, i.lang, !!i.at, !!i.mailed_at].join(','); }));
console.log('open invitations:', await p.$$eval('.inv-row', xs => xs.map(x => x.querySelector('.inv-main').textContent.replace(/\s+/g, ' ').trim()).join(' || ')), '| note:', await p.$eval('#invites p.muted', e => e.textContent.slice(0, 60)).catch(() => 'none'));
await p.screenshot({path: OUT + '/shots/invite-admin.png'});
// 3. someone who is already a member → refused at once, nothing sent
const nBefore = await p.evaluate(() => (window.__invites || []).length);
const member = await p.evaluate(() => (window.__tables.profiles.find(x => x.ws === window.__tables.workspaces[0].ws && x.email) || {}).email);
await invite(member); console.log('existing member:', await toast(), '| function called:', (await p.evaluate(() => (window.__invites || []).length)) !== nBefore);
// 4. invalid address
await invite('kein-at-zeichen'); console.log('invalid address:', await toast());
// 5. resend
await p.waitForTimeout(3200); await p.click('.inv-row [data-reinv]'); await p.waitForTimeout(600); console.log('resend:', await toast(), '| calls for neu@:', await p.evaluate(() => window.__invites.filter(x => x.email === 'neu@kunde.de').map(x => x.lang).join(',')));
// 6. the function answers "already in another workspace" → message, no fallback mail
await p.evaluate(() => { window.__invErr = 'other_ws'; }); await p.waitForTimeout(3200); await invite('woanders@firma.de');
console.log('other workspace:', await toast(), '| code mails:', await p.evaluate(() => (window.__otp || []).length));
// 7. function not ready (not deployed / table missing) → the old code mail as fallback
await p.evaluate(() => { window.__invErr = 'not_ready'; }); await p.waitForTimeout(3200); await invite('alt@kunde.de');
console.log('fallback:', await toast(), '| code mails to:', await p.evaluate(() => (window.__otp || []).join(',')));
await p.evaluate(() => { window.__invErr = null; });
// 8. withdraw → confirm → gone
const nInv = await p.$$eval('.inv-row', xs => xs.length); await p.click('.inv-row [data-rminv]'); await p.waitForTimeout(300);
console.log('withdraw question:', await p.$eval('.modal-bg', e => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 90)));
await p.click('.modal-bg [data-ok]'); await p.waitForTimeout(600); console.log('rows before/after withdraw:', nInv, '/', await p.$$eval('.inv-row', xs => xs.length));
// 9. phone: the invitation rows wrap without overflow
await p.setViewportSize({width:390, height:844}); await p.waitForTimeout(400);
console.log('phone overflow:', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1));
// 10. the sign-in page from the invitation link
const c2 = await browser.newContext({viewport:{width:390,height:844}}); await c2.addInitScript(() => { localStorage.setItem('gg_lang','de'); localStorage.setItem('gg_nosess','1'); localStorage.removeItem('gg_email'); });
const l = await c2.newPage(); l.on('pageerror', e => errs.push('L ' + e.message));
await l.goto(BASE + '/index3.html#/join/' + encodeURIComponent('Neu@Kunde.de')); await l.waitForTimeout(1600);
console.log('join page:', JSON.stringify(await l.evaluate(() => ({email: document.querySelector('#li-email').value, nameOpen: !document.querySelector('#li-namewrap').hidden, hint: (document.querySelector('.l-join') || {}).textContent, note: document.querySelector('#login-note').textContent.slice(0, 60), focus: document.activeElement && document.activeElement.id}))));
await l.screenshot({path: OUT + '/shots/invite-join.png'});
await l.fill('#li-name', 'Nina Neu'); await l.click('#li-go'); await l.waitForTimeout(600);
console.log('after sign-in request – waiting card:', await l.$eval('#magic', e => !e.hidden), '|', await l.$eval('#magic-sub', e => e.textContent.slice(0, 80)));
// the plain sign-in page stays as it was
await l.goto(BASE + '/index3.html#/'); await l.reload(); await l.waitForTimeout(1500);
console.log('normal sign-in page – hint:', !!(await l.$('.l-join')), '| name field hidden:', await l.$eval('#li-namewrap', e => e.hidden));
console.log(errs.join('\n') || 'NO ERRORS'); await browser.close();
