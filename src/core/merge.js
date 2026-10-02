// v12.48.1 – two people, one instruction: a three-way merge instead of "take theirs / overwrite".
// Every server version this device has seen is remembered (per instruction, by its updated_at stamp = i._base). When a save finds a
// newer row on the server, mine and theirs are compared against that common base: changes to different steps or different fields
// are combined automatically; only the same field of the same step changed on both sides is a real conflict (→ the dialog as before).
const bases = new Map(); // id → Map(stamp → JSON of the instruction content)
const SKIP = new Set(['id', 'ws', 'updatedAt', '_base', 'lastBy', 'steps']);
const clean = i => { const o = {}; Object.keys(i || {}).forEach(k => { if(k[0] !== '_' && k !== 'updatedAt' && k !== 'lastBy') o[k] = i[k]; }); return o; };
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

const rememberBase = i => {
  if(!i || !i.id || !i._base) return;
  let m = bases.get(i.id); if(!m){ m = new Map(); bases.set(i.id, m); }
  if(!m.has(i._base)) m.set(i._base, JSON.stringify(clean(i)));
  while(m.size > 6) m.delete(m.keys().next().value); // the last few versions are enough
};
// the device mirror keeps the base next to each copy, so a merge still works after a reload (offline edits included)
const baseJson = i => { const m = bases.get(i && i.id); return (m && m.get(i._base)) || null; };
const seedBase = (id, stamp, json) => { if(!id || !stamp || !json) return; let m = bases.get(id); if(!m){ m = new Map(); bases.set(id, m); } if(!m.has(stamp)) m.set(stamp, json); };
const baseOf = i => { const m = bases.get(i && i.id); const j = m && m.get(i._base); return j ? JSON.parse(j) : null; };

// one value: who changed it since the base?
let prefer = 'mine';
const pick = (b, m, t, path, conflicts) => {
  if(same(m, b)) return t; if(same(t, b) || same(m, t)) return m;
  conflicts.push(path); return prefer === 'theirs' ? t : m;
};
const mergeObj = (b, m, t, path, conflicts) => {
  const out = {}; const keys = new Set([...Object.keys(b || {}), ...Object.keys(m || {}), ...Object.keys(t || {})]);
  keys.forEach(k => { if(path === '' && SKIP.has(k)) return; if(k[0] === '_') return; const v = pick((b || {})[k], (m || {})[k], (t || {})[k], path + k, conflicts); if(v !== undefined) out[k] = v; });
  return out;
};
const mergeSteps = (B, M, T, conflicts) => {
  B = B || []; M = M || []; T = T || [];
  const byId = a => new Map(a.map(s => [s.id, s])); const bm = byId(B), mm = byId(M), tm = byId(T);
  const ord = a => a.map(s => s.id).join('|');
  // order: whoever reordered wins; both reordered → mine, with their new steps placed after their predecessor
  let order = same(ord(M), ord(B)) ? T.map(s => s.id) : M.map(s => s.id);
  if(!same(ord(M), ord(B)) && !same(ord(T), ord(B))){
    T.forEach((s, k) => { if(!bm.has(s.id) && !order.includes(s.id)){ const prev = k > 0 ? T[k-1].id : null; const at = prev ? order.indexOf(prev) + 1 : 0; order.splice(at > 0 ? at : order.length, 0, s.id); } });
  }
  // steps added on one side only (not yet in the chosen order) → keep them where the other side put them
  // and steps the other side deleted are kept in view here, so the check below can tell 'deleted' from 'deleted but changed elsewhere'
  [M, T].forEach(src => src.forEach((s, k) => { if(!order.includes(s.id)){ const prev = k > 0 ? src[k-1].id : null; const at = prev && order.includes(prev) ? order.indexOf(prev) + 1 : order.length; order.splice(at, 0, s.id); } }));
  const out = [];
  order.forEach(id => {
    const b = bm.get(id), m = mm.get(id), t = tm.get(id);
    if(b && (!m || !t)){ // deleted on one side
      const kept = m || t; if(same(kept, b)) return; // the other side did not touch it → stays deleted
      conflicts.push('step:' + id + ':deleted'); if(prefer === 'theirs' && !t) return; if(prefer === 'mine' && !m) return; out.push(kept); return;
    }
    if(!b){ out.push(m || t); return; } // new
    out.push(mergeObj(b, m, t, 'step:' + id + ':', conflicts));
  });
  return out;
};

// → {merged, conflicts} or null when this device has no common base (then the dialog decides)
// prefer: who wins where both changed the same field ('mine' | 'theirs'); everything else is combined either way
const merge3 = (mine, theirs, pref) => {
  const base = baseOf(mine); if(!base) return null; prefer = pref || 'mine';
  const conflicts = []; const m = clean(mine), t = clean(theirs);
  const merged = mergeObj(base, m, t, '', conflicts);
  merged.steps = mergeSteps(base.steps, m.steps, t.steps, conflicts);
  return {merged, conflicts};
};

// write the merged content into the open object in place: the editor keeps references to it and to its step objects
const applyMerged = (i, merged) => {
  const keepSteps = new Map((i.steps || []).map(s => [s.id, s]));
  const steps = merged.steps.map(s => { const own = keepSteps.get(s.id); if(!own) return s; Object.keys(own).forEach(k => { if(!(k in s)) delete own[k]; }); return Object.assign(own, s); });
  Object.keys(clean(i)).forEach(k => { if(!SKIP.has(k) && !(k in merged)) delete i[k]; });
  Object.keys(merged).forEach(k => { if(k !== 'steps') i[k] = merged[k]; });
  if(Array.isArray(i.steps)){ i.steps.length = 0; i.steps.push(...steps); } else i.steps = steps;
};

export { rememberBase, merge3, applyMerged, baseJson, seedBase };
