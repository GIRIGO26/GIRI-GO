/* GIRI Go service worker – app shell offline, libraries cached, data always live.
   v0.29: the shell (index.html) is served from the cache at once and refreshed in the background – a cold start no longer waits
   for GitHub. When the fresh copy differs, the page is told (→ version check → reload at a safe moment). "?v=" loads bypass the cache. */
const CACHE = 'giri-go-shell';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png?v=2', './icons/icon-512.png?v=2'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {}))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', e => { if(e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request; if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin === location.origin){
    // app shell: network first and always revalidated (no-cache → GitHub Pages' 10-minute HTTP cache is skipped), cache as offline fallback
    if(req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')){
      const fresh = () => fetch(req.url, {cache:'no-cache', credentials:'same-origin'});
      // "?v=" loads and every non-navigation request (the in-app version check!) go to the network first – v0.30.2:
      // before, the version check got the cached shell back and never saw a new release
      if(url.search.includes('v=') || req.mode !== 'navigate'){ e.respondWith(fresh().then(r => { if(r.ok){ const c = r.clone(); caches.open(CACHE).then(x => x.put('./index.html', c)); } return r; }).catch(() => caches.match('./index.html'))); return; }
      e.respondWith(caches.match('./index.html').then(async cached => {
        const update = fresh().then(async r => { if(!r.ok) return r; const c = r.clone(); const x = await caches.open(CACHE);
          if(cached){ const [a, b] = await Promise.all([cached.clone().text(), r.clone().text()]); const va = /APP_VERSION = '([^']+)'/.exec(a), vb = /APP_VERSION = '([^']+)'/.exec(b);
            if(va && vb && va[1] !== vb[1]){ // tell the page – it may still be loading, so try a few times
              for(let k = 0; k < 4; k++){ const cl = await self.clients.matchAll({type:'window', includeUncontrolled:true}); if(cl.length){ cl.forEach(w => w.postMessage({type:'shell-updated', v: vb[1]})); break; } await new Promise(res => setTimeout(res, 1200)); } } }
          await x.put('./index.html', c); return r; }).catch(() => null);
        if(cached){ e.waitUntil(update); return cached; }
        const r = await update; return r || caches.match('./index.html'); })); return; }
    // built app files (assets/index-<hash>.js|css, fonts, vendor): the hash changes with every release, so cache first is safe –
    // no round trip to GitHub Pages on every start. Old builds are dropped from the cache when a new one arrives.
    if(/\/(assets|fonts|vendor)\//.test(url.pathname)){
      e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { if(res.ok){ const c = res.clone(); caches.open(CACHE).then(async x => { await x.put(req, c); if(url.pathname.includes('/assets/')){ const ext = url.pathname.split('.').pop(); const keys = await x.keys(); keys.forEach(k => { const u = new URL(k.url); if(u.pathname.includes('/assets/') && u.pathname.endsWith('.'+ext) && u.pathname !== url.pathname) x.delete(k); }); } }); } return res; }))); return; }
    // icons, manifest, login image: network first (so a new login.jpg shows up), cache fallback
    e.respondWith(fetch(req).then(res => { if(res.ok){ const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; }).catch(() => caches.match(req))); return;
  }
  // libraries + fonts from CDNs (versioned URLs): cache first
  if(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.host)){
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { if(res.ok || res.type === 'opaque'){ const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; }))); return;
  }
  // Supabase, DeepL etc.: network only
});
