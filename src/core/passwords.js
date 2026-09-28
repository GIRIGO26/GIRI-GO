import { mirrorPut, flushDirty, netErr, schedulePill } from './offline.js';
import { esc, modal, toast } from './helpers.js';
import { t } from './i18n.js';
import { G, S } from './state.js';
import { DB, uid } from './storage.js';
import { rowToInstr } from './translate.js';
import { instrTeams } from './workspace.js';

/* ---------- Link passwords (per project / per team; default off) ---------- */
async function sha256Hex(str){ const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join(''); }

const mkPw = async pw => { const s = uid()+uid(); return {h: await sha256Hex(s+pw), s}; };

// which passwords guard an instruction's public link (names for the share hint)
const lockNames = instr => { const out = []; const f = (S.wsRow.folders||[]).find(x=>x.id===instr.folder); if(f && f.pw) out.push(f.name); instrTeams(instr).forEach(tid => { const tm = (S.wsRow.teams||[]).find(x=>x.id===tid); if(tm && tm.pw) out.push(tm.name); }); return out; };

// set / change / remove a link password for a project or team → resolves {h,s} | null (remove) | undefined (cancel)
function pwDialog(name, has){
  return modal(`<h2>🔒 ${t('link_pw')}</h2><p class="muted" style="margin:0 0 12px">${esc(t('link_pw_sub',{n:name}))}</p><div class="field"><label for="pw-in">${t('link_pw_label')}</label><input id="pw-in" type="text" autocomplete="off" autocapitalize="off" placeholder="${has ? t('link_pw_keep') : t('link_pw_ph')}"></div><div class="actions">${has?`<button class="btn ghost" data-rm style="color:var(--red)">${t('link_pw_remove')}</button>`:''}<button class="btn ghost" data-x>${t('cancel')}</button><button class="btn" data-ok>${t('save')}</button></div>`, (bg, close) => {
    const inp = bg.querySelector('#pw-in'); setTimeout(() => inp.focus(), 50);
    const ok = async () => { const pw = inp.value.trim(); if(!pw){ if(has) close(undefined); else inp.focus(); return; } close(await mkPw(pw)); };
    bg.querySelector('[data-ok]').onclick = ok; inp.addEventListener('keydown', e => { if(e.key==='Enter') ok(); });
    bg.querySelector('[data-x]').onclick = () => close(undefined); const rm = bg.querySelector('[data-rm]'); if(rm) rm.onclick = () => close(null); });
}

const fetchInstr = async id => { if(!G.sb) return null; const {data} = await G.sb.from('instructions').select('*').eq('id', id).maybeSingle(); return data ? rowToInstr(data) : null; };
 const ownWrites = new Set();

// one row → server; true on success. Used by saveInstr and by the offline queue.
const upsertInstrRow = async i => {
  const {id, ws, status, title, updatedAt, ...rest} = i; const data = Object.assign({}, rest);
  G.saving++; ownWrites.add(updatedAt); if(ownWrites.size > 200){ const first = ownWrites.values().next().value; ownWrites.delete(first); }
  try{ const {error} = await G.sb.from('instructions').upsert({id, ws, status, title, updated_at: new Date(updatedAt).toISOString(), data}); if(error) throw error; return true; }
  catch(e){ if(!netErr(e)) toast(e.message||String(e)); return false; }
  finally { G.saving--; }
};
// saves go to the local mirror first (dirty), then to the server; without network they stay dirty and are pushed later
const saveInstr = async (i, opts) => {
  if(!(opts && opts.keepDate)) i.updatedAt = Date.now(); if(!G.sb) return; // keepDate: the importer keeps the original Classic date
  if(i.ws === (S.user && S.user.ws) && !S.instrs.some(x => x.id === i.id)) S.instrs.unshift(i); // new instruction: in memory at once (v0.29 – navigation no longer waits for a server round trip)
  (i.steps||[]).forEach(s => { if(s.mediaId && !s.mediaUrl && S.remoteUrl.has(s.mediaId)){ s.mediaUrl = S.remoteUrl.get(s.mediaId); } }); // uploaded here meanwhile → never save it without its URL
  await mirrorPut(i, true);
  const ok = await upsertInstrRow(i);
  if(ok){ await mirrorPut(i, false); } else { toast(t('saved_offline')); }
  schedulePill();
};
const retrySaves = () => flushDirty(upsertInstrRow);

const deleteInstr = async i => { if(!G.sb) return; const paths = (i.steps||[]).filter(s=>s.mediaPath).map(s=>s.mediaPath); if(paths.length) await G.sb.storage.from('media').remove(paths).catch(()=>{}); for(const s of i.steps||[]) if(s.mediaId) await DB.del('media', s.mediaId); await G.sb.from('instructions').delete().eq('id', i.id); };

export { upsertInstrRow, retrySaves, sha256Hex, mkPw, lockNames, pwDialog, fetchInstr, ownWrites, saveInstr, deleteInstr };
