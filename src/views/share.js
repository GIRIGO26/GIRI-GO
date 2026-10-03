import { $$, esc, modal, toast } from '../core/helpers.js';
import { t } from '../core/i18n.js';
import { lockNames } from '../core/passwords.js';
import { FLAGS, LANGS, hasTx, srcHash, translateInstr, withLang } from '../core/translate.js';
import { exportPDF } from '../pdf/export.js';
import { exportQrPdf } from '../pdf/fonts.js';
import { IC } from '../ui/icons.js';
import { ensureShareKey, publicLink } from '../core/links.js';
import { hasLive, liveView } from '../core/live.js';


/* ---------- Share ---------- */
async function shareModal(instr){
  await ensureShareKey(instr); const link = publicLink(instr);
  let opts = {title:true, date:true, creator:true, version:true, note:false, image:false, brand:true}; try{ opts = Object.assign(opts, JSON.parse(localStorage.getItem('gg_qropts')||'{}')); }catch(e){}
  modal(`<h2>${t('share_title')}</h2><p class="muted" style="margin:0 0 12px">${t('share_sub')}</p>
    ${instr.status!=='published' ? (hasLive(instr) ? `<div class="notice blue" style="margin-bottom:12px">${t('live_share_note', {v: instr.live.version})}</div>` : `<div class="notice" style="margin-bottom:12px">${t('not_pub')}</div>`) : ''}
    <div class="qr-wrap"><a id="qr" href="${esc(link)}" target="_blank" rel="noopener" title="${t('open_link')}"></a><div class="linkbox"><a id="lnk" class="linka" href="${esc(link)}" target="_blank" rel="noopener">${IC.link} <span>${esc(link.replace(/^https?:\/\//, ''))}</span></a><div class="row" style="gap:8px;margin-top:8px"><a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">${t('open_link')} ↗</a><button class="btn ghost sm" id="cp">${t('copy')}</button></div></div></div>
    <p class="muted" style="margin:10px 0 0;font-size:12px">🌐 ${t('tx_live_sub').split(':')[0]}.</p>
    ${lockNames(instr).length ? `<p class="muted" style="margin:6px 0 0;font-size:12px">🔒 ${esc(t('link_pw_hint',{n:lockNames(instr).join(' / ')}))}</p>` : ''}
    <div class="lbl" style="margin:16px 0 8px">${t('qr_pdf_opts')}</div>
    <div class="optgrid">${[['title',t('title')],['date',t('qr_date')],['creator',t('qr_creator')],['version',t('version')],['note',t('qr_note')],['image',t('qr_image')],['brand',t('qr_brand')]].map(([k,l])=>`<label class="opt"><input type="checkbox" data-o="${k}" ${opts[k]?'checked':''}> ${l}</label>`).join('')}</div>
    <div class="actions"><button class="btn ghost" data-x>${t('close')}</button><button class="btn" id="qrpdf">${IC.upload} ${t('qr_download')}</button></div>`, (bg, close) => {
    const q = bg.querySelector('#qr'); try{ new QRCode(q, {text:link, width:180, height:180, colorDark:'#000000', colorLight:'#ffffff', correctLevel: QRCode.CorrectLevel.M}); }catch(e){ q.textContent='QR n/a'; }
    bg.querySelector('#cp').onclick = async () => { try{ await navigator.clipboard.writeText(link); toast(t('copied')); }catch(e){ const r = document.createRange(); r.selectNodeContents(bg.querySelector('#lnk span')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy'); toast(t('copied')); } };
    $$('[data-o]', bg).forEach(c => c.onchange = () => { opts[c.dataset.o] = c.checked; try{ localStorage.setItem('gg_qropts', JSON.stringify(opts)); }catch(e){} });
    bg.querySelector('#qrpdf').onclick = () => exportQrPdf(liveView(instr), link, opts, q); // v12.51: the card shows what the code opens (the approved version)
    bg.querySelector('[data-x]').onclick = () => close();
  });
}

// PDF: ask for the language when translations exist (the per-language buttons in the translations card go direct)
async function exportPDFAsk(instr){
  const h = srcHash(instr); const state = k => !hasTx(instr, k) ? '' : (instr.translations[k].hash===h ? ' <small>✓</small>' : ' <small>↻</small>');
  const l = await modal(`<h2>${t('pdf_lang')}</h2><p class="muted" style="margin:0 0 10px">${t('pdf_lang_sub2')}</p><div class="menu langmenu"><button data-l="">${IC.globe} ${t('original')}</button>${LANGS.map(([k,n]) => `<button data-l="${k}"><span class="flag">${FLAGS[k]}</span> ${n}${state(k)}</button>`).join('')}</div><div class="actions"><button class="btn ghost" data-x>${t('cancel')}</button></div>`, (bg, close) => { $$('[data-l]', bg).forEach(b => b.onclick = () => close(b.dataset.l)); bg.querySelector('[data-x]').onclick = () => close(null); });
  if(l===null) return; if(!l) return exportPDF(instr);
  if(!hasTx(instr, l) || instr.translations[l].hash!==h){ toast(t('translating')); try{ await translateInstr(instr, l); }catch(e){ toast('DeepL: '+e.message); return; } }
  exportPDF(withLang(instr, l));
}

export { shareModal, exportPDFAsk };
