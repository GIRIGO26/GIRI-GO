/* ---------- KI-PDF-Import (v0.28): existing work instruction as PDF → proposed steps → review → new instruction ----------
   1. Browser: the PDF is sent to the edge function "pdf-analyze" (Gemini 3.5 Flash, Vertex AI europe-west3 – stays in Germany).
   2. Browser (pdf.js, vendored, loaded on first use): pages are rendered locally; the pictures of each step are cut out of the page
      with the bounding boxes the model returned. The pictures never leave the device before the user takes over the steps.
   3. Review dialog: edit / delete / reorder, choose picture (cut-out · whole page · title card), then "Übernehmen" creates the instruction. */
import { newShareKey } from '../core/links.js';
import { $, $$, el, esc, modal, toast } from '../core/helpers.js';
import { G, S, putMedia } from '../core/state.js';
import { uid } from '../core/storage.js';
import { t } from '../core/i18n.js';
import { saveInstr } from '../core/passwords.js';
import { runUploads } from '../core/uploads.js';
import { IC } from '../ui/icons.js';

const MAX_MB = 12;
// the default style guide ("GIRI-Leitfaden") – the edge function has the same text as fallback; users may adapt it per import, admins per workspace
const GUIDE = {de: `GIRI-Leitfaden – so wird aus einem Dokument die beste Arbeitsanleitung der Welt, die jede und jeder sofort versteht:

1. Eine Handlung pro Schritt. Jeder Schritt wird später als kurzes Video aufgenommen – maximal 5 Sekunden, genau eine Bewegung. Enthält ein Satz im Dokument mehrere Handlungen, teile ihn in mehrere Schritte auf. Lieber mehr kleine Schritte als ein großer.
2. Orientierung zuerst: Wo bin ich? Wo muss ich hin? Was muss ich tun? Wechseln Arbeitsplatz, Werkzeug, Material oder Position, setze vorher einen kurzen Orientierungsschritt (z. B. „Zu Station 4 gehen“, „Drehmomentschlüssel nehmen“) – nur wenn es sich aus dem Dokument ergibt.
3. Titel = Objekt + Verb, 2–5 Wörter. Kein Artikel, kein „bitte“, keine Füllwörter, keine ganzen Schulsätze. „Box öffnen“ statt „Bitte die Box vorsichtig öffnen“. „Schraube M6 einsetzen“ statt „Nun wird die Schraube eingesetzt“.
4. Beschreibung nur, wenn sie wirklich hilft: höchstens 1–2 kurze Zeilen, Stichworte statt Sätze, Werte nach vorn („10 Nm · über Kreuz“). Niemand liest langen Text.
5. Warnhinweise kurz und klar: Gefahr – Maßnahme („Quetschgefahr – Finger weg vom Hebel“). Direkt am betroffenen Schritt, nicht gesammelt am Anfang.
6. Kapitel bilden, sobald die Anleitung mehr als etwa 8 Schritte hat: sinnvolle Abschnitte mit 3–8 Schritten, Kapitelnamen 1–3 Wörter („Vorbereitung“, „Montage“, „Prüfung“).
7. Ton: klar, direkt, respektvoll – leicht motivierend ist erlaubt, nie übertrieben. Z. B. als Beschreibung des letzten Schritts eines Kapitels: „Sitzt. Weiter mit der Prüfung.“ Sparsam einsetzen, keine Ausrufezeichen-Ketten.
8. Aufnahme-Hinweis („shot“) für jeden Schritt: Was zeigt das 5-Sekunden-Video? Perspektive, Hände, Bauteil, die eine Bewegung – z. B. „Nahaufnahme: Hebel schließt, Klick“.
9. Fachbegriffe, Teilenummern und Werte exakt übernehmen. Nichts erfinden, nichts weglassen, was für Sicherheit oder Qualität zählt.`,
en: `GIRI guide – turn a document into the best work instruction in the world, one that anyone understands at a glance:

1. One action per step. Every step is later recorded as a short video – 5 seconds max, exactly one movement. If a sentence in the document contains several actions, split it into several steps. Rather more small steps than one big one.
2. Orientation first: Where am I? Where do I need to go? What do I do there? When the workstation, tool, material or position changes, add a short orientation step first (e.g. "Go to station 4", "Take torque wrench") – only if it follows from the document.
3. Title = object + verb, 2–5 words. No articles, no "please", no filler, no full school sentences. "Open box" instead of "Please carefully open the box".
4. Description only when it really helps: 1–2 short lines at most, keywords instead of sentences, values first ("10 Nm · crosswise"). Nobody reads long text.
5. Warnings short and clear: hazard – measure ("Pinch hazard – keep fingers off the lever"). Directly on the affected step, not collected at the start.
6. Build chapters as soon as the instruction has more than about 8 steps: meaningful sections of 3–8 steps, chapter names of 1–3 words ("Preparation", "Assembly", "Inspection").
7. Tone: clear, direct, respectful – slightly motivating is fine, never exaggerated. E.g. as description of the last step of a chapter: "Done. On to inspection." Use sparingly, no exclamation-mark chains.
8. Recording hint ("shot") for every step: what does the 5-second video show? Camera view, hands, part, the one movement – e.g. "Close-up: lever closes, click".
9. Take technical terms, part numbers and values over exactly. Invent nothing, leave out nothing that matters for safety or quality.`};
const defaultGuide = () => GUIDE[G.LANG==='de' ? 'de' : 'en'];
const GUIDE_KEY = 'gg_pdf_guide';
const wsGuide = () => (S.wsRow && S.wsRow.settings && S.wsRow.settings.pdfGuide) || '';
const currentGuide = () => { let g = ''; try{ g = localStorage.getItem(GUIDE_KEY) || ''; }catch(e){} return g || wsGuide() || defaultGuide(); };
let pdfjsReady = null;
function loadPdfJs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if(pdfjsReady) return pdfjsReady;
  pdfjsReady = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/pdf.min.js'; s.onload = () => { try{ window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; res(window.pdfjsLib); }catch(e){ rej(e); } }; s.onerror = () => { pdfjsReady = null; rej(new Error('pdf.js')); }; document.head.appendChild(s); });
  return pdfjsReady;
}
const toB64 = buf => { const b = new Uint8Array(buf); let s = ''; const CH = 0x8000; for(let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH)); return btoa(s); };
const canvasBlob = (c, q = .88) => new Promise(r => c.toBlob(r, 'image/jpeg', q));
const cleanWarn = w => String(w||'').replace(/^\s*(achtung|warnung|vorsicht|hinweis|gefahr|caution|warning|danger|notice)\s*[:!-]\s*/i, '').trim();

