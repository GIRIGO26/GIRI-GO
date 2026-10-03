import { esc } from '../core/helpers.js';
import { t } from '../core/i18n.js';
import { can } from '../core/roles.js';
import { folderName } from '../core/workspace.js';
import { IC } from './icons.js';

/* ---------- v12.48: orientation for one instruction ----------
   The breadcrumb up to the instruction (Instructions › folder › title) and its three views as tabs: edit · preview · analytics.
   Before, analytics opened as a separate page whose back arrow led to the start page – there was no way back to the instruction. */
const instrCrumbs = instr => {
  const c = [{label: t('instructions'), href: ''}];
  const fn = instr.folder ? folderName(instr.folder) : ''; if(fn) c.push({label: fn, href: 'p/' + instr.folder});
  c.push({label: instr.title || t('untitled')}); return c; };

// v12.49: the sub-pages of one instruction – edit (steps) · settings (checklist, feedback, folder, access) · analytics. The preview opens the
// worker view in full screen and is therefore not a tab but a button at the far right of the head (previewBtn).
function instrTabs(instr, active, opts={}){
  const cEdit = can(instr, 'edit'), cApprove = can(instr, 'approve_tech') || can(instr, 'approve_dsgvo'), cStats = can(instr, 'analytics') || cEdit;
  const tab = (k, href, ico, label, extra='') => `<a class="itab ${active===k?'on':''}" href="#/${href}/${instr.id}" ${active===k?'aria-current="page"':''} data-itab="${k}">${ico}<span>${label}</span>${extra}</a>`;
  return `<nav class="itabs" aria-label="${esc(t('instr_nav'))}">${cEdit || cApprove ? tab('edit', 'edit', IC.edit, t('edit')) : ''}${cEdit ? tab('settings', 'settings', IC.gear, t('settings_tab')) : ''}${cStats ? tab('results', 'results', IC.eye, t('stats_tab'), opts.fbOpen ? `<span class="nbadge">${opts.fbOpen}</span>` : '') : ''}</nav>`;
}
const previewBtn = instr => `<a class="btn ghost sm ipv" id="pvw" href="#/preview/${instr.id}" title="${esc(t('preview_sub'))}">${IC.play}<span>${t('preview')}</span></a>`;
// v12.51: at the far right of the head – a published instruction gets "Link & QR code" (that is what one does with it now; the link opens
// the live worker view, a separate preview is not needed); a draft keeps "Preview" to check the worker view before the approval.
// The views wire [data-headshare] to the share dialog.
const headLinkBtn = instr => instr.status==='published' && can(instr, 'links') ? `<button class="btn sm ipv" id="pvw-share" data-headshare title="${esc(t('share_sub'))}">${IC.qr}<span>${t('link_qr')}</span></button>` : previewBtn(instr);

export { instrCrumbs, instrTabs, previewBtn, headLinkBtn };
