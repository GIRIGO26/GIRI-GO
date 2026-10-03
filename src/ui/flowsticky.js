/* ---------- v12.49: one page, one scroll (since v12.51 only the navigator of the start page; the editor: see 09-premium.css) ----------
   Side columns (the step list and the step itself in the editor, the navigator on the start page) used to be sticky boxes with
   their own scroll bar: the mouse wheel over a box moved only the box, never the page – "the page does not scroll along".
   Now there is only the page scroll. A column that fits into the window stays put (sticky, as before). A column taller than the
   window moves with the page and stops at its own end – scrolling up it moves back and stops at its start (the pattern of long
   sidebars in feeds). Technically: position:sticky with a `top` that follows the scroll, clamped between "column top under the head"
   and "column bottom at the window bottom". */

function flowSticky(el, getTop, opts = {}){
  const mq = opts.media ? matchMedia(opts.media) : null;
  let cur = null, lastY = window.scrollY, dead = false;
  const off = () => { el.style.top = ''; el.classList.remove('fsticky'); cur = null; };
  let revealUntil = 0, revealing = false;
  const apply = () => {
    if(dead) return;
    if(!el.isConnected){ destroy(); return; }
    const y = window.scrollY;
    if(mq && !mq.matches){ off(); lastY = y; return; }
    el.classList.add('fsticky');
    const top = getTop(), V = window.innerHeight, H = el.offsetHeight;
    const minTop = Math.min(top, V - H - 16); // a tall column: its bottom may come up to 16 px above the window bottom
    if(cur === null) cur = top;
    cur = Math.max(minTop, Math.min(top, cur - (y - lastY)));
    lastY = y; el.style.top = Math.round(cur) + 'px';
    if(!revealing && performance.now() < revealUntil) reveal();
  };
  // after reset(): the start of the column must really be visible – near the end of the page the column cannot move up any further
  // (it may not leave its box), then the page scrolls back by the missing bit; repeated while the new content is still growing
  const reveal = () => { revealing = true; try{ const want = getTop();
    for(let k = 0; k < 4; k++){ const at = el.getBoundingClientRect().top; if(at >= want - 2 || window.scrollY <= 0) break; window.scrollBy(0, at - want); cur = want; lastY = window.scrollY; el.style.top = Math.round(cur) + 'px'; } }
    finally{ revealing = false; } };
  const onScroll = () => apply();
  window.addEventListener('scroll', onScroll, {passive: true});
  window.addEventListener('resize', onScroll);
  // the column changes its height (a folder opens, a list grows): place it again – in the next frame (no "ResizeObserver loop" warning).
  // v12.51: the observe() call had slipped into the comment of the line above – heights were only re-read on the next scroll
  let raf = 0; const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(apply); }) : null;
  if(ro) ro.observe(el);
  if(mq && mq.addEventListener) mq.addEventListener('change', onScroll);
  function destroy(){ if(dead) return; dead = true; window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if(ro) ro.disconnect(); if(mq && mq.removeEventListener) mq.removeEventListener('change', onScroll); }
  apply();
  // reset(): show the column's start again (e.g. after picking another step – the picture is at the top of the column)
  // (near the end of the page the column cannot move up any further – then the page itself scrolls back by the missing bit)
  return { reset(){ cur = null; revealUntil = performance.now() + 1500; apply(); [16, 120, 350, 800].forEach(ms => setTimeout(apply, ms)); }, destroy, apply };
}

export { flowSticky };