// render one page to a canvas (longest side ~1800 px – sharp enough for a step picture, small enough for phones)
async function renderPage(doc, n, cache){
  if(cache.has(n)) return cache.get(n);
  const p = (async () => { const page = await doc.getPage(n); const v1 = page.getViewport({scale:1}); const sc = Math.min(3, 1800/Math.max(v1.width, v1.height)); const vp = page.getViewport({scale:sc});
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await page.render({canvasContext:x, viewport:vp}).promise; return c; })();
  cache.set(n, p); return p;
}
// cut a [ymin,xmin,ymax,xmax] (0–1000) box out of a rendered page, with a small margin
function cropBox(page, box){
  const [y0, x0, y1, x1] = box; const W = page.width, H = page.height; const m = 0.006;
  let sx = Math.max(0, (Math.min(x0, x1)/1000 - m)*W), sy = Math.max(0, (Math.min(y0, y1)/1000 - m)*H), ex = Math.min(W, (Math.max(x0, x1)/1000 + m)*W), ey = Math.min(H, (Math.max(y0, y1)/1000 + m)*H);
  if(ex - sx < 24 || ey - sy < 24) return null;
  const c = document.createElement('canvas'); c.width = Math.round(ex - sx); c.height = Math.round(ey - sy); c.getContext('2d').drawImage(page, sx, sy, c.width, c.height, 0, 0, c.width, c.height); return c;
}
// title card for steps without a picture: brand colour, step title – replace later by recording
function titleCard(title, n){
  const c = document.createElement('canvas'); c.width = 1280; c.height = 960; const x = c.getContext('2d'); const col = (S.brand && S.brand.color) || '#004EAD';
  const g = x.createLinearGradient(0, 0, 1280, 960); g.addColorStop(0, col); g.addColorStop(1, '#0B0B0C'); x.fillStyle = g; x.fillRect(0, 0, 1280, 960);
  x.fillStyle = 'rgba(255,255,255,.14)'; x.font = '800 260px Montserrat, system-ui, sans-serif'; x.textAlign = 'right'; x.fillText(String(n), 1220, 320);
  x.fillStyle = '#fff'; x.textAlign = 'left'; x.font = '700 64px Montserrat, system-ui, sans-serif';
  const words = String(title||'').split(/\s+/); const lines = []; let cur = ''; for(const w of words){ const tr = cur ? cur + ' ' + w : w; if(x.measureText(tr).width > 1100 && cur){ lines.push(cur); cur = w; } else cur = tr; } if(cur) lines.push(cur);
  lines.slice(0, 5).forEach((l, i) => x.fillText(l, 80, 560 + i*80 - (Math.min(5, lines.length)-1)*40));
  return c;
}

