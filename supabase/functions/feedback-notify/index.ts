import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// GIRI – feedback-notify (v2, v12.50: German + English in one mail; v1): a worker left feedback on an instruction → e-mail to the instruction's creator (instructions.owner).
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
    // v2 (v12.50): German first, English below – a flag at the top jumps there (the worker's text itself stays as written)
    const L = (lang: "de" | "en") => {
      const de = lang === "de";
      const stepLine = fb.step_no ? `${de ? "Schritt" : "Step"} ${fb.step_no}${step && step.title ? " · " + step.title : ""}` : (de ? "Zur ganzen Anleitung" : "On the whole instruction");
      const kind = fb.kind === "process" ? (de ? "Prozess verbessern" : "Improve the process") : (de ? "Anleitung verbessern" : "Improve the instruction");
      const who = fb.worker ? fb.worker : (de ? "Ein Werker" : "A worker");
      return { stepLine, kind, who, by: de ? "von" : "by", kicker: de ? "Feedback von Werkern" : "Feedback from workers", btn: de ? "Feedback ansehen" : "View feedback",
        mediaLbl: fb.media_type === "video" ? (de ? "Video ansehen" : "Watch video") : (de ? "Foto ansehen" : "View photo"),
        onlyMedia: de ? `Kein Text – nur ${fb.media_type === "video" ? "ein Video" : "ein Foto"}.` : `No text – only ${fb.media_type === "video" ? "a video" : "a photo"}.`,
        why: de ? "Du bekommst diese Mail, weil du diese Anleitung erstellt hast oder Freigeber dafür bist. Abschalten: Anleitung öffnen → Einstellungen → Feedback → „Ersteller per E-Mail benachrichtigen“."
                : "You get this e-mail because you created this instruction or approve it. Switch it off: open the instruction → Settings → Feedback → “Notify the creator by e-mail”." };
    };
    const D = L("de"), E = L("en");
    const link = `${APP}#/results/${instr.id}`;
    const quote = fb.text ? `<blockquote style="margin:0 0 14px;padding:12px 14px;border-left:4px solid #004EAD;background:#F4F6FA;border-radius:8px;font-size:15px;line-height:1.45;color:#111">${esc(fb.text).replace(/\n/g, "<br>")}</blockquote>` : "";
    const part = (x: ReturnType<typeof L>, second: boolean) => `
        <div style="background:#fff;border-radius:${second ? "14px" : "0 0 14px 14px"};padding:22px 22px 18px;border:1px solid #E6E8EE;${second ? "margin-top:16px" : "border-top:0"}">
          ${second ? `<a name="lang-en" id="lang-en"></a><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr><td style="font-size:13px;font-weight:800">🇬🇧 English version</td><td align="right"><a href="#lang-top" style="font-size:12.5px;color:#004EAD;text-decoration:none;font-weight:700">↑ 🇩🇪 Deutsch</a></td></tr></table>` : ""}
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">${x.kicker}</p>
          <h1 style="margin:0 0 4px;font-size:20px;line-height:1.3">${esc(instr.title)}</h1>
          <p style="margin:0 0 16px;color:#555;font-size:14px">${esc(x.stepLine)} · ${esc(x.kind)} · ${x.by} <b>${esc(x.who)}</b></p>
          ${quote || `<p style="margin:0 0 14px;color:#555">${x.onlyMedia}</p>`}${fb.media_url ? `<p style="margin:0 0 14px"><a href="${esc(fb.media_url)}" style="color:#004EAD;font-weight:700">${x.mediaLbl} →</a></p>` : ""}
          <a href="${esc(link)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px;font-size:15px">${x.btn}</a>
          <p style="margin:18px 0 0;font-size:12px;color:#8A8F98;line-height:1.5">${x.why}</p>
        </div>`;
    const subject = `Neues Feedback zu „${instr.title}“${fb.step_no ? " – Schritt " + fb.step_no : ""} · New feedback`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111">
      <div style="max-width:560px;margin:0 auto;padding:28px 16px"><a name="lang-top" id="lang-top"></a>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000;border-radius:14px 14px 0 0"><tr>
          <td style="padding:16px 22px;color:#fff;font-weight:800;font-size:18px;letter-spacing:.02em">GIRI</td>
          <td align="right" style="padding:16px 22px"><a href="#lang-en" style="color:#fff;font-size:13px;font-weight:700;text-decoration:none;background:#1F1F23;border-radius:999px;padding:6px 12px;white-space:nowrap">🇬🇧 English ↓</a></td>
        </tr></table>${part(D, false)}${part(E, true)}
        <p style="margin:14px 0 0;text-align:center;font-size:11px;color:#9AA0A6">GIRI · AR-Experts GmbH · go.ar-giri.de</p>
      </div></body></html>`;
    const ptxt = (x: ReturnType<typeof L>, btn: string) => `${x.stepLine} · ${x.kind} · ${x.by} ${x.who}\n\n${fb.text || x.onlyMedia}\n${fb.media_url ? "\n" + fb.media_url : ""}\n\n${btn}: ${link}\n\n${x.why}`;
    const plain = `${subject}\n\n${ptxt(D, D.btn)}\n\n${"—".repeat(24)}\n🇬🇧 English version\n\n${ptxt(E, E.btn)}`;
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
