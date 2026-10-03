import { realSteps } from '../core/auth.js';
import { toast } from '../core/helpers.js';
import { fmtD, t } from '../core/i18n.js';
import { S, loadBrand } from '../core/state.js';
import { stepImages } from './export.js';
import { coverCrop, fitBox, giriFooter, loadImgData } from './poster.js';
import { hexToRgb, saveFile, slug } from '../views/results.js';

/* ---------- PDF fonts: Montserrat (Latin/Cyrillic) or Noto Sans SC (Chinese), loaded once from /fonts ---------- */
const PDF_FONT_CACHE = {};

async function loadFontB64(path){ if(PDF_FONT_CACHE[path]) return PDF_FONT_CACHE[path]; const r = await fetch(path); if(!r.ok) throw new Error('font '+path); const u8 = new Uint8Array(await r.arrayBuffer()); let bin = ''; for(let i=0;i<u8.length;i+=8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i+8192)); PDF_FONT_CACHE[path] = btoa(bin); return PDF_FONT_CACHE[path]; }

async function pdfFonts(doc, lang){
  try{
    if(lang==='ZH'){ const b = await loadFontB64('fonts/NotoSansSC-Regular.ttf'); doc.addFileToVFS('NotoSansSC-Regular.ttf', b); doc.addFont('NotoSansSC-Regular.ttf', 'NotoSansSC', 'normal'); doc.addFont('NotoSansSC-Regular.ttf', 'NotoSansSC', 'bold'); return bold => doc.setFont('NotoSansSC', bold ? 'bold' : 'normal'); }
    const [r, b] = await Promise.all([loadFontB64('fonts/Montserrat-Regular.ttf'), loadFontB64('fonts/Montserrat-Bold.ttf')]);
    doc.addFileToVFS('Montserrat-Regular.ttf', r); doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal'); doc.addFileToVFS('Montserrat-Bold.ttf', b); doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold');
    return bold => doc.setFont('Montserrat', bold ? 'bold' : 'normal');
  }catch(e){ console.warn('pdf fonts', e); return bold => doc.setFont('helvetica', bold ? 'bold' : 'normal'); }
}

