import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// GIRI – device-login (v1, v12.50): sign in on the phone by scanning a QR code on the PC – no second e-mail.
// The pattern of WhatsApp Web with Microsoft-style number matching, the other way round (the signed-in PC shows the code, the phone has
// the camera). State in public.device_logins (migration v014, service role only). All steps go through this function:
//   1. PC (signed in)  create  {}                       → {id, secret, expires_at}  QR = https://go.ar-giri.de/#/qr/<id>/<secret>
//   2. phone           claim   {id, secret, device}     → {code, claim, name, email} the phone shows a two-digit number and keeps
//                                                         `claim` – a second secret that only this phone has
//   3. PC              status  {id}                     → {status, device}          "iPhone · Safari wants to sign in" (no number!)
//   4. PC              approve {id, ok, code}           → the person types the number from the phone; a wrong number = declined
//   5. phone           poll    {id, secret, claim}      → approved: a one-time sign-in token (admin generateLink – nothing is mailed);
//                                                         the phone redeems it with auth.verifyOtp({token_hash}) and has its own session
//      phone           cancel  {id, secret, claim}      → "not me / cancel" on the phone = declined
// Security: the secret exists only in the QR (stored as SHA-256), 3 minutes, one claim; only the phone that claimed can pick up the
// sign-in (claim secret, also stored as SHA-256) – someone who merely saw the QR code cannot; the PC must type the number shown on that
// phone, which the server never sends to the PC – a phone that is not one's own cannot be allowed by a careless click, and nobody can
// script the approval of a stranger's phone; the token is handed out once; 10 codes per person and hour; a new code replaces the open one.
// verify_jwt is off (the phone is not signed in yet); create / status / approve check the caller's session themselves.
// Review 3 Oct 2026 (independent): poll bound to the claiming phone, typed number, current e-mail from auth.users at hand-out.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const TTL = 180e3;               // the QR is valid 3 minutes
const GRACE = 120e3;             // an approved hand-over can be picked up for 2 more minutes
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rnd = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const same = (a: string, b: string) => { if (!a || !b || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const mask = (e: string) => { const [u, d] = String(e).split("@"); return (u || "").slice(0, 2) + "•••@" + (d || ""); };
const open = (r: { status: string; expires_at: string }) => (r.status === "pending" || r.status === "claimed") && Date.parse(r.expires_at) >= Date.now();
const shown = (r: { status: string; expires_at: string }) => (r.status === "pending" || r.status === "claimed") && !open(r) ? "expired" : r.status;
const SECRET = /^[A-Za-z0-9_-]{32,64}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const body = await req.json().catch(() => ({}));
    const act = String(body.action || "");
    // without the table (migration v014 not applied yet) nothing works – say so instead of failing half-way
    const probe = await admin.from("device_logins").select("id").limit(1);
    if (probe.error) { console.error("device_logins:", probe.error.message); return json({ error: "not_ready" }, 503); }
    const userOf = async () => {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!jwt || jwt.split(".").length !== 3) return null;
      const { data, error } = await admin.auth.getUser(jwt);
      return error || !data?.user?.email ? null : data.user;
    };
    const now = Date.now();

    if (act === "create") {
      const u = await userOf(); if (!u) return json({ error: "login_required" }, 401);
      const { count } = await admin.from("device_logins").select("id", { head: true, count: "exact" }).eq("user_id", u.id).gte("created_at", new Date(now - 3600e3).toISOString());
      if ((count || 0) >= 10) return json({ error: "too_many" }, 429);
      await admin.from("device_logins").update({ status: "replaced" }).eq("user_id", u.id).in("status", ["pending", "claimed"]);
      await admin.from("device_logins").delete().lt("created_at", new Date(now - 30 * 864e5).toISOString());
      const id = crypto.randomUUID(), secret = rnd();
      const { error } = await admin.from("device_logins").insert({ id, user_id: u.id, email: String(u.email).toLowerCase(), secret_hash: await sha(secret), status: "pending", expires_at: new Date(now + TTL).toISOString() });
      if (error) { console.error("create:", error.message); return json({ error: "server_error" }, 500); }
      return json({ ok: true, id, secret, expires_at: now + TTL });
    }

    if (act === "status" || act === "approve") {
      const u = await userOf(); if (!u) return json({ error: "login_required" }, 401);
      const { data: r } = await admin.from("device_logins").select("*").eq("id", String(body.id || "")).maybeSingle();
      if (!r || r.user_id !== u.id) return json({ error: "not_found" }, 404);
      if (act === "status") return json({ status: shown(r), device: r.device || "" }); // never the number – it is typed from the phone
      if (r.status !== "claimed" || !open(r)) return json({ error: r.status === "claimed" ? "expired" : "wrong_state", status: shown(r) }, 409);
      const allow = body.ok === true && String(body.code ?? "").trim() === String(r.code);
      const { data: upd } = await admin.from("device_logins").update({ status: allow ? "approved" : "denied", decided_at: new Date().toISOString() }).eq("id", r.id).eq("status", "claimed").select("id");
      if (!upd || !upd.length) return json({ error: "wrong_state" }, 409);
      if (body.ok === true && !allow) return json({ error: "wrong_code", status: "denied" }, 409); // a wrong number ends this code
      return json({ ok: true, status: allow ? "approved" : "denied" });
    }

    if (act === "claim" || act === "poll" || act === "cancel") {
      const id = String(body.id || ""), secret = String(body.secret || "");
      if (!/^[0-9a-f-]{36}$/i.test(id) || !SECRET.test(secret)) return json({ error: "invalid" }, 400);
      const { data: r } = await admin.from("device_logins").select("*").eq("id", id).maybeSingle();
      if (!r || !same(r.secret_hash, await sha(secret))) return json({ error: "invalid" }, 404);
      if (act === "claim") {
        if (r.status === "replaced") return json({ error: "replaced" }, 409);
        if (r.status !== "pending") return json({ error: "used" }, 409);
        if (!open(r)) return json({ error: "expired" }, 410);
        const code = 10 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90), claim = rnd();
        const device = String(body.device || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").slice(0, 80);
        const { data: upd } = await admin.from("device_logins").update({ status: "claimed", claimed_at: new Date().toISOString(), code, device, claim_hash: await sha(claim) }).eq("id", id).eq("status", "pending").select("id");
        if (!upd || !upd.length) return json({ error: "used" }, 409);
        const { data: p } = await admin.from("profiles").select("name").eq("id", r.user_id).maybeSingle();
        return json({ ok: true, code, claim, name: p?.name || "", email: mask(r.email), expires_at: Date.parse(r.expires_at) });
      }
      // poll / cancel: only the phone that claimed (it holds the claim secret)
      const claim = String(body.claim || "");
      if (!SECRET.test(claim) || !same(r.claim_hash || "", await sha(claim))) return json({ error: "invalid" }, 404);
      if (act === "cancel") {
        await admin.from("device_logins").update({ status: "denied", decided_at: new Date().toISOString() }).eq("id", id).in("status", ["claimed", "approved"]);
        return json({ ok: true, status: "denied" });
      }
      if (r.status === "approved") {
        if (now - Date.parse(r.decided_at || r.expires_at) > GRACE) return json({ status: "expired" });
        const { data: upd } = await admin.from("device_logins").update({ status: "used", used_at: new Date().toISOString() }).eq("id", id).eq("status", "approved").select("id");
        if (!upd || !upd.length) return json({ status: "used" });
        // the login's e-mail as it is NOW (it may have changed since the code was made)
        const { data: au, error: ae } = await admin.auth.admin.getUserById(r.user_id);
        const email = au?.user?.email;
        if (ae || !email) { console.error("getUserById:", ae?.message); return json({ error: "server_error" }, 500); }
        const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
        const props = (link as any)?.properties;
        if (error || !props?.hashed_token) { console.error("generateLink:", error?.message); return json({ error: "server_error" }, 500); }
        return json({ status: "signed_in", token_hash: props.hashed_token, type: "magiclink", email });
      }
      return json({ status: shown(r) });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("device-login:", (e as Error)?.message || e);
    return json({ error: "server_error" }, 500);
  }
});
