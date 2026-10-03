/* ---------- Papierkorb: Anleitungen (deleted_at, 30 Tage) und Schritte (instr.trash, Medien bleiben) ---------- */
import { G, S } from './state.js';
import { DB } from './storage.js';
import { rowToInstr } from './translate.js';
import { livePaths, liveUses } from './live.js';

const TRASH_DAYS = 30;
const trashAge = ms => Math.max(0, Math.round((Date.now() - ms) / 864e5));

// ---- instructions ----
const trashInstr = async i => { if(!G.sb) return; const {error} = await G.sb.from('instructions').update({deleted_at: new Date().toISOString()}).eq('id', i.id); if(error) throw error; S.instrs = S.instrs.filter(x => x.id !== i.id); };
const restoreInstr = async id => { const {error} = await G.sb.from('instructions').update({deleted_at: null}).eq('id', id); if(error) throw error; };
const purgeInstr = async i => {
  const all = (i.steps||[]).concat(i.trash||[]); const paths = [...new Set(all.filter(s => s.mediaPath).map(s => s.mediaPath).concat(livePaths(i)))];
  if(paths.length) await G.sb.storage.from('media').remove(paths).catch(() => {});
  for(const s of all) if(s.mediaId) await DB.del('media', s.mediaId);
  const {error} = await G.sb.from('instructions').delete().eq('id', i.id); if(error) throw error;
};
// deleted instructions of the workspace, newest first; anything older than 30 days is removed for good on the way
const loadTrash = async () => {
  const {data, error} = await G.sb.from('instructions').select('*').eq('ws', S.user.ws).not('deleted_at', 'is', null).order('deleted_at', {ascending:false});
  if(error) throw error;
  const rows = (data||[]).map(r => { const i = rowToInstr(r); i.deletedAt = new Date(r.deleted_at).getTime(); return i; });
  const old = rows.filter(i => trashAge(i.deletedAt) > TRASH_DAYS);
  for(const i of old){ try{ await purgeInstr(i); }catch(e){} }
  return rows.filter(i => !old.includes(i));
};

// ---- steps: move into instr.trash (position remembered), media untouched ----
const trashStep = (instr, s) => { const i = instr.steps.indexOf(s); if(i < 0) return; instr.steps.splice(i, 1); instr.trash = (instr.trash||[]).filter(x => x.id !== s.id); instr.trash.push(Object.assign({}, s, {deletedAt: Date.now(), at: i})); };
const restoreStep = (instr, ts) => { instr.trash = (instr.trash||[]).filter(x => x.id !== ts.id); const s = Object.assign({}, ts); const at = Math.min(s.at ?? instr.steps.length, instr.steps.length); delete s.deletedAt; delete s.at; instr.steps.splice(at, 0, s); return s; };
const purgeStep = async (instr, ts) => { instr.trash = (instr.trash||[]).filter(x => x.id !== ts.id); if(ts.mediaId) await DB.del('media', ts.mediaId); if(ts.mediaPath && G.sb && !liveUses(instr, ts.mediaPath)) G.sb.storage.from('media').remove([ts.mediaPath]).catch(() => {}); };
const purgeOldSteps = async instr => { const old = (instr.trash||[]).filter(x => trashAge(x.deletedAt||0) > TRASH_DAYS); for(const ts of old) await purgeStep(instr, ts); return old.length; };

export { TRASH_DAYS, trashAge, trashInstr, restoreInstr, purgeInstr, loadTrash, trashStep, restoreStep, purgeStep, purgeOldSteps };
