const APP_VERSION = window.APP_VERSION || 'dev'; // set in index.html

// hosts of earlier Supabase projects – media URLs still pointing there are rewritten to the current project (v12.38, move to Frankfurt)
const LEGACY_HOSTS = ['goorpzgcxhtjbaothluv.supabase.co'];
const CUR_HOST = (() => { try{ return new URL(window.GIRI_CONFIG.SUPABASE_URL).host; }catch(e){ return ''; } })();
const fixLegacyHosts = obj => { if(!CUR_HOST) return obj; let s = JSON.stringify(obj); if(!LEGACY_HOSTS.some(h => s.includes(h))) return obj; LEGACY_HOSTS.forEach(h => { s = s.split(h).join(CUR_HOST); }); return JSON.parse(s); };
// legal pages (v12.39): imprint on Notion, privacy / DPA (AVV) on the website
const LEGAL = { imprint: 'https://ar-giri.notion.site/IMPRESSUM-10776a0b69b780eeb271cdee6c191012', legal: 'https://www.ar-giri.com/legal' };
export { APP_VERSION, LEGACY_HOSTS, fixLegacyHosts, LEGAL };
