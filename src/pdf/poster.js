import { ensureShareKey, publicLink } from '../core/links.js';
import { realSteps } from '../core/auth.js';
import { modal, toast } from '../core/helpers.js';
import { fmtD, t } from '../core/i18n.js';
import { S, loadBrand } from '../core/state.js';
import { stepImages } from './export.js';
import { pdfFonts } from './fonts.js';
import { IC } from '../ui/icons.js';
import { nOf } from '../views/dashboard.js';
import { hexToRgb, saveFile, slug } from '../views/results.js';


/* ---------- Project poster: one A4 sheet with a QR tile per instruction ---------- */
const qrDataUrl = async (text, size) => { const tmp = document.createElement('div'); tmp.style.position='fixed'; tmp.style.left='-9999px'; document.body.appendChild(tmp); let out = null; try{ new QRCode(tmp, {text, width:size||512, height:size||512, colorDark:'#000000', colorLight:'#ffffff', correctLevel:QRCode.CorrectLevel.M}); await new Promise(r=>setTimeout(r,60)); const c = tmp.querySelector('canvas'); out = c ? c.toDataURL('image/png') : ((tmp.querySelector('img')||{}).src || null); }catch(e){} tmp.remove(); return out; };

// image → PNG data URL + aspect ratio (logos); null when it cannot be read
const loadImgData = url => new Promise(res => { if(!url) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => { try{ const cv = document.createElement('canvas'); cv.width = i.naturalWidth; cv.height = i.naturalHeight; cv.getContext('2d').drawImage(i, 0, 0); res({data: cv.toDataURL('image/png'), ratio: cv.width/cv.height}); }catch(e){ res(null); } }; i.onerror = () => res(null); i.src = url; });
// biggest box with this aspect ratio inside maxW × maxH – nothing gets stretched
const fitBox = (ratio, maxW, maxH) => { let w = maxW, h = w/ratio; if(h > maxH){ h = maxH; w = h*ratio; } return {w, h}; };
let giriLogo = null; const giriLogoData = async () => { if(giriLogo!==null) return giriLogo; giriLogo = (await loadImgData('icons/giri-logo.png')) || false; return giriLogo; };
// "made with GIRI Go" line at the bottom of a sheet
async function giriFooter(doc, F, W, y, extra){ const g = await giriLogoData(); let x = W/2; const txt = extra ? `${extra}  ·  go.ar-giri.de` : 'go.ar-giri.de'; F(false); doc.setFontSize(7.5); doc.setTextColor(150); const tw = doc.getTextWidth(txt);
  if(g){ const b = fitBox(g.ratio, 22, 6); const total = b.w + 3 + tw; x = (W-total)/2; try{ doc.addImage(g.data, 'PNG', x, y - b.h + 1.2, b.w, b.h); }catch(e){} doc.text(txt, x + b.w + 3, y, {align:'left'}); }
  else doc.text('GIRI  ·  ' + txt, W/2, y, {align:'center'}); }

// cover-crop an image data URL to a given aspect ratio (w/h) – posters never show squashed pictures
const coverCrop = (dataUrl, ratio, maxW) => new Promise(res => { const i = new Image(); i.onload = () => { const sw = i.naturalWidth, sh = i.naturalHeight; let cw = sw, ch = Math.round(sw/ratio); if(ch > sh){ ch = sh; cw = Math.round(sh*ratio); } const sc = Math.min(1, (maxW||900)/cw); const c = document.createElement('canvas'); c.width = Math.round(cw*sc); c.height = Math.round(ch*sc); c.getContext('2d').drawImage(i, (sw-cw)/2, (sh-ch)/2, cw, ch, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .85)); }; i.onerror = () => res(null); i.src = dataUrl; });

async function posterDialog(f, rows){
  const pub = rows.filter(i => i.status==='published');
  const r = await modal(`<h2>${t('poster')}</h2><p class="muted" style="margin:0 0 12px">${t('poster_sub')}</p>
    <label class="opt" style="margin-bottom:8px"><input type="checkbox" id="po-pub" ${pub.length?'checked':''} ${pub.length?'':'disabled'}> ${t('poster_only_pub')} <span class="muted">(${pub.length} / ${rows.length})</span></label>
    <label class="opt" style="margin-bottom:8px"><input type="checkbox" id="po-img" checked> ${t('qr_image')}</label>
    <label class="opt" style="margin-bottom:8px"><input type="checkbox" id="po-brand" checked> ${t('qr_brand')}</label>
    <div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${IC.pdf} ${t('poster_make')}</button></div>`, (bg, close) => {
      bg.querySelector('[data-x]').onclick = () => close(null);
      bg.querySelector('[data-ok]').onclick = () => close({onlyPub: bg.querySelector('#po-pub').checked, image: bg.querySelector('#po-img').checked, brand: bg.querySelector('#po-brand').checked}); });
  if(!r) return;
  const list = r.onlyPub ? pub : rows; if(!list.length){ toast(t('empty_title')); return; }
  await exportPosterPdf(f, list, r);
}

