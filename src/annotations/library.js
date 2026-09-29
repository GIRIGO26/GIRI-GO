// v12.40 – the symbol library: one sheet for everything that can go into a picture.
// Tabs: recent · mark (arrows, shapes, text) · status (check, cross, thumbs, smileys, numbers) · safety (ISO 7010, 332 signs in five
// classes + the three quick warning triangles) · own (workspace symbols) · emoji. Tiles are drawn with the real renderer, so what
// you see in the sheet is the 3D look that lands in the picture.
import { $$, el, esc, modal } from '../core/helpers.js';
import { G } from '../core/state.js';
import { t } from '../core/i18n.js';
import { COLORS, drawAnn, isoUrl, preloadImg, onImgReady } from './draw.js';

// vector tools – id, annotation type and the extra fields the placed symbol starts with
const VECTOR = [
  { id:'arrow', type:'arrow', tab:'mark' }, { id:'turn', type:'turn', tab:'mark', extra:{dir:'cw'} }, { id:'turn_ccw', type:'turn', tab:'mark', extra:{dir:'ccw'} },
  { id:'pin', type:'pin', tab:'mark' }, { id:'circle', type:'circle', tab:'mark' }, { id:'rect', type:'rect', tab:'mark' }, { id:'text', type:'text', tab:'mark' }, { id:'number', type:'number', tab:'mark' },
  { id:'check', type:'check', tab:'status' }, { id:'cross', type:'cross', tab:'status' }, { id:'thumb_up', type:'thumb', tab:'status', extra:{dir:'up'} }, { id:'thumb_down', type:'thumb', tab:'status', extra:{dir:'down'}, color:'red' },
  { id:'smile', type:'smile', tab:'status', color:'yellow' }, { id:'smile_sad', type:'smile', tab:'status', extra:{mood:'sad'}, color:'yellow' },
  { id:'warn', type:'warn', tab:'safety' }, { id:'elec', type:'elec', tab:'safety' }, { id:'hot', type:'hot', tab:'safety' },
  { id:'emoji', type:'emoji', tab:'emoji' }, { id:'img', type:'img', tab:'own' },
];
const ISO_GROUPS = ['W', 'P', 'M', 'E', 'F'];
let isoIndex = null, isoLoading = null;
const loadIso = () => { if(isoIndex) return Promise.resolve(isoIndex); if(!isoLoading) isoLoading = fetch('symbols/iso/index.json').then(r => r.json()).then(j => { isoIndex = j; return j; }).catch(() => { isoLoading = null; return []; }); return isoLoading; };
const isoName = e => (G.LANG==='de' ? e.de : e.en) || e.en;

// recently used tools (this device)
const recent = () => { try{ return JSON.parse(localStorage.getItem('gg_symrecent')||'[]'); }catch(e){ return []; } };
const remember = spec => { try{ const key = JSON.stringify(spec); const list = [spec, ...recent().filter(x => JSON.stringify(x) !== key)].slice(0, 12); localStorage.setItem('gg_symrecent', JSON.stringify(list)); }catch(e){} };

// a sample annotation for a tile preview
const sample = (v, color) => { const a = Object.assign({id:'p', type:v.type, color: color || v.color || 'blue', size:0.78, x:0.5, y:0.5}, v.extra||{});
  if(v.type==='arrow') Object.assign(a, {x:0.2, y:0.78, x2:0.8, y2:0.22, size:0.5});
  else if(v.type==='circle'||v.type==='rect') Object.assign(a, {x:0.2, y:0.2, x2:0.8, y2:0.8, size:0.4});
  else if(v.type==='text') Object.assign(a, {x:0.28, y:0.5, text:'10 Nm', size:0.42});
  else if(v.type==='number') a.n = 1;
  else if(v.type==='pin'){ a.y = 0.9; a.size = 0.95; }
  else if(v.type==='number'||v.type==='check'||v.type==='cross'||v.type==='smile') a.size = 0.95;
  else if(v.type==='warn'||v.type==='elec'||v.type==='hot') a.size = 0.9;
  else if(v.type==='emoji') a.emoji = '😀';
  return a; };
