import { drawAnn, preloadImg } from '../annotations/draw.js';
import { render } from '../app/router.js';
import { realSteps } from '../core/auth.js';
import { toast } from '../core/helpers.js';
import { I18N, fmtD, loadUiLang, t } from '../core/i18n.js';
import { mdToPlain } from '../core/richtext.js';
import { G, loadBrand, mediaUrl } from '../core/state.js';
import { confirmSteps } from '../core/workspace.js';
import { pdfFonts } from './fonts.js';
import { grabFrame, nOf } from '../views/dashboard.js';
import { hexToRgb, saveFile, slug } from '../views/results.js';


/* ---------- PDF export (SOP / IATF style) ---------- */

async function exportPDF(instr){
  if(!window.jspdf){ toast('jsPDF n/a'); return; } toast(t('pdf_making'));
  // the PDF borrows the UI language for its labels; renders are held back meanwhile so the app never flips into that language
  const prevL = G.LANG; if(instr._lang){ const l = instr._lang.toLowerCase(); await loadUiLang(l); G.LANG = I18N[l] ? l : 'en'; }
  G.pdfBusy = true;
  try{ await exportPDF2(instr); } finally { G.LANG = prevL; G.pdfBusy = false; if(G.renderAfterPdf){ G.renderAfterPdf = false; render(); } }
}

