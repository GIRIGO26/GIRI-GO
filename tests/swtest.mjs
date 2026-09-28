// service worker: the shell comes from the cache at once, the in-app version check always hits the network,
// a newer shell in the background tells the page (v0.30.2 – before, the version check got the cached shell and never updated)
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { ROOT } from './env.mjs';
const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const store = new Map(); const log = []; const handlers = {};
const mkRes = (txt, ok=true) => ({ ok, status: ok?200:500, type:'basic', _t: txt, clone(){ return mkRes(txt, ok); }, text: async () => txt });
let networkVersion = '0.30.1', networkCalls = 0;
const ctx = {
  self: { addEventListener: (n, f) => { handlers[n] = f; }, skipWaiting(){}, clients: { claim(){}, matchAll: async () => [{ postMessage: m => log.push('msg:'+JSON.stringify(m)) }] } },
  location: { origin: 'https://go.ar-giri.de', href: 'https://go.ar-giri.de/sw.js' }, URL, setTimeout, Promise,
  caches: { open: async () => ({ put: async (k, r) => { store.set(typeof k==='string' ? new URL(k, 'https://go.ar-giri.de/sw.js').href : k.url, r); }, match: async k => store.get(new URL(k, 'https://go.ar-giri.de/sw.js').href) || undefined, keys: async () => [] }), match: async k => store.get(new URL(k, 'https://go.ar-giri.de/sw.js').href) || undefined, keys: async () => [], delete: async () => true },
  fetch: async (u) => { networkCalls++; return mkRes(`<script>window.APP_VERSION = '${networkVersion}';</script>`); }, console };
vm.createContext(ctx); vm.runInContext(src, ctx);
const run = async (url, mode) => { let out = null, waited = []; const ev = { request: { url, method:'GET', mode }, respondWith: p => { out = p; }, waitUntil: p => waited.push(p) }; handlers.fetch(ev); const r = await out; await Promise.all(waited); return r; };
// 1. old shell in the cache, new release on the server: navigation → cached shell now, cache refreshed, page told
store.set('https://go.ar-giri.de/index.html', mkRes(`<script>window.APP_VERSION = '0.30.0';</script>`));
const nav = await run('https://go.ar-giri.de/', 'navigate');
console.log('navigation served from cache:', nav._t.includes('0.30.0') ? 'YES' : 'NO – BUG', '| cache refreshed to:', /APP_VERSION = '([^']+)'/.exec(store.get('https://go.ar-giri.de/index.html')._t)[1], '| page told:', log.some(l => l.includes('shell-updated')) ? 'YES' : 'NO – BUG');
// 2. the in-app version check (not a navigation, ?v=) → network, never the cache
networkVersion = '0.31.0'; const before = networkCalls;
const chk = await run('https://go.ar-giri.de/index.html?v=check123', 'cors');
console.log('version check hits the network:', networkCalls > before && chk._t.includes('0.31.0') ? 'YES' : 'NO – BUG');
// 3. a plain non-navigation fetch of index.html (older app builds without ?v=) → also network
const chk2 = await run('https://go.ar-giri.de/index.html', 'cors');
console.log('plain check hits the network:', chk2._t.includes('0.31.0') ? 'YES' : 'NO – BUG');
// 4. "?v=" navigation after an update → network
const nav2 = await run('https://go.ar-giri.de/?v=0.31.0', 'navigate');
console.log('?v= navigation from network:', nav2._t.includes('0.31.0') ? 'YES' : 'NO – BUG');
console.log('NO ERRORS');