// the whole flow; folderId = project the instruction goes into (or null)
async function pdfImport(folderId){
  // start sheet: what happens + the AI guide (collapsible, editable), then pick the PDF
  const isAdmin = S.user && S.user.isAdmin; let guide = currentGuide();
  const go = await modal(`<div class="pdfi-head"><span class="pdfi-ico ai">✦</span><div><h2>${t('ni_pdf')}</h2><div class="muted">${t('pdfi_intro')}</div></div></div>
    <ul class="pdfi-rules"><li>${t('pdfi_r1')}</li><li>${t('pdfi_r2')}</li><li>${t('pdfi_r3')}</li><li>${t('pdfi_r4')}</li></ul>
    <details class="pdfi-guide"><summary>${t('pdfi_guide')} <span class="muted">${guide !== defaultGuide() ? '· ' + t('pdfi_guide_custom') : ''}</span></summary>
      <p class="muted" style="margin:8px 0">${t('pdfi_guide_sub')}</p><textarea id="pg-t" rows="12">${esc(guide)}</textarea>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px"><button class="btn ghost sm" data-reset>${t('pdfi_guide_reset')}</button>${isAdmin ? `<button class="btn ghost sm" data-wsave>${t('pdfi_guide_ws')}</button><a class="btn ghost sm" href="#/admin/ai" data-aicfg>${IC.gear} ${t('ai_cfg_open')}</a>` : ''}</div></details>
    <p class="muted pdfi-note" style="margin-top:12px">${t('pdfi_privacy')}</p>
    <div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn mint" data-ok>${IC.upload} ${t('pdfi_pick')}</button></div>`, (bg, close) => {
      const ta = bg.querySelector('#pg-t'); ta.oninput = () => { guide = ta.value; };
      bg.querySelector('[data-reset]').onclick = () => { ta.value = guide = wsGuide() || defaultGuide(); toast(t('pdfi_guide_reset_done')); };
      const ws = bg.querySelector('[data-wsave]'); if(ws) ws.onclick = async () => { try{ const { saveWs } = await import('../core/workspace.js'); await saveWs({settings: Object.assign({}, S.wsRow.settings||{}, {pdfGuide: ta.value.trim() === defaultGuide().trim() ? '' : ta.value.trim()})}); toast(t('saved')); }catch(e){} };
      const ac = bg.querySelector('[data-aicfg]'); if(ac) ac.onclick = () => close(false);
      bg.querySelector('[data-x]').onclick = () => close(false); bg.querySelector('[data-ok]').onclick = () => close(true); });
  if(!go) return;
  try{ if(guide.trim() && guide.trim() !== (wsGuide() || defaultGuide()).trim()) localStorage.setItem(GUIDE_KEY, guide.trim()); else localStorage.removeItem(GUIDE_KEY); }catch(e){}
  const file = await new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/pdf,.pdf'; i.onchange = () => res(i.files[0] || null); i.addEventListener('cancel', () => res(null)); i.click(); });
  if(!file) return;
  if(!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)){ toast(t('pdfi_notpdf')); return; }
  if(file.size > MAX_MB*1048576){ toast(t('pdfi_toolarge', {n:MAX_MB})); return; }
  return pdfImportFile(file, folderId, guide);
}

