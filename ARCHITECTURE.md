# GIRI Go – Architektur (Stand v12.48)

Für alle, die den Code übernehmen oder prüfen (Backend-Hire, Code-Review, ISO-Audit). Die Versionsgeschichte steht in `README.md`,
die Ordnerkarte in `src/README.md`. Dieses Dokument beschreibt **was wo läuft, wem was gehört und wo die Sicherheit sitzt**.

## 1. Was GIRI Go ist

Eine Web-App (PWA) für Video-/Foto-Arbeitsanweisungen: Ersteller filmen Schritte, markieren Bilder mit 3D-Symbolen, holen Freigaben
ein; Werker sehen die Anleitung per Link/QR am Handy, auch offline, und geben Feedback. Ein Workspace = eine Firma (`ws` =
Mail-Domain), darin Teams, Ordner (Projekte), Anleitungen.

## 2. Laufzeit – wer redet mit wem

```
Browser (SPA, Vite-Build, PWA mit Service Worker)
   │  HTTPS
   ├── Cloudflare Workers  go.ar-giri.de          nur statische Dateien (index.html, assets, symbols) – keine Kundendaten
   └── Supabase  eu-central-1 (Frankfurt)         Postgres + RLS · Auth · Storage (Bucket "media") · Edge Functions · Vault
            ├── translate        → DeepL API (Übersetzung von Anleitungstexten)
            ├── pdf-analyze      → Google Vertex AI, Gemini, Region europe-west3 (PDF → Schrittvorschläge; Service-Account im Vault)
            ├── feedback-notify  → Resend (Mail an Ersteller/Freigeber bei Werker-Feedback)
            ├── invite-notify    → Resend (Einladungs-Mail; nur Admins, nur offene Einladungen, Limits über mail_log) – seit v12.48
            ├── master-admin     → nur Plattform-Admins: Demo (1–5 Admins, 1 Team), Person/Workspace löschen, Einladung zurückziehen – seit v12.48.2
            ├── device-login     Anmeldung am Handy per QR vom PC (Number Matching, Einmal-Token, keine Mail; Tabelle device_logins) – seit v12.50
            ├── signup-notify    → Resend (Mail an die Plattform-Admins bei jeder Registrierung)
            ├── hubspot-sync     → HubSpot CRM (Nutzer-Kontakte, nur Name/Mail/Firma)
            ├── giri-import      → GIRI-Classic-Server des Kunden (Import bestehender Anleitungen, Token des Nutzers)
            └── migrate-posters  Wartung (Poster-Bilder in den Storage), Service-Role
Login: E-Mail-Code/Link (Supabase Auth OTP) oder Google (OAuth); seit v12.50 am Handy auch per QR-Code vom angemeldeten PC (device-login). Keine Passwörter.
```

**Datenfluss Kundendaten**: Anleitungen (JSON) und Medien (Fotos/Videos/Poster) liegen ausschließlich in Supabase Frankfurt.
Cloudflare sieht nur die App-Dateien. Drittdienste erhalten nur den jeweiligen Auftrag (DeepL: Texte; Vertex: das hochgeladene
PDF; Resend: Mailadresse + Betreff; HubSpot: Kontaktdaten des Nutzers). DeepL, Vertex und Resend sind pro Aufruf, nichts wird dort
dauerhaft gespeichert (DeepL Pro: no-store; Vertex: Standard-Datenverarbeitung des Google-Cloud-Vertrags).

## 3. Sicherheit – was wo geprüft wird

