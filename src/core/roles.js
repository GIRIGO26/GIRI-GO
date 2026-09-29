// v12.39 – roles & permissions, taken over 1:1 from GIRI Classic (help.ar-giri.com/administratoren/rollen-berechtigungen).
// Roles apply per team; a person can hold different roles in different teams. The workspace role (profiles.role) is the
// default wherever an instruction/folder is not restricted to a team. Org admins (profiles.is_admin / role 'admin') hold
// every right everywhere. Legacy names from earlier GIRI Go versions map onto the new set (reviewer → approver).
import { S } from './state.js';
import { instrTeams, myEmail, teamsOf } from './workspace.js';

const ROLES = ['viewer', 'editor', 'approver', 'tech_approver', 'compliance_approver', 'compliance_manager', 'creator', 'team_admin'];
// capabilities: view · edit (create/change/delete) · approve_tech · approve_dsgvo · lock · links (web links / QR) · projects (folders)
// · users (team members) · users_limited (viewer + compliance manager only) · team (team details) · analytics (views, job-done)
const CAPS = {
  viewer: [],
  editor: ['edit'],
  approver: ['approve_tech', 'approve_dsgvo', 'lock', 'links'],
  tech_approver: ['approve_tech', 'lock', 'links'],
  compliance_approver: ['approve_dsgvo', 'lock', 'links'],
  compliance_manager: ['approve_dsgvo', 'lock', 'links', 'users_limited'],
  creator: ['edit', 'approve_tech', 'approve_dsgvo', 'lock', 'links', 'projects'],
  team_admin: ['edit', 'approve_tech', 'approve_dsgvo', 'lock', 'links', 'projects', 'users', 'users_limited', 'team', 'analytics'],
};
const ALIAS = { reviewer: 'approver', admin: 'team_admin', 'team-admin': 'team_admin', technical_approver: 'tech_approver' };
const RANK = { viewer: 0, editor: 1, tech_approver: 2, compliance_approver: 2, approver: 3, compliance_manager: 3, creator: 4, team_admin: 5 };
const ICON = { viewer: '👀', editor: '✏️', approver: '✅', tech_approver: '🔧', compliance_approver: '🛡️', compliance_manager: '🗂️', creator: '🛠️', team_admin: '👑' };

const normRole = r => { const x = ALIAS[r] || r; return CAPS[x] ? x : 'viewer'; };
const capsOf = r => CAPS[normRole(r)] || [];
const roleRank = r => RANK[normRole(r)] ?? 0;
const roleIcon = r => ICON[normRole(r)] || '';
const isOrgAdmin = () => !!(S.user && (S.user.isAdmin || S.user.role === 'admin'));

// the roles I hold in the given teams (none given → the workspace role)
const rolesIn = teamIds => {
  if(!S.user) return [];
  if(isOrgAdmin()) return ['team_admin'];
  const ids = new Set(teamIds || []);
  const mine = ids.size ? teamsOf().filter(tm => ids.has(tm.id)) : [];
  const roles = mine.map(tm => ((tm.members || []).find(m => (m.email || '').toLowerCase() === myEmail()) || {}).role).filter(Boolean).map(normRole);
  return roles.length ? roles : [normRole(S.user.role)];
};
const myRoles = instr => rolesIn(instrTeams(instr));
const canIn = (teamIds, cap) => rolesIn(teamIds).some(r => capsOf(r).includes(cap));
const can = (instr, cap) => myRoles(instr).some(r => capsOf(r).includes(cap));
// any of my roles anywhere (workspace role + every team I am in) – for page-level actions like "new instruction" or "new folder"
const canAny = cap => { if(!S.user) return false; if(isOrgAdmin()) return true; const all = [normRole(S.user.role), ...teamsOf().map(tm => normRole(((tm.members || []).find(m => (m.email || '').toLowerCase() === myEmail()) || {}).role))]; return all.some(r => capsOf(r).includes(cap)); };
const canApproveAny = () => canAny('approve_tech') || canAny('approve_dsgvo');
// the roles a manager may hand out: team admins everything, compliance managers only viewer + compliance manager
const assignableRoles = teamIds => { const r = rolesIn(teamIds); if(r.some(x => capsOf(x).includes('users'))) return ROLES.slice(); if(r.some(x => capsOf(x).includes('users_limited'))) return ['viewer', 'compliance_manager']; return []; };

export { ROLES, CAPS, normRole, capsOf, roleRank, roleIcon, isOrgAdmin, rolesIn, myRoles, canIn, can, canAny, canApproveAny, assignableRoles };
