import { newShareKey } from '../core/links.js';
import { saveInstr } from '../core/passwords.js';
import { G, S, putMedia } from '../core/state.js';
import { uid } from '../core/storage.js';
import { runUploads } from '../core/uploads.js';


/* ---------- Seed example ---------- */

async function ensureSeed(){
  if(!G.sb || !S.user || S.user.role==='viewer') return;
  if(G.seedOnce) return G.seedOnce; G.seedOnce = seedImpl(); return G.seedOnce;
}

async function seedImpl(){
  const {count} = await G.sb.from('instructions').select('id', {count:'exact', head:true}).eq('ws', S.user.ws); if(count) return;
  const mkImg = (label, hue) => new Promise(res => { const c = document.createElement('canvas'); c.width=1280; c.height=960; const x=c.getContext('2d');
    const g = x.createLinearGradient(0,0,1280,960); g.addColorStop(0,`hsl(${hue},40%,22%)`); g.addColorStop(1,`hsl(${hue+30},45%,38%)`); x.fillStyle=g; x.fillRect(0,0,1280,960);
    x.strokeStyle='rgba(255,255,255,.15)'; x.lineWidth=2; for(let i=0;i<1280;i+=80){ x.beginPath(); x.moveTo(i,0); x.lineTo(i,960); x.stroke(); } for(let i=0;i<960;i+=80){ x.beginPath(); x.moveTo(0,i); x.lineTo(1280,i); x.stroke(); }
    x.fillStyle='rgba(255,255,255,.12)'; x.beginPath(); x.roundRect ? x.roundRect(380,300,520,360,30) : x.rect(380,300,520,360); x.fill();
    x.fillStyle='#fff'; x.font='700 54px Montserrat, sans-serif'; x.textAlign='center'; x.fillText(label, 640, 500); x.font='600 28px Montserrat, sans-serif'; x.fillStyle='rgba(255,255,255,.7)'; x.fillText('Beispielbild · Example image', 640, 560);
    c.toBlob(b => res(b), 'image/jpeg', .8); });
  const steps = [
    {ch:'Vorbereitung', t:'Werkstück in Spannvorrichtung einlegen', d:'Anschlag links, Kante bündig.', hue:210, ann:[{type:'arrow',x:.22,y:.22,x2:.46,y2:.44,color:'blue'}]},
    {t:'Spannhebel schließen', d:'Bis zum hörbaren Klick.', hue:200, ann:[{type:'circle',x:.4,y:.35,x2:.62,y2:.65,color:'red'},{type:'number',x:.2,y:.2,n:1,color:'blue'}]},
    {ch:'Montage', t:'Schrauben M6 einsetzen (4×)', d:'Reihenfolge über Kreuz.', hue:160, ann:[{type:'number',x:.3,y:.3,n:1,color:'blue'},{type:'number',x:.7,y:.7,n:2,color:'blue'},{type:'number',x:.7,y:.3,n:3,color:'blue'},{type:'number',x:.3,y:.7,n:4,color:'blue'}]},
    {t:'Mit 10 Nm anziehen', d:'Drehmomentschlüssel Nr. 3.', hue:30, w:'Handschuhe tragen', ann:[{type:'warn',x:.8,y:.22},{type:'text',x:.35,y:.8,text:'10 Nm',color:'yellow'}]},
    {ch:'Prüfung', t:'Sichtprüfung Spalt', d:'Spaltmaß max. 0,5 mm.', hue:340, ann:[{type:'check',x:.5,y:.5}]}
  ];
  const instr = {id:uid(), ws:S.user.ws, title:'Beispiel: Spannvorrichtung rüsten', example:true, shareKey:newShareKey(), createdBy:S.user.name, createdAt:Date.now(), updatedAt:Date.now(), status:'draft', version:0, approvals:{tech:null, dsgvo:null}, checklist:true, steps:[], history:[]};
  for(const s of steps){
    if(s.ch) instr.steps.push({id:uid(), kind:'chapter', title:s.ch});
    const blob = await mkImg(s.t, s.hue); const mid = uid();
    await putMedia({id:mid, blob, w:1280, h:960, type:'photo', ws:S.user.ws, instrId:instr.id});
    instr.steps.push({id:uid(), type:'photo', mediaId:mid, w:1280, h:960, duration:0, trimStart:0, trimEnd:0, title:s.t, desc:s.d, warn:s.w||'', ann:s.ann.map(a => Object.assign({id:uid(), color:'blue', t:0}, a))});
  }
  await saveInstr(instr); runUploads();
}

export { ensureSeed, seedImpl };
