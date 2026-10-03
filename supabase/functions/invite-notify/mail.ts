// GIRI – invite-notify: the invitation e-mail itself (v2, v12.50).
// Both languages in one mail: the language the admin picked comes first, the other one below. A small flag at the top jumps to the
// other language (an anchor link – Apple Mail, iOS, Outlook and most webmailers jump; where not, the label says "English below").
// No word count of digits for the code: the project's sign-in codes are 8 digits, Supabase lets that be changed – "your code" is right.

export const APP = "https://go.ar-giri.de/";
export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export const ROLE: Record<string, { de: string; en: string }> = {
  admin: { de: "Admin", en: "Admin" }, viewer: { de: "Betrachter", en: "Viewer" }, editor: { de: "Bearbeiter", en: "Editor" },
  approver: { de: "Freigeber", en: "Approver" }, reviewer: { de: "Freigeber", en: "Approver" }, tech_approver: { de: "Technischer Freigeber", en: "Technical approver" },
  compliance_approver: { de: "Compliance-Freigeber", en: "Compliance approver" }, compliance_manager: { de: "Compliance-Manager", en: "Compliance manager" },
  creator: { de: "Ersteller", en: "Creator" }, team_admin: { de: "Team-Admin", en: "Team admin" },
};

type V = { inviter: string; company: string; role: string; email: string; inviterMail: string };
type Txt = { subject: string; kicker: string; h1: string; lead: string; what: string; btn: string; how: string; s1: string; s2: string; s3: string; validT: string; valid: string; nobtn: string; tip: string; qr: string; foot: string; flag: string; other: string; back: string };

const T = (lang: "de" | "en", v: V): Txt => {
  const i = esc(v.inviter), c = esc(v.company), r = esc((ROLE[v.role] || ROLE.creator)[lang]), e = esc(v.email), im = esc(v.inviterMail);
  return lang === "en" ? {
    subject: `${v.inviter} invited you to GIRI`,
    flag: "🇬🇧", other: "🇬🇧 English ↓", back: "↑ 🇩🇪 Deutsch",
    kicker: "Invitation", h1: "Welcome to GIRI",
    lead: `<b>${i}</b> invited you to <b>${c}</b> – as <b>${r}</b>.`,
    what: "GIRI is the app for work instructions with photo and video: record, approve and play them right at the workplace.",
    btn: "Sign in now", how: "How to sign in – no password needed:",
    s1: "Tap “Sign in now” – your e-mail address is already filled in.",
    s2: "Tap “Sign in”. A second e-mail with your sign-in code arrives right away (sender “GIRI” – check your spam folder if needed).",
    s3: `Enter the code – done. You land directly in “${c}”.`,
    validT: "How long is this valid?",
    valid: `The invitation stays open until you sign in or ${i} withdraws it. The code from the second e-mail is valid for 60 minutes and works once – simply request a new one if it has expired.`,
    nobtn: `Button not working? Open <a href="${APP}" style="color:#004EAD">go.ar-giri.de</a> and sign in with ${e}.`,
    tip: "On your phone: after signing in, choose “Install app” – GIRI then starts like an app and also works without a network.",
    qr: "Signed in on the PC already? Then sign in on the phone without a second e-mail: on the PC tap your profile at the top → “Sign in on your phone” and scan the QR code.",
    foot: `You are receiving this e-mail because ${i} (${im}) invited you to GIRI. Not expected? Simply ignore it – nothing happens without signing in. Questions? Reply to this e-mail, it goes to ${i}.`,
  } : {
    subject: `${v.inviter} hat dich zu GIRI eingeladen`,
    flag: "🇩🇪", other: "🇩🇪 Deutsch ↓", back: "↑ 🇬🇧 English",
    kicker: "Einladung", h1: "Willkommen bei GIRI",
    lead: `<b>${i}</b> hat dich in den Bereich <b>${c}</b> eingeladen – als <b>${r}</b>.`,
    what: "GIRI ist die App für Arbeitsanweisungen mit Foto und Video: aufnehmen, freigeben und direkt am Arbeitsplatz abspielen.",
    btn: "Jetzt anmelden", how: "So meldest du dich an – ohne Passwort:",
    s1: "Auf „Jetzt anmelden“ tippen – deine E-Mail-Adresse ist schon eingetragen.",
    s2: "Auf „Anmelden“ tippen. Sofort kommt eine zweite Mail mit deinem Anmelde-Code (Absender „GIRI“ – ggf. im Spam-Ordner nachsehen).",
    s3: `Code eingeben – fertig. Du landest direkt in „${c}“.`,
    validT: "Wie lange gilt das?",
    valid: `Die Einladung bleibt offen, bis du dich anmeldest oder ${i} sie zurückzieht. Der Code aus der zweiten Mail gilt 60 Minuten und nur einmal – ist er abgelaufen, einfach neu anfordern.`,
    nobtn: `Button geht nicht? Öffne <a href="${APP}" style="color:#004EAD">go.ar-giri.de</a> und melde dich mit ${e} an.`,
    tip: "Fürs Handy: Nach der Anmeldung „App installieren“ wählen – dann startet GIRI wie eine App und funktioniert auch ohne Netz.",
    qr: "Am PC schon angemeldet? Dann am Handy ohne zweite Mail: am PC oben auf dein Profil → „Auf dem Handy anmelden“ und den QR-Code scannen.",
    foot: `Du bekommst diese Mail, weil ${i} (${im}) dich zu GIRI eingeladen hat. Nicht erwartet? Einfach ignorieren – ohne Anmeldung passiert nichts. Fragen? Antworte auf diese Mail, sie geht an ${i}.`,
  };
};