async function exportQrPdf(instr, link, opts, qrEl){
  if(!window.jspdf){ toast('jsPDF n/a'); return; } toast(t('pdf_making'));
  const {jsPDF} = window.jspdf; const doc = new jsPDF({unit:'mm', format:'a4', putOnlyUsedFonts:true}); const W = 210, H = 297; const F = await pdfFonts(doc, 'DE');
  const brand = await loadBrand(instr.ws); const bc = hexToRgb(brand.color||'#004EAD');
  // QR as image (from the rendered canvas/img)
  let qrData = null; const c = qrEl.querySelector('canvas'), im = qrEl.querySelector('img'); try{ qrData = c ? c.toDataURL('image/png') : (im ? im.src : null); }catch(e){}
  if(!qrData){ const tmp = document.createElement('div'); tmp.style.position='fixed'; tmp.style.left='-9999px'; document.body.appendChild(tmp); try{ new QRCode(tmp, {text:link, width:512, height:512, colorDark:'#000000', colorLight:'#ffffff', correctLevel:QRCode.CorrectLevel.M}); await new Promise(r=>setTimeout(r,80)); const cc = tmp.querySelector('canvas'); qrData = cc ? cc.toDataURL('image/png') : null; }catch(e){} tmp.remove(); }
  // ---- card: white, brand colour only as a stripe; customer logo in its own proportions, no white box; picture cover-cropped; GIRI at the bottom ----
  const hist = instr.history || []; const lastHist = hist[hist.length-1]; const note = opts.note && lastHist && lastHist.note ? lastHist.note : '';
  const cardW = 150, pad = 12;
  // measure first, so the card is exactly as tall as its content
  F(true); doc.setFontSize(15); const titleLines = opts.title ? doc.splitTextToSize(instr.title, cardW-2*pad).length : 0;
  F(false); doc.setFontSize(8.5); const noteLines = note ? Math.min(3, doc.splitTextToSize(`„${note}“`, cardW-2*pad).length) : 0;
  const hasMeta = opts.version || opts.date || opts.creator;
  const cardH = 12 + (opts.brand ? 22 : 4) + (opts.image ? 58 : 0) + 58 + 9 + titleLines*6.5 + (titleLines ? 1 : 0) + (hasMeta ? 7 : 0) + (noteLines ? noteLines*4.2 + 4 : 0) + 24;
  const cx = (W-cardW)/2, cy = (H-cardH)/2;
  doc.setDrawColor(222); doc.setLineWidth(.3); doc.setFillColor(255); doc.roundedRect(cx, cy, cardW, cardH, 4, 4, 'FD');
  doc.setFillColor(...bc); doc.roundedRect(cx, cy, cardW, 4, 4, 4, 'F'); doc.rect(cx, cy+2, cardW, 2, 'F'); // stripe
  let y = cy + 12;
  if(opts.brand){ let lx = cx+pad; const logo = brand.logo ? await loadImgData(brand.logo) : null;
    if(logo){ const b = fitBox(logo.ratio, 44, 14); try{ doc.addImage(logo.data, 'PNG', lx, y, b.w, b.h); }catch(e){} lx += b.w + 5; }
    if(brand.name){ doc.setTextColor(60); F(true); doc.setFontSize(10.5); doc.text(brand.name, lx, y + 9); }
    y += 14 + 8; doc.setDrawColor(235); doc.line(cx+pad, y-4, cx+cardW-pad, y-4); }
  else y += 4;
  if(opts.image){ const first = realSteps(instr).find(x => x.mediaId) || realSteps(instr)[0]; let data = null; if(first){ try{ const imgs = await stepImages(first, 1); if(imgs[0]) data = await coverCrop(imgs[0], (cardW-2*pad)/50, 900); }catch(e){} }
    if(data){ try{ doc.addImage(data, 'JPEG', cx+pad, y, cardW-2*pad, 50); }catch(e){} } y += 50 + 8; }
  const qrSize = 58; if(qrData){ try{ doc.addImage(qrData, 'PNG', cx + (cardW-qrSize)/2, y, qrSize, qrSize); }catch(e){} } y += qrSize + 9;
  if(opts.title){ doc.setTextColor(0); F(true); doc.setFontSize(15); const tl = doc.splitTextToSize(instr.title, cardW-2*pad); doc.text(tl, W/2, y, {align:'center'}); y += tl.length*6.5 + 1; }
  F(false); doc.setFontSize(9.5); doc.setTextColor(90);
  const meta = []; if(opts.version) meta.push(`v${instr.version}`); if(opts.date) meta.push(fmtD(lastHist ? lastHist.at : instr.updatedAt)); if(opts.creator) meta.push(instr.createdBy||'');
  if(meta.length){ doc.text(meta.filter(Boolean).join('  ·  '), W/2, y+1, {align:'center'}); y += 7; }
  if(note){ doc.setTextColor(110); doc.setFontSize(8.5); const nl = doc.splitTextToSize(`„${note}“`, cardW-2*pad).slice(0, 3); doc.text(nl, W/2, y+2, {align:'center'}); y += nl.length*4.2 + 4; }
  doc.setFontSize(7.5); doc.setTextColor(150); doc.text(t('qr_scan'), W/2, cy+cardH-14, {align:'center'});
  await giriFooter(doc, F, W, cy+cardH-6, null);
  const blob = doc.output('blob'); const ok = await saveFile(`qr-${slug(instr.title)}.pdf`, blob, 'application/pdf'); if(ok) toast(t('pdf_done'));
}

export { PDF_FONT_CACHE, loadFontB64, pdfFonts, exportQrPdf };
