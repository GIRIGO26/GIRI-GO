import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { APP, inviteMail } from "./mail.ts";

// GIRI – invite-notify (v2, v12.50): the invitation e-mail – both languages in one mail (see mail.ts).
// (v1, v12.48): the invitation e-mail.
// Before, an invited person only got the generic sign-in code mail – no word of who invites them, into which company, where to sign in
// or how long the code lasts. Now an admin's invitation (or a platform admin's demo workspace) sends a real invitation: inviter, company,
// role, a button to the sign-in page with the e-mail filled in, and the three sign-in steps.
// The code is NOT in this mail: the person requests it on the sign-in page, so the invitation does not run out – it stays open until they
// sign in or the admin withdraws it. The code from the second mail is valid 60 minutes (Supabase "Email OTP Expiration") and works once.
// Called by the browser with the caller's session. Only for e-mails that are open invitations of the caller's workspace (no free mail relay).
// Limits: 1 mail per invitation and minute, 5 per invitation and day, 30 per workspace and day (200 for customers), 300 per hour overall –
// counted in public.mail_log (service role only, rows older than 90 days are removed). Without that table (migration v013 not applied yet)
// the function sends nothing and answers not_ready – the app then falls back to the plain sign-in code mail.
// Sends via Resend (vault: resend_api_key), sender GIRI <giri@ar-giri.de>, reply-to the inviting person.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
// names come from the workspace (admin-controlled): one line, short, no links
const clip = (s: unknown, n: number) => { const x = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
const since = (ms: number) => new Date(Date.now() - ms).toISOString();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    // ---- caller: a signed-in admin of the workspace, or a platform admin (demo workspaces) ----
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "login_required" }, 401);
    const { data: u, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !u?.user) return json({ error: "login_required" }, 401);
    const callerMail = String(u.user.email || "").toLowerCase();
    const { data: p } = await admin.from("profiles").select("ws, role, is_admin, name, email").eq("id", u.user.id).maybeSingle();
    const { data: pa } = await admin.from("platform_admins").select("email");
    const master = !!callerMail && (pa || []).some((x: any) => String(x.email || "").toLowerCase() === callerMail);
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return json({ error: "email" }, 400);
    const ws = master && body.ws ? String(body.ws) : (p?.ws || "");
    if (!ws) return json({ error: "no_profile" }, 403);
    const isAdmin = !!p && p.ws === ws && (p.is_admin || p.role === "admin");
    if (!isAdmin && !master) return json({ error: "no_permission" }, 403);
    const lang = body.lang === "en" ? "en" : "de";

    // ---- only open invitations of this workspace; nobody who already has an account ----
    const { data: w } = await admin.from("workspaces").select("ws, name, plan, invites").eq("ws", ws).maybeSingle();
    if (!w) return json({ error: "no_workspace" }, 404);
    const invites: any[] = Array.isArray(w.invites) ? w.invites : [];
    const k = invites.findIndex((i: any) => String(i?.email || "").toLowerCase() === email);
    if (k < 0) return json({ error: "no_invite" }, 404);
    const { data: ex } = await admin.from("profiles").select("ws").ilike("email", email.replace(/([%_\\])/g, "\\$1")).limit(1);
    if (ex && ex.length) return json({ error: ex[0].ws === ws ? "already_member" : "other_ws" }, 409);

    // ---- limits (fail closed: without the log table nothing is sent) ----
    const { data: mine, error: le } = await admin.from("mail_log").select("at").eq("kind", "invite").eq("ws", ws).eq("to_email", email).eq("ok", true).gte("at", since(DAY)).order("at", { ascending: false });
    if (le) return json({ error: "not_ready", detail: le.message }, 503);
    if (mine && mine.length && Date.now() - Date.parse(mine[0].at) < MIN) return json({ error: "too_soon" }, 429);
    if (mine && mine.length >= 5) return json({ error: "limit" }, 429);
    const { count: nWs } = await admin.from("mail_log").select("id", { count: "exact", head: true }).eq("kind", "invite").eq("ws", ws).eq("ok", true).gte("at", since(DAY));
    if ((nWs || 0) >= (w.plan === "active" ? 200 : 30)) return json({ error: "limit" }, 429);
    const { count: nAll } = await admin.from("mail_log").select("id", { count: "exact", head: true }).eq("kind", "invite").eq("ok", true).gte("at", since(HOUR));
    if ((nAll || 0) >= 300) return json({ error: "limit" }, 429);

    // ---- the mail ----
    const { data: key } = await admin.rpc("get_resend_key");
    if (!key) return json({ error: "no_key" }, 500);
    const inv = invites[k];
    const inviter = clip(p?.name || p?.email || callerMail, 60) || "GIRI";
    const inviterMail = clip(p?.email || callerMail, 120);
    const company = clip(w.name || ws, 60);
    const link = `${APP}#/join/${encodeURIComponent(email)}`;
    const x = inviteMail(lang, { inviter, company, role: String(inv.role || "creator"), email, inviterMail }, link);
    const log = async (ok: boolean, error?: string) => { try { await admin.from("mail_log").insert({ ws, kind: "invite", by_user: u.user.id, to_email: email, ok, error: error || null }); } catch (_) { /* never block on logging */ } };
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "GIRI <giri@ar-giri.de>", to: [email], reply_to: inviterMail || undefined, subject: x.subject, html: x.html, text: x.text, tags: [{ name: "type", value: "invite" }] }) });
    const rb = await r.json().catch(() => ({}));
    if (!r.ok) { await log(false, "resend_" + r.status); return json({ error: "resend_" + r.status, detail: rb }, 502); }
    await log(true);
    // note on the invitation when it was mailed (the admin page shows it); the service role passes the workspace guards
    const fresh = invites.map((i: any, n: number) => n === k ? { ...i, mailed_at: Date.now(), mail_n: (Number(i.mail_n) || 0) + 1, lang } : i);
    await admin.from("workspaces").update({ invites: fresh }).eq("ws", ws);
    if (Math.random() < 0.05) await admin.from("mail_log").delete().lt("at", since(90 * DAY));
    return json({ sent: true, id: rb.id || null });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
