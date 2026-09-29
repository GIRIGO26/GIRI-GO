/* ---------- Storage (IndexedDB with memory fallback) ---------- */
const DB = (() => {
  const mem = {instr:new Map(), media:new Map(), runs:new Map(), vcache:new Map()};
  let db = null, failed = false;
  let opening = null, retryAt = 0;
  const STORES = ['instr','media','runs','vcache'];
  // v2 adds "vcache" (instructions saved for offline viewing). An older tab / the installed app may still hold v1 open and block the
  // upgrade – then this call falls back to memory after 3 s (never a hang) and the next call tries again; once the old tab is gone
  // the upgrade goes through. New connections close themselves when a later version asks for it.
  const open = () => { if(db||failed) return Promise.resolve(db); if(opening) return opening; if(Date.now() < retryAt) return Promise.resolve(null); opening = new Promise(res => {
    let done = false; const fin = (d, hard) => { if(done){ if(d && !db){ db = d; d.onversionchange = () => { try{ d.close(); }catch(e){} db = null; }; } return; } done = true; clearTimeout(tm); if(d){ db = d; d.onversionchange = () => { try{ d.close(); }catch(e){} db = null; }; } else if(hard) failed = true; opening = null; res(db); };
    const tm = setTimeout(() => { retryAt = Date.now() + 5000; fin(null, false); }, 3000);
    try{
      const rq = indexedDB.open('giri-go', 2);
      rq.onupgradeneeded = e => { const d = e.target.result; STORES.forEach(s => { if(!d.objectStoreNames.contains(s)) d.createObjectStore(s,{keyPath:'id'}); }); };
      rq.onsuccess = e => fin(e.target.result, false);
      rq.onerror = () => fin(null, true);
    }catch(e){ fin(null, true); }
  }); return opening; };
  // v12.43: a request that never answers (iOS after the app was in the background) or a connection that closed underneath us
  // must not hang the caller – 6 s watchdog, the connection is dropped so the next call opens a fresh one
  const tx = (store, mode, fn) => open().then(d => new Promise((res, rej) => {
    if(!d){ try{ res(fn(null, store)); }catch(e){ rej(e); } return; }
    if(!d.objectStoreNames.contains(store)){ rej(new Error('store missing: '+store)); return; }
    let done = false; const tm = setTimeout(() => { if(done) return; done = true; if(db === d){ try{ d.close(); }catch(e){} db = null; } rej(new Error('idb timeout')); }, 6000);
    const ok = v => { if(done) return; done = true; clearTimeout(tm); res(v); }; const bad = e => { if(done) return; done = true; clearTimeout(tm); rej(e); };
    let tr, st; try{ tr = d.transaction(store, mode); st = tr.objectStore(store); }catch(e){ if(db === d){ try{ d.close(); }catch(x){} db = null; } bad(e); return; }
    let r; try{ r = fn(st, store); }catch(e){ bad(e); return; }
    if(!r){ tr.oncomplete = () => ok(); tr.onerror = () => bad(tr.error); tr.onabort = () => bad(tr.error || new Error('aborted')); return; }
    r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
  }));
  return {
    put:(s,o) => tx(s,'readwrite',(st,name)=> st ? st.put(o) : (mem[name].set(o.id,o), null)),
    get:(s,id) => tx(s,'readonly',(st,name)=> st ? st.get(id) : mem[name].get(id)),
    has:(s,id) => tx(s,'readonly',(st,name)=> st ? st.getKey(id) : mem[name].get(id)).then(k => k != null), // key only – no value is deserialised
    del:(s,id) => tx(s,'readwrite',(st,name)=> st ? st.delete(id) : (mem[name].delete(id), null)),
    all:(s) => tx(s,'readonly',(st,name)=> st ? st.getAll() : [...mem[name].values()])
  };
})();

const uid = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);

const LS = { get:k=>{try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}}, set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}} , del:k=>{try{localStorage.removeItem(k);}catch(e){}} };

export { DB, uid, LS };