function previewCanvas(spec, size){
  const c = document.createElement('canvas'); const dpr = window.devicePixelRatio||1; c.width = size*dpr; c.height = size*dpr; c.style.width = c.style.height = size+'px';
  const ctx = c.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  try{ drawAnn(ctx, sample(spec, spec.color), {x:0, y:0, w:size, h:size}, false, null); }catch(e){}
  return c;
}
const labelOf = v => t('tool_'+v.id);

// opens the sheet; resolves with a tool spec {id, type, extra?, code?, r?, name?} or null
function symbolSheet(opts={}){
  let tab = 'mark'; try{ tab = localStorage.getItem('gg_symtab') || (recent().length ? 'recent' : 'mark'); }catch(e){}
  let isoGrp = 'W'; try{ isoGrp = localStorage.getItem('gg_isogrp') || 'W'; }catch(e){}
  const TABS = [['recent', t('sy_recent')], ['mark', t('sy_mark')], ['status', t('sy_status')], ['safety', t('sy_safety')], ['own', t('sy_own')], ['emoji', t('sy_emoji')]];
  return modal(`<div class="symsheet">
      <div class="ss-head"><h2>${t('mark_img')}</h2><label class="ss-search">${'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>'}<input id="ss-q" data-nofocus type="search" placeholder="${t('sy_search')}" autocomplete="off"></label><button class="ss-x" data-x aria-label="${t('close')}">×</button></div>
      <div class="ss-tabs" id="ss-tabs">${TABS.map(([k, l]) => `<button class="ss-tab ${k===tab?'on':''}" data-tab="${k}" ${k==='recent' && !recent().length ? 'hidden' : ''}>${l}</button>`).join('')}</div>
      <div class="ss-body" id="ss-body"></div>
      <p class="ss-hint">${t('sy_hint')}</p>
    </div>`, (bg, close) => {
    const body = bg.querySelector('#ss-body'), q = bg.querySelector('#ss-q');
    const pick = spec => { remember(spec); close(spec); };
    const tile = (spec, label, node) => { const b = el(`<button class="ss-tile" title="${esc(label)}"></button>`); b.appendChild(node); b.appendChild(el(`<span>${esc(label)}</span>`)); b.onclick = () => pick(spec); return b; };
    const vectorTile = v => tile({id:v.id, type:v.type, extra:v.extra||null, color:v.color||null}, labelOf(v), previewCanvas(v, 52));
    const isoTile = e => { const img = el(`<img class="ss-iso" src="${isoUrl(e.c)}" alt="" loading="lazy" decoding="async">`); const b = tile({id:'iso', type:'iso', code:e.c, r:e.r||1, name:isoName(e)}, isoName(e), img); b.classList.add('iso'); return b; };
    const grid = (nodes, cls='') => { const g = el(`<div class="ss-grid ${cls}"></div>`); nodes.forEach(n => g.appendChild(n)); return g; };
    const section = (title, nodes, cls) => { const s = el(`<section class="ss-sec"></section>`); if(title) s.appendChild(el(`<div class="ss-lbl">${esc(title)}</div>`)); s.appendChild(grid(nodes, cls)); return s; };
    const ownTiles = () => { const syms = (opts.symbols || []); const nodes = syms.map(sy => { const img = el(`<img src="${esc(sy.url)}" alt="" loading="lazy">`); return tile({id:'img', type:'img', src:sy.url, name:sy.name||'', ar:sy.ar||1, alpha:!!sy.alpha}, sy.name||t('tool_img'), img); });
      const add = el(`<button class="ss-tile add"><span class="ss-plus">+</span><span>${t('sym_add')}</span></button>`); add.onclick = () => close({id:'img', type:'img', manage:true}); nodes.push(add); return nodes; };
    const show = async () => {
      const term = q.value.trim().toLowerCase(); body.innerHTML = '';
      if(term){
        const hitsV = VECTOR.filter(v => v.id!=='img' && labelOf(v).toLowerCase().includes(term));
        const iso = await loadIso(); const hitsI = iso.filter(e => isoName(e).toLowerCase().includes(term) || e.en.toLowerCase().includes(term) || e.c.toLowerCase()===term).slice(0, 60);
        if(hitsV.length) body.appendChild(section(t('sy_mark'), hitsV.map(vectorTile)));
        if(hitsI.length) body.appendChild(section(t('sy_safety')+' · ISO 7010', hitsI.map(isoTile), 'iso'));
        if(!hitsV.length && !hitsI.length) body.innerHTML = `<div class="muted" style="padding:16px">${t('no_result')}</div>`;
        return; }
      if(tab==='recent'){ const list = recent(); body.appendChild(section('', list.map(spec => { if(spec.type==='iso'){ const img = el(`<img class="ss-iso" src="${isoUrl(spec.code)}" alt="">`); const b = tile(spec, spec.name||spec.code, img); b.classList.add('iso'); return b; } if(spec.type==='img'){ const img = el(`<img src="${esc(spec.src)}" alt="">`); return tile(spec, spec.name||t('tool_img'), img); } const v = VECTOR.find(x => x.id===spec.id) || {id:spec.id, type:spec.type, extra:spec.extra}; return tile(spec, labelOf(v), previewCanvas(v, 52)); }))); }
      else if(tab==='safety'){
        body.appendChild(section(t('sy_quick'), VECTOR.filter(v => v.tab==='safety').map(vectorTile)));
        const chips = el(`<div class="ss-chips">${ISO_GROUPS.map(k => `<button class="ss-chip g${k} ${k===isoGrp?'on':''}" data-g="${k}">${t('iso_'+k)}</button>`).join('')}</div>`); body.appendChild(chips);
        const holder = el(`<div></div>`); body.appendChild(holder);
        const fill = async () => { const iso = await loadIso(); holder.innerHTML = ''; holder.appendChild(section('ISO 7010 · '+t('iso_'+isoGrp), iso.filter(e => e.k===isoGrp.toLowerCase()[0] || e.k===isoGrp).map(isoTile), 'iso')); };
        $$('[data-g]', chips).forEach(b => b.onclick = () => { isoGrp = b.dataset.g; try{ localStorage.setItem('gg_isogrp', isoGrp); }catch(e){} $$('[data-g]', chips).forEach(x => x.classList.toggle('on', x===b)); fill(); });
        fill(); }
      else if(tab==='own'){ body.appendChild(section('', ownTiles())); }
      else if(tab==='emoji'){ const r = (G.recentEmojis||[]); const emo = el(`<div class="ss-sec"><div class="ss-lbl">${t('tool_emoji')}</div><div class="ss-grid emo">${['😀','👍','👎','⭐','❗','❓','🔥','💧','⚡','🧤','🥽','🦺','🔩','🔧','🪛','🧹','🧯','🚫','⏱️','📦','✅','❌','⬆️','⬇️','⬅️','➡️'].concat(r).filter((e,i,a) => a.indexOf(e)===i).map(e => `<button class="ss-tile emo" data-e="${e}"><span class="ss-emo">${e}</span></button>`).join('')}<button class="ss-tile add" data-more><span class="ss-plus">…</span><span>${t('sy_all_emoji')}</span></button></div></div>`); body.appendChild(emo);
        $$('[data-e]', emo).forEach(b => b.onclick = () => pick({id:'emoji', type:'emoji', emoji:b.dataset.e})); emo.querySelector('[data-more]').onclick = () => close({id:'emoji', type:'emoji', picker:true}); }
      else { body.appendChild(section('', VECTOR.filter(v => v.tab===tab).map(vectorTile))); }
    };
    $$('[data-tab]', bg).forEach(b => b.onclick = () => { tab = b.dataset.tab; try{ localStorage.setItem('gg_symtab', tab); }catch(e){} $$('[data-tab]', bg).forEach(x => x.classList.toggle('on', x===b)); q.value = ''; show(); });
    let tmr = 0; q.oninput = () => { clearTimeout(tmr); tmr = setTimeout(show, 120); };
    bg.querySelector('[data-x]').onclick = () => close(null);
    const off = onImgReady(() => {}); bg.addEventListener('close', off);
    show();
  });
}

export { VECTOR, ISO_GROUPS, loadIso, isoName, symbolSheet, previewCanvas, recent as recentSymbols };
