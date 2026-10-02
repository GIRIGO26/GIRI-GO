// service worker: the shell comes from the cache at once, the in-app version check always hits the network, a newer shell in the
// background tells the page (v0.30.2) – and (v12.48) a new shell only replaces the cached one once all its app files are cached,
// so a start without network never finds a shell whose bundle was never downloaded
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { ROOT } from './env.mjs';
const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const ORIGIN = 'https://go.ar-giri.de'; const abs = k => new URL(typeof k === 'string' ? k : k.url, ORIGIN + '/sw.js').href;
class Res { constructor(body, init={}){ this._t = typeof body === 'string' ? body : String(body ?? ''); this.status = init.status ?? 200; this.ok = this.status >= 200 && this.status < 300; this.headers = init.headers || {}; this.type = 'basic'; }
  clone(){ return new Res(this._t, {status:this.status, headers:this.headers}); } async text(){ return this._t; } async arrayBuffer(){ return this._t; } }
const store = new Map(); const log = []; const handlers = {};
const cache = { put: async (k, r) => { store.set(abs(k), r); }, match: async k => store.get(abs(k)), add: async k => { store.set(abs(k), new Res('x')); }, keys: async () => [...store.keys()].map(url => ({url})), delete: async k => store.delete(abs(k)) };
let net = {}; let netCalls = []; let offlineFor = new Set();
const shell = (v, js, css) => `<link rel="stylesheet" href="./assets/${css}"><script src="https://cdn.jsdelivr.net/npm/lib@1/x.js"></script><script src="vendor/mp4-muxer.js"></script><script>window.APP_VERSION = '${v}';</script><script type="module" src="./assets/${js}"></script>`;
const ctx = {
  self: { addEventListener: (n, f) => { handlers[n] = f; }, skipWaiting(){}, registration: { scope: ORIGIN + '/' }, location: { origin: ORIGIN }, clients: { claim(){}, matchAll: async () => [{ postMessage: m => log.push('msg:'+JSON.stringify(m)) }] } },
  location: { origin: ORIGIN, href: ORIGIN + '/sw.js' }, URL, setTimeout, Promise, Response: Res, console,
  caches: { open: async () => cache, match: async (k) => store.get(abs(k)), keys: async () => ['giri-go-shell'], delete: async () => true },
  fetch: async (u) => { const url = abs(u); netCalls.push(url); const key = url.replace(/\?.*$/, ''); if(offlineFor.has(key)) throw new Error('Failed to fetch'); const b = net[key] ?? net[url]; if(b == null) return new Res('', {status:404}); return new Res(b); } };
vm.createContext(ctx); vm.runInContext(src, ctx);
const run = async (url, mode) => { let out = null, waited = []; const ev = { request: { url, method:'GET', mode }, respondWith: p => { out = p; }, waitUntil: p => waited.push(p) }; handlers.fetch(ev); const r = await out; await Promise.all(waited); await new Promise(r => setTimeout(r, 20)); return r; };
const cachedVer = () => { const r = store.get(ORIGIN + '/index.html'); return r ? /APP_VERSION = '([^']+)'/.exec(r._t)[1] : null; };
const cachedAssets = () => [...store.keys()].filter(k => k.includes('/assets/')).map(k => k.split('/').pop()).sort().join(',');
// 1. old shell + its files cached, a new release on the server: navigation → cached shell now; new files cached, shell switched, old files gone, page told
store.set(ORIGIN + '/index.html', new Res(shell('12.47.0', 'old.js', 'old.css'))); store.set(ORIGIN + '/assets/old.js', new Res('old')); store.set(ORIGIN + '/assets/old.css', new Res('old'));
net = { [ORIGIN + '/']: shell('12.48.1', 'new.js', 'new.css'), [ORIGIN + '/assets/new.js']: 'js', [ORIGIN + '/assets/new.css']: 'body{background:url(../fonts/m.woff2)}', [ORIGIN + '/fonts/m.woff2']: 'font', [ORIGIN + '/vendor/mp4-muxer.js']: 'mux', 'https://cdn.jsdelivr.net/npm/lib@1/x.js': 'lib' };
const nav = await run(ORIGIN + '/', 'navigate');
console.log('navigation served from cache:', nav._t.includes("'12.47.0'") ? 'YES' : 'NO – BUG', '| cache switched to:', cachedVer(), '| assets now:', cachedAssets(), '| font + lib cached:', !!store.get(ORIGIN + '/fonts/m.woff2') && !!store.get('https://cdn.jsdelivr.net/npm/lib@1/x.js') ? 'YES' : 'NO – BUG', '| page told:', log.some(l => l.includes('shell-updated')) ? 'YES' : 'NO – BUG');
// 2. a newer release, but its bundle cannot be fetched (connection drops) → the cached shell stays in charge, its files stay
net[ORIGIN + '/'] = shell('12.48.1', 'newer.js', 'new.css'); offlineFor = new Set([ORIGIN + '/assets/newer.js']); log.length = 0;
await run(ORIGIN + '/', 'navigate');
console.log('incomplete update keeps the old shell:', cachedVer() === '12.48.1' && cachedAssets() === 'new.css,new.js' ? 'YES' : 'NO – BUG (' + cachedVer() + ' / ' + cachedAssets() + ')', '| page not told:', log.some(l => l.includes('shell-updated')) ? 'NO – BUG' : 'YES');
offlineFor = new Set();
// 3. the in-app version check (not a navigation, ?v=) → network, never the cache
net[ORIGIN + '/index.html'] = shell('12.48.1', 'newer.js', 'new.css'); net[ORIGIN + '/assets/newer.js'] = 'js2'; const before = netCalls.length;
const chk = await run(ORIGIN + '/index.html?v=check123', 'cors');
console.log('version check hits the network:', netCalls.length > before && chk._t.includes("'12.48.1'") ? 'YES' : 'NO – BUG');
// 4. a plain non-navigation fetch of index.html (older app builds without ?v=) → also network
const chk2 = await run(ORIGIN + '/index.html', 'cors');
console.log('plain check hits the network:', chk2._t.includes("'12.48.1'") ? 'YES' : 'NO – BUG');
// 5. "?v=" navigation after an update → network, and the complete new shell lands in the cache
net[ORIGIN + '/'] = shell('12.48.1', 'newer.js', 'new.css');
const nav2 = await run(ORIGIN + '/?v=12.48.1', 'navigate');
console.log('?v= navigation from network:', nav2._t.includes("'12.48.1'") ? 'YES' : 'NO – BUG', '| cache now:', cachedVer(), '| assets:', cachedAssets());
// 6. offline start: navigation → the cached shell, its bundle from the cache
offlineFor = new Set([ORIGIN + '/', ORIGIN + '/assets/newer.js', ORIGIN + '/assets/new.css']);
const off = await run(ORIGIN + '/', 'navigate'); const offJs = await run(ORIGIN + '/assets/newer.js', 'no-cors');
console.log('offline start works:', off && off._t.includes("'12.48.1'") && offJs && offJs._t === 'js2' ? 'YES' : 'NO – BUG');
console.log('NO ERRORS');