| Ebene | Was | Wo im Code |
|---|---|---|
| **Postgres RLS + Trigger** (verbindlich) | Wer welche Zeile lesen/schreiben darf – seit v12.45 mit denselben Regeln wie die Oberfläche; seit v12.48 (`v013`) zusätzlich: **Identität** (E-Mail/ID eines Profils ändert nur das System, sie folgt dem Login; Rolle/Admin nur durch Admins, nie die eigene – `profiles_guard`), **Workspace-Zeile** (Teams, Einladungen, Einstellungen, Branding, Name nur Admins/Plattform-Admins; Ordner → Recht `projects`, Symbole → `edit` – `ws_write_guard`), **Workspace lesen** nur Mitglieder + Plattform-Admins (anonym nur `ws_brand(ws)`); Workspace-Zugehörigkeit; **Team-Sichtbarkeit** (Anleitung mit Team/Team-Ordner nur für Mitglieder, Org-Admins alles – Spalte `instructions.teams_eff`, gepflegt per Trigger); **Rollen/Fähigkeiten** (`role_caps`, `my_can`) für Anlegen, Ändern, Löschen; **Freigabe-Trigger** `instr_authz_guard`: technische/DSGVO-Freigabe nur mit der passenden Rolle, Veröffentlichen nur mit beiden Freigaben, Inhaltsänderung nur mit Bearbeitungsrecht; Admin-Rechte für Workspace-Einstellungen; veröffentlichte Anleitungen per Link (`open_instr`, Passwort-Hash-Prüfung im SQL) | `supabase/schema.sql`, Migrationen `v001…v014` (`supabase/migrations/`), Tests `supabase/tests/authz.sql`, `supabase/tests/signup.sql`, `supabase/tests/security.sql` |
| **Plattform-Ebene** (verbindlich, seit v12.47) | `platform_admins` (E-Mail-Liste, `is_master()` – seit v12.48 gegen die E-Mail des Logins in `auth.users` geprüft, nicht gegen das Profil) – nur diese Personen sehen alle Workspaces und dürfen Plan-Felder ändern (`ws_plan_guard` verwirft Plan-Änderungen anderer Admins); Master-RPCs prüfen `is_master()` im SQL; pausierte Workspaces (`plan = 'suspended'`) sind für alle nur lesend (`instr_authz_guard`) | `supabase/migrations/v010…v012`, `src/views/master.js` (Route `#/master`) |
| **Edge Functions** (verbindlich) | JWT des Nutzers wird geprüft (bzw. ein gemeinsames Geheimnis bei Aufrufen aus der Datenbank); Geheimnisse (DeepL, Resend, HubSpot, Google-SA) liegen im Supabase Vault und verlassen den Server nie; Mail-Functions schicken nur an Empfänger, die sich aus der Datenbank ergeben (Ersteller, offene Einladung, Plattform-Admins) – kein freies Mail-Relay | `supabase/functions/*` |
| **Storage-Policies** (verbindlich) | Bucket `media`: Lesen öffentlich per unratbarer URL (Medien veröffentlichter Anleitungen müssen ohne Login abrufbar sein); Auflisten/Lesen über die API seit v12.48 nur im eigenen Workspace-Ordner (`media_read_ws`); Hochladen/Ändern/Löschen nur im eigenen Workspace-Ordner `media/<ws>/…` (`my_ws()`); Werker ohne Login dürfen nur Beweisfotos nach `runs/…` laden | `supabase/schema.sql` (Policies auf `storage.objects`) |
| **Browser** (Komfort, nicht verbindlich) | Rollen-Fähigkeiten für die Oberfläche (`src/core/roles.js`): welche Knöpfe erscheinen. Alles, was hier ausgeblendet wird, muss die DB trotzdem ablehnen – Regel: **kein Recht existiert nur im Browser** | `src/core/roles.js`, `src/views/*` |

Regel seit v12.45: **jede Rechteänderung = Policy/Trigger in Supabase (Migration) + Spiegel in `src/core/roles.js` + Fall in
`supabase/tests/authz.sql`.** Die Oberfläche blendet nur aus, entschieden wird in der Datenbank; lehnt sie ab (SQLSTATE 42501), verwirft
der Client die Änderung und lädt den Serverstand (`core/passwords.js → upsertInstrRow`).

Offen: die Policy-Tests laufen noch von Hand (SQL-Editor/MCP) gegen das Produktivprojekt – rollbacksicher, aber nicht in CI
(dafür fehlt ein Supabase-Test-Projekt mit Seed).

