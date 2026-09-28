// One-off maintenance (v0.29): move step thumbnails that still sit as data URLs inside instruction JSON into Storage (<ws>/<instr>/<media>.poster.jpg)
// – the same thing the client does in the background since v0.24.1, but for every workspace at once. Service role; callable only with the maintenance secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const isData = (u: unknown) => typeof u === "string" && u.startsWith("data:image");

async function shrink(dataUrl: string): Promise<Uint8Array> {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1); const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  try { const img = await Image.decode(raw); if (img.width > 360) img.resize(320, Image.RESIZE_AUTO); return await img.encodeJPEG(62); } catch { return raw; } // undecodable → keep as is
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const given = req.headers.get("x-giri-test") || ""; const { data: sec } = await db.rpc("get_hs_secret");
  if (!given || !sec || given !== sec) return new Response("forbidden", { status: 403 });
  const body = await req.json().catch(() => ({})); const dry = !!body.dry; const limit = Math.min(200, Number(body.limit) || 50);
  const { data: rows, error } = await db.from("instructions").select("id, ws, updated_at, data").is("deleted_at", null).order("updated_at", { ascending: false }).limit(1000);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const out: unknown[] = []; let done = 0;
  for (const r of rows || []) {
    if (done >= limit) break;
    const d = r.data || {}; const steps = [...(d.steps || []), ...(d.trash || [])].filter((s: any) => isData(s.poster) && s.mediaUrl && !s.posterUrl && s.mediaId);
    if (!steps.length) continue;
    const before = JSON.stringify(d).length; let moved = 0, failed = 0;
    if (!dry) {
      for (const s of steps) {
        try {
          const jpg = await shrink(s.poster); const path = `${r.ws}/${r.id}/${s.mediaId}.poster.jpg`;
          const { error: ue } = await db.storage.from("media").upload(path, jpg, { upsert: true, contentType: "image/jpeg" }); if (ue) throw ue;
          s.posterUrl = `${URL_}/storage/v1/object/public/media/${path}`; delete s.poster; moved++;
        } catch (e) { failed++; }
      }
      // dead weight: data posters on steps that never got a media URL (never uploaded) are useless on other devices too, but leave them – the owning client may still upload
      if (moved) {
        const now = Date.now(); d.updatedAt = now;
        const { error: we } = await db.from("instructions").update({ data: d, updated_at: new Date(now).toISOString() }).eq("id", r.id).eq("updated_at", r.updated_at); // only if untouched meanwhile
        if (we) failed += moved;
      }
    }
    out.push({ id: r.id, ws: r.ws, steps: steps.length, moved, failed, kb_before: Math.round(before / 1024), kb_after: dry ? null : Math.round(JSON.stringify(d).length / 1024) }); done++;
  }
  return Response.json({ dry, instructions: out.length, rows: out });
});
