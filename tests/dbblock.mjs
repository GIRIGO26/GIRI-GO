// an old tab still holds IndexedDB v1 open → the v2 upgrade is blocked; the app must still come up (memory fallback), and recover once the tab is gone
import { chromium } from 'playwright'; import { BASE, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const ctx = await browser.newContext({viewport:{width:1366,height:900}}); await ctx.addInitScript(() => { localStorage.setItem('gg_lang','de'); });
const errs = [];
// "old tab": opens the database as version 1 and keeps it open without onversionchange
const old = await ctx.newPage(); await old.goto(BASE+'/tests/imp1.jpg');
await old.evaluate(() => new Promise(r => { const q = indexedDB.open('giri-go', 1); q.onupgradeneeded = e => ['instr','media','runs'].forEach(s => e.target.result.createObjectStore(s,{keyPath:'id'})); q.onsuccess = e => { window.__db = e.target.result; r(); }; }));
const d = await ctx.newPage(); d.on('pageerror', e => errs.push(e.message));
const t0 = Date.now(); await d.goto(BASE+'/index3.html'); await d.waitForTimeout(6000);
console.log('dashboard with blocked upgrade:', !!(await d.$('.dash #list')), 'after', Math.round((Date.now()-t0)/1000), 's');
await old.close(); await d.waitForTimeout(6500);
await d.goto(BASE+'/index3.html#/trash'); await d.waitForTimeout(1500); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1500);
const ver = await d.evaluate(() => new Promise(r => { const q = indexedDB.open('giri-go'); q.onsuccess = e => { const v = e.target.result.version; e.target.result.close(); r(v); }; }));
console.log('db version after old tab closed:', ver);
console.log(errs.join('\n')||'NO ERRORS'); await browser.close();