Werker öffnen Anleitungen ohne Login: der Link enthält einen 24-Zeichen-Schlüssel (`shareKey`), optional zusätzlich ein Passwort
(nur als Hash gespeichert, Prüfung in `open_instr`). Sichtbar ist dann genau diese eine veröffentlichte Anleitung.

## 4. Datenmodell (Kurzfassung)

- `profiles` – Nutzer (id = auth.users.id, ws, role, is_admin). Angelegt vom Trigger `handle_new_user` → `place_new_user`: **1.** Einladung in irgendeinem
  Workspace (beliebige Domain) → dorthin mit der eingeladenen Rolle; **2.** Workspace derselben E-Mail-Domain mit `open_domain = true` → dorthin als Creator;
  **3.** sonst eigener Workspace (`firma-de-xxxxx`, Admin, Plan `trial` 30 Tage, Domain geschlossen). Gleiche Domain ≠ gleicher Account – zusammenführen
  kann nur ein Plattform-Admin. Jede Registrierung löst `signup_poke` → Edge-Function `signup-notify` → Mail an `platform_admins` aus.
  DSGVO: `gdpr_export_user(email)` (Auskunft als JSON) und `gdpr_erase_user(email)` (Login + Profil + Mitgliedschaften weg, Namen in Anleitungen/Feedback anonymisiert) – nur Org-Admins, Knöpfe in Admin → Nutzer.
- `workspaces` – eine Zeile pro Firma: `brand`, `teams[]` (Mitglieder + Rolle), `folders[]` (Projekte), `symbols[]` (eigene Symbole), `settings`;
  seit v12.47 Plan-Felder `name, plan (trial|active|demo|suspended), plan_until, seats, plan_note, open_domain, owner_email, created_at` – nur über
  das Master-Panel änderbar (`master_set_plan`); Trial/Demo laufen weich aus (Hinweisbanner im Dashboard, kein automatisches Sperren), `suspended`
  sperrt das Schreiben. Abrechnung (Stripe o. ä.) gibt es nicht – Plan und Plätze werden von Hand gepflegt, `seats` ist nur Anzeige.
- `platform_admins` – wer das Master-Panel sieht (`master_overview`, `master_users`, `master_set_plan`, `master_move_user`, `master_merge_workspace`,
  `master_create_demo`, `master_add_admin`).
- `instructions` – eine Zeile pro Anleitung; **die Anleitung selbst ist ein JSON-Dokument in `data`** (Schritte, Kapitel, Symbole, Freigaben, Historie, Übersetzungen). Spalten daneben nur für Listen/Policies: `ws, status, title, updated_at, owner, deleted_at, teams_eff` (wirksame Team-IDs = eigene Teams ∪ Teams des Ordners, per Trigger gepflegt – Basis der Sichtbarkeits-Policy).
- `instr_stats`, `views`, `runs` – Nutzung (Aufrufe, Durchläufe mit Checkliste), `feedback` – Werker-Rückmeldungen (offen/erledigt, optional Foto/Video), `ai_usage` – Protokoll der KI-Aufrufe, `ui_tx` – Cache für Oberflächen-Übersetzungen, `mail_log` (seit v12.48, nur Service-Role) – versendete Einladungs-Mails für die Limits, nach 90 Tagen gelöscht.
- `workspaces.invites[]` – offene Einladungen `{email, role, at, by, lang, mailed_at, mail_n}`; eingelöst beim ersten Login (`place_new_user`), danach entfernt. Die Einladung selbst läuft nicht ab; der Login-Code gilt 60 Minuten (Supabase „Email OTP Expiration“).
- Storage `media/<ws>/…` – Fotos, Videos (H.264, ≤ 1280 px), Poster-JPEGs, eigene Symbole.

Schema-Änderungen = SQL-Migration im Supabase-Projekt (MCP/CLI) **und** derselbe Block angehängt an `supabase/schema.sql`.

## 5. Client-Architektur