// one language block (the second one is a little quieter: no repeated header, a flag line instead)
const block = (x: Txt, link: string, second: boolean, anchor: string, backAnchor: string) => `
        <div style="background:#fff;border-radius:${second ? "14px" : "0 0 14px 14px"};padding:22px 22px 18px;border:1px solid #E6E8EE;${second ? "margin-top:16px" : "border-top:0"}">
          ${second ? `<a name="${anchor}" id="${anchor}"></a><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr><td style="font-size:13px;font-weight:800;color:#111">${x.flag} ${x.flag === "🇬🇧" ? "English version" : "Deutsche Version"}</td><td align="right"><a href="#${backAnchor}" style="font-size:12.5px;color:#004EAD;text-decoration:none;font-weight:700">${x.back}</a></td></tr></table>` : ""}
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">${x.kicker}</p>
          <h1 style="margin:0 0 10px;font-size:${second ? 20 : 22}px;line-height:1.3">${x.h1}</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.5">${x.lead}</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:#555">${x.what}</p>
          <a href="${esc(link)}" style="display:inline-block;background:#004EAD;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:12px;font-size:15px">${x.btn}</a>
          <p style="margin:22px 0 8px;font-size:14px;font-weight:700">${x.how}</p>
          <ol style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.55;color:#222"><li>${x.s1}</li><li>${x.s2}</li><li>${x.s3}</li></ol>
          <div style="margin:0 0 14px;padding:12px 14px;background:#F4F6FA;border-left:4px solid #03D39B;border-radius:8px;font-size:13.5px;line-height:1.5;color:#222"><b>${x.validT}</b><br>${x.valid}</div>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#555">📱 ${x.qr}</p>
          <p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:#555">${x.tip}</p>
          <p style="margin:0;font-size:12.5px;line-height:1.5;color:#6B7280">${x.nobtn}</p>
          <p style="margin:18px 0 0;font-size:12px;color:#8A8F98;line-height:1.5">${x.foot}</p>
        </div>`;

export function inviteMail(lang: "de" | "en", v: V, link: string) {
  const a = T(lang, v), b = T(lang === "de" ? "en" : "de", v);
  const otherAnchor = lang === "de" ? "lang-en" : "lang-de", topAnchor = "lang-top";
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111">
      <div style="max-width:560px;margin:0 auto;padding:28px 16px"><a name="${topAnchor}" id="${topAnchor}"></a>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000;border-radius:14px 14px 0 0"><tr>
          <td style="padding:16px 22px;color:#fff;font-weight:800;font-size:18px;letter-spacing:.02em">GIRI</td>
          <td align="right" style="padding:16px 22px"><a href="#${otherAnchor}" style="color:#fff;font-size:13px;font-weight:700;text-decoration:none;background:#1F1F23;border-radius:999px;padding:6px 12px;white-space:nowrap">${b.other}</a></td>
        </tr></table>${block(a, link, false, "", "")}${block(b, link, true, otherAnchor, topAnchor)}
        <p style="margin:14px 0 0;text-align:center;font-size:11px;color:#9AA0A6">GIRI · AR-Experts GmbH · go.ar-giri.de</p>
      </div></body></html>`;
  const txt = (x: Txt) => [x.h1, "", strip(x.lead), strip(x.what), "", `${x.btn}: ${link}`, "", strip(x.how), "1. " + strip(x.s1), "2. " + strip(x.s2), "3. " + strip(x.s3), "", strip(x.validT) + " " + strip(x.valid), "", strip(x.qr), "", strip(x.tip), "", strip(x.foot)].join("\n");
  const text = txt(a) + "\n\n" + "—".repeat(24) + "\n" + (lang === "de" ? "🇬🇧 English version" : "🇩🇪 Deutsche Version") + "\n\n" + txt(b);
  return { subject: a.subject, html, text };
}
