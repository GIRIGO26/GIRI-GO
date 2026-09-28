/* ---------- Papierkorb-Seite (#/trash): gelöschte Anleitungen wiederherstellen oder endgültig löschen ---------- */
import { S } from '../core/state.js';
import { t, fmtDate } from '../core/i18n.js';
import { el, esc, toast, confirmM } from '../core/helpers.js';
import { realSteps } from '../core/auth.js';
import { loadInstrs } from '../core/translate.js';
import { topbar } from '../ui/topbar.js';
import { IC } from '../ui/icons.js';
import { stepPoster, nOf } from './dashboard.js';
import { loadTrash, restoreInstr, purgeInstr, TRASH_DAYS, trashAge } from '../core/trash.js';
import { DB, uid } from '../core/storage.js';
import { modal } from '../core/helpers.js';
import { saveInstr } from '../core/passwords.js';
import { mirrorList } from '../core/offline.js';
import { runUploads } from '../core/uploads.js';
import { mediaUrl } from '../core/state.js';

async function renderTrash(app){
  topbar(app, {back:'/', sub: t('trash')});
  const v = el(`<main class="page"><div class="dash-head"><div><h1>${t('trash')}</h1><div class="sub">${t('trash_sub', {d: TRASH_DAYS})}</div></div></div><div class="list" id="tlist"><div class="loading"><div class="spin"></div></div></div></main>`);
  app.appendChild(v);
  let rows = []; try{ rows = await loadTrash(); }catch(e){ toast(e.message||String(e)); }
  const list = v.querySelector('#tlist'); list.innerHTML = '';
  const emptyHtml = `<div class="card empty"><h2>${t('trash_empty')}</h2><div>${t('trash_empty_sub')}</div></div>`;
  renderOrphans(v).catch(() => {});
  if(!rows.length){ list.innerHTML = emptyHtml; return; }
  const canEdit = S.user.role !== 'viewer' || S.user.isAdmin;
  rows.forEach(i => {
    const st = realSteps(i); const left = Math.max(0, TRASH_DAYS - trashAge(i.deletedAt));
    const card = el(`<article class="card instr trash"><img class="thumb" alt="" src=""><div><div class="title">${esc(i.title)}</div>
      <div class="meta"><span>${nOf(st.length, 'step', 'steps')}</span><span>v${i.version}</span><span>${t('deleted_on')} ${fmtDate(i.deletedAt)}</span><span class="${left <= 5 ? 'warn' : ''}">${t('purge_in', {d: left})}</span></div>
      ${canEdit ? `<div class="acts"><button class="btn" data-a="restore">${t('restore')}</button><button class="btn ghost del" data-a="purge">${IC.trash} ${t('purge')}</button></div>` : ''}</div></article>`);
    if(st[0]) stepPoster(st[0]).then(u => { if(u) card.querySelector('.thumb').src = u; });
    card.onclick = async e => { const b = e.target.closest('[data-a]'); if(!b) return; b.disabled = true;
      try{
        if(b.dataset.a === 'restore'){ await restoreInstr(i.id); await loadInstrs(); toast(t('restored')); card.remove(); if(!list.children.length) list.innerHTML = emptyHtml; }
        else { if(!(await confirmM(t('purge_q', {t: i.title}), t('purge')))){ b.disabled = false; return; } await purgeInstr(i); toast(t('deleted')); card.remove(); if(!list.children.length) list.innerHTML = emptyHtml; }
      }catch(err){ toast(err.message||String(err)); b.disabled = false; } };
    list.appendChild(card);
  });
}

// recordings that sit on this device but belong to no instruction any more (connection lost while the step list was saved, instruction purged, …)
async function renderOrphans(v){
  const media = (await DB.all('media')).filter(m => m.ws === S.user.ws && (m.buf || m.blob) && !m.cache); // cache: offline copies for viewing, not recordings
  if(!media.length) return;
  const known = new Set(); const all = S.instrs.concat(await mirrorList());
  all.forEach(i => (i.steps||[]).concat(i.trash||[]).forEach(s => { if(s.mediaId) known.add(s.mediaId); }));
  const orphans = media.filter(m => !known.has(m.id) && m.type!=='photo-note'); if(!orphans.length) return;
  const box = el(`<section style="margin-top:22px"><h3 style="margin:0 0 4px">${t('orphans')} <span class="tnum cnt" style="background:var(--surface-2);color:var(--ink-2);font-size:12px;padding:1px 8px;border-radius:999px">${orphans.length}</span></h3><p class="muted" style="margin:0 0 10px">${t('orphans_sub')}</p><div class="list" id="olist"></div></section>`);
  const ol = box.querySelector('#olist');
  for(const m of orphans){
    const card = el(`<article class="card instr"><img class="thumb" alt="" src=""><div><div class="title">${m.type==='video' ? '🎬' : '📷'} ${m.type==='video' ? (m.duration ? Math.round(m.duration)+' s' : 'Video') : 'Foto'}</div><div class="meta"><span>${m.w||'?'}×${m.h||'?'}</span><span>${m.remote ? '☁︎' : t('offline')}</span></div><div class="acts"><button class="btn" data-a="take">${t('orphan_take')}</button><button class="btn ghost del" data-a="del">${IC.trash} ${t('purge')}</button></div></div></article>`);
    try{ const u = await mediaUrl(m.id); if(u){ if(m.type==='video'){ const vd = document.createElement('video'); vd.src = u; vd.muted = true; vd.playsInline = true; vd.style.cssText = 'width:100%;aspect-ratio:1;object-fit:cover;border-radius:16px;background:#222'; card.querySelector('.thumb').replaceWith(vd); } else card.querySelector('.thumb').src = u; } }catch(e){}
    card.onclick = async e => { const b = e.target.closest('[data-a]'); if(!b) return;
      if(b.dataset.a==='del'){ if(!(await confirmM(t('purge_step_q'), t('purge')))) return; await DB.del('media', m.id); card.remove(); toast(t('deleted')); return; }
      let target = S.instrs.find(i => i.id===m.instrId);
      if(!target){ if(!S.instrs.length){ toast(t('empty_title')); return; } const pick = await modal(`<h2>${t('orphan_pick')}</h2><div class="menu">${S.instrs.map(i => `<button data-i="${i.id}">${esc(i.title)}</button>`).join('')}</div>`, (bg, close) => { bg.querySelectorAll('[data-i]').forEach(x => x.onclick = () => close(x.dataset.i)); }); if(!pick) return; target = S.instrs.find(i => i.id===pick); }
      if(!target) return;
      const ns = {id:uid(), type:m.type, mediaId:m.id, w:m.w, h:m.h, duration:m.duration, trimStart:0, trimEnd:m.duration, title:'', desc:'', warn:'', ann:[], poster:m.poster||null}; if(m.remote){ ns.mediaUrl = m.remote; ns.mediaPath = m.path; }
      target.steps.push(ns); if(m.instrId !== target.id){ m.instrId = target.id; await DB.put('media', m); }
      await saveInstr(target); runUploads(); card.remove(); toast(t('orphan_added', {n: realSteps(target).length})); };
    ol.appendChild(card);
  }
  v.appendChild(box);
}

export { renderTrash };