async function exportPosterPdf(f, list, opts){
  if(!window.jspdf){ toast('jsPDF n/a'); return; } toast(t('pdf_making'));
  const {jsPDF} = window.jspdf; const doc = new jsPDF({unit:'mm', format:'a4', putOnlyUsedFonts:true}); const W = 210, H = 297, M = 12; const F = await pdfFonts(doc, 'DE');
  const brand = await loadBrand(S.user.ws); const bc = hexToRgb(brand.color||'#004EAD'); const base = location.href.split('#')[0];
  const logo = opts.brand && brand.logo ? await loadImgData(brand.logo) : null;
  // tiles: 2 columns up to 4 instructions, else 3; page holds 2 or 3 rows
  const cols = list.length <= 4 ? 2 : 3, maxRows = cols===2 ? 2 : 3, perPage = cols*maxRows;
  const rowsPerPage = Math.min(maxRows, Math.ceil(list.length/cols)); // fewer instructions → taller tiles, no empty band
  const headH = 30, footH = 10, gap = 6; const gridTop = M + headH + 8, gridH = H - gridTop - footH - M;
  const tileW = (W - 2*M - gap*(cols-1))/cols, tileH = (gridH - gap*(rowsPerPage-1))/rowsPerPage;
  const imgH = opts.image ? Math.min(tileH*(cols===2 ? 0.46 : 0.4), tileW*0.62) : 0; const titleFs = cols===2 ? 13 : 10.5, lineH = titleFs*0.42;
  const qrS = Math.max(18, Math.min(tileW*0.5, tileH - imgH - 2*lineH - 16));
  const pages = Math.ceil(list.length/perPage);
  const header = (pg) => {
    // white header, brand colour as a stripe – logos keep their proportions and never sit in a white box
    doc.setFillColor(...bc); doc.roundedRect(M, M, W-2*M, headH, 3, 3, 'F'); doc.setFillColor(255); doc.roundedRect(M, M+3, W-2*M, headH-3, 3, 3, 'F'); doc.rect(M, M+3, W-2*M, 4, 'F');
    let lx = M+6; if(logo){ const b = fitBox(logo.ratio, 44, 16); try{ doc.addImage(logo.data, 'PNG', lx, M+7+(16-b.h)/2, b.w, b.h); }catch(e){} lx += b.w+7; }
    doc.setTextColor(120); F(false); doc.setFontSize(8.5); doc.text((opts.brand && brand.name) ? brand.name.toUpperCase() : 'GIRI', lx, M+12);
    doc.setTextColor(20); F(true); doc.setFontSize(19); const tl = doc.splitTextToSize(f.name, W-2*M-(lx-M)-58)[0]; doc.text(tl, lx, M+22);
    doc.setTextColor(120); F(false); doc.setFontSize(8.5); doc.text(`${nOf(list.length,'instruction','instructions')}${pages>1?`  ·  ${pg}/${pages}`:''}`, W-M-6, M+12, {align:'right'});
    doc.setTextColor(...bc); doc.setFontSize(9); doc.text(t('poster_scan'), W-M-6, M+22, {align:'right'});
  };
  for(let k=0; k<list.length; k++){
    const pg = Math.floor(k/perPage); if(k % perPage === 0){ if(k) doc.addPage(); header(pg+1); }
    const i = list[k]; const idx = k % perPage; const cx = M + (idx % cols)*(tileW+gap), cy = gridTop + Math.floor(idx/cols)*(tileH+gap);
    doc.setFillColor(255); doc.setDrawColor(215); doc.setLineWidth(.35); doc.roundedRect(cx, cy, tileW, tileH, 3.5, 3.5, 'FD');
    let y = cy;
    if(opts.image){ const first = realSteps(i).find(x => x.mediaId) || realSteps(i)[0]; let data = null; if(first){ try{ const imgs = await stepImages(first, 1); if(imgs[0]) data = await coverCrop(imgs[0], tileW/imgH, 900); }catch(e){} }
      if(data){ try{ doc.addImage(data, 'JPEG', cx+1.5, cy+1.5, tileW-3, imgH-1.5); }catch(e){} } else { doc.setFillColor(238); doc.rect(cx+1.5, cy+1.5, tileW-3, imgH-1.5, 'F'); }
      y = cy + imgH + 4; }
    else y = cy + 5;
    // number badge
    doc.setFillColor(...bc); doc.circle(cx+tileW-8, cy+7, 4.2, 'F'); doc.setTextColor(255); F(true); doc.setFontSize(9); doc.text(String(k+1), cx+tileW-8, cy+8.4, {align:'center'});
    // title across the tile, then QR with the facts beside it
    doc.setTextColor(20); F(true); doc.setFontSize(titleFs); const lines = doc.splitTextToSize(i.title, tileW-10).slice(0, 2); doc.text(lines, cx+5, y+lineH); y += lines.length*lineH + 3;
    await ensureShareKey(i); const link = publicLink(i); const qr = await qrDataUrl(link, 384); const qy = Math.min(y, cy+tileH-qrS-7); if(qr){ try{ doc.addImage(qr, 'PNG', cx+4, qy, qrS, qrS); }catch(e){} }
    const tx = cx + 4 + qrS + 4; F(false); doc.setFontSize(cols===2 ? 9 : 8); doc.setTextColor(90);
    const meta = [nOf(realSteps(i).length,'step','steps'), 'v'+i.version]; if(i.status!=='published') meta.push(t(i.status==='review'?'in_review':'draft'));
    meta.forEach((m, mi) => doc.text(m, tx, qy + 5 + mi*(cols===2 ? 5 : 4.4)));
    doc.setFontSize(7); doc.setTextColor(150); doc.text(doc.splitTextToSize(t('qr_scan'), tileW-qrS-14), tx, qy + qrS - 2);
  }
  for(let p = 1; p <= pages; p++){ doc.setPage(p); await giriFooter(doc, F, W, H-M+2, fmtD(Date.now())); }
  const blob = doc.output('blob'); const ok = await saveFile(`poster-${slug(f.name)}.pdf`, blob, 'application/pdf'); if(ok) toast(t('pdf_done'));
}

export { qrDataUrl, coverCrop, loadImgData, fitBox, giriFooter, posterDialog, exportPosterPdf };
