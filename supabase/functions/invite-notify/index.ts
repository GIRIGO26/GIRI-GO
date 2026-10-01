import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// GIRI – invite-notify (v1, v12.48): the invitation e-mail.
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
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// names come from the workspace (admin-controlled): one line, short, no links
const clip = (s: unknown, n: number) => { const x = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
const APP = "https://go.ar-giri.de/";
const ROLE: Record<string, string> = { admin: "Admin", viewer: "Viewer", editor: "Editor", approver: "Approver", reviewer: "Approver", tech_approver: "Technical Approver", compliance_approver: "Compliance Approver", compliance_manager: "Compliance Manager", creator: "Creator", team_admin: "Team Admin" };
const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
const since = (ms: number) => new Date(Date.now() - ms).toISOString();

type Txt = { subject: string; kicker: string; h1: string; lead: string; what: string; btn: string; how: string; s1: string; s2: string; s3: string; validT: string; valid: string; nobtn: string; tip: string; foot: string };
const T = (lang: string, v: { inviter: string; company: string; role: string; email: string; inviterMail: string }): Txt => {
  const i = esc(v.inviter), c = esc(v.company), r = esc(v.role), e = esc(v.email), im = esc(v.inviterMail);
  return lang === "en" ? {
    subject: `${v.inviter} invited you to GIRI`,
    kicker: "Invitation", h1: "Welcome to GIRI",
    lead: `<b>${i}</b> invited you to <b>${c}</b> – as <b>${r}</b>.`,
    what: "GIRI is the app for work instructions with photo and video: record, approve and play them right at the workplace.",
    btn: "Sign in now", how: "How to sign in – no password needed:",
    s1: "Tap “Sign in now” – your e-mail address is already filled in.",
    s2: "Tap “Sign in”. A second e-mail with your 6-digit code arrives right away (sender “GIRI” – check your spam folder if needed).",
    s3: `Enter the code – done. You land directly in “${c}”.`,
    validT: "How long is this valid?",
    valid: `The invitation stays open until you sign in or ${i} withdraws it. The code from the second e-mail is valid for 60 minutes and works once – simply request a new one if it has expired.`,
    nobtn: `Button not working? Open <a href="${APP}" style="color:#004EAD">go.ar-giri.de</a> and sign in with ${e}.`,
    tip: "Tip for your phone: after signing in, choose “Install app” – GIRI then starts like an app and also works without a network.",
    foot: `You are receiving this e-mail because ${i} (${im}) invited you to GIRI. Not expected? Simply ignore it – nothing happens without signing in. Questions? Reply to this e-mail, it goes to ${i}.`,
  } : {
    subject: `${v.inviter} hat dich zu GIRI eingeladen`,
    kicker: "Einladung", h1: "Willkommen bei GIRI",
    lead: `<b>${i}</b> hat dich in den Bereich <b>${c}</b> eingeladen – als <b>${r}</b>.`,
    what: "GIRI ist die App für Arbeitsanweisungen mit Foto und Video: aufnehmen, freigeben und direkt am Arbeitsplatz abspielen.",
    btn: "Jetzt anmelden", how: "So meldest du dich an – ohne Passwort:",
    s1: "Auf „Jetzt anmelden“ tippen – deine E-Mail-Adresse ist schon eingetragen.",
    s2: "Auf „Anmelden“ tippen. Sofort kommt eine zweite Mail mit deinem 6-stelligen Code (Absender „GIRI“ – ggf. im Spam-Ordner nachsehen).",
    s3: `Code eingeben – fertig. Du landest direkt in „${c}“.`,
    validT: "Wie lange gilt das?",
    valid: `Die Einladung bleibt offen, bis du dich anmeldest oder ${i} sie zurückzieht. Der Code aus der zweiten Mail gilt 60 Minuten und nur einmal – ist er abgelaufen, einfach neu anfordern.`,
    nobtn: `Button geht nicht? Öffne <a href="${APP}" style="color:#004EAD">go.ar-giri.de</a> und melde dich mit ${e} an.`,
    tip: "Tipp fürs Handy: Nach der Anmeldung „App installieren“ wählen – dann startet GIRI wie eine App und funktioniert auch ohne Netz.",
    foot: `Du bekommst diese Mail, weil ${i} (${im}) dich zu GIRI eingeladen hat. Nicht erwartet? Einfach ignorieren – ohne Anmeldung passiert nichts. Fragen? Antworte auf diese Mail, sie geht an ${i}.`,
  };
};
const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

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
    const role = ROLE[String(inv.role || "creator")] || "Creator";
    const x = T(lang, { inviter, company, role, email, inviterMail });
    const link = `${APP}#/join/${encodeURIComponent(email)}`;
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111">
      <div style="max-width:560px;margin:0 auto;padding:28px 16px">
        <div style="background:#000;color:#fff;border-radius:14px 14px 0 0;padding:16px 22px;font-weight:800;font-size:18px;letter-spacing:.02em">GIRI</div>
        <div style="background:#fff;border-radius:0 0 14px 14px;padding:22px 22px 18px;border:1px solid #E6E8EE;border-top:0">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">${x.kicker}</p>
          <h1 style="margin:0 0 10px;font-size:22px;line-height:1.3">${x.h1}</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.5">${x.lead}</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:#555">${x.what}</p>
          <a href="${esc(link)}" style="display:inline-block;background:#004EAD;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:12px;font-size:15px">${x.btn}</a>
          <p style="margin:22px 0 8px;font-size:14px;font-weight:700">${x.how}</p>
          <ol style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.55;color:#222"><li>${x.s1}</li><li>${x.s2}</li><li>${x.s3}</li></ol>
          <div style="margin:0 0 14px;padding:12px 14px;background:#F4F6FA;border-left:4px solid #03D39B;border-radius:8px;font-size:13.5px;line-height:1.5;color:#222"><b>${x.validT}</b><br>${x.valid}</div>
          <p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:#555">${x.tip}</p>
          <p style="margin:0;font-size:12.5px;line-height:1.5;color:#6B7280">${x.nobtn}</p>
          <p style="margin:18px 0 0;font-size:12px;color:#8A8F98;line-height:1.5">${x.foot}</p>
        </div>
        <p style="margin:14px 0 0;text-align:center;font-size:11px;color:#9AA0A6">GIRI · AR-Experts GmbH</p>
      </div></body></html>`;
    const plain = [x.h1, "", strip(x.lead), strip(x.what), "", `${x.btn}: ${link}`, "", strip(x.how), "1. " + strip(x.s1), "2. " + strip(x.s2), "3. " + strip(x.s3), "", strip(x.validT) + " " + strip(x.valid), "", strip(x.tip), "", strip(x.foot)].join("\n");
    const log = async (ok: boolean, error?: string) => { try { await admin.from("mail_log").insert({ ws, kind: "invite", by_user: u.user.id, to_email: email, ok, error: error || null }); } catch (_) { /* never block on logging */ } };
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "GIRI <giri@ar-giri.de>", to: [email], reply_to: inviterMail || undefined, subject: x.subject, html, text: plain, tags: [{ name: "type", value: "invite" }] }) });
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
