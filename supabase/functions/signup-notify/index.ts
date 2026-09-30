import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// GIRI – signup-notify (v1, v12.47): a person signed up (profile created) → e-mail to the platform admins (public.platform_admins)
// with who, which workspace (new trial / joined by invitation / joined by domain), and the workspace's counts.
// Called by the database (trigger profiles_signup_notify → signup_poke → pg_net) with the shared secret; never by browsers.
// Sends via Resend (key in the vault: resend_api_key), sender GIRI <giri@ar-giri.de>.

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const APP = "https://go.ar-giri.de/";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const { data: secret } = await admin.rpc("get_hs_secret");
    if (!secret || req.headers.get("x-giri-secret") !== secret) return json({ error: "forbidden" }, 403);
    const body = await req.json();
    const id = String(body.user_id || "");
    if (!id) return json({ error: "id" }, 400);
    const { data: p } = await admin.from("profiles").select("id,email,name,role,ws,is_admin,created_at").eq("id", id).maybeSingle();
    if (!p) return json({ error: "not_found" }, 404);
    const { data: w } = await admin.from("workspaces").select("ws,name,plan,plan_until,open_domain,owner_email,created_at").eq("ws", p.ws).maybeSingle();
    const { count: users } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("ws", p.ws);
    const { count: instrs } = await admin.from("instructions").select("id", { count: "exact", head: true }).eq("ws", p.ws).is("deleted_at", null);
    const { data: admins } = await admin.from("platform_admins").select("email");
    const to = (admins || []).map((a: any) => String(a.email || "").toLowerCase()).filter(Boolean);
    if (!to.length) return json({ skipped: "no_admins" });
    const { data: key } = await admin.rpc("get_resend_key");
    if (!key) return json({ error: "no_key" }, 500);

    const isNewWs = !!w && (users || 0) <= 1 && String(w.owner_email || "").toLowerCase() === String(p.email || "").toLowerCase();
    const how = isNewWs ? (w?.plan === "demo" ? "Demo-Konto angenommen" : "Neuer Workspace (Trial)") : (p.is_admin ? "Beigetreten als Admin" : "Beigetreten (Einladung oder Domain)");
    const until = w?.plan_until ? new Date(w.plan_until).toLocaleDateString("de-DE") : "–";
    const subject = `${isNewWs ? "Neue Registrierung" : "Neuer Nutzer"}: ${p.name || p.email} · ${w?.name || p.ws}`;
    const rows = [
      ["Person", `${esc(p.name || "")} &lt;${esc(p.email)}&gt;`],
      ["Rolle", `${esc(p.role)}${p.is_admin ? " (Admin)" : ""}`],
      ["Workspace", `${esc(w?.name || p.ws)} <span style="color:#8A8F98">(${esc(p.ws)})</span>`],
      ["Art", esc(how)],
      ["Plan", `${esc(w?.plan || "–")} · bis ${esc(until)}${w?.open_domain ? " · Domain offen" : ""}`],
      ["Stand", `${users || 0} Nutzer · ${instrs || 0} Anleitungen`],
    ];
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111">
      <div style="max-width:560px;margin:0 auto;padding:28px 16px">
        <div style="background:#000;color:#fff;border-radius:14px 14px 0 0;padding:16px 22px;font-weight:800;font-size:18px;letter-spacing:.02em">GIRI Go</div>
        <div style="background:#fff;border-radius:0 0 14px 14px;padding:22px 22px 18px;border:1px solid #E6E8EE;border-top:0">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">${isNewWs ? "Neue Registrierung" : "Neuer Nutzer"}</p>
          <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">${esc(p.name || p.email)}</h1>
          <table style="border-collapse:collapse;font-size:14px;width:100%">${rows.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#6B7280;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0">${v}</td></tr>`).join("")}</table>
          <a href="${APP}#/master" style="display:inline-block;margin-top:16px;background:#000;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px;font-size:15px">Master-Admin öffnen</a>
          <p style="margin:18px 0 0;font-size:12px;color:#8A8F98;line-height:1.5">Du bekommst diese Mail, weil du Plattform-Admin von GIRI Go bist.</p>
        </div>
        <p style="margin:14px 0 0;text-align:center;font-size:11px;color:#9AA0A6">GIRI · AR-Experts GmbH</p>
      </div></body></html>`;
    const plain = `${subject}\n\n${rows.map(([k, v]) => `${k}: ${String(v).replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">")}`).join("\n")}\n\n${APP}#/master`;
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "GIRI <giri@ar-giri.de>", to, subject, html, text: plain, tags: [{ name: "type", value: "signup" }] }) });
    const rb = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: "resend_" + r.status, detail: rb }, 502);
    return json({ sent: true, to, id: rb.id || null });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
