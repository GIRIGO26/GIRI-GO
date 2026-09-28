import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// GIRI – feedback-notify (v1): a worker left feedback on an instruction → e-mail to the instruction's creator (instructions.owner).
// Called by the database (trigger feedback_notify_ins → pg_net) with the shared secret; never by browsers.
// Off per instruction with data.fbNotify === false (editor → approval & settings); data.fbNotifyReviewers adds the reviewers who may see it. Sends via Resend (key in the vault: resend_api_key),
// sender GIRI <giri@ar-giri.de>. Marks feedback.notified_at so nothing is sent twice.

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
    const id = String(body.feedback_id || "");
    if (!id) return json({ error: "id" }, 400);
    const { data: fb } = await admin.from("feedback").select("*").eq("id", id).maybeSingle();
    if (!fb) return json({ error: "not_found" }, 404);
    if (fb.notified_at) return json({ skipped: "already" });
    const { data: instr } = await admin.from("instructions").select("id,ws,title,owner,data").eq("id", fb.instr_id).maybeSingle();
    if (!instr) return json({ error: "no_instruction" }, 404);
    const d = instr.data || {};
    const notifyOwner = d.fbNotify !== false, notifyRev = !!d.fbNotifyReviewers;
    if (!notifyOwner && !notifyRev) return json({ skipped: "off" });
    let to: { email: string; name: string } | null = null;
    if (notifyOwner && instr.owner) { const { data: p } = await admin.from("profiles").select("email,name").eq("id", instr.owner).maybeSingle(); if (p?.email) to = { email: p.email, name: p.name || "" }; }
    // optional: reviewers who may see the instruction (team-restricted → members with role reviewer of those teams, else all workspace reviewers)
    const cc: string[] = [];
    if (notifyRev) {
      const { data: wsRow } = await admin.from("workspaces").select("teams,folders").eq("ws", instr.ws).maybeSingle();
      const teams: any[] = wsRow?.teams || [], folders: any[] = wsRow?.folders || [];
      const folder = folders.find((f: any) => f.id === d.folder);
      const tids = new Set<string>([...(folder?.teams || []), ...(d.teams || [])].filter((id: string) => teams.some((tm: any) => tm.id === id)));
      const { data: revs } = await admin.from("profiles").select("email").eq("ws", instr.ws).eq("role", "reviewer");
      const revEmails = new Set((revs || []).map((r: any) => String(r.email || "").toLowerCase()).filter(Boolean));
      if (tids.size) {
        teams.filter((tm: any) => tids.has(tm.id)).forEach((tm: any) => (tm.members || []).forEach((m: any) => { const e = String(m.email || "").toLowerCase(); if (m.role === "reviewer" || revEmails.has(e)) cc.push(e); }));
      } else revEmails.forEach((e) => cc.push(e));
    }
    const recipients = [...new Set([to?.email, ...cc].filter((e): e is string => !!e))];
    if (!recipients.length) return json({ skipped: "no_owner" });
    const { data: key } = await admin.rpc("get_resend_key");
    if (!key) return json({ error: "no_key" }, 500);

    const step = (d.steps || []).filter((s: any) => !s.kind)[Math.max(0, (fb.step_no || 1) - 1)] || null;
    const stepLine = fb.step_no ? `Schritt ${fb.step_no}${step && step.title ? " · " + step.title : ""}` : "Zur ganzen Anleitung";
    const kind = fb.kind === "process" ? "Prozess verbessern" : "Anleitung verbessern";
    const who = fb.worker ? fb.worker : "Ein Werker";
    const link = `${APP}#/results/${instr.id}`;
    const media = fb.media_url ? `<p style="margin:0 0 14px"><a href="${esc(fb.media_url)}" style="color:#004EAD;font-weight:700">${fb.media_type === "video" ? "Video ansehen" : "Foto ansehen"} →</a></p>` : "";
    const text = fb.text ? `<blockquote style="margin:0 0 14px;padding:12px 14px;border-left:4px solid #004EAD;background:#F4F6FA;border-radius:8px;font-size:15px;line-height:1.45;color:#111">${esc(fb.text).replace(/\n/g, "<br>")}</blockquote>` : `<p style="margin:0 0 14px;color:#555">Kein Text – nur ${fb.media_type === "video" ? "ein Video" : "ein Foto"}.</p>`;
    const subject = `Neues Feedback zu „${instr.title}“${fb.step_no ? " – Schritt " + fb.step_no : ""}`;
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111">
      <div style="max-width:560px;margin:0 auto;padding:28px 16px">
        <div style="background:#000;color:#fff;border-radius:14px 14px 0 0;padding:16px 22px;font-weight:800;font-size:18px;letter-spacing:.02em">GIRI</div>
        <div style="background:#fff;border-radius:0 0 14px 14px;padding:22px 22px 18px;border:1px solid #E6E8EE;border-top:0">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">Feedback von Werkern</p>
          <h1 style="margin:0 0 4px;font-size:20px;line-height:1.3">${esc(instr.title)}</h1>
          <p style="margin:0 0 16px;color:#555;font-size:14px">${esc(stepLine)} · ${esc(kind)} · von <b>${esc(who)}</b></p>
          ${text}${media}
          <a href="${esc(link)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px;font-size:15px">Feedback ansehen</a>
          <p style="margin:18px 0 0;font-size:12px;color:#8A8F98;line-height:1.5">Du bekommst diese Mail, weil du diese Anleitung erstellt hast oder Freigeber dafür bist. Abschalten: Anleitung öffnen → Freigabe &amp; Einstellungen → „Ersteller per E-Mail benachrichtigen“ / „Auch Freigeber benachrichtigen“.</p>
        </div>
        <p style="margin:14px 0 0;text-align:center;font-size:11px;color:#9AA0A6">GIRI · AR-Experts GmbH</p>
      </div></body></html>`;
    const plain = `${subject}\n\n${stepLine} · ${kind} · von ${who}\n\n${fb.text || (fb.media_url ? "(nur " + (fb.media_type === "video" ? "Video" : "Foto") + ")" : "")}\n${fb.media_url ? "\n" + fb.media_url : ""}\n\nFeedback ansehen: ${link}\n\nAbschalten: Anleitung öffnen → Freigabe & Einstellungen → „Ersteller per E-Mail benachrichtigen“.`;
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "GIRI <giri@ar-giri.de>", to: recipients, subject, html, text: plain, tags: [{ name: "type", value: "feedback" }] }) });
    const rb = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: "resend_" + r.status, detail: rb }, 502);
    await admin.from("feedback").update({ notified_at: new Date().toISOString() }).eq("id", id);
    return json({ sent: true, to: recipients, id: rb.id || null });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
