import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// GIRI Go – translate (v8). Three modes:
//  A) { instrId, target, pw?, key? } – public viewer: translates a PUBLISHED instruction (or returns the cached
//                             translation) and caches it in instructions.data.translations[target]
//  B) { texts[], target }  – signed-in user: raw text translation (editor)
//  C) { ui:[{k,v}], target } – app UI strings (German source); cached per string in public.ui_tx (public, bounded)
// Custom auth (verify_jwt off): apikey header must match the project's publishable/anon key;
// mode B additionally requires a valid user session.
// Markdown-lite survives translation: **bold**, [text](url), ==do not translate==, {placeholders}, list markers.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const TARGET: Record<string, string> = { EN: "EN-GB", PT: "PT-PT", ZH: "ZH-HANS" };
const ALLOWED = ["EN", "FR", "ES", "IT", "NL", "PL", "CS", "TR", "PT", "RO", "HU", "DE", "ZH"];

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const xmlUnesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
// ==text== and {placeholders} → <keep> (ignored by DeepL); **bold** → <b>; [text](url) → <a href> (tags survive, attributes untouched)
const protect = (s: string) => xmlEsc(s)
  .replace(/==([^=\n]+)==/g, "<keep>$1</keep>")
  .replace(/\{([a-zA-Z0-9_]+)\}/g, "<keep>{$1}</keep>")
  .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
  .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
const unprotect = (s: string) => xmlUnesc(s
  .replace(/<keep>\{([a-zA-Z0-9_]+)\}<\/keep>/g, "{$1}")
  .replace(/<keep>([\s\S]*?)<\/keep>/g, "==$1==")
  .replace(/<b>([\s\S]*?)<\/b>/g, "**$1**")
  .replace(/<a\s+href="([^"]+)"\s*>([\s\S]*?)<\/a>/g, "[$2]($1)"));
const strHash = (str: string) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

