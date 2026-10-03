import { go } from '../app/router.js';
import { realSteps } from '../core/auth.js';
import { $$, el, esc, toast } from '../core/helpers.js';
import { LOCALE, fmtDate, t } from '../core/i18n.js';
import { G, S } from '../core/state.js';
import { can } from '../core/roles.js';
import { confirmSteps } from '../core/workspace.js';
import { barChart, runDetailsModal } from '../ui/charts.js';
import { IC } from '../ui/icons.js';
import { topbar } from '../ui/topbar.js';
import { instrCrumbs, instrTabs, previewBtn } from '../ui/instrnav.js';
import { debounce } from './editor.js';


/* ---------- Results ---------- */
async function renderResults(app, id){
  const instr = S.instrs.find(i=>i.id===id); if(!instr) return go('');
  topbar(app, {crumbs: instrCrumbs(instr)}); // v12.48: same trail as the editor; edit / preview / analytics are tabs of the instruction
  const steps = realSteps(instr);
  const [{data:rows, error}, {data:vrows}, {data:fbrows}] = await Promise.all([
    G.sb.from('runs').select('*').eq('instr_id', id).order('started_at', {ascending:false}),
    G.sb.from('views').select('*').eq('instr_id', id).order('started_at', {ascending:false}).limit(2000),
    G.sb.from('feedback').select('*').eq('instr_id', id).order('created_at', {ascending:false}) ]);
  const fbs = (fbrows||[]).sort((a,b) => (a.status==='open'?0:1)-(b.status==='open'?0:1) || (new Date(b.created_at)-new Date(a.created_at))); const fbOpen = fbs.filter(f => f.status==='open').length;
  const canEditFb = can(instr, 'edit'); // v12.39
  const fbCard = f => { const st = f.step_id ? steps.find(x => x.id===f.step_id) : null; const no = st ? steps.indexOf(st)+1 : f.step_no;
    return `<article class="card fbcard ${f.status}" data-fb="${f.id}"><div class="fbmedia">${f.media_url ? (f.media_type==='video' ? `<video src="${esc(f.media_url)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(f.media_url)}" alt="" loading="lazy">`) : `<div class="fbnomedia">${IC.msg}</div>`}</div>
      <div class="fbbody"><div class="row" style="gap:6px;flex-wrap:wrap"><span class="chip ${f.kind==='process'?'review':'published'}">${f.kind==='process'?t('fb_process'):t('fb_quality')}</span>${no?`<span class="chip">${t('step')} ${no}${st?' · '+esc(st.title||''):''}</span>`:''}${f.status!=='open'?`<span class="chip">${f.status==='done'?'✓ '+t('fb_done'):t('fb_dismissed')}</span>`:''}</div>
        <p class="fbtext">${f.text ? esc(f.text) : `<span class="muted">${t('fb_notext')}</span>`}</p>
        <div class="muted" style="font-size:12px">${f.worker ? esc(f.worker)+' · ' : ''}${fmtDate(f.created_at)}</div>
        ${canEditFb && f.status==='open' ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px">${f.media_url ? `<a class="btn sm" href="#/edit/${instr.id}/fb/${f.id}">${IC.plus} ${t('fb_adopt')}</a>` : (st ? `<a class="btn sm" href="#/edit/${instr.id}/fb/${f.id}">${IC.edit} ${t('fb_goto')}</a>` : '')}<button class="btn ghost sm" data-fbs="done">${IC.check} ${t('fb_done')}</button><button class="btn ghost sm" data-fbs="dismissed">${t('fb_dismiss')}</button></div>` : ''}
      </div></article>`; };
  if(error) toast(error.message);
  const runs = (rows||[]).map(r => ({id:r.id, instrId:r.instr_id, worker:r.worker, version:r.version, startedAt:new Date(r.started_at).getTime(), finishedAt:r.finished_at?new Date(r.finished_at).getTime():0, items:r.items||{}}));
  const views = vrows||[]; const vN = views.length, vReload = views.filter(x=>x.reload).length, vDone = views.filter(x=>x.completed).length; const withDur = views.filter(x=>x.duration_s>0); const avgDur = withDur.length ? Math.round(withDur.reduce((a,x)=>a+x.duration_s,0)/withDur.length) : 0; const avgSeen = views.length ? (views.reduce((a,x)=>a+(x.steps_seen||0),0)/views.length) : 0;
  const fmtDur = sec => `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
  const lastAt = r => Math.max(r.startedAt, ...Object.values(r.items).map(i=>i.at||0));
  const dur = r => fmtDur(Math.max(0, Math.round(((r.finishedAt||lastAt(r))-r.startedAt)/1000)));
  const days = []; for(let k=29;k>=0;k--){ const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-k); days.push(d); } const dkey = d => d.toISOString().slice(0,10); const perDay = Object.fromEntries(days.map(d=>[dkey(d),0])); views.forEach(x => { const d = new Date(x.started_at||0); if(isNaN(d)) return; const k = dkey(d); if(perDay[k]!=null) perDay[k]++; });
  let tab = 'views'; try{ tab = sessionStorage.getItem('gg_rtab_'+id) || 'views'; }catch(e){}
  const v = el(`<main class="page"><div class="ed-head res-head"><div class="ed-top"><div class="title-wrap"><h1 class="ititle-static">${esc(instr.title)}</h1></div><div class="ed-meta"><span class="chip dot ${instr.status}">${t(instr.status==='review'?'in_review':instr.status)}</span><span class="muted tnum">v${instr.version}</span><span class="muted">· ${t('stats_sub')}</span></div></div><div class="ed-bar">${instrTabs(instr, 'results', {fbOpen})}<div class="ed-acts"><button class="btn ghost sm" id="csv">${t('export_csv')}</button>${previewBtn(instr)}</div></div></div>
    <div class="tabs" id="rtabs"><button data-tab="views" class="${tab==='views'?'on':''}">${t('views_tab')} <span class="tnum cnt">${vN}</span></button><button data-tab="runs" class="${tab==='runs'?'on':''}">${t('jobdone')} <span class="tnum cnt">${runs.length}</span></button><button data-tab="feedback" class="${tab==='feedback'?'on':''}">${t('feedback')} <span class="tnum cnt ${fbOpen?'hot':''}">${fbOpen||fbs.length}</span></button></div>
    <div id="tab-feedback" ${tab!=='feedback'?'hidden':''}><p class="muted" style="margin:0 0 12px">${t('fb_inbox_sub')}</p><div class="fblist" id="fblist">${fbs.length ? fbs.map(fbCard).join('') : `<div class="card empty">${t('fb_none')}</div>`}</div></div>
    <div id="tab-views" ${tab!=='views'?'hidden':''}>
      <div class="stats"><div class="card stat"><b class="tnum">${vN}</b><span>${t('views_total')}</span></div><div class="card stat"><b class="tnum">${vReload}</b><span>${t('views_reload')}</span></div><div class="card stat"><b class="tnum">${fmtDur(avgDur)}</b><span>${t('views_avg')}</span></div><div class="card stat"><b class="tnum">${vN?Math.round(100*vDone/vN):0}%</b><span>${t('views_done')}</span></div><div class="card stat"><b class="tnum">${avgSeen.toFixed(1)} / ${steps.length}</b><span>${t('views_steps')}</span></div></div>
      <div class="card chart" style="margin-bottom:14px"><h3>${t('views_per_day')} · ${t('last_30')}</h3><canvas id="c-day"></canvas></div>
      <div class="card tbl-wrap">${vN?`<table class="res"><thead><tr><th>${t('started')}</th><th>${t('device')}</th><th>${t('duration')}</th><th>${t('steps')}</th><th>${t('version')}</th><th></th></tr></thead><tbody>${views.map(x=>`<tr><td class="tnum">${fmtDate(x.started_at)}</td><td>${esc(x.device||'')}</td><td class="tnum">${fmtDur(x.duration_s||0)}</td><td class="tnum">${x.steps_seen||0} / ${x.steps_total||steps.length}</td><td>v${x.version}</td><td>${x.completed?`<span class="ok-n">✓ ${t('views_completed')}</span>`:(x.reload?`<span class="muted">${t('views_reloaded')}</span>`:'')}</td></tr>`).join('')}</tbody></table>`:`<div class="empty">${t('no_views')}</div>`}</div>
    </div>
    <div id="tab-runs" ${tab!=='runs'?'hidden':''}>
      <div class="card tbl-wrap">${runs.length?`<table class="res"><thead><tr><th>${t('worker')}</th><th>${t('started')}</th><th>Status</th><th>${t('duration')}</th><th>${t('version')}</th><th>${t('ok_count')}</th><th>${t('nok_count')}</th><th>${t('open_count')}</th><th></th></tr></thead><tbody>${runs.map(r => { const its = Object.values(r.items); const ok = its.filter(i=>i.ok).length, nok = its.filter(i=>i.ok===false).length; return `<tr><td><b>${esc(r.worker)}</b></td><td class="tnum">${fmtDate(r.startedAt)}</td><td>${r.finishedAt?`<span class="ok-n">✓</span>`:`<span class="chip review">${t('running')}</span>`}</td><td class="tnum">${dur(r)}</td><td>v${r.version}</td><td class="ok-n tnum">${ok}</td><td class="nok-n tnum">${nok}</td><td class="tnum">${Math.max(0, confirmSteps(instr).length-ok-nok)}</td><td><button class="btn ghost sm" data-d="${r.id}">${t('details')}</button></td></tr>`; }).join('')}</tbody></table>`:`<div class="empty">${t('no_runs')}${instr.checklist?'':'<br><span class="muted">'+t('jobdone_hint')+'</span>'}</div>`}</div>
    </div></main>`);
  app.appendChild(v);
  const drawDay = () => { const c = v.querySelector('#c-day'); if(c && !c.closest('[hidden]')) barChart(c, days.map(d => d.toLocaleDateString(LOCALE(), {day:'2-digit', month:'2-digit'})), days.map(d=>perDay[dkey(d)]), {color:S.brand.color||'#004EAD'}); };
  setTimeout(drawDay, 30); const onR2 = () => debounce('rchart', drawDay, 150); window.addEventListener('resize', onR2); G.activeCleanup = () => window.removeEventListener('resize', onR2);
  $$('#rtabs button', v).forEach(b => b.onclick = () => { tab = b.dataset.tab; try{ sessionStorage.setItem('gg_rtab_'+id, tab); }catch(e){} $$('#rtabs button', v).forEach(x=>x.classList.toggle('on', x===b)); v.querySelector('#tab-views').hidden = tab!=='views'; v.querySelector('#tab-runs').hidden = tab!=='runs'; v.querySelector('#tab-feedback').hidden = tab!=='feedback'; v.querySelector('#csv').hidden = tab==='feedback'; if(tab==='views') setTimeout(drawDay, 30); });
  v.querySelector('#csv').hidden = tab==='feedback';
  v.querySelector('#fblist').onclick = async e => { const b = e.target.closest('[data-fbs]'); if(!b) return; const card = b.closest('[data-fb]'); const f = fbs.find(x => x.id===card.dataset.fb); if(!f) return; b.disabled = true;
    const {error} = await G.sb.from('feedback').update({status:b.dataset.fbs, resolved_at:new Date().toISOString()}).eq('id', f.id); if(error){ toast(error.message); b.disabled = false; return; }
    f.status = b.dataset.fbs; card.outerHTML = fbCard(f); toast(t('saved')); };
  v.querySelector('#csv').onclick = async () => {
    if(tab==='views'){ const rows2 = [[t('started'), t('device'), t('duration')+' (s)', t('steps'), t('version'), t('views_completed'), t('views_reloaded')]]; views.forEach(x => rows2.push([new Date(x.started_at).toISOString(), x.device||'', x.duration_s||0, x.steps_seen||0, 'v'+x.version, x.completed?'1':'0', x.reload?'1':'0'])); const csv = rows2.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(';')).join('\n'); await saveFile(`giri-${slug(instr.title)}-views.csv`, '﻿'+csv, 'text/csv'); return; }
    const rows2 = [[t('worker'), t('started'), t('version'), t('step'), t('title'), 'Status', 'Zeit/Time', t('nok_note')]];
    runs.forEach(r => steps.forEach((s,i) => { const it = r.items[s.id]; rows2.push([r.worker, new Date(r.startedAt).toISOString(), 'v'+r.version, i+1, s.title, it?(it.ok?'OK':'NOK'):'', it?new Date(it.at).toISOString():'', it&&it.note?it.note:'']); }));
    const csv = rows2.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(';')).join('\n');
    await saveFile(`giri-${slug(instr.title)}-jobdone.csv`, '﻿'+csv, 'text/csv');
  };
  $$('[data-d]', v).forEach(b => b.onclick = () => runDetailsModal(runs.find(x=>x.id===b.dataset.d), steps));
}

const hexToRgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h||''); if(!m) return [0,78,173]; const n = parseInt(m[1],16); return [(n>>16)&255, (n>>8)&255, n&255]; };

const slug = s => (s||'anleitung').toLowerCase().replace(/[^a-z0-9äöüß]+/g,'-').replace(/^-|-$/g,'').slice(0,40);

async function saveFile(filename, data, mime){
  try{ if(window.claude && window.claude.use){ const dl = await window.claude.use('downloads'); if(dl){ await dl.save({filename, data}); toast(t('saved')); return true; } } }catch(e){ if(e && e.code==='declined') return false; }
  try{ const blob = data instanceof Blob ? data : new Blob([data], {type:mime||'application/octet-stream'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 2000); toast(t('saved')); return true; }catch(e){ toast(t('pdf_fail')); return false; }
}

export { renderResults, hexToRgb, slug, saveFile };