- Kein Framework: ES-Module, `el(html)`-Helfer, Vite nur als Bundler. `S` (Zustand: Nutzer, Anleitungen, Workspace) und `G` (Einzelwerte:
  Sprache, Supabase-Client, Update-Status) in `src/core/state.js`.
- **Offline-first**: `IndexedDB` (Spiegel der Anleitungen, Medien-Blobs, Offline-Kopien für Werker, seit v12.46 Editor-Cache der Clips – `media/preload.js`: PC alle Schritte, Handy die nächsten zwei, 14 Tage), Upload-Queue (`core/uploads.js`),
  Delta-Sync nur `id + updated_at` (`core/translate.js → loadInstrs`); offline zeichnet die App sofort aus Speicher/Gerät, ungespeicherte
  Änderungen bleiben markiert und werden alle 30 s bzw. beim Zurückkehren erneut hochgeladen. Service Worker cached die App-Shell und Symbole,
  prüft die Version und rettet hängende Installationen (`sw.js`); seit v12.48 übernimmt er eine neue Version erst, wenn alle ihre Dateien im
  Cache liegen (`installShell`), sonst bliebe offline eine leere Seite.
- **Orientierung** (v12.48): `ui/topbar.js` zeichnet den Pfad (Anleitungen › Ordner › Anleitung) und den Zurück-Pfeil eine Ebene hoch; `ui/instrnav.js` die Reiter einer Anleitung (Bearbeiten · Vorschau · Auswertung). Avatar = Profil, ≡ = App-Menü.
- **Unterseiten einer Anleitung** (v12.49): `#/edit/<id>` (Schritte), `#/settings/<id>` (Ablage & Zugriff, Checkliste, Feedback), `#/results/<id>` (Auswertung) – gleicher Kopf, Vorschau als Button ganz rechts (`previewBtn`); Freigabe als Dialog in `views/editor.js` (`approvalDialog`). **Eine Seite scrollt:** `ui/flowsticky.js` hält Seitenspalten (Schrittliste, Schritt-Spalte, Navigator) mit der Seite in Bewegung statt eigener Scrollbereiche.
- **Anmelden per QR** (v12.50, `views/devicelogin.js`): PC (angemeldet) → Profil → „Auf dem Handy anmelden“ (`qrLoginDialog`: QR `#/qr/<id>/<secret>`, Status-Abfrage, Zahl eintippen); Handy → `#/qr/…` (`renderQrLogin`: erst beanspruchen, Zahl zeigen, mit dem Zweit-Geheimnis abfragen, Token per `verifyOtp` einlösen) oder Scanner auf der Anmeldeseite (`scanQr`: `BarcodeDetector`/`vendor/jsQR.min.js`). Zustand nur in `device_logins` (ohne Policies, nur die Edge Function). Abmelden = nur dieses Gerät (`signOut({scope:'local'})`), „Auf allen Geräten abmelden“ = `scope:'global'`.
- **Werker-Ansicht** (`views/viewer.js`): Abschnitte mit Scroll-Snap; bei Checkliste eine feste Antwortleiste und eine Sperre (`gateUpdate`): alles nach dem ersten offenen Pflichtschritt ist ausgeblendet; vor dem Start gewählte Kapitel verschieben den Beginn der Sperre. Ende-Bildschirm nach Zählung (alles OK / nicht OK / offen).
- **Gleichzeitiges Bearbeiten**: optimistisches Sperren – jede Kopie kennt das `updated_at`, von dem sie stammt (`_base`);
  `update … where updated_at = _base`, sonst Konfliktdialog (`core/passwords.js → upsertInstrRow`, Test `locktest`).
- **Symbole**: ein Renderer für Editor, Viewer und PDF (`annotations/draw.js`), 3D durch Extrusion + affine Kipp-/Dreh-Abbildung,
  ISO 7010 als SVG-Schilder (`symbols/iso`), Bibliothek (`annotations/library.js`).
