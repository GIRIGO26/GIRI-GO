// v12.39 – the eight Classic roles: editor edits but has no web links; technical approver only approves the technical part; viewer reads
import { chromium } from 'playwright'; import { BASE, OUT, launchArgs } from './env.mjs';
const browser = await chromium.launch(launchArgs([]));
const errs=[];
const open = async (role) => {
  const ctx = await browser.newContext({viewport:{width:1300,height:900}});
  await ctx.addInitScript(role => { localStorage.setItem('gg_lang','de'); Object.defineProperty(window, '__tables', {configurable:true, set(t){ t.profiles[0].role='viewer'; t.profiles[0].is_admin=false; t.profiles[0].email='anna@ar-giri.com'; t.workspaces[0].teams.push({id:'tq', name:'Qualität', members:[{email:'anna@ar-giri.com', role}]}); t.workspaces[0].folders.push({id:'fq', name:'Prüfplatz', teams:['tq']}); this._t = t; }, get(){ return this._t; }}); }, role);
  const d = await ctx.newPage(); d.on('pageerror', e => errs.push(role+': '+e.message));
  await d.goto(BASE+'/index3.html'); await d.waitForTimeout(2500);
  // the seeded instruction goes into the team folder and waits for approval
  const id = await d.evaluate(() => { const t = window.__tables; if(!t.instructions.length){ const ws = t.profiles[0].ws; const at = Date.now(); t.instructions.push({id:'rt1', ws, status:'review', title:'Prüfen', updated_at:new Date(at).toISOString(), data:{id:'rt1', ws, title:'Prüfen', status:'review', updatedAt:at, createdAt:at, createdBy:'x', shareKey:'aaaaaaaaaaaaaaaaaaaaaaaa', version:0, approvals:{tech:null,dsgvo:null}, checklist:false, history:[], steps:[{id:'s1', type:'empty', title:'Schritt', desc:'', warn:'', ann:[], w:1280, h:720, duration:0, trimStart:0, trimEnd:0}]}}); } const r = t.instructions[0]; r.data.folder='fq'; r.status='review'; r.data.status='review'; r.data.approvals={tech:null, dsgvo:null}; return r.id; });
  await d.goto(BASE+'/index3.html#/x'); await d.waitForTimeout(200); await d.goto(BASE+'/index3.html#/'); await d.waitForTimeout(1500);
  const dash = await d.evaluate(() => ({ newBtn: !!document.querySelector('#new'), addFolder: !!document.querySelector('#fadd'), todo: !!document.querySelector('#todo') }));
  await d.click(`[data-sid="${id}"] [data-a="more"]`); await d.waitForTimeout(300);
  const menu = await d.$$eval('.modal .menu [data-m]', x => x.map(e => e.dataset.m).join(','));
  await d.keyboard.press('Escape'); await d.waitForTimeout(200);
  await d.goto(BASE+'/index3.html#/edit/'+id); await d.waitForTimeout(1500);
  const openedEditor = await d.evaluate(() => !!document.querySelector('#ititle'));
  const ed = await d.evaluate(() => ({ opened: !!document.querySelector('#ititle'), titleEditable: !document.querySelector('#ititle').disabled, share: !!(document.querySelector('#share') && !document.querySelector('#share').hidden), okTech: !!document.querySelector('[data-ok="tech"]'), okDsgvo: !!document.querySelector('[data-ok="dsgvo"]'), addStep: !!document.querySelector('.add-step, [data-addstep], .srow.add') }));
  await ctx.close();
  return {dash, menu, ed};
};
for(const role of ['viewer','editor','tech_approver','compliance_approver','approver','creator','team_admin']){
  const r = await open(role);
  console.log(role.padEnd(20), '| new:', r.dash.newBtn, 'folder+:', r.dash.addFolder, 'todo:', r.dash.todo, '| menu:', r.menu, '| editor:', r.ed.opened, 'edit:', r.ed.titleEditable, 'share:', r.ed.share, 'tech:', r.ed.okTech, 'dsgvo:', r.ed.okDsgvo);
}
console.log(errs.join('\n')||'NO ERRORS');
await browser.close();
