// tiny static server for the built app (module scripts need http, file:// is blocked by CORS)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { ROOT, PORT } from './env.mjs';
const MIME = {'.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ttf':'font/ttf', '.webm':'video/webm', '.mp4':'video/mp4', '.pdf':'application/pdf'};
const DB = {v: 0, db: null};
export function startServer(){ return new Promise(res => { const srv = http.createServer((req, r) => {
    // v12.48.1 – shared test database for tests/collab.mjs (two browsers, one "Supabase"): GET returns it, POST replaces it, DELETE clears it
    if(req.url.startsWith('/__db')){ r.setHeader('Content-Type', 'application/json'); r.setHeader('Cache-Control', 'no-store');
      if(req.method === 'DELETE'){ DB.v = 0; DB.db = null; r.end('{}'); return; }
      if(req.method === 'POST'){ let b = ''; req.on('data', c => b += c); req.on('end', () => { DB.db = JSON.parse(b); DB.v++; r.end(JSON.stringify({v: DB.v})); }); return; }
      r.end(JSON.stringify(DB)); return; }
    let u = decodeURIComponent(req.url.split('?')[0]); if(u.endsWith('/')) u += 'index.html'; const f = path.join(ROOT, u); if(!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ r.writeHead(404); r.end('404'); return; } r.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); r.setHeader('Access-Control-Allow-Origin', '*'); r.setHeader('Accept-Ranges', 'bytes');
    const size = fs.statSync(f).size; const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range||''); // range requests: videos are only seekable with them
    if(m){ const a = m[1] ? +m[1] : Math.max(0, size - +m[2]), b = m[2] && m[1] ? Math.min(size-1, +m[2]) : size-1; r.writeHead(206, {'Content-Range':`bytes ${a}-${b}/${size}`, 'Content-Length': b-a+1}); fs.createReadStream(f, {start:a, end:b}).pipe(r); return; }
    r.setHeader('Content-Length', size); fs.createReadStream(f).pipe(r); }); srv.listen(PORT, () => res(srv)); }); }
if(process.argv[1] && process.argv[1].endsWith('server.mjs')){ startServer().then(() => console.log('serving', ROOT, 'on', PORT)); }
