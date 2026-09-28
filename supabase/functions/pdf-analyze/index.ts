import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// GIRI Go – pdf-analyze (v3): an existing work instruction as PDF → proposed steps (title, description, warning, page, figure box).
// Model: Gemini 3.8 Flash on Google Vertex AI, region europe-west3 (Frankfurt) – the PDF stays in Germany, nothing goes to other providers.
// If 3.8 is not served in Frankfurt the call falls back to Gemini 3.5 Flash in the SAME region (never to US/global).
// Prompt = fixed core (extraction rules, JSON) + an editable style guide ("GIRI-Leitfaden", body.guide or the default below).
// Auth: signed-in user with an editing role (creator / reviewer / admin), checked against the user's session (verify_jwt off, checked here).
// Secrets: vault google_sa_json (or function secret GOOGLE_SERVICE_ACCOUNT_JSON) – service account "giri-go-ai", role "Vertex AI User"; optional VERTEX_MODEL / VERTEX_REGION / VERTEX_PROJECT.
// Every call is written to public.ai_usage (cost control + audit); limit per workspace and day.
// Request:  { pdf: <base64>, name?: string, lang?: "DE"|"EN", guide?: string (≤ 6000 chars) }  ·  { probe:true } checks model availability
// Response: { title, language, steps:[{title, description, warning, shot, page, chapter, figure:{page, box:[ymin,xmin,ymax,xmax] 0–1000}|null}], model, usage }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PROJECT = Deno.env.get("VERTEX_PROJECT") || "giri-go";
const REGION = Deno.env.get("VERTEX_REGION") || "europe-west3";
const MODEL = Deno.env.get("VERTEX_MODEL") || "gemini-3.8-flash";
const FALLBACK = Deno.env.get("VERTEX_FALLBACK") || "gemini-3.5-flash"; // same region only
const MAX_BYTES = 12 * 1024 * 1024;   // Vertex inline limit is ~20 MB after base64
const DAILY_LIMIT = 60;               // analyses per workspace and day

// ---- Google OAuth with the service account (JWT bearer grant), token cached per instance ----
let tokenCache: { token: string; exp: number } | null = null;
const b64url = (buf: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function googleToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  // service account: function secret GOOGLE_SERVICE_ACCOUNT_JSON, or (since the Frankfurt move) the vault secret google_sa_json
  let raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "";
  if (!raw) { const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!); const { data } = await admin.rpc("get_google_sa"); raw = String(data || ""); }
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing");
  const sa = JSON.parse(raw);
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: sa.private_key_id }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }) });
  const j = await r.json(); if (!r.ok || !j.access_token) throw new Error("google_auth: " + (j.error_description || j.error || r.status));
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