async function pdfImportFile(file, folderId, guide){
  // ---- progress sheet ----
  const bg = el(`<div class="modal-bg pdfi-bg"><div class="modal pdfi"><div class="pdfi-head"><span class="pdfi-ico">${IC.pdf}</span><div><h2>${t('pdfi_title')}</h2><div class="muted pdfi-file">${esc(file.name)}</div></div></div>
    <ol class="pdfi-stages"><li data-s="read">${t('pdfi_s_read')}</li><li data-s="ai">${t('pdfi_s_ai')}</li><li data-s="img">${t('pdfi_s_img')}</li></ol>
    <p class="muted pdfi-note">${t('pdfi_privacy')}</p><div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button></div></div></div>`);
  $('#modals').appendChild(bg); let cancelled = false; bg.querySelector('[data-x]').onclick = () => { cancelled = true; bg.remove(); };
  const stage = (s, state) => { const li = bg.querySelector(`[data-s="${s}"]`); if(li) li.className = state; };
  const fail = msg => { if(!bg.isConnected) return; bg.querySelector('.pdfi').innerHTML = `<h2>${t('pdfi_title')}</h2><p style="margin:0 0 6px">${esc(msg)}</p><div class="actions"><button class="btn" data-x>${t('close')}</button></div>`; bg.querySelector('[data-x]').onclick = () => bg.remove(); };
  try{
    stage('read', 'on'); const buf = await file.arrayBuffer(); const b64 = toB64(buf);
    const docP = loadPdfJs().then(lib => lib.getDocument({data: buf.slice(0)}).promise);
    stage('read', 'done'); stage('ai', 'on');
    const {data, error} = await G.sb.functions.invoke('pdf-analyze', {body:{pdf:b64, name:file.name.replace(/\.pdf$/i, ''), lang:G.LANG.toUpperCase(), guide: guide || currentGuide()}});
    if(cancelled) return;
    if(error || !data || data.error){ let code = data && data.error; try{ if(!code && error && error.context && error.context.json){ const j = await error.context.json(); code = j.error; } }catch(e){}
      fail(t('pdfi_err_' + (code||'x')) !== 'pdfi_err_' + (code||'x') ? t('pdfi_err_' + code) : t('pdfi_err', {e: code || (error && error.message) || '?'})); return; }
    if(!data.steps || !data.steps.length){ fail(t('pdfi_nosteps')); return; }
    stage('ai', 'done'); stage('img', 'on');
    const doc = await docP; const pages = new Map();
    const steps = [];
    for(const [k, s] of data.steps.entries()){
      if(cancelled) return;
      const it = {id:uid(), chapter:s.chapter||'', title:s.title||'', desc:s.description||'', warn:cleanWarn(s.warning), shot:s.shot||'', page:s.page, crop:null, pageImg:null, pick:'crop'};
      try{ if(s.figure && s.figure.page <= doc.numPages){ const pc = await renderPage(doc, s.figure.page, pages); it.crop = cropBox(pc, s.figure.box); } }catch(e){}
      try{ if(s.page <= doc.numPages) it.pageImg = await renderPage(doc, s.page, pages); }catch(e){}
      if(!it.crop) it.pick = 'none';
      steps.push(it); bg.querySelector('[data-s="img"]').textContent = `${t('pdfi_s_img')} · ${k+1}/${data.steps.length}`;
    }
    stage('img', 'done'); bg.remove();
    await reviewDialog({title: data.title || file.name.replace(/\.pdf$/i, ''), steps, folderId, model: data.model, guideCustom: (guide || '').trim() !== (wsGuide() || defaultGuide()).trim()});
  }catch(e){ fail(t('pdfi_err', {e: e.message || String(e)})); }
}

