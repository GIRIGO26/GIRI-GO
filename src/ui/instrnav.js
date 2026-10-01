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

function instrTabs(instr, active, opts={}){
  const cEdit = can(instr, 'edit'), cApprove = can(instr, 'approve_tech') || can(instr, 'approve_dsgvo'), cStats = can(instr, 'analytics') || cEdit;
  const tab = (k, href, ico, label, extra='') => `<a class="itab ${active===k?'on':''}" href="#/${href}/${instr.id}" ${active===k?'aria-current="page"':''} data-itab="${k}">${ico}<span>${label}</span>${extra}</a>`;
  return `<nav class="itabs" aria-label="${esc(t('instr_nav'))}">${cEdit || cApprove ? tab('edit', 'edit', IC.edit, t('edit')) : ''}${tab('preview', 'preview', IC.play, t('preview'))}${cStats ? tab('results', 'results', IC.eye, t('stats_tab'), opts.fbOpen ? `<span class="nbadge">${opts.fbOpen}</span>` : '') : ''}</nav>`;
}

export { instrCrumbs, instrTabs };
