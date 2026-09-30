import { cacheWs, cachedWs } from './offline.js';
import { toast } from './helpers.js';
import { BRAND_DEFAULT, G, S, brandCache } from './state.js';

/* ---------- Workspace row: Projekte (folders), Teams, Einladungen ---------- */

const applyWsRow = data => { S.wsRow = {folders:(data&&data.folders)||[], teams:(data&&data.teams)||[], invites:(data&&data.invites)||[], symbols:(data&&data.symbols)||[], settings:(data&&data.settings)||{},
    name:(data&&data.name)||'', plan:(data&&data.plan)||'active', planUntil:(data&&data.plan_until)||null, seats:(data&&data.seats)||null, planNote:(data&&data.plan_note)||'', openDomain:!!(data&&data.open_domain), ownerEmail:(data&&data.owner_email)||''}; /* v12.47: plan fields are read-only here (set by the platform) */ if(data && data.brand){ S.brand = Object.assign({}, BRAND_DEFAULT, data.brand); brandCache.set(S.user.ws, S.brand); } };
async function loadWs(force){ if(!G.sb || !S.user) return S.wsRow; if(G.wsLoaded && !force) return S.wsRow; let data = null; try{ const r = await G.sb.from('workspaces').select('*').eq('ws', S.user.ws).maybeSingle(); data = r.data; if(r.error) throw r.error; cacheWs(data); }catch(e){ data = cachedWs(); if(!data) return S.wsRow; } applyWsRow(data); G.wsLoaded = true; return S.wsRow; }
// v0.29: cold start without waiting for the server – the last workspace row from this device (the network copy follows)
const loadWsLocal = () => { const data = cachedWs(); if(data) applyWsRow(data); return !!data; };

async function saveWs(patch){ Object.assign(S.wsRow, patch); const {error} = await G.sb.from('workspaces').upsert(Object.assign({ws:S.user.ws, updated_at:new Date().toISOString()}, patch)); if(error){ toast(error.message); throw error; } }

const myEmail = () => ((S.user&&S.user.email)||'').toLowerCase();

const teamsOf = () => (S.wsRow.teams||[]).filter(tm => (tm.members||[]).some(m => (m.email||'').toLowerCase()===myEmail()));

const folderTeams = fid => { const f = (S.wsRow.folders||[]).find(x=>x.id===fid); return f ? (f.teams||[]) : []; };

const folderName = fid => { const f = (S.wsRow.folders||[]).find(x=>x.id===fid); return f ? f.name : ''; };

// Sichtbarkeit + effektive Rolle je Anleitung: Projekt ohne Team-Zuordnung = alle im Workspace; sonst nur Team-Mitglieder (Admins immer)
// teams of an instruction = teams of its project + teams assigned to the instruction itself
const instrTeams = instr => { const ids = new Set([...folderTeams(instr && instr.folder), ...((instr && instr.teams)||[])]); const have = new Set((S.wsRow.teams||[]).map(tm=>tm.id)); return [...ids].filter(x => have.has(x)); };

const canSee = instr => { if(!S.user) return false; if(S.user.isAdmin) return true; const ft = instrTeams(instr); if(!ft.length) return true; return teamsOf().some(tm => ft.includes(tm.id)); };

// checklist modes: all = every step, chapter = last step of each chapter, custom = steps marked by the creator
const needsConfirm = (instr, st, idx, arr) => { if(!instr.checklist || st.kind==='chapter') return false; const m = instr.checkMode||'all'; if(m==='custom') return !!st.confirm; if(m==='chapter'){ const nx = arr[idx+1]; return !nx || nx.kind==='chapter'; } return true; };

const confirmSteps = instr => (instr.steps||[]).filter((st,i,arr) => needsConfirm(instr, st, i, arr));

export { loadWsLocal, loadWs, saveWs, myEmail, teamsOf, folderTeams, folderName, instrTeams, canSee, needsConfirm, confirmSteps };
