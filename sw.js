/* GIRI service worker – app shell offline, libraries cached, data always live.
   v0.29: the shell (index.html) is served from the cache at once and refreshed in the background – a cold start no longer waits
   for the host. When the fresh copy differs, the page is told (→ version check → reload at a safe moment). "?v=" loads bypass the cache.
   v12.48: a new shell only replaces the cached one once every file it needs (app bundle, styles, libraries, fonts) is in the cache
   too – before, the background update stored the new index.html alone, and the next start without network found a page whose
   app files had never been downloaded (blank app offline). Old app files are dropped only after the switch. */
const CACHE = 'giri-go-shell';
// v12.38: cache a copy without the response URL – the host redirects /index.html → /, and a cached response that still carries
// its redirected URL (…/?v=check…) would become the address of the next navigation served from the cache
const plain = async r => new Response(await r.clone().arrayBuffer(), {status: r.status, statusText: r.statusText, headers: r.headers});
const CORE = ['./manifest.webmanifest', './icons/icon-192.png?v=3', './icons/icon-512.png?v=3', './login.jpg'];
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
const verOf = txt => { const m = /APP_VERSION = '([^']+)'/.exec(txt||''); return m ? m[1] : ''; };
const newer = (a, b) => { const A = a.split('.').map(Number), B = b.split('.').map(Number); for(let i = 0; i < 3; i++){ if((A[i]||0) !== (B[i]||0)) return (A[i]||0) > (B[i]||0); } return false; };

