import { esc } from './helpers.js';

/* ---------- Rich text (markdown-lite): **fett**, - Liste, 1. Liste, [Text](url), ==nicht übersetzen== ---------- */
const mdInline = s => s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/==([^=]+)==/g, '<span class="keep">$1</span>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  .replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (m, p, u) => p + '<a href="'+u+'" target="_blank" rel="noopener">'+u+'</a>');

function mdToHtml(src){
  const lines = String(src||'').split(/\r?\n/); let out = '', list = null; const closeList = () => { if(list){ out += `</${list}>`; list = null; } };
  for(const raw of lines){ const line = esc(raw); let m;
    if((m = /^\s*[-*•]\s+(.*)$/.exec(line))){ if(list!=='ul'){ closeList(); out += '<ul>'; list='ul'; } out += `<li>${mdInline(m[1])}</li>`; }
    else if((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))){ if(list!=='ol'){ closeList(); out += '<ol>'; list='ol'; } out += `<li>${mdInline(m[1])}</li>`; }
    else { closeList(); if(line.trim()!=='') out += `<p>${mdInline(line)}</p>`; } }
  closeList(); return out;
}

const titleHtml = s => mdInline(esc(String(s||'')));

const mdToPlain = src => String(src||'').split(/\r?\n/).map(l => l.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/==([^=]+)==/g,'$1').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'$1 ($2)').replace(/^\s*[-*•]\s+/, '• ')).join('\n');


/* ---------- HTML → markdown-lite (imports from GIRI Classic, pasted rich text): <p>, <br>, <ul>/<ol><li>, <strong>/<b>, <a href> ---------- */
const ENT = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', '#39':"'", '#34':'"'};
const decodeEnt = s => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => { const k = String(e).toLowerCase(); if(ENT[k] != null) return ENT[k]; if(k[0]==='#'){ const n = k[1]==='x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; } return m; });
function htmlToMd(h){
  h = String(h == null ? '' : h); if(!/<[a-z/!]/i.test(h)) return h;
  let s = h.replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, tg, x) => { const t = x.replace(/<[^>]+>/g, '').trim(); return t ? '**'+t+'**' : ''; });
  s = s.replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, x) => { const t = x.replace(/<[^>]+>/g, '').trim(); return /^https?:\/\//.test(href) ? `[${t||href}](${href})` : t; });
  s = s.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (m, inner) => { let n = 0; return '\n' + inner.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (x, li) => `${++n}. ${li.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`) + '\n'; });
  s = s.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (m, inner) => '\n' + inner.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (x, li) => `- ${li.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`) + '\n');
  s = s.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n').replace(/<(p|div|h[1-6])\b[^>]*>/gi, '').replace(/<[^>]+>/g, '');
  s = decodeEnt(s);
  return s.split('\n').map(l => l.replace(/[ \t]+$/g, '').replace(/^[ \t]+(?=\S)/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export { htmlToMd, mdInline, mdToHtml, titleHtml, mdToPlain };
