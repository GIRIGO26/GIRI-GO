import { saveInstr } from './passwords.js';
import { S } from './state.js';

/* ---------- Public links (v0.33) ----------
   A public link carries the instruction id plus a random share key: #/v/<id>/<key>. Without the right key the server returns
   nothing (no anonymous table reads any more – see open_instr). 18 random bytes → 24 url-safe characters (144 bit), generated
   in the browser when an instruction is created or first shared; stored in instr.shareKey. Old links without a key are stale. */
const KEY_RE = /^[A-Za-z0-9_-]{16,}$/;
const isShareKey = s => KEY_RE.test(s || '');
function newShareKey(){ const b = new Uint8Array(18); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_'); }
const appBase = () => location.href.split('#')[0];
const publicLink = (instr, extra) => `${appBase()}#/v/${instr.id}${instr.shareKey ? '/' + instr.shareKey : ''}${extra ? '/' + extra : ''}`;
// gives an instruction its key if it has none yet (older rows) and saves – a no-op for keyed ones
async function ensureShareKey(instr){
  if(instr.shareKey) return instr.shareKey;
  instr.shareKey = newShareKey();
  const mem = (S.instrs || []).find(i => i.id === instr.id); if(mem && mem !== instr) mem.shareKey = instr.shareKey;
  try{ await saveInstr(instr); }catch(e){}
  return instr.shareKey;
}
export { isShareKey, newShareKey, publicLink, ensureShareKey };
