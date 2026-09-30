import { retrySaves } from './core/passwords.js';
import { schedulePill } from './core/offline.js';
import './styles/index.css';
import { checkUpdate, pickupSession } from './app/pwa.js';
import { render, refreshIfStale } from './app/router.js';
import { $, $$, toast } from './core/helpers.js';
import { UI_LANGS, t } from './core/i18n.js';
import { BRAND_DEFAULT, G, S } from './core/state.js';
import { initSb } from './core/supabase.js';
import { installTelemetry } from './core/telemetry.js';
import { runUploads } from './core/uploads.js';

// from core/i18n
try{ const st = localStorage.getItem('gg_lang'); const nav = (navigator.language||'de').slice(0,2).toLowerCase(); G.LANG = UI_LANGS.includes(st) ? st : (UI_LANGS.includes(nav) ? nav : 'en'); }catch(e){}

// from core/state
S.brand = Object.assign({}, BRAND_DEFAULT);

// from core/workspace
S.wsRow = {folders:[], teams:[], invites:[], symbols:[], settings:{}};

// from core/uploads
window.addEventListener('online', () => { retrySaves().finally(() => runUploads()); schedulePill(); }); // v12.47: rows first, then clips – the media patch lands on an existing row
window.addEventListener('offline', () => schedulePill());
window.addEventListener('beforeunload', e => { if(G.pendingSync > 0){ e.preventDefault(); e.returnValue = ''; } });

// from app/router
window.addEventListener('hashchange', () => { if(/^#(access_token|error|refresh_token)/.test(location.hash) || location.hash.includes('access_token=')) return; render(); });

// from views/login
initSb();

// from views/symbols
try{ G.recentEmojis = JSON.parse(localStorage.getItem('gg_emo')||'[]'); }catch(e){}

// from pdf/export
window.addEventListener('error', e => { try{ toast('JS: '+(e.message||'').slice(0,120)); }catch(x){} });

// from pdf/export
window.addEventListener('unhandledrejection', e => { try{ const m = e.reason && (e.reason.message||String(e.reason)); if(m && !/AbortError|play\(\)|Failed to fetch|Load failed|NetworkError|network error/i.test(m)) toast('Fehler: '+m.slice(0,120)); }catch(x){} }); // v12.47: a dropped connection is shown by the sync pill, not as an error

// a tiny haptic tick on primary buttons (phones that support it)
document.addEventListener('pointerdown', e => { if(e.pointerType==='touch' && navigator.vibrate && e.target.closest('.btn.mint, .btn:not(.ghost), .shutter, .ib-btn')){ try{ navigator.vibrate(8); }catch(x){} } }, {passive:true});

// no pinch zoom of the whole app (iOS ignores the viewport flag) – the editor canvas has its own pinch via pointer events
document.addEventListener('gesturestart', e => e.preventDefault(), {passive:false});
document.addEventListener('touchmove', e => { if(e.scale && e.scale !== 1) e.preventDefault(); }, {passive:false});

// from app/pwa
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); G.installPrompt = e; $$('[data-install]').forEach(b => b.hidden = false); const n = $('#inst-note'); if(n) n.hidden = false; });

// from app/pwa
window.addEventListener('appinstalled', () => { G.installPrompt = null; toast(t('install_done')); const n = $('#inst-note'); if(n) n.remove(); });

// from app/pwa
if('serviceWorker' in navigator && /^https:/.test(location.protocol)){ window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {})); }

installTelemetry();

// from app/pwa
setTimeout(() => checkUpdate(true), 2500);

// from app/pwa
setInterval(() => checkUpdate(false), 30*60000);
if('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if(e.data && e.data.type === 'shell-updated') checkUpdate(true); });

// from app/pwa
document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible'){ checkUpdate(false); pickupSession(); refreshIfStale(); } });

// from app/pwa
window.addEventListener('pageshow', e => { if(e.persisted){ checkUpdate(true); pickupSession(); } });

// from app/pwa
window.addEventListener('focus', () => pickupSession());

// from app/pwa
window.addEventListener('storage', e => { if(e.key && /^sb-/.test(e.key)) pickupSession(); });

/* ---------- Boot ---------- */

// from main
// v12.46: editor media copies older than two weeks are dropped once a day (never on the critical path)
setTimeout(() => { try{ const k = 'gg_ecache_pruned', d = new Date().toISOString().slice(0,10); if(localStorage.getItem(k) === d) return; localStorage.setItem(k, d); import('./media/preload.js').then(m => m.pruneEditorCache()).catch(()=>{}); }catch(e){} }, 20000);
(function boot(){
  if(initSb()){ render(); return; }
  render();
  const tryLoad = (src, next) => { const sc = document.createElement('script'); sc.src = src; sc.onload = () => { if(initSb()) render(); else next(); }; sc.onerror = next; document.head.appendChild(sc); };
  tryLoad('https://unpkg.com/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js', () => tryLoad('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js', () => {}));
})();
