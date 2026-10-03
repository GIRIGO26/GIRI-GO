import { go } from '../app/router.js';
import { realSteps } from '../core/auth.js';
import { $$, el, esc } from '../core/helpers.js';
import { LOCALE, fmtDate, t } from '../core/i18n.js';
import { G, S } from '../core/state.js';
import { canSee } from '../core/workspace.js';
import { barChart, fmtDurS, runDetailsModal } from '../ui/charts.js';
import { topbar } from '../ui/topbar.js';
import { debounce } from './editor.js';
import { saveFile } from './results.js';


/* ---------- Global statistics (workspace) ---------- */
async function renderGlobalStats(app){
  topbar(app, {crumbs: [{label: t('instructions'), href: ''}, {label: t('global_stats')}]});
  const since = new Date(Date.now()-30*864e5); since.setHours(0,0,0,0);
  const [{data:vrows}, {data:rrows}, {data:srows}] = await Promise.all([
    G.sb.from('views').select('instr_id,started_at,duration_s,completed,reload,steps_seen,steps_total,device').eq('ws', S.user.ws).gte('started_at', since.toISOString()).order('started_at', {ascending:false}).limit(5000),
    G.sb.from('runs').select('*').eq('ws', S.user.ws).order('started_at', {ascending:false}).limit(300),
    G.sb.from('instr_stats').select('*').eq('ws', S.user.ws) ]);
  const viewsAll = vrows||[], statsAll = srows||[]; const byId = Object.fromEntries(S.instrs.map(i=>[i.id,i])); const titleOf = id => (byId[id]||{}).title || '–';
  const runsAll = (rrows||[]).map(r => ({id:r.id, instrId:r.instr_id, title:titleOf(r.instr_id), worker:r.worker, version:r.version, startedAt:new Date(r.started_at).getTime(), finishedAt:r.finished_at?new Date(r.finished_at).getTime():0, items:r.items||{}}));
  const days = []; for(let k=29;k>=0;k--){ const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-k); days.push(d); }
  const key = d => d.toISOString().slice(0,10); const dl = days.map(d => d.toLocaleDateString(LOCALE(), {day:'2-digit', month:'2-digit'}));
  const lastAt = r => Math.max(r.startedAt, ...Object.values(r.items).map(i=>i.at||0));
  let tab = 'views'; try{ tab = sessionStorage.getItem('gg_gtab') || 'views'; }catch(e){}
  let filter = ''; try{ filter = sessionStorage.getItem('gg_gfilter') || ''; }catch(e){} if(filter && !byId[filter]) filter = '';
  const shell = el(`<main class="page"><div class="dash-head"><div><h1>${t('global_stats')}</h1><div class="sub">${t('stats_all_sub')}</div></div>
    <div class="row"><select id="ifilter" class="sel"><option value="">${t('all_instr')}</option>${S.instrs.filter(canSee).map(i => `<option value="${i.id}" ${filter===i.id?'selected':''}>${esc(i.title)}</option>`).join('')}</select><button class="btn ghost" id="csv">${t('export_csv')}</button></div></div><div id="gbody"></div></main>`);
  app.appendChild(shell); const body = shell.querySelector('#gbody');
  let views, stats, runs, perDay, top;
  function build(){
    views = filter ? viewsAll.filter(x=>x.instr_id===filter) : viewsAll; stats = filter ? statsAll.filter(x=>x.instr_id===filter) : statsAll; runs = filter ? runsAll.filter(r=>r.instrId===filter) : runsAll;
    const total = stats.reduce((a,x)=>a+(x.views||0),0), done = stats.reduce((a,x)=>a+(x.completed||0),0); const withDur = views.filter(x=>x.duration_s>0); const avg = withDur.length ? Math.round(withDur.reduce((a,x)=>a+x.duration_s,0)/withDur.length) : 0;
    const nokN = runs.reduce((a,r)=>a+Object.values(r.items).filter(i=>i.ok===false).length,0);
    top = [...stats].filter(x=>x.views>0).sort((a,b)=>b.views-a.views).slice(0,12);
    perDay = Object.fromEntries(days.map(d=>[key(d),0])); views.forEach(x => { const d = new Date(x.started_at||0); if(isNaN(d)) return; const k = key(d); if(perDay[k]!=null) perDay[k]++; });
    body.innerHTML = `
    <div class="stats"><div class="card stat"><b class="tnum">${total}</b><span>${t('views_total')}</span></div><div class="card stat"><b class="tnum">${views.length}</b><span>${t('views_total')} · ${t('last_30')}</span></div><div class="card stat"><b class="tnum">${fmtDurS(avg)}</b><span>${t('views_avg')}</span></div><div class="card stat"><b class="tnum">${total?Math.round(100*done/total):0}%</b><span>${t('views_done')}</span></div><div class="card stat"><b class="tnum">${runs.length}</b><span>${t('runs_total')}</span></div><div class="card stat"><b class="tnum nok-n">${nokN}</b><span>${t('nok_total')}</span></div></div>
    <div class="tabs" id="gtabs"><button data-tab="views" class="${tab==='views'?'on':''}">${t('views_tab')}</button><button data-tab="runs" class="${tab==='runs'?'on':''}">${t('jobdone')} <span class="tnum cnt">${runs.length}</span></button></div>
    <div id="tab-views" ${tab!=='views'?'hidden':''}>
      <div class="charts"><div class="card chart"><h3>${t('views_per_day')} · ${filter?esc(titleOf(filter)):t('all_instr')} · ${t('last_30')}</h3><canvas id="c-day"></canvas></div>
      ${filter?'':`<div class="card chart"><h3>${t('views_per_instr')}</h3>${top.length?`<canvas id="c-top" style="height:${Math.max(120, 30*top.length+8)}px"></canvas>`:`<div class="empty">${t('no_data')}</div>`}</div>`}</div>
      <div class="card tbl-wrap">${stats.length?`<table class="res"><thead><tr><th>${t('instruction')}</th><th>${t('views_total')}</th><th>${t('views_reload')}</th><th>${t('views_avg')}</th><th>${t('views_done')}</th><th>${t('views_steps')}</th><th></th></tr></thead><tbody>${[...stats].sort((a,b)=>b.views-a.views).map(x=>`<tr><td><b>${esc(titleOf(x.instr_id))}</b></td><td class="tnum">${x.views}</td><td class="tnum">${x.reloads}</td><td class="tnum">${fmtDurS(x.avg_duration_s||0)}</td><td class="tnum">${x.views?Math.round(100*x.completed/x.views):0}%</td><td class="tnum">${x.avg_steps_seen}</td><td>${byId[x.instr_id]?`<button class="btn ghost sm" data-r="${x.instr_id}">${t('details')}</button>`:''}</td></tr>`).join('')}</tbody></table>`:`<div class="empty">${t('no_views')}</div>`}</div>
    </div>
    <div id="tab-runs" ${tab!=='runs'?'hidden':''}>
      <div class="card tbl-wrap">${runs.length?`<table class="res"><thead><tr><th>${t('instruction')}</th><th>${t('worker')}</th><th>${t('started')}</th><th>Status</th><th>${t('duration')}</th><th>${t('ok_count')}</th><th>${t('nok_count')}</th><th></th></tr></thead><tbody>${runs.map(r => { const its = Object.values(r.items); const ok = its.filter(i=>i.ok).length, nok = its.filter(i=>i.ok===false).length; return `<tr><td><b>${esc(r.title)}</b> <span class="muted">v${r.version}</span></td><td>${esc(r.worker)}</td><td class="tnum">${fmtDate(r.startedAt)}</td><td>${r.finishedAt?`<span class="ok-n">✓</span>`:`<span class="chip review">${t('running')}</span>`}</td><td class="tnum">${fmtDurS(Math.max(0, Math.round(((r.finishedAt||lastAt(r))-r.startedAt)/1000)))}</td><td class="ok-n tnum">${ok}</td><td class="nok-n tnum">${nok}</td><td><button class="btn ghost sm" data-d="${r.id}">${t('details')}</button></td></tr>`; }).join('')}</tbody></table>`:`<div class="empty">${t('no_runs')}<br><span class="muted">${t('jobdone_hint')}</span></div>`}</div>
    </div>`;
    $$('#gtabs button', body).forEach(b => b.onclick = () => { tab = b.dataset.tab; try{ sessionStorage.setItem('gg_gtab', tab); }catch(e){} $$('#gtabs button', body).forEach(x=>x.classList.toggle('on', x===b)); body.querySelector('#tab-views').hidden = tab!=='views'; body.querySelector('#tab-runs').hidden = tab!=='runs'; if(tab==='views') setTimeout(draw, 30); });
    $$('[data-r]', body).forEach(b => b.onclick = () => go('results/'+b.dataset.r));
    $$('[data-d]', body).forEach(b => b.onclick = () => { const r = runs.find(x=>x.id===b.dataset.d); runDetailsModal(r, byId[r.instrId] ? realSteps(byId[r.instrId]) : []); });
    setTimeout(draw, 30);
  }
  const draw = () => { const c1 = body.querySelector('#c-day'); if(c1) barChart(c1, dl, days.map(d=>perDay[key(d)]), {color:S.brand.color||'#004EAD'}); const c2 = body.querySelector('#c-top'); if(c2) barChart(c2, top.map(x=>titleOf(x.instr_id)), top.map(x=>x.views), {horizontal:true, color:S.brand.color||'#004EAD'}); };
  build();
  shell.querySelector('#ifilter').onchange = e => { filter = e.target.value; try{ sessionStorage.setItem('gg_gfilter', filter); }catch(x){} build(); };
  const onR = () => debounce('gchart', draw, 150); window.addEventListener('resize', onR); G.activeCleanup = () => window.removeEventListener('resize', onR);
  shell.querySelector('#csv').onclick = async () => {
    if(tab==='views'){ const rows2 = [[t('instruction'), t('views_total'), t('views_reload'), t('views_avg')+' (s)', t('views_completed'), t('views_steps')]]; stats.forEach(x => rows2.push([titleOf(x.instr_id), x.views, x.reloads, x.avg_duration_s||0, x.completed, x.avg_steps_seen])); rows2.push([]); rows2.push([t('views_per_day')]); days.forEach(d => rows2.push([key(d), perDay[key(d)]])); await saveFile('giri-views.csv', '﻿'+rows2.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(';')).join('\n'), 'text/csv'); return; }
    const rows2 = [[t('instruction'), t('worker'), t('started'), 'Status', t('version'), t('ok_count'), t('nok_count'), t('nok_note')]];
    runs.forEach(r => { const its = Object.values(r.items); rows2.push([r.title, r.worker, new Date(r.startedAt).toISOString(), r.finishedAt?'done':'running', 'v'+r.version, its.filter(i=>i.ok).length, its.filter(i=>i.ok===false).length, its.filter(i=>i.ok===false&&i.note).map(i=>i.note).join(' | ')]); });
    await saveFile('giri-jobdone.csv', '﻿'+rows2.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(';')).join('\n'), 'text/csv');
  };
}

export { renderGlobalStats };