async function exportPDF2(instr){
  const {jsPDF} = window.jspdf; const doc = new jsPDF({unit:'mm', format:'a4', putOnlyUsedFonts:true, compress:true}); const F = await pdfFonts(doc, instr._lang||'DE');
  const brand = await loadBrand(instr.ws); const bc = hexToRgb(brand.color||'#004EAD');
  const imgData = async (src, maxW=700) => { if(!src) return null; try{ const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin='anonymous'; i.onload=()=>res(i); i.onerror=rej; i.src = src; }); const sc = Math.min(1, maxW/(img.naturalWidth||1)); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth*sc)); c.height = Math.max(1, Math.round(img.naturalHeight*sc)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return {data:c.toDataURL('image/png'), ratio:c.width/c.height}; }catch(e){ return null; } };
  const brandLogo = await imgData(brand.logo);
  const ggLogo = await imgData((/url\(["']?(data:[^"')]+)["']?\)/.exec(getComputedStyle(document.documentElement).getPropertyValue('--logo-dark')||'')||[])[1]);
  const W = 210, H = 297, M = 16, CW = W-2*M; const ink = [17,17,17], grey = [120,120,120], soft = [244,246,249], line = [222,226,232];
  const steps = realSteps(instr); const ap = instr.approvals||{}; const chk = new Set(confirmSteps(instr).map(s=>s.id)); const lastHist = (instr.history||[])[instr.history.length-1];
  const docNo = 'GG-' + instr.id.slice(0,6).toUpperCase(); const statusTxt = t(instr.status==='review'?'in_review':instr.status);
  const TOP = 24, BOT = H-20; let y = TOP;
  const txt = (s, x, yy, o) => doc.text(String(s==null?'':s), x, yy, o);
  // ---- every page: document line top left, GIRI Go top right, hairline; footer with doc no. + page ----
  const header = () => {
    let hx = M; if(brandLogo){ const lh = 6.6, lw = Math.min(30, lh*brandLogo.ratio); try{ doc.addImage(brandLogo.data, 'PNG', M, 6.8, lw, lh); }catch(e){} hx = M + lw + 3; }
    F(true); doc.setFontSize(7.5); doc.setTextColor(...grey); txt(((brand.name && !brandLogo ? brand.name+'   ·   ' : '') + t('pdf_h_doc')).toUpperCase(), hx, 12);
    // v12.47.2: the product is "GIRI" – logo top right, no "GO" badge any more
    if(ggLogo){ const lh = 6.6, lw = lh*ggLogo.ratio; try{ doc.addImage(ggLogo.data, 'PNG', W-M-lw, 6.8, lw, lh); }catch(e){} }
    doc.setDrawColor(...line); doc.setLineWidth(.25); doc.line(M, 16, W-M, 16);
  };
  const footer = (p, total) => { doc.setDrawColor(...line); doc.setLineWidth(.25); doc.line(M, H-13, W-M, H-13); F(false); doc.setFontSize(7.5); doc.setTextColor(...grey);
    txt(`${docNo}   ·   v${instr.version}   ·   ${statusTxt}   ·   ${fmtD(instr.updatedAt||instr.createdAt)}`, M, H-8.5); txt(`${t('pdf_h_pages')} ${p} / ${total}`, W-M, H-8.5, {align:'right'}); };
  const newPage = () => { doc.addPage(); header(); y = TOP; return doc.getNumberOfPages(); };
  const ensure = need => { if(y+need > BOT) newPage(); };
  const label = (s, x, yy) => { F(true); doc.setFontSize(7); doc.setTextColor(...grey); txt(String(s).toUpperCase(), x, yy); };
  // ================= page 1: cover with document control, contents, history =================
  header();
  if(brandLogo){ const lh = Math.min(22, 80/brandLogo.ratio), lw = lh*brandLogo.ratio; try{ doc.addImage(brandLogo.data, 'PNG', M, y, lw, lh); }catch(e){} if(brand.name){ F(true); doc.setFontSize(10); doc.setTextColor(...grey); txt(brand.name, M + lw + 5, y + lh - 1); } y += lh + 10; } else if(brand.name){ F(true); doc.setFontSize(11); doc.setTextColor(...bc); txt(brand.name, M, y+4); y += 12; }
  F(true); doc.setFontSize(24); doc.setTextColor(...ink); const tl = doc.splitTextToSize(mdToPlain(instr.title), CW); txt(tl, M, y+6); y += tl.length*10 + 2;
  F(false); doc.setFontSize(10); doc.setTextColor(...grey); txt(`${t('pdf_h_created')}: ${instr.createdBy||''}   ·   ${fmtD(instr.createdAt)}`, M, y+2); y += 12;
  // document control – six tiles
  const chapCount = (instr.steps||[]).filter(s=>s.kind==='chapter').length;
  const cmTxt = !instr.checklist ? '–' : t((instr.checkMode||'all')==='chapter' ? 'cm_chapter' : (instr.checkMode||'all')==='custom' ? 'cm_custom' : 'cm_all');
  const tiles = [[t('pdf_h_version'), `v${instr.version}${lastHist ? '  ·  '+fmtD(lastHist.at) : ''}`], [t('pdf_h_status'), statusTxt], [t('pdf_h_tech'), ap.tech ? `${ap.tech.by}  ·  ${fmtD(ap.tech.at)}` : t('pending')], [t('pdf_h_dsgvo'), ap.dsgvo ? `${ap.dsgvo.by}  ·  ${fmtD(ap.dsgvo.at)}` : t('pending')], [t('steps'), `${steps.length}${chapCount ? '  ·  '+chapCount+' '+t('chapters') : ''}`], [t('checklist_short'), cmTxt]];
  const tw = (CW-6)/2, th = 15; tiles.forEach(([k, v], i) => { const x = M + (i%2)*(tw+6), yy = y + Math.floor(i/2)*(th+4); doc.setFillColor(...soft); doc.roundedRect(x, yy, tw, th, 2, 2, 'F'); label(k, x+5, yy+5.5); F(true); doc.setFontSize(10); doc.setTextColor(...ink); txt(doc.splitTextToSize(String(v), tw-10)[0]||'', x+5, yy+11.3); }); y += 3*(th+4) + 6;
  // contents: chapters with page numbers (filled in after the pages exist)
  const groups = []; { let g = null; for(const st of instr.steps||[]){ if(st.kind==='chapter'){ g = {title:st.title, steps:[]}; groups.push(g); } else { if(!g){ g = {title:'', intro:true, steps:[]}; groups.push(g); } g.steps.push(st); } } }
  const histRows = (instr.history||[]).slice(-6).reverse(); const histNeed = histRows.length ? 10 + histRows.length*6.5 : 0;
  let tocY = 0, tocRows = 0;
  if(groups.length > 1 || chapCount){ label(t('chapters'), M, y); y += 3; tocY = y; tocRows = Math.min(groups.length, Math.floor((BOT - histNeed - y - 4)/6)); y += tocRows*6 + 6; }
  if(histRows.length){ label(t('pdf_h_hist'), M, y); y += 3;
    histRows.forEach(h => { F(true); doc.setFontSize(9); doc.setTextColor(...ink); txt(`v${h.version}`, M, y+4.5); F(false); doc.setTextColor(70); const s = doc.splitTextToSize(`${fmtD(h.at)}  ·  ${h.by||''}${h.note ? '  —  '+h.note : ''}`, CW-16); txt(s[0]||'', M+12, y+4.5); doc.setDrawColor(...line); doc.setLineWidth(.2); doc.line(M, y+6.5, W-M, y+6.5); y += 6.5; }); }
  // ================= chapters: each one starts on a new page =================
  const pageOf = []; let n = 0;
  for(const [gi, g] of groups.entries()){
    pageOf[gi] = newPage();
    const title = g.intro ? (groups.length > 1 ? t('intro') : t('pdf_h_steps')) : (mdToPlain(g.title) || `${t('chapter')} ${gi+1}`);
    F(true); doc.setFontSize(9); doc.setTextColor(...bc); txt(`${(groups.length > 1 || chapCount) ? t('chapter').toUpperCase()+' '+(gi+1) : t('pdf_h_steps').toUpperCase()}`, M, y);
    doc.setFontSize(20); doc.setTextColor(...ink); const ct = doc.splitTextToSize(title, CW); txt(ct, M, y+9); y += 9 + ct.length*8;
    doc.setFillColor(...bc); doc.rect(M, y-3, 14, 1.2, 'F'); y += 6;
    for(const s of g.steps){
      n++;
      const imgs = await stepImages(s, s.type==='video' ? 3 : 1); const ratio = (s.h||3)/(s.w||4);
      const row = imgs.length > 1; const imgW = row ? (CW-8)/3 : 64; const imgH = row ? Math.min(imgW*ratio, 44) : Math.min(imgW*ratio, 54);
      const textW = (row || !imgs.length) ? CW-12 : CW-12-imgW-6;
      F(true); doc.setFontSize(11.5); const titleLines = doc.splitTextToSize(mdToPlain(s.title) || `${t('step')} ${n}`, textW);
      F(false); doc.setFontSize(9.5); const descLines = s.desc ? doc.splitTextToSize(mdToPlain(s.desc), textW) : [];
      const warnLines = s.warn ? doc.splitTextToSize(s.warn, textW-9) : [];
      const textH = titleLines.length*5.4 + (descLines.length ? descLines.length*4.4 + 1.5 : 0) + (warnLines.length ? warnLines.length*4.4 + 5 : 0) + (chk.has(s.id) ? 8 : 0);
      const blockH = row ? textH + (imgs.length ? imgH + 5 : 0) : Math.max(textH, imgs.length ? imgH : 0);
      ensure(blockH + 8);
      const y0 = y;
      doc.setFillColor(...bc); doc.circle(M+4, y+3.2, 4, 'F'); doc.setTextColor(255); F(true); doc.setFontSize(9); txt(String(n), M+4, y+4.5, {align:'center'});
      if(!row && imgs.length){ try{ doc.addImage(imgs[0], 'JPEG', W-M-imgW, y, imgW, imgH); }catch(e){} }
      let tx = M+12, ty = y+4.8;
      doc.setTextColor(...ink); F(true); doc.setFontSize(11.5); txt(titleLines, tx, ty); ty += titleLines.length*5.4;
      if(descLines.length){ F(false); doc.setFontSize(9.5); doc.setTextColor(55); txt(descLines, tx, ty+0.5); ty += descLines.length*4.4 + 1.5; }
      if(warnLines.length){ const wh = warnLines.length*4.4 + 3; doc.setFillColor(255,246,222); doc.roundedRect(tx, ty, textW, wh, 1.5, 1.5, 'F'); doc.setFillColor(217,144,0); doc.rect(tx, ty, 1.4, wh, 'F'); F(true); doc.setFontSize(9); doc.setTextColor(140,90,0); txt('!', tx+4, ty+4.3); txt(warnLines, tx+8, ty+4.3); ty += wh + 2; }
      if(chk.has(s.id)){ doc.setDrawColor(...ink); doc.setLineWidth(.45); doc.roundedRect(tx, ty+1, 4.2, 4.2, .8, .8, 'S'); F(true); doc.setFontSize(9); doc.setTextColor(...ink); txt(t('pdf_h_check'), tx+6.5, ty+4.3); ty += 8; }
      if(row && imgs.length){ const iy = Math.max(ty, y0) + 2; imgs.forEach((im, k) => { try{ doc.addImage(im, 'JPEG', M + k*(imgW+4), iy, imgW, imgH); }catch(e){} }); ty = iy + imgH; }
      y = Math.max(ty, y0 + (!row && imgs.length ? imgH : 0)) + 5;
      doc.setDrawColor(...line); doc.setLineWidth(.2); doc.line(M, y, W-M, y); y += 5;
    }
  }
  // ================= signature – once, at the very end =================
  ensure(44); y += 6; label(t('pdf_h_sig'), M, y); y += 16;
  doc.setDrawColor(...ink); doc.setLineWidth(.4); const c1 = M, c2 = M+78, c3 = M+128; doc.line(c1, y, c1+68, y); doc.line(c2, y, c2+40, y); doc.line(c3, y, W-M, y);
  F(false); doc.setFontSize(8); doc.setTextColor(...grey); txt(t('name'), c1, y+4.5); txt(t('pdf_h_date2'), c2, y+4.5); txt(t('pdf_h_sig').split(' ')[0], c3, y+4.5);
  // contents on page 1 now that the page numbers are known
  if(tocRows){ doc.setPage(1); let yy = tocY; groups.slice(0, tocRows).forEach((g, gi) => { F(true); doc.setFontSize(9.5); doc.setTextColor(...bc); txt(String(gi+1), M, yy+4.5); doc.setTextColor(...ink); const tt = g.intro ? t('intro') : (mdToPlain(g.title) || `${t('chapter')} ${gi+1}`); txt(doc.splitTextToSize(tt, CW-40)[0]||'', M+8, yy+4.5); F(false); doc.setTextColor(...grey); txt(`${nOf(g.steps.length,'step','steps')}`, W-M-14, yy+4.5, {align:'right'}); F(true); doc.setTextColor(...ink); txt(String(pageOf[gi]), W-M, yy+4.5, {align:'right'}); doc.setDrawColor(...line); doc.setLineWidth(.2); doc.line(M, yy+6, W-M, yy+6); yy += 6; }); }
  const total = doc.getNumberOfPages(); for(let p=1;p<=total;p++){ doc.setPage(p); footer(p,total); }
  const blob = doc.output('blob');
  const ok = await saveFile(`${slug(instr.title)}-v${instr.version}${instr._lang?'-'+instr._lang.toLowerCase():''}.pdf`, blob, 'application/pdf'); if(ok) toast(t('pdf_done'));
}