async function deepl(key: string, texts: string[], target: string, sourceLang?: string): Promise<string[]> {
  const endpoint = key.endsWith(":fx") ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";
  const out: string[] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const chunk = texts.slice(i, i + 50);
    const idx = chunk.map((t, k) => (t.trim() ? k : -1)).filter((k) => k >= 0);
    let res: string[] = [];
    if (idx.length) {
      const payload: Record<string, unknown> = { text: idx.map((k) => protect(chunk[k])), target_lang: TARGET[target] || target, preserve_formatting: true, tag_handling: "xml", ignore_tags: ["keep"], non_splitting_tags: ["b", "a", "keep"] };
      if (sourceLang && sourceLang !== target) payload.source_lang = sourceLang;
      const r = await fetch(endpoint, { method: "POST", headers: { Authorization: "DeepL-Auth-Key " + key, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error("deepl_" + r.status + " " + (await r.text()).slice(0, 200));
      const j = await r.json();
      res = (j.translations || []).map((x: { text: string }) => unprotect(x.text));
    }
    const merged = chunk.map(() => "");
    idx.forEach((k, n) => (merged[k] = res[n] ?? ""));
    out.push(...merged);
  }
  return out;
}

// same source-text order as the app (srcTexts)
function srcTexts(instr: any): { k: string; v: string }[] {
  const arr = [{ k: "title", v: instr.title || "" }];
  for (const st of instr.steps || []) {
    if (st.kind === "chapter") arr.push({ k: "ch:" + st.id, v: st.title || "" });
    else { arr.push({ k: "t:" + st.id, v: st.title || "" }); arr.push({ k: "d:" + st.id, v: st.desc || "" }); arr.push({ k: "w:" + st.id, v: st.warn || "" }); }
  }
  return arr;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apikey = req.headers.get("apikey") || "";
    const allowed = [anon, Deno.env.get("PUBLISHABLE_KEY") || "", "sb_publishable_eDo9afwf0tBuFqu1-yYyGg_2Tk3uv_L", "sb_publishable_DPCsusG0yVnugNpJaB-vpA_-DLUJaLW"].filter(Boolean);
    if (!allowed.includes(apikey)) return json({ error: "forbidden" }, 403);
    const admin = createClient(url, service);
    const { data: key, error: kerr } = await admin.rpc("get_deepl_key");
    if (kerr || !key) return json({ error: "no_key", detail: kerr?.message }, 500);
    const body = await req.json();
    const target = String(body.target || "EN").toUpperCase();
    if (!ALLOWED.includes(target)) return json({ error: "bad_target" }, 400);

    // mode C: UI strings of the app (German source; public, cached per string, bounded)
    if (Array.isArray(body.ui)) {
      const items = body.ui.slice(0, 600).map((x: any) => ({ k: String(x.k ?? ""), v: String(x.v ?? "") })).filter((x: any) => x.k);
      const total = items.reduce((a: number, x: any) => a + x.v.length, 0);
      if (total > 60000) return json({ error: "too_large" }, 413);
      const hashes = items.map((x: any) => strHash(x.v));
      const have = new Map<string, string>();
      for (let i = 0; i < hashes.length; i += 200) {
        const { data: rows } = await admin.from("ui_tx").select("h,txt").eq("target", target).in("h", hashes.slice(i, i + 200));
        (rows || []).forEach((r: any) => have.set(r.h, r.txt));
      }
      const missing: { k: string; v: string; h: string }[] = [];
      items.forEach((x: any, i: number) => { if (x.v.trim() && !have.has(hashes[i]) && !missing.find((m) => m.h === hashes[i])) missing.push({ k: x.k, v: x.v, h: hashes[i] }); });
      if (missing.length) {
        // global budget: at most 200k source chars per hour through this public path
        const { data: recent } = await admin.from("ui_tx").select("src").gte("created_at", new Date(Date.now() - 3600e3).toISOString());
        const used = (recent || []).reduce((a: number, r: any) => a + (r.src || "").length, 0);
        if (used > 200000) return json({ error: "budget" }, 429);
        const res = await deepl(String(key), missing.map((m) => m.v), target, "DE");
        const rows = missing.map((m, i) => ({ h: m.h, target, src: m.v, txt: res[i] || m.v }));
        await admin.from("ui_tx").upsert(rows, { onConflict: "h,target" });
        rows.forEach((r) => have.set(r.h, r.txt));
      }
      const map: Record<string, string> = {};
      items.forEach((x: any, i: number) => { map[x.k] = have.get(hashes[i]) ?? x.v; });
      return json({ map });
    }

    if (body.instrId) {
      const { data: row, error } = await admin.from("instructions").select("id,status,title,data").eq("id", String(body.instrId)).maybeSingle();
      if (error || !row) return json({ error: "not_found" }, 404);
      // drafts only for signed-in users; published for everyone
      if (row.status !== "published") {
        const auth = req.headers.get("Authorization") || "";
        const uc = createClient(url, anon, { global: { headers: { Authorization: auth } } });
        const { data: { user } } = await uc.auth.getUser();
        if (!user) return json({ error: "not_published" }, 403);
      }
      // password-protected links (project/team password): the viewer sends the password it unlocked with
      if (row.status === "published") {
        // v0.33: public links carry a share key – without the right key (stale/guessed link) only signed-in users may translate
        const { data: gate } = await admin.rpc("open_instr", { p_id: row.id, p_pw: body.pw ? String(body.pw) : null, p_key: body.key ? String(body.key) : null });
        if (!gate || gate.locked || gate.stale) {
          const auth = req.headers.get("Authorization") || "";
          const uc = createClient(url, anon, { global: { headers: { Authorization: auth } } });
          const { data: { user } } = await uc.auth.getUser();
          if (!user) return json({ error: "locked" }, 403);
        }
      }
      const instr = { ...(row.data || {}), title: row.title };
      const items = srcTexts(instr);
      const hash = strHash(items.map((x) => x.v).join("\u0001"));
      const tx = (row.data && row.data.translations) || {};
      if (tx[target] && tx[target].hash === hash) return json({ map: tx[target].map, cached: true });
      const res = await deepl(String(key), items.map((x) => x.v), target);
      const map: Record<string, string> = {}; items.forEach((x, i) => (map[x.k] = res[i] || ""));
      tx[target] = { map, at: Date.now(), hash, by: "auto" };
      const data = { ...(row.data || {}), translations: tx };
      await admin.from("instructions").update({ data }).eq("id", row.id);
      return json({ map, cached: false });
    }

    // mode B: raw texts, signed-in only
    const auth = req.headers.get("Authorization") || "";
    const uc = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await uc.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);
    const texts: string[] = (body.texts || []).map((x: unknown) => String(x ?? ""));
    if (!texts.length) return json({ translations: [] });
    return json({ translations: await deepl(String(key), texts, target) });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