// every file a shell (or a style sheet) refers to that the app needs to start: own app files + the libraries/fonts from the CDNs
const refsOf = (text, base) => { const out = new Set(); const re = /(?:src|href)=["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g; let m;
  while((m = re.exec(text))){ const raw = m[1] || m[2]; if(!raw || raw.startsWith('data:') || raw.startsWith('#')) continue; let u; try{ u = new URL(raw, base); }catch(e){ continue; }
    if(u.origin === self.location.origin){ if(/\/(assets|vendor|fonts|icons|symbols)\//.test(u.pathname) || /\.(webmanifest|jpg|png|woff2?)$/.test(u.pathname)) out.add(u.href); }
    else if(CDN.test(u.href) && u.href !== 'https://fonts.googleapis.com/' && u.href !== 'https://fonts.googleapis.com') out.add(u.href); }
  return [...out]; };
const fetchFor = u => fetch(u, u.startsWith(self.location.origin) ? {cache:'no-cache', credentials:'same-origin'} : {mode:'cors', credentials:'omit'});
// cache the shell's files first, then the shell, then drop app files no shell needs any more. false = not everything could be
// fetched (offline, host hiccup) → the old shell stays in charge
async function installShell(html, headers){
  const c = await caches.open(CACHE); const base = self.registration.scope; const need = refsOf(html, base); const all = new Set(need);
  for(const u of need){
    let r = await c.match(u, {ignoreVary: true}); if(!r){ r = await fetchFor(u).catch(() => null); if(!r || !r.ok){ if(u.startsWith(self.location.origin)) return false; continue; } await c.put(u, r.clone()); } // own files are a must; a CDN that is blocked here was cached when the page loaded it
    if(/\.css(\?|$)|fonts\.googleapis\.com\/css/.test(u)){ const css = await r.clone().text().catch(() => ''); for(const f of refsOf(css, u)){ all.add(f); if(await c.match(f, {ignoreVary: true})) continue; const fr = await fetchFor(f).catch(() => null); if(fr && fr.ok) await c.put(f, fr); } }
  }
  await c.put('./index.html', new Response(html, {status:200, headers}));
  for(const k of await c.keys()){ const p = new URL(k.url).pathname; if(/\/assets\//.test(p) && !all.has(k.url)) await c.delete(k); }
  return true;
}
const installFrom = async r => { try{ const html = await r.clone().text(); if(!verOf(html)) return false; return await installShell(html, r.headers); }catch(e){ return false; } };

self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(async c => { await Promise.all(CORE.map(u => c.add(u).catch(() => {}))); try{ const r = await fetch('./', {cache:'no-cache'}); if(r.ok) await installFrom(r); }catch(e){} })); });
// v12.39: a new service worker rescues installed apps that are stuck on an old shell – app versions before 12.37.1 had a dead
// in-page version check and never reloaded on their own. On activation: fetch the current shell, and if the cached one is older,
// swap it and send every open window to the new version (home-screen apps on iOS/Android included).
const rescueClients = async () => { try{
  const c = await caches.open(CACHE); const cached = await c.match('./index.html'); const oldV = cached ? verOf(await cached.clone().text()) : '';
  const r = await fetch('./', {cache:'no-cache'}); if(!r.ok) return; const txt = await r.clone().text(); const newV = verOf(txt); if(!newV) return;
  if(!(await installShell(txt, r.headers))) return;
  if(oldV && !newer(newV, oldV)) return;
  const wins = await self.clients.matchAll({type:'window', includeUncontrolled:true});
  for(const w of wins){ try{ w.postMessage({type:'shell-updated', v:newV}); if(!oldV || newer('12.37.1', oldV) || oldV==='dev'){ if('navigate' in w) await w.navigate(w.url.split('?')[0] + '?v=' + newV + (w.url.includes('#') ? '#' + w.url.split('#')[1] : '')); } }catch(e){} }
}catch(e){} };
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()).then(rescueClients)); });
self.addEventListener('message', e => { if(e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request; if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin === location.origin){
    // app shell: network first and always revalidated (no-cache → the host's HTTP cache is skipped), cache as offline fallback
    if(req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')){
      const fresh = () => fetch(req.url, {cache:'no-cache', credentials:'same-origin'});
      // "?v=" loads and every non-navigation request (the in-app version check!) go to the network first – v0.30.2:
      // before, the version check got the cached shell back and never saw a new release
      if(url.search.includes('v=') || req.mode !== 'navigate'){ e.respondWith(fresh().then(async r => { if(r.ok) e.waitUntil(installFrom(await plain(r))); return r; }).catch(() => caches.match('./index.html'))); return; }
      e.respondWith(caches.match('./index.html').then(async cached => {
        const update = fresh().then(async r => { if(!r.ok) return r; const c = await plain(r);
          const ok = await installFrom(c);
          if(ok && cached){ const [a, b] = await Promise.all([cached.clone().text(), c.clone().text()]); const va = verOf(a), vb = verOf(b);
            if(va && vb && va !== vb){ // tell the page – it may still be loading, so try a few times
              for(let k = 0; k < 4; k++){ const cl = await self.clients.matchAll({type:'window', includeUncontrolled:true}); if(cl.length){ cl.forEach(w => w.postMessage({type:'shell-updated', v: vb})); break; } await new Promise(res => setTimeout(res, 1200)); } } }
          return r; }).catch(() => null);
        if(cached){ e.waitUntil(update); return cached; }
        const r = await update; return r || caches.match('./index.html'); })); return; }
    // built app files (assets/index-<hash>.js|css, fonts, vendor): the hash changes with every release, so cache first is safe.
    // v12.48: old builds are dropped by installShell() once a new shell is complete – not here, where it could orphan the cached shell
    if(/\/(assets|fonts|vendor|symbols)\//.test(url.pathname)){ // v12.40: ISO 7010 SVGs are cached like the app files
      e.respondWith(caches.match(req, {ignoreVary: true}).then(r => r || fetch(req).then(res => { if(res.ok){ const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; }))); return; }
    // icons, manifest, login image: network first (so a new login.jpg shows up), cache fallback
    e.respondWith(fetch(req).then(res => { if(res.ok){ const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; }).catch(() => caches.match(req, {ignoreSearch: true}))); return;
  }
  // libraries + fonts from CDNs (versioned URLs): cache first
  if(CDN.test(url.href)){
    e.respondWith(caches.match(req, {ignoreVary: true}).then(r => r || fetch(req).then(res => { if(res.ok || res.type === 'opaque'){ const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; }))); return;
  }
  // Supabase, DeepL etc.: network only
});