- **Video**: Aufnahme mit MediaRecorder, Konvertierung im Browser (WebCodecs → MP4, `media/convert.js`), Trimmen ohne Neu-Encoding
  (`trimStart/trimEnd`), Symbol-Zeitpunkte (`a.t`), optionales Objekt-Tracking (`annotations/track.js`).
- Größte Datei: `src/views/editor.js` (Editor: Liste, Bühne, Symbole, Video). Nächster Wartungsschritt: in Liste / Bühne / Medien /
  Symbol-Interaktion aufteilen.

## 6. Bauen, Testen, Ausliefern

- `npm run dev` lokal · `npm run build` → `index.html` + `assets/` im Repo-Root (werden mit eingecheckt) · `npm run build:cf` → `dist/` für Cloudflare.
- `npm test` = `node tests/run.mjs` – 51 Playwright-Ende-zu-Ende-Tests gegen den gebauten Stand; Supabase ist durch einen
  In-Memory-Mock ersetzt (`tests/build_mock.mjs` → `index3.html`), keine Geheimnisse, kein Netz. Einzelne Tests: `node tests/run.mjs libtest vidtest`.
- CI: `.github/workflows/ci.yml` baut und lässt die Suite bei jedem Push/PR laufen; Screenshots und Ausgaben hängen als Artifact am Lauf.
- Release: Version in `app/index.html` (`APP_VERSION`) und `package.json` hochzählen, README-Abschnitt, `npm run build`, Commit auf `main`
  → Cloudflare baut und veröffentlicht automatisch. Installierte Apps holen die neue Version beim nächsten Öffnen (Versions-Check im SW).
- Geheimnisse: nie im Repo, nie im Chat – Vault (Server) oder Dashboard-Felder (Auth-Provider, SMTP).

## 7. Bekannte Schulden (ehrlich)

- Code ist dicht geschrieben (lange Zeilen, große Funktionen) – lesbar für den Autor, teuer für Neue. Geplant: Prettier/ESLint-Pass,
  Aufteilung von `editor.js`, JSDoc-Typen für `instr`/`step`/`ann`.
- Policy-Tests (`supabase/tests/authz.sql`, `supabase/tests/signup.sql`) laufen von Hand, nicht in CI (Supabase-Test-Projekt mit Seed fehlt).
- Plan-Ablauf ist weich (Banner), Plätze werden nicht erzwungen, keine Abrechnung – bewusst für die ersten Kunden; Stripe o. ä. später.
- **Backups**: Pro-Plan → tägliche Datenbank-Backups, 7 Tage. **Dateien im Storage (Fotos, Videos, Poster) sind nicht Teil dieser Backups** – ein eigener Storage-Export (z. B. wöchentlich, außerhalb von Supabase) fehlt noch, ebenso eine Restore-Probe (Backup in ein Testprojekt einspielen, Stichprobe prüfen). Point-in-Time-Recovery ist ein Zusatzpaket (~100 $/Monat für 7 Tage).
- **Werker-Durchläufe ohne Login** (`runs`) werden über eine zufällige ID fortgeschrieben (Policy `runs_update`: offen, jünger als 2 Tage); wer die ID kennt, könnte einen laufenden Durchgang überschreiben – abgeschlossene nicht. Für die Nachweisführung später: Schlüssel pro Lauf oder Abschluss serverseitig festschreiben.
- **Fehler-Monitoring**: nur `client_log` (JS-Fehler, langsame Seiten, 30 Tage) und die Supabase-Logs; kein Alarm bei Fehlern (z. B. Sentry o. ä.) und keine Uptime-Überwachung.
- Advisor-WARNs bleiben bewusst: die Policy-Helfer (`my_ws`, `my_admin`, `my_can*`, `my_team_ids`, `instr_team_ids`) sind als RPC
  aufrufbar, geben aber nur Auskunft über den Aufrufer selbst; `open_instr`/`instr_public`/`instr_locked`/`feedback_poke` sind
  absichtlich ohne Login erreichbar (Werker-Links).
