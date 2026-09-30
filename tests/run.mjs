// runs the whole Playwright suite against the built app:  node tests/run.mjs [names…]
import { spawn, spawnSync } from 'node:child_process'; import { TESTS, PORT } from './env.mjs'; import path from 'node:path';
const ALL = ['swtest','navtest','blanktest','locktest','roletest','libtest','bigvidtest','vidtest','hangtest','pdftest_ai','tracktest','perftest','migtest','linktest','foldertest','logintest','dbblock','vcachetest','teamtest','sessiontest','offlinetest','trashtest','check4','chaptest','symtest','runtest','r14test','uitest','importtest','ssotest','captest','animtest','fbtest','addstep','r19test','pdftest','pdfsym','postertest','authztest','docktest','preloadtest','offlinerec','swipetest','duptest','mastertest','uifix2','betatest'];
const OK = {chaptest: /admin instr matrix rows: 1/, pdftest: /orig pdf bytes: \d+/, check4: /runs after finish/};
const names = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
spawnSync('node', [path.join(TESTS, 'build_mock.mjs')], {stdio:'inherit'});
// static server in its own process (spawnSync below would block an in-process server)
const srv = spawn('node', [path.join(TESTS, 'server.mjs')], {stdio:'ignore'});
for(let k=0; k<30; k++){ await new Promise(r => setTimeout(r, 200)); if(await fetch(`http://localhost:${PORT}/index3.html`).then(r => r.ok).catch(() => false)) break; }
let failed = 0;
for(const n of names){
  const r = spawnSync('node', [path.join(TESTS, n+'.mjs')], {encoding:'utf8', timeout: 300000, env: {...process.env, GG_PORT: String(PORT)}});
  const out = (r.stdout||'') + (r.stderr||''); const clean = out.split('\n').filter(l => !/Failed to load resource|^\s+at |agent-proxy|connect_rejected|For details|^- |CORS/.test(l)).join('\n');
  const ok = r.status===0 && (OK[n] ? OK[n].test(clean) : /NO ERRORS/.test(clean));
  if(!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if(!ok) console.log(clean.split('\n').slice(-25).join('\n'));
}
srv.kill(); console.log(failed ? `\n${failed} failed` : '\nall passed'); process.exit(failed ? 1 : 0);