// ---- review: edit, delete, reorder, choose picture, then create ----
async function reviewDialog(r){ const guide = r.guideCustom;
  const thumbOf = it => it.pick === 'crop' && it.crop ? it.crop : it.pick === 'page' && it.pageImg ? it.pageImg : null;
  const bg = el(`<div class="modal-bg pdfi-bg"><div class="modal pdfi pdfi-review"><div class="pdfi-head"><span class="pdfi-ico ai">✦</span><div><h2>${t('pdfi_review')}</h2><div class="muted">${t('pdfi_review_sub')}</div></div>${r.model ? `<span class="pdfi-model">${esc(r.model)}</span>` : ''}</div>
    <div class="field"><label for="pdfi-t">${t('title')}</label><input id="pdfi-t" value="${esc(r.title)}"></div>
    <div class="pdfi-list" id="pdfi-list"></div>
    <div class="actions pdfi-actions"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn mint" data-ok></button></div></div></div>`);
  $('#modals').appendChild(bg);
  const list = bg.querySelector('#pdfi-list');
  const draw = () => {
    list.innerHTML = ''; let lastCh = null;
    r.steps.forEach((it, i) => {
      if(it.chapter && it.chapter !== lastCh){ lastCh = it.chapter; list.appendChild(el(`<div class="pdfi-ch">${esc(it.chapter)}</div>`)); }
      const row = el(`<div class="pdfi-step"><div class="pdfi-img"><canvas></canvas><span class="pdfi-n tnum">${i+1}</span></div>
        <div class="pdfi-f"><input class="pdfi-title" value="${esc(it.title)}" placeholder="${t('step_title_ph')}">
          <textarea class="pdfi-desc" rows="2" placeholder="${t('desc_ph')}">${esc(it.desc)}</textarea>
          ${it.warn ? `<input class="pdfi-warn" value="${esc(it.warn)}" placeholder="${t('warn')}">` : `<button class="pdfi-addwarn" type="button">+ ${t('warn')}</button>`}
          ${it.shot ? `<div class="pdfi-shot" title="${t('shot_hint')}">🎬 <input class="pdfi-shotin" value="${esc(it.shot)}"></div>` : ''}
          <div class="pdfi-pick">${it.crop ? `<button data-p="crop" class="${it.pick==='crop'?'on':''}">${t('pdfi_p_crop')}</button>` : ''}${it.pageImg ? `<button data-p="page" class="${it.pick==='page'?'on':''}">${t('pdfi_p_page')}</button>` : ''}<button data-p="none" class="${it.pick==='none'?'on':''}">${t('pdfi_p_none')}</button><span class="muted">S. ${it.page}</span></div></div>
        <div class="pdfi-ops"><button data-up title="${t('move_up')}" ${i===0?'disabled':''}>${IC.up}</button><button data-dn title="${t('move_down')}" ${i===r.steps.length-1?'disabled':''}>${IC.down}</button><button data-del class="del" title="${t('delete')}">${IC.trash}</button></div></div>`);
      // preview canvas
      const src = thumbOf(it); const cv = row.querySelector('canvas'); if(!src){ row.querySelector('.pdfi-img').classList.add('none'); cv.replaceWith(el(`<div class="pdfi-none">${IC.cam}<span>${t('pdfi_p_none')}</span></div>`)); } else { const sc = Math.min(1, 240/src.width, 180/src.height); cv.width = Math.max(1, Math.round(src.width*sc)); cv.height = Math.max(1, Math.round(src.height*sc)); cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height); }
      row.querySelector('.pdfi-title').oninput = e => { it.title = e.target.value; };
      row.querySelector('.pdfi-desc').oninput = e => { it.desc = e.target.value; };
      const w = row.querySelector('.pdfi-warn'); if(w) w.oninput = e => { it.warn = e.target.value; };
      const sh = row.querySelector('.pdfi-shotin'); if(sh) sh.oninput = e => { it.shot = e.target.value; };
      const aw = row.querySelector('.pdfi-addwarn'); if(aw) aw.onclick = () => { it.warn = ' '; draw(); const nw = list.querySelectorAll('.pdfi-step')[i].querySelector('.pdfi-warn'); if(nw){ nw.value = ''; it.warn = ''; nw.focus(); } };
      $$('[data-p]', row).forEach(b => b.onclick = () => { it.pick = b.dataset.p; draw(); });
      row.querySelector('[data-up]').onclick = () => { if(i>0){ [r.steps[i-1], r.steps[i]] = [r.steps[i], r.steps[i-1]]; draw(); } };
      row.querySelector('[data-dn]').onclick = () => { if(i<r.steps.length-1){ [r.steps[i+1], r.steps[i]] = [r.steps[i], r.steps[i+1]]; draw(); } };
      row.querySelector('[data-del]').onclick = () => { r.steps.splice(i, 1); draw(); };
      list.appendChild(row);
    });
    const ok = bg.querySelector('[data-ok]'); ok.textContent = t('pdfi_take', {n:r.steps.length}); ok.disabled = !r.steps.length;
  };
  draw();
  const res = await new Promise(resolve => { bg.querySelector('[data-x]').onclick = () => resolve(false); bg.querySelector('[data-ok]').onclick = () => resolve(true); });
  if(!res){ bg.remove(); return; }
  const ok = bg.querySelector('[data-ok]'); ok.disabled = true; ok.textContent = t('pdfi_creating');
  try{
    const instr = {id:uid(), ws:S.user.ws, title:(bg.querySelector('#pdfi-t').value.trim() || t('untitled')), shareKey:newShareKey(), createdBy:S.user.name, createdAt:Date.now(), updatedAt:Date.now(), status:'draft', version:0, approvals:{tech:null,dsgvo:null}, checklist:false, steps:[], history:[], source:{kind:'pdf', model:r.model||'', at:Date.now(), guide: guide ? 'custom' : 'default'}};
    if(r.folderId && r.folderId !== 'none') instr.folder = r.folderId;
    let lastCh = null;
    for(const [i, it] of r.steps.entries()){
      if(it.chapter && it.chapter !== lastCh){ lastCh = it.chapter; instr.steps.push({id:uid(), kind:'chapter', title:it.chapter}); }
      const src = thumbOf(it);
      // no picture in the PDF → an empty step: text only, filmed later in the camera (the text is shown there)
      if(!src){ instr.steps.push({id:uid(), type:'empty', w:1280, h:720, duration:0, trimStart:0, trimEnd:0, title:it.title.trim(), desc:it.desc.trim(), warn:(it.warn||'').trim(), shot:(it.shot||'').trim(), ann:[]}); continue; }
      // cap at 1600 px on the long side
      const sc = Math.min(1, 1600/Math.max(src.width, src.height)); let c = src; if(sc < 1){ c = document.createElement('canvas'); c.width = Math.round(src.width*sc); c.height = Math.round(src.height*sc); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); }
      const blob = await canvasBlob(c); const mid = uid();
      const pc = document.createElement('canvas'); const ps = Math.min(1, 320/c.width); pc.width = Math.round(c.width*ps); pc.height = Math.round(c.height*ps); pc.getContext('2d').drawImage(c, 0, 0, pc.width, pc.height);
      await putMedia({id:mid, blob, w:c.width, h:c.height, type:'photo', ws:instr.ws, instrId:instr.id});
      instr.steps.push({id:uid(), type:'photo', mediaId:mid, placeholder:'pdf', w:c.width, h:c.height, duration:0, trimStart:0, trimEnd:0, title:it.title.trim(), desc:it.desc.trim(), warn:(it.warn||'').trim(), shot:(it.shot||'').trim(), ann:[], poster:pc.toDataURL('image/jpeg', .62)});
    }
    await saveInstr(instr); runUploads(); bg.remove(); toast(t('pdfi_done', {n:r.steps.length}));
    location.hash = '#/edit/' + instr.id;
  }catch(e){ toast(e.message || String(e)); ok.disabled = false; ok.textContent = t('pdfi_take', {n:r.steps.length}); }
}

export { pdfImport, pdfImportFile, loadPdfJs, cropBox, titleCard, GUIDE, defaultGuide };