async function stepImages(s, count){
  const url = await mediaUrl(s.mediaId); if(!url) return [];
  await Promise.all((s.ann||[]).filter(a => a.type==='img' && a.src).map(a => preloadImg(a.src)));
  const withAnn = (canvas, tm) => { const ctx = canvas.getContext('2d'); const r = {x:0,y:0,w:canvas.width,h:canvas.height}; s.ann.forEach(a => { if(s.type==='video' && Math.abs((a.t||0)-tm) > 1.0) return; drawAnn(ctx, a, r, false); }); return canvas.toDataURL('image/jpeg', .82); };
  if(s.type==='photo'){ const img = await new Promise(res => { const i = new Image(); i.crossOrigin='anonymous'; i.onload=()=>res(i); i.onerror=()=>res(null); i.src=url; }); if(!img) return []; const c = document.createElement('canvas'); const sc = Math.min(1, 900/img.naturalWidth); c.width = Math.round(img.naturalWidth*sc); c.height = Math.round(img.naturalHeight*sc); c.getContext('2d').drawImage(img,0,0,c.width,c.height); return [withAnn(c, 0)]; }
  const st = s.trimStart||0, en = s.trimEnd||s.duration||3; const times = [];
  const annT = s.ann.map(a=>a.t||0).filter(x=>x>=st&&x<=en);
  if(annT.length){ times.push(st+0.05, ...annT.slice(0,1), Math.max(st, en-0.15)); } else { times.push(st+0.05, (st+en)/2, Math.max(st, en-0.15)); }
  const out = []; for(const tm of [...new Set(times.map(x=>Math.round(x*10)/10))].slice(0,count)){ const c = await grabFrame(url, tm, 900); if(c) out.push(withAnn(c, tm)); }
  return out;
}

export { exportPDF, exportPDF2, stepImages };
