# GIRI Go – Architektur (Stand v12.46)

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
            ├── hubspot-sync     → HubSpot CRM (Nutzer-Kontakte, nur Name/Mail/Firma)
            ├── giri-import      → GIRI-Classic-Server des Kunden (Import bestehender Anleitungen, Token des Nutzers)
            └── migrate-posters  Wartung (Poster-Bilder in den Storage), Service-Role
Login: E-Mail-Code/Link (Supabase Auth OTP) oder Google (OAuth). Keine Passwörter.
```

**Datenfluss Kundendaten**: Anleitungen (JSON) und Medien (Fotos/Videos/Poster) liegen ausschließlich in Supabase Frankfurt.
Cloudflare sieht nur die App-Dateien. Drittdienste erhalten nur den jeweiligen Auftrag (DeepL: Texte; Vertex: das hochgeladene
PDF; Resend: Mailadresse + Betreff; HubSpot: Kontaktdaten des Nutzers). DeepL, Vertex und Resend sind pro Aufruf, nichts wird dort
dauerhaft gespeichert (DeepL Pro: no-store; Vertex: Standard-Datenverarbeitung des Google-Cloud-Vertrags).

## 3. Sicherheit – was wo geprüft wird

| Ebene | Was | Wo im Code |
|---|---|---|
| **Postgres RLS + Trigger** (verbindlich) | Wer welche Zeile lesen/schreiben darf – seit v12.45 mit denselben Regeln wie die Oberfläche: Workspace-Zugehörigkeit; **Team-Sichtbarkeit** (Anleitung mit Team/Team-Ordner nur für Mitglieder, Org-Admins alles – Spalte `instructions.teams_eff`, gepflegt per Trigger); **Rollen/Fähigkeiten** (`role_caps`, `my_can`) für Anlegen, Ändern, Löschen; **Freigabe-Trigger** `instr_authz_guard`: technische/DSGVO-Freigabe nur mit der passenden Rolle, Veröffentlichen nur mit beiden Freigaben, Inhaltsänderung nur mit Bearbeitungsrecht; Admin-Rechte für Workspace-Einstellungen; veröffentlichte Anleitungen per Link (`open_instr`, Passwort-Hash-Prüfung im SQL) | `supabase/schema.sql`, Migrationen `v001…v009` (`supabase/migrations/`), Tests `supabase/tests/authz.sql` |
| **Edge Functions** (verbindlich) | JWT des Nutzers wird geprüft; Geheimnisse (DeepL, Resend, HubSpot, Google-SA) liegen im Supabase Vault und verlassen den Server nie | `supabase/functions/*` |
| **Storage-Policies** (verbindlich) | Bucket `media`: Lesen öffentlich per unratbarer URL (Medien veröffentlichter Anleitungen müssen ohne Login abrufbar sein); Hochladen/Ändern/Löschen nur im eigenen Workspace-Ordner `media/<ws>/…` (`my_ws()`); Werker ohne Login dürfen nur Beweisfotos nach `runs/…` laden | `supabase/schema.sql` (Policies auf `storage.objects`) |
| **Browser** (Komfort, nicht verbindlich) | Rollen-Fähigkeiten für die Oberfläche (`src/core/roles.js`): welche Knöpfe erscheinen. Alles, was hier ausgeblendet wird, muss die DB trotzdem ablehnen – Regel: **kein Recht existiert nur im Browser** | `src/core/roles.js`, `src/views/*` |

Regel seit v12.45: **jede Rechteänderung = Policy/Trigger in Supabase (Migration) + Spiegel in `src/core/roles.js` + Fall in
`supabase/tests/authz.sql`.** Die Oberfläche blendet nur aus, entschieden wird in der Datenbank; lehnt sie ab (SQLSTATE 42501), verwirft
der Client die Änderung und lädt den Serverstand (`core/passwords.js → upsertInstrRow`).

Offen: die Policy-Tests laufen noch von Hand (SQL-Editor/MCP) gegen das Produktivprojekt – rollbacksicher, aber nicht in CI
(dafür fehlt ein Supabase-Test-Projekt mit Seed).

Werker öffnen Anleitungen ohne Login: der Link enthält einen 24-Zeichen-Schlüssel (`shareKey`), optional zusätzlich ein Passwort
(nur als Hash gespeichert, Prüfung in `open_instr`). Sichtbar ist dann genau diese eine veröffentlichte Anleitung.

## 4. Datenmodell (Kurzfassung)

- `profiles` – Nutzer (id = auth.users.id, ws, role, is_admin). Angelegt vom Trigger `handle_new_user` (Einladungen, erlaubte Domains).
  DSGVO: `gdpr_export_user(email)` (Auskunft als JSON) und `gdpr_erase_user(email)` (Login + Profil + Mitgliedschaften weg, Namen in Anleitungen/Feedback anonymisiert) – nur Org-Admins, Knöpfe in Admin → Nutzer.
- `workspaces` – eine Zeile pro Firma: `brand`, `teams[]` (Mitglieder + Rolle), `folders[]` (Projekte), `symbols[]` (eigene Symbole), `settings`.
- `instructions` – eine Zeile pro Anleitung; **die Anleitung selbst ist ein JSON-Dokument in `data`** (Schritte, Kapitel, Symbole, Freigaben, Historie, Übersetzungen). Spalten daneben nur für Listen/Policies: `ws, status, title, updated_at, owner, deleted_at, teams_eff` (wirksame Team-IDs = eigene Teams ∪ Teams des Ordners, per Trigger gepflegt – Basis der Sichtbarkeits-Policy).
- `instr_stats`, `views`, `runs` – Nutzung (Aufrufe, Durchläufe mit Checkliste), `feedback` – Werker-Rückmeldungen (offen/erledigt, optional Foto/Video), `ai_usage` – Protokoll der KI-Aufrufe, `ui_tx` – Cache für Oberflächen-Übersetzungen.
- Storage `media/<ws>/…` – Fotos, Videos (H.264, ≤ 1280 px), Poster-JPEGs, eigene Symbole.

Schema-Änderungen = SQL-Migration im Supabase-Projekt (MCP/CLI) **und** derselbe Block angehängt an `supabase/schema.sql`.

## 5. Client-Architektur

- Kein Framework: ES-Module, `el(html)`-Helfer, Vite nur als Bundler. `S` (Zustand: Nutzer, Anleitungen, Workspace) und `G` (Einzelwerte:
  Sprache, Supabase-Client, Update-Status) in `src/core/state.js`.
- **Offline-first**: `IndexedDB` (Spiegel der Anleitungen, Medien-Blobs, Offline-Kopien für Werker, seit v12.46 Editor-Cache der Clips – `media/preload.js`: PC alle Schritte, Handy die nächsten zwei, 14 Tage), Upload-Queue (`core/uploads.js`),
  Delta-Sync nur `id + updated_at` (`core/translate.js → loadInstrs`). Service Worker cached die App-Shell und Symbole, prüft die
  Version und rettet hängende Installationen (`sw.js`).
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
- `npm test` = `node tests/run.mjs` – 41 Playwright-Ende-zu-Ende-Tests gegen den gebauten Stand; Supabase ist durch einen
  In-Memory-Mock ersetzt (`tests/build_mock.mjs` → `index3.html`), keine Geheimnisse, kein Netz. Einzelne Tests: `node tests/run.mjs libtest vidtest`.
- CI: `.github/workflows/ci.yml` baut und lässt die Suite bei jedem Push/PR laufen; Screenshots und Ausgaben hängen als Artifact am Lauf.
- Release: Version in `app/index.html` (`APP_VERSION`) und `package.json` hochzählen, README-Abschnitt, `npm run build`, Commit auf `main`
  → Cloudflare baut und veröffentlicht automatisch. Installierte Apps holen die neue Version beim nächsten Öffnen (Versions-Check im SW).
- Geheimnisse: nie im Repo, nie im Chat – Vault (Server) oder Dashboard-Felder (Auth-Provider, SMTP).

## 7. Bekannte Schulden (ehrlich)

- Code ist dicht geschrieben (lange Zeilen, große Funktionen) – lesbar für den Autor, teuer für Neue. Geplant: Prettier/ESLint-Pass,
  Aufteilung von `editor.js`, JSDoc-Typen für `instr`/`step`/`ann`.
- Policy-Tests (`supabase/tests/authz.sql`) laufen von Hand, nicht in CI (Supabase-Test-Projekt mit Seed fehlt).
- Backup-/Restore-Probe: noch nicht gemacht (braucht Pro-Plan mit täglichen Backups).
- Advisor-WARNs bleiben bewusst: die Policy-Helfer (`my_ws`, `my_admin`, `my_can*`, `my_team_ids`, `instr_team_ids`) sind als RPC
  aufrufbar, geben aber nur Auskunft über den Aufrufer selbst; `open_instr`/`instr_public`/`instr_locked`/`feedback_poke` sind
  absichtlich ohne Login erreichbar (Werker-Links).
