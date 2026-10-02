// v12.48.1 – unit test of the three-way merge (src/core/merge.js): add / delete / reorder / same field
import { rememberBase, merge3 } from '../src/core/merge.js';
const S = (id, desc, title='T') => ({id, title, desc});
const base = {id:'x', _base:1, title:'Anleitung', status:'draft', steps:[S('a','A'), S('b','B'), S('c','C')]};
const cp = o => JSON.parse(JSON.stringify(o)); rememberBase(base);
const run = (name, mine, theirs, pref) => { mine._base = 1; const r = merge3(mine, theirs, pref); console.log(name.padEnd(46), '→', r.merged.steps.map(s => s.id+':'+s.desc+(s.title!=='T'?'/'+s.title:'')).join(' '), '| title', r.merged.title, '| conflicts', r.conflicts.length); };
let m, t;
m = cp(base); m.steps.splice(1, 0, S('n1','NEU-ICH')); t = cp(base); t.steps[2].desc = 'C-ER'; run('I add a step, they edit step c', m, t);
m = cp(base); m.steps[0].desc = 'A-ICH'; t = cp(base); t.steps.splice(1, 1); run('I edit a, they delete b', m, t);
m = cp(base); m.steps[1].desc = 'B-ICH'; t = cp(base); t.steps.splice(1, 1); run('I edit b, they delete b (conflict)', m, t);
m = cp(base); m.steps.reverse(); t = cp(base); t.steps[0].desc = 'A-ER'; run('I reorder, they edit a', m, t);
m = cp(base); m.steps.push(S('n2','MEINS')); t = cp(base); t.steps.push(S('n3','SEINS')); run('both add a step at the end', m, t);
m = cp(base); m.title = 'Mein Titel'; t = cp(base); t.steps[1].title = 'Schritt neu'; run('I rename, they retitle step b', m, t);
m = cp(base); m.steps[2].desc = 'C-ICH'; t = cp(base); t.steps[2].desc = 'C-ER'; run('same field, prefer mine', m, t, 'mine');
m = cp(base); m.steps[2].desc = 'C-ICH'; t = cp(base); t.steps[2].desc = 'C-ER'; run('same field, prefer theirs', m, t, 'theirs');
console.log('no base → dialog as before:', merge3({id:'y', _base:5, steps:[]}, {id:'y', steps:[]}) === null);
console.log('NO ERRORS');
