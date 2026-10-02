/* ---------- Motion tracking (v0.25): a symbol follows the spot it points at while the video plays ----------
   Block matching on a downscaled grey frame: a small patch around the anchor is searched in the next frame within a radius;
   the offsets are stored per 0.1 s as a.track = {t0, dt, pts:[[dx,dy],…]} (normalised, cumulative). Purely client-side. */

const W = 320, DT = 0.1, HALF = 11, R = 16, MAX_FRAMES = 200, LOST = 34; // patch 23×23 px, search ±16 px, mean abs diff limit (0–255)

// anchor = the spot the symbol marks: arrows their tip, everything else its centre
const OFFS = (() => { const o = []; for(let dy=-R; dy<=R; dy++) for(let dx=-R; dx<=R; dx++) o.push([dx,dy]); return o.sort((p,q) => (p[0]*p[0]+p[1]*p[1])-(q[0]*q[0]+q[1]*q[1])); })();

const anchorOf = a => a.type==='arrow' && a.x2!=null ? {x:a.x2, y:a.y2} : {x:a.x, y:a.y};
const trackEnd = a => a.track && a.track.pts && a.track.pts.length ? a.track.t0 + (a.track.pts.length-1)*a.track.dt : (a.t||0);
// the symbol shifted to where its spot is at video time vt (returns a itself when there is nothing to shift)
function trackedAt(a, vt){
  const tr = a.track; if(!tr || vt==null || !tr.pts || tr.pts.length < 2) return a;
  const f = (vt - tr.t0)/tr.dt; if(f <= 0) return a;
  const i = Math.min(tr.pts.length-1, Math.floor(f)), j = Math.min(tr.pts.length-1, i+1), u = Math.min(1, Math.max(0, f-i));
  const dx = tr.pts[i][0] + (tr.pts[j][0]-tr.pts[i][0])*u, dy = tr.pts[i][1] + (tr.pts[j][1]-tr.pts[i][1])*u;
  if(!dx && !dy) return a;
  const c = Object.assign({}, a, {x:a.x+dx, y:a.y+dy}); if(a.x2!=null){ c.x2 = a.x2+dx; c.y2 = a.y2+dy; } return c;
}

function seek(v, t){ return new Promise(res => { let done = false; const fin = () => { if(done) return; done = true; v.removeEventListener('seeked', fin); res(); }; v.addEventListener('seeked', fin); setTimeout(fin, 1500); try{ v.currentTime = t; }catch(e){ fin(); } }); }
function grey(ctx, v, w, h){ ctx.drawImage(v, 0, 0, w, h); const d = ctx.getImageData(0, 0, w, h).data; const g = new Float32Array(w*h); for(let i=0, j=0; i<g.length; i++, j+=4) g[i] = d[j]*0.299 + d[j+1]*0.587 + d[j+2]*0.114; return g; }
// mean absolute difference between the patch at (px,py) in A and at (qx,qy) in B
function mad(A, B, w, h, px, py, qx, qy){ let s = 0, n = 0; for(let y=-HALF; y<=HALF; y++){ const ay = py+y, by = qy+y; if(ay<0||by<0||ay>=h||by>=h) continue; for(let x=-HALF; x<=HALF; x++){ const ax = px+x, bx = qx+x; if(ax<0||bx<0||ax>=w||bx>=w) continue; s += Math.abs(A[ay*w+ax]-B[by*w+bx]); n++; } } return n ? s/n : 1e9; }

/* track the anchor of `a` from a.t to tEnd in the video at `src`; onProgress(0..1). Resolves {track, lostAt|null} or null when the video cannot be read. */
async function trackAnn(src, a, tEnd, onProgress){
  // v12.49: the video sits (invisibly) in the page and is started once – iPhones only decode frames of a video that is in the
  // document and has played; before, Safari could hand over black frames and the "track" silently stayed in place
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.preload = 'auto'; v.crossOrigin = 'anonymous';
  v.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none'; document.body.appendChild(v); v.src = src;
  const cleanup = () => { try{ v.pause(); v.removeAttribute('src'); v.load(); v.remove(); }catch(e){} };
  await new Promise((res, rej) => { v.addEventListener('loadeddata', res, {once:true}); v.addEventListener('error', rej, {once:true}); setTimeout(res, 4000); }).catch(() => null);
  if(!v.videoWidth){ cleanup(); return null; }
  try{ await v.play(); }catch(e){} try{ v.pause(); }catch(e){}
  const w = W, h = Math.max(16, Math.round(W*v.videoHeight/v.videoWidth)); const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d', {willReadFrequently:true});
  const t0 = a.t||0; const an = anchorOf(a); let px = Math.round(an.x*w), py = Math.round(an.y*h); const ox = px, oy = py;
  const n = Math.min(MAX_FRAMES, Math.max(0, Math.floor((tEnd - t0)/DT)));
  await seek(v, t0); let prev; try{ prev = grey(ctx, v, w, h); }catch(e){ cleanup(); return null; } // tainted canvas (no CORS) → null
  { let lo = 255, hi = 0; for(let i = 0; i < prev.length; i += 7){ const g = prev[i]; if(g < lo) lo = g; if(g > hi) hi = g; } if(hi - lo < 4){ cleanup(); return null; } } // a flat (black) frame: this device does not hand out video frames
  const pts = [[0,0]]; let lostAt = null; let ref = prev;
  for(let k=1; k<=n; k++){
    await seek(v, t0 + k*DT); const cur = grey(ctx, v, w, h);
    let best = 1e9, bx = px, by = py;
    for(const [dx,dy] of OFFS){ const m = mad(ref, cur, w, h, px, py, px+dx, py+dy); if(m < best){ best = m; bx = px+dx; by = py+dy; } } // OFFS sorted by distance: ties favour small motion
    if(best > LOST || bx <= HALF || by <= HALF || bx >= w-HALF || by >= h-HALF){ lostAt = t0 + (k-1)*DT; break; }
    px = bx; py = by; ref = cur; pts.push([(px-ox)/w, (py-oy)/h]);
    if(onProgress) onProgress(k/n);
  }
  cleanup();
  return {track:{t0, dt:DT, pts}, lostAt};
}

export { anchorOf, trackEnd, trackedAt, trackAnn };
