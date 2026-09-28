import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// GIRI – giri-import (v1): copies instructions from a GIRI Classic server (API v2, e.g. https://ar-giri.cloud) into this workspace.
// The browser drives the import step by step; this function does only what the browser cannot: talk to the old server with the
// customer's session token and copy binaries server-to-server into Storage. Nothing is stored here – the old-platform token travels
// with every request and lives only in the admin's browser memory. Only workspace admins may call this.
// Actions (POST JSON):
//   { action:"connect", server, email, password }            → { token, user, organization }
//   { action:"list", server, token }                         → { projects, teams, instructions }
//   { action:"structure", server, token }                    → { users, teams(+members), projects }   (org structure for the role/team/folder import)
//   { action:"instruction", server, token, id }              → { instruction }  (mapped tree: chapters/steps/media/icons)
//   { action:"copy", server, token, url, path }              → { path, url, bytes, contentType }   (url = signed old-server URL, path under <ws>/)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const MAX_FILE = 120 * 1024 * 1024; // edge function memory is 256 MB – the file is buffered once

function normServer(s: unknown): string {
  const u = new URL(String(s || "").trim());
  if (u.protocol !== "https:") throw new Error("server_https");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith(".supabase.co") || h.endsWith(".local")) throw new Error("server_blocked");
  return u.origin;
}
async function api(server: string, token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(server + path, { ...init, headers: { Accept: "application/json", "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(init.headers || {}) } });
  let body: any = null; try { body = await r.json(); } catch { body = null; }
  if (!r.ok || !body || body.stat !== "OK") { const code = body?.error || ("HTTP_" + r.status); throw new Error("classic:" + code); }
  return body.data;
}
async function allPages(server: string, token: string, path: string, key: string) {
  const out: any[] = []; let page = 1;
  for (;;) {
    const d = await api(server, token, `${path}${path.includes("?") ? "&" : "?"}page=${page}&page_size=500`);
    const items = d[key] || []; out.push(...items);
    const pg = d.pagination; const size = +(pg?.page_size || 500) || 500;
    if (!items.length || items.length < size || (pg?.total && out.length >= +pg.total) || !pg || page > 200) break; page++;
  }
  return out;
}
// Classic stores rich text as HTML (<p>, <ul><li>, <strong>, <a>) – GIRI uses markdown-lite (**fett**, "- " lists, [text](url)), so convert on the way in
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#34": '"' };
const decodeEnt = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => { const k = String(e).toLowerCase(); if (ENT[k] != null) return ENT[k]; if (k[0] === "#") { const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; } return m; });
function htmlToMd(h: string): string {
  if (!/<[a-z/!]/i.test(h)) return h;
  let s = h.replace(/\r/g, "").replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, x) => { const t = x.replace(/<[^>]+>/g, "").trim(); return t ? "**" + t + "**" : ""; });
  s = s.replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, x) => { const t = x.replace(/<[^>]+>/g, "").trim(); return /^https?:\/\//.test(href) ? `[${t || href}](${href})` : t; });
  // lists: each <li> becomes its own line with "- " or "1. "
  s = s.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner) => { let n = 0; return "\n" + inner.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_x: string, li: string) => `${++n}. ${li.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}\n`) + "\n"; });
  s = s.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner) => "\n" + inner.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_x: string, li: string) => `- ${li.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}\n`) + "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n").replace(/<(p|div|h[1-6])\b[^>]*>/gi, "");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEnt(s);
  return s.split("\n").map((l) => l.replace(/[ \t]+$/g, "").replace(/^[ \t]+(?=\S)/g, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
const txt = (v: unknown) => htmlToMd(v == null ? "" : typeof v === "string" ? v : typeof v === "object" ? String((v as any).de || (v as any).en || Object.values(v as any)[0] || "") : String(v));
const mapMedia = (m: any) => ({ id: m.id, url: m.url, type: m.type || null, width: +m.width || null, height: +m.height || null, quality: m.quality || null, tags: m.tags || [], bytes: +m.size_bytes || 0, position: m.position ?? 0, preview: m.preview || null });
const mapStep = (s: any) => ({ id: s.id, name: txt(s.name), description: txt(s.description), position: s.position ?? 0, hidden: !!s.hidden, chapter_id: s.chapter_id || null,
  icons: (s.icons || []).map((i: any) => ({ id: i.id, url: i.url, filename: i.filename || "" })),
  media: (s.step_media || s.media || []).map(mapMedia), objects3d: (s.step_objects || []).length,
  // labeling pattern ("Vorher - Nachher", "Morgen - Mittag - Abend"): one label string per language, split by " - " into slots; media carry pattern-slot-index:n
  pattern: s.pattern && typeof s.pattern === "object" && s.pattern.id ? { id: s.pattern.id, name: s.pattern.name || "", labels: s.pattern.labels || {}, default_language: s.pattern.default_language || "", label_visible: s.pattern.label_visible !== false } : null });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    // ---- caller: a signed-in workspace admin ----
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "login_required" }, 401);
    const { data: u, error: ue } = await admin.auth.getUser(jwt); if (ue || !u?.user) return json({ error: "login_required" }, 401);
    const { data: p } = await admin.from("profiles").select("ws, role, is_admin").eq("id", u.user.id).maybeSingle();
    if (!p) return json({ error: "no_profile" }, 403);
    if (!(p.is_admin || p.role === "admin")) return json({ error: "no_permission" }, 403);
    const ws: string = p.ws;
    const body = await req.json();
    const server = normServer(body.server);
    const action = String(body.action || "");

    if (action === "connect") {
      const email = String(body.email || "").trim().toLowerCase(), password = String(body.password || "");
      if (!email || !password) return json({ error: "credentials" }, 400);
      const d = await api(server, "", "/api/v2/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      const token = d?.session?.id; if (!token) return json({ error: "classic:NO_SESSION" }, 502);
      const me = await api(server, token, "/api/v2/users/me");
      const user = me.user || me;
      return json({ token, user: { email: user.email, name: user.name || [user.first_name, user.last_name].filter(Boolean).join(" "), is_org_admin: !!user.is_org_admin, is_super_admin: !!user.is_super_admin }, organization: user.organization || null });
    }
    const token = String(body.token || ""); if (!token) return json({ error: "token" }, 400);

    if (action === "list") {
      const [projects, teams, instructions] = await Promise.all([
        allPages(server, token, "/api/v2/projects", "projects"), allPages(server, token, "/api/v2/teams", "teams"),
        allPages(server, token, "/api/v2/instructions?sort_by=name&sort_dir=asc", "instructions") ]);
      return json({
        projects: projects.map((x: any) => ({ id: x.id, name: x.name, description: txt(x.description), count: x.instructions_count ?? null, published: x.published_instructions_count ?? null, using_ar: !!x.using_ar })),
        teams: teams.map((x: any) => ({ id: x.id, name: x.name, members: x.members_count ?? null, count: x.instructions_count ?? null })),
        instructions: instructions.map((x: any) => ({ id: x.id, name: txt(x.name), description: txt(x.description), project_id: x.project?.id || x.project_id || null, project_name: x.project?.name || null, team_id: x.team_id || null, version: x.version ?? 1, version_group_id: x.version_group_id || null, published: !!x.published, released: !!x.released, locked: !!x.locked, qr_code: x.qr_code || null, created_at: x.created_at, updated_at: x.updated_at, updated_count: x.updated_count ?? null, approvals: x.approvals || null,
          // the documented API has no creator field – pass one through if this server sends it under a common name
          creator: (() => { const c = x.created_by || x.creator || x.author || x.owner || x.user; if (!c) return null; if (typeof c === "string") return /^user_/.test(c) ? null : c; return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.name || c.email || null; })() })) });
    }
    if (action === "structure") {
      // organisation members, teams with members (one call per team), projects – the browser maps them onto workspace roles/teams/folders
      const [users, teams, projects] = await Promise.all([
        allPages(server, token, "/api/v2/users", "users").catch((e) => { throw e; }),
        allPages(server, token, "/api/v2/teams", "teams"), allPages(server, token, "/api/v2/projects", "projects") ]);
      const members = await Promise.all(teams.map((tm: any) => allPages(server, token, `/api/v2/teams/${encodeURIComponent(tm.id)}/members`, "team_members").catch(() => [])));
      const name = (u: any) => [u?.first_name, u?.last_name].filter(Boolean).join(" ");
      return json({
        users: users.map((u: any) => ({ id: u.id, email: String(u.email || "").toLowerCase(), name: name(u), is_org_admin: !!u.is_org_admin, status: u.status || "active", is_demo: !!u.is_demo })),
        teams: teams.map((tm: any, i: number) => ({ id: tm.id, name: tm.name, description: tm.description || "", members: (members[i] || []).map((m: any) => ({ email: String(m.user?.email || "").toLowerCase(), name: name(m.user), role: m.team_role || "viewer" })).filter((m: any) => m.email) })),
        projects: projects.map((p: any) => ({ id: p.id, name: p.name, description: p.description || "" })) });
    }
    if (action === "instruction") {
      const id = String(body.id || ""); if (!id) return json({ error: "id" }, 400);
      const d = await api(server, token, `/api/v2/instructions/${encodeURIComponent(id)}`);
      const i = d.instruction || d;
      const chapters = (i.chapters || []).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map((c: any) => ({ id: c.id, name: txt(c.name), description: txt(c.description), position: c.position ?? 0, steps: (c.steps || []).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map(mapStep) }));
      const loose = (i.steps || []).filter((s: any) => !s.chapter_id).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map(mapStep);
      // steps listed at instruction level but belonging to a chapter that has no inline steps → attach
      const inChapter = new Set(chapters.flatMap((c: any) => c.steps.map((s: any) => s.id)));
      for (const s of (i.steps || [])) { if (s.chapter_id && !inChapter.has(s.id)) { const c = chapters.find((x: any) => x.id === s.chapter_id); if (c) { c.steps.push(mapStep(s)); inChapter.add(s.id); } } }
      chapters.forEach((c: any) => c.steps.sort((a: any, b: any) => a.position - b.position));
      return json({ instruction: { id: i.id, name: txt(i.name), description: txt(i.description), version: i.version ?? 1, published: !!i.published, released: !!i.released, approvals: i.approvals || null, project_id: i.project_id || i.project?.id || null, team_id: i.team_id || null, created_at: i.created_at, updated_at: i.updated_at, qr_code: i.qr_code || null, chapters, steps: loose } });
    }
    if (action === "copy") {
      const src = String(body.url || ""), path = String(body.path || "");
      if (!/^https:\/\//.test(src)) return json({ error: "url" }, 400);
      if (!path.startsWith(ws + "/") || path.includes("..") || path.length > 200) return json({ error: "path" }, 400);
      // media URLs are signed (sig=…) and need no bearer; icon/logo URLs may need the session – send it only to the old server itself
      const sameHost = new URL(src).origin === server;
      const hdr = sameHost && !/[?&]sig=/.test(src) ? { Authorization: "Bearer " + token } : {};
      // the old server can be slow to start streaming (cold media) – one quick retry on 5xx / network error, 100 s cap per attempt
      let r: Response | null = null, lastErr = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        try { r = await fetch(src, { headers: hdr, signal: AbortSignal.timeout(100000) }); if (r.ok || r.status < 500) break; lastErr = "classic:HTTP_" + r.status; }
        catch (e) { lastErr = "classic:" + ((e as Error).name === "TimeoutError" ? "TIMEOUT" : "FETCH"); r = null; }
        await new Promise((res) => setTimeout(res, 1500));
      }
      if (!r || !r.ok) return json({ error: r ? "classic:HTTP_" + r.status : lastErr }, 502);
      const ct = (r.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
      const len = +(r.headers.get("content-length") || 0); if (len > MAX_FILE) return json({ error: "too_large", bytes: len }, 413);
      let buf: ArrayBuffer; try { buf = await r.arrayBuffer(); } catch { return json({ error: "classic:TIMEOUT" }, 502); }
      if (buf.byteLength > MAX_FILE) return json({ error: "too_large", bytes: buf.byteLength }, 413);
      const up = await admin.storage.from("media").upload(path, buf, { contentType: ct, upsert: true });
      if (up.error) return json({ error: "storage:" + up.error.message }, 502);
      const url = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/media/${path}`;
      return json({ path, url, bytes: buf.byteLength, contentType: ct });
    }
    return json({ error: "action" }, 400);
  } catch (e) {
    const msg = (e as Error).message || String(e);
    const status = /^classic:/.test(msg) ? 502 : /^server_/.test(msg) ? 400 : 500;
    return json({ error: msg }, status);
  }
});