// ---- structured output ----
const SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", description: "Title of the whole work instruction" },
    language: { type: "STRING", description: "ISO 639-1 code of the document language" },
    steps: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          chapter: { type: "STRING", description: "Section / chapter this step belongs to, empty if the document has none" },
          title: { type: "STRING", description: "Short imperative step title, max ~60 characters" },
          description: { type: "STRING", description: "What to do, details, tools, values (torque, dimensions). Plain text, may use line breaks." },
          warning: { type: "STRING", description: "Safety / quality warning for this step, empty if none" },
          shot: { type: "STRING", description: "Recording hint: what the max. 5-second video of this step shows (camera view, hands, part, the one movement)" },
          page: { type: "INTEGER", description: "1-based PDF page where this step is described" },
          figure: {
            type: "OBJECT", nullable: true,
            description: "The picture/drawing/photo that illustrates this step, null if there is none",
            properties: {
              page: { type: "INTEGER", description: "1-based page of the picture" },
              box: { type: "ARRAY", items: { type: "NUMBER" }, description: "[ymin, xmin, ymax, xmax] of the picture on that page, normalised 0–1000" },
            },
            required: ["page", "box"],
          },
        },
        required: ["title", "description", "page"],
      },
    },
  },
  required: ["title", "steps"],
};
// ---- prompt = fixed core (never editable) + style guide (editable per import / per workspace) ----
const DEFAULT_GUIDE = `GIRI-Leitfaden – so wird aus einem Dokument die beste Arbeitsanleitung der Welt, die jede und jeder sofort versteht:

1. Eine Handlung pro Schritt. Jeder Schritt wird später als kurzes Video aufgenommen – maximal 5 Sekunden, genau eine Bewegung. Enthält ein Satz im Dokument mehrere Handlungen, teile ihn in mehrere Schritte auf. Lieber mehr kleine Schritte als ein großer.
2. Orientierung zuerst: Wo bin ich? Wo muss ich hin? Was muss ich tun? Wechseln Arbeitsplatz, Werkzeug, Material oder Position, setze vorher einen kurzen Orientierungsschritt (z. B. „Zu Station 4 gehen“, „Drehmomentschlüssel nehmen“) – nur wenn es sich aus dem Dokument ergibt.
3. Titel = Objekt + Verb, 2–5 Wörter. Kein Artikel, kein „bitte“, keine Füllwörter, keine ganzen Schulsätze. „Box öffnen“ statt „Bitte die Box vorsichtig öffnen“. „Schraube M6 einsetzen“ statt „Nun wird die Schraube eingesetzt“.
4. Beschreibung nur, wenn sie wirklich hilft: höchstens 1–2 kurze Zeilen, Stichworte statt Sätze, Werte nach vorn („10 Nm · über Kreuz“). Niemand liest langen Text.
5. Warnhinweise kurz und klar: Gefahr – Maßnahme („Quetschgefahr – Finger weg vom Hebel“). Direkt am betroffenen Schritt, nicht gesammelt am Anfang.
6. Kapitel bilden, sobald die Anleitung mehr als etwa 8 Schritte hat: sinnvolle Abschnitte mit 3–8 Schritten, Kapitelnamen 1–3 Wörter („Vorbereitung“, „Montage“, „Prüfung“).
7. Ton: klar, direkt, respektvoll – leicht motivierend ist erlaubt, nie übertrieben. Z. B. als Beschreibung des letzten Schritts eines Kapitels: „Sitzt. Weiter mit der Prüfung.“ Sparsam einsetzen, keine Ausrufezeichen-Ketten.
8. Aufnahme-Hinweis („shot“) für jeden Schritt: Was zeigt das 5-Sekunden-Video? Perspektive, Hände, Bauteil, die eine Bewegung – z. B. „Nahaufnahme: Hebel schließt, Klick“.
9. Fachbegriffe, Teilenummern und Werte exakt übernehmen. Nichts erfinden, nichts weglassen, was für Sicherheit oder Qualität zählt.`;
const CORE = (lang: string) => `Du bist Expertin bzw. Experte für digitale Arbeitsanleitungen in der industriellen Fertigung.
Du bekommst eine bestehende Arbeitsanweisung / Montageanleitung / SOP als PDF. Erstelle daraus eine Schritt-für-Schritt-Anleitung nach dem Leitfaden unten.

Feste Regeln (haben immer Vorrang):
- Sprache des Dokuments beibehalten, nichts übersetzen. Bei unklarer Sprache: ${lang === "EN" ? "English" : "Deutsch"}.
- Nur Inhalte aus dem Dokument. Werte, Drehmomente, Maße, Teilenummern, Werkzeuge exakt übernehmen. Nichts erfinden.
- Deckblatt, Inhaltsverzeichnis, Änderungshistorie, Freigabe- und Unterschriftsfelder, Kopf- und Fußzeilen ignorieren.
- Reihenfolge wie im Dokument.
- "chapter": Kapitelname für jeden Schritt (gleicher Text für alle Schritte eines Kapitels), leer wenn keine Kapitel.
- "page": Seite, auf der die Handlung beschrieben ist.
- "figure": das Foto / die Zeichnung, die diese Handlung zeigt, mit enger Bounding Box nur um die Abbildung (ohne Bildunterschrift, ohne Seitenrand, keine Logos, keine Tabellen). Mehrere Schritte dürfen dieselbe Abbildung nutzen. Ohne passendes Bild: null.
- "warning": Sicherheits- oder Qualitätshinweis nur am betroffenen Schritt, ohne Vorsilbe wie „Achtung:“.
- Ausgabe ausschließlich als JSON nach Schema.`;
const buildPrompt = (lang: string, guide?: string) => `${CORE(lang)}\n\n---\n${(guide && guide.trim()) ? guide.trim().slice(0, 6000) : DEFAULT_GUIDE}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service);
  let userId = "", ws = "", bytes = 0;
  const log = async (ok: boolean, extra: Record<string, unknown>) => { try { await admin.from("ai_usage").insert({ user_id: userId || "00000000-0000-0000-0000-000000000000", ws: ws || "?", feature: "pdf-import", model: MODEL, region: REGION, bytes, ok, ...extra }); } catch (_) { /* never block on logging */ } };
  try {
    // ---- who is calling: a signed-in user with an editing role ----
    {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!jwt) return json({ error: "login_required" }, 401);
      const { data: u, error: ue } = await admin.auth.getUser(jwt); if (ue || !u?.user) return json({ error: "login_required" }, 401);
      userId = u.user.id;
      const { data: p } = await admin.from("profiles").select("ws, role, is_admin").eq("id", userId).maybeSingle();
      if (!p) return json({ error: "no_profile" }, 403);
      ws = p.ws; if (!(p.is_admin || ["admin", "creator", "reviewer"].includes(p.role))) return json({ error: "no_permission" }, 403);
      const since = new Date(Date.now() - 864e5).toISOString();
      const { count } = await admin.from("ai_usage").select("id", { count: "exact", head: true }).eq("ws", ws).gte("at", since);
      if ((count || 0) >= DAILY_LIMIT) return json({ error: "daily_limit", limit: DAILY_LIMIT }, 429);
    }
    const body = await req.json();
    const pdf = String(body.pdf || ""); bytes = Math.floor(pdf.length * 3 / 4);
    if (!pdf || !/^[A-Za-z0-9+/=\s]+$/.test(pdf.slice(0, 200))) return json({ error: "no_pdf" }, 400);
    if (bytes > MAX_BYTES) return json({ error: "too_large", max_mb: MAX_BYTES / 1048576 }, 413);
    if (body.ping) { await googleToken(); return json({ ok: true, model: MODEL, region: REGION, guide: DEFAULT_GUIDE }); }

    const token = await googleToken();
    const host = (loc: string) => loc === "eu" ? "aiplatform.eu.rep.googleapis.com" : loc === "global" ? "aiplatform.googleapis.com" : `${loc}-aiplatform.googleapis.com`;
    const call = (model: string, parts: unknown[], gen: Record<string, unknown>, loc = REGION) => fetch(`https://${host(loc)}/v1/projects/${PROJECT}/locations/${loc}/publishers/google/models/${model}:generateContent`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: gen }),
    });
    if (body.probe) { // which models answer in this region?
      const out: Record<string, unknown> = {};
      // test secret only: other locations may be probed (a text-only "OK", never customer data)
      const locs: string[] = [REGION];
      for (const loc of locs) for (const m of [MODEL, FALLBACK]) { const r = await call(m, [{ text: "Antworte nur mit OK." }], { maxOutputTokens: 16 }, loc); const j = await r.json().catch(() => ({})); out[`${loc}/${m}`] = r.ok ? "ok" : String(j?.error?.message || r.status).slice(0, 90); }
      return json({ region: REGION, models: out });
    }
    const parts = [{ inlineData: { mimeType: "application/pdf", data: pdf } }, { text: buildPrompt(String(body.lang || "DE").toUpperCase(), typeof body.guide === "string" ? body.guide : "") }];
    const gen = { temperature: 0.2, responseMimeType: "application/json", responseSchema: SCHEMA, maxOutputTokens: 32768 };
    let used = MODEL; let r = await call(MODEL, parts, gen); let j = await r.json();
    if (!r.ok && (r.status === 404 || r.status === 400) && /not found|not supported|does not have access|is not available/i.test(j?.error?.message || "")) { used = FALLBACK; r = await call(FALLBACK, parts, gen); j = await r.json(); }
    if (!r.ok) { const msg = j?.error?.message || String(r.status); await log(false, { error: msg.slice(0, 500), model: used }); return json({ error: "model", detail: msg }, 502); }
    const cand = j.candidates?.[0]; const text = (cand?.content?.parts || []).map((p: any) => p.text || "").join("");
    let out: any; try { out = JSON.parse(text); } catch (_) { await log(false, { error: "bad_json " + (cand?.finishReason || "") }); return json({ error: "bad_json", finish: cand?.finishReason }, 502); }
    // sanitise: plain strings, sane numbers, boxes clamped to 0–1000
    const clamp = (v: any) => Math.max(0, Math.min(1000, Number(v) || 0));
    const steps = (Array.isArray(out.steps) ? out.steps : []).slice(0, 400).map((s: any) => ({
      chapter: String(s.chapter || "").slice(0, 120), title: String(s.title || "").slice(0, 200), description: String(s.description || "").slice(0, 4000),
      warning: String(s.warning || "").slice(0, 500), shot: String(s.shot || "").slice(0, 300), page: Math.max(1, parseInt(s.page) || 1),
      figure: s.figure && Array.isArray(s.figure.box) && s.figure.box.length === 4 ? { page: Math.max(1, parseInt(s.figure.page) || parseInt(s.page) || 1), box: s.figure.box.map(clamp) } : null,
    })).filter((s: any) => s.title || s.description);
    const usage = { in: j.usageMetadata?.promptTokenCount || 0, out: j.usageMetadata?.candidatesTokenCount || 0 };
    await log(true, { tokens_in: usage.in, tokens_out: usage.out, pages: Math.max(0, ...steps.map((s: any) => s.page)), model: used });
    return json({ title: String(out.title || body.name || "").slice(0, 200), language: String(out.language || ""), steps, model: used, usage });
  } catch (e) {
    const msg = (e as Error).message || String(e); await log(false, { error: msg.slice(0, 500) });
    return json({ error: "internal", detail: msg }, 500);
  }
});
