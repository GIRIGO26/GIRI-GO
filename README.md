# GIRI Go

Leichtgewichtige Web-App für Video-/Foto-Arbeitsanleitungen: aufnehmen (3–5 s pro Schritt), annotieren, freigeben, per Link/QR ausführen, als SOP-PDF exportieren.

**Repo:** `https://github.com/GIRIGO26/GIRI-GO` · **Live:** `https://go.ar-giri.de` (Cloudflare Workers, baut automatisch bei jedem Push auf `main`) · **Backend:** Supabase Frankfurt (`hcomtmogkuxxchrnticq`, eu-central-1) · Architektur: `ARCHITECTURE.md`, Datenbank: `supabase/schema.sql` + `supabase/migrations/`.

## v0.28 – KI-PDF-Import
- **Neue Anleitung → „Aus PDF erstellen“**: Bestehende Arbeitsanweisung als PDF hochladen (max. 12 MB). Die KI schlägt Schritte, Kapitel, Warnhinweise und das passende Bild je Schritt vor; im Prüf-Dialog Texte ändern, Schritte löschen/verschieben, Bild wählen (Bildausschnitt · ganze Seite · Titelkarte), dann „Übernehmen“ → Entwurf mit Foto-Schritten, der Editor öffnet sich.
- **Modell/Datenfluss:** Edge Function `pdf-analyze` → Google Vertex AI, **Gemini 3.5 Flash (`gemini-3.5-flash`), Region europe-west3 (Frankfurt)**, Projekt `giri-go`, Dienstkonto `giri-go-ai` (Secret `GOOGLE_SERVICE_ACCOUNT_JSON`). Structured Output (JSON-Schema) mit Bounding Boxes `[ymin,xmin,ymax,xmax]` 0–1000; die Bilder werden **im Browser** mit pdf.js aus der gerenderten Seite ausgeschnitten (funktioniert auch bei gescannten PDFs). Kein Anthropic/Claude in diesem Pfad. Überschreibbar per Function-Secrets `VERTEX_MODEL`, `VERTEX_REGION`, `VERTEX_PROJECT`.
- **Zugriff:** nur angemeldete Nutzer mit Rolle Creator/Freigeber/Admin (Session wird in der Function geprüft). Limit 60 Analysen pro Workspace und 24 h. Jeder Aufruf landet in `public.ai_usage` (Nutzer, Workspace, Modell, Region, Bytes, Tokens, Erfolg/Fehler) – lesbar für Admins des Workspace.
- **pdf.js 3.11.174** liegt unter `vendor/pdf.min.js` + `vendor/pdf.worker.min.js` (Apache-2.0), wird erst beim ersten Import geladen und vom Service Worker gecacht. **Beide Dateien mit hochladen.**
- Live getestet mit `tests/sample_ai.pdf` (3 Seiten, 3 Kapitel, 4 Abbildungen, 2 Warnhinweise, Änderungshistorie): 6 Schritte, Kapitel und Warnungen korrekt, Bildrahmen auf wenige mm genau, Änderungshistorie ignoriert; ~2.400 Tokens rein / ~600 raus. Die echte Antwort liegt als Fixture in `tests/pdf_ai_response.json` (Test `pdftest_ai`, läuft ohne Cloud).
- Offen (manuell in Google Cloud): Budget-Alarm (~50 €/Monat), optional Org-Policy „Ressourcenstandort nur EU“ fürs ISO-Audit.

## v0.27 – Design-Runde: Dashboard, Editor, Web-Anleitung
- **Dashboard:** „Zuletzt bearbeitet“ (4 Karten, am Handy horizontal wischbar) als erste Reihe; KPI-Zeile am Handy ausgeblendet; Projektkarten am Handy einspaltig mit großem Cover; Status als Farbbalken (Veröffentlicht mint / In Prüfung blau / Entwurf grau) + eine Textzeile statt Chips.
- **Editor:** Thumbnails 84×64 mit ▶-Dauer-Badge; Kapitel als farbige Trenner (6 Farben rotierend), Schritte eines Kapitels mit dezenter Farbkante; am PC ist die rechte Bühne sticky.
- **Web-Anleitung:** ohne Checkliste und ohne Kapitel eine ruhige Startkarte (Logo, Bild, Titel, „Los geht’s“ – kein Namensfeld); Kapitel-Übersicht mit Fortschrittsring (Checkliste); „Erledigt“ mit kurzem Haken-Sprung; Ende-Screen mit großem Firmenlogo auf heller Fläche.

## v0.26 – Sicherheit, QR-PDFs, Feinschliff
- **0.26.1:** Viewer-Fortschrittsbalken deutlich (7 px, Leuchtkante, Zeit-Chip „0:02 / 0:04“); Login: Namensfeld hinter „Neu hier? Namen angeben“; Dashboard am Handy: nur „Neue Anleitung“, Statistik/Papierkorb/Admin/Branding hinter ⋯; `hs_sync_secret` rotiert.
- **Sicherheit (Supabase-Advisor):** 15 `SECURITY DEFINER`-Funktionen waren über die REST-API für jeden mit dem Publishable-Key aufrufbar – darunter `get_hubspot_token()` (HubSpot-Token!), `get_hs_secret()`, `hs_all_users()` (alle Nutzer-Mails), `instr_pw_hashes()`, `purge_trash()`. Jetzt: `REVOKE EXECUTE` für `anon`/`authenticated`/`public` auf allem außer `open_instr` und `instr_locked` (die der öffentliche Viewer braucht) und `my_ws/my_role/my_admin` für eingeloggte Nutzer (RLS-Helfer). Secrets/HubSpot nur noch für `service_role` (Edge Functions). Trigger-Funktionen für niemanden aufrufbar. Default-Privilegien so gesetzt, dass **neue Funktionen nicht mehr automatisch öffentlich** sind. `search_path` gepinnt. Anonyme sehen an `workspaces` nur noch `ws, brand` – keine Team-Mails, Einladungen, Einstellungen. Verifiziert per REST-Test: Token-Endpoint → 401, Viewer-Brand → 200. **Offen (manuell): HubSpot-Private-App-Token rotieren** (war seit Anlage abrufbar) und im Vault als `hubspot_token` ersetzen.
- **QR-PDF pro Anleitung** (`pdf/fonts.js`): Karte neu – weiße Karte mit Farbstreifen, Kundenlogo in eigenen Proportionen ohne weißen Kasten, Bild als Cover-Crop (nie verzerrt), Titel, Meta, optional **Versionskommentar** (letzter Freigabe-Kommentar, Option im Teilen-Dialog), unten immer GIRI-Logo + go.ar-giri.de. Kartenhöhe passt sich dem Inhalt an. Projekt-Poster: gleicher Header-Stil, GIRI-Fußzeile auf jeder Seite. GIRI-Wortmarke liegt unter `icons/giri-logo.png` (**mit hochladen**).
- **Feinschliff:** Dialoge am Handy als Bottom-Sheet mit Griff, größere Touch-Ziele, Fokus-Ringe, Skeleton-Loading statt Spinner, haptischer Tick auf Primär-Buttons, `prefers-reduced-motion`.

## v0.25.2 – Ladezeit II, Editor am Handy aufgeräumt
- **Ladezeit, zweite Runde:** Bei jedem Seitenwechsel wurden bisher **alle lokal gespeicherten Clips** aus IndexedDB gelesen (Upload-Queue + Status-Pille, je einmal) – auf einem Handy mit vielen Aufnahmen etliche MB pro Klick. Jetzt gibt es eine kleine Liste der wartenden Uploads (`gg_pend_media` in localStorage, `state.js`); die Queue liest nur noch diese Clips. Anleitungs-Spiegel wird pro Ladevorgang einmal gelesen statt dreimal. Offline-Status prüft nur Schlüssel (`DB.has`), keine Inhalte.
- **Viewer lädt Medien lazy:** nur die Schritte um den sichtbaren herum (±1,5 Bildschirme), weiter entfernte werden wieder freigegeben. Vorher zog eine Anleitung mit 12 Clips alle 12 auf einmal.
- **Poster klein:** neue Poster werden vor dem Upload auf 320 px / q 0,62 verkleinert (statt bis 130 KB).
- **Editor am Handy:** Titel, darunter Status · Version · Schrittzahl; eine Aktionszeile „Aufnehmen | Zur Freigabe | ↶ | ⋯“; Tabs volle Breite; Link/QR · PDF · Statistik nur noch im ⋯-Menü; Tastatur-Hinweis weg; „Schritt hinzufügen“ als drei gleich große Kacheln (Aufnehmen · Bilder/Videos · Kapitel).

## v0.25.1 – Verlorene Clip-Links
- **Symptom:** Einzelne Video-Schritte blieben im Viewer schwarz. Der Clip lag im Storage, aber die Anleitung hatte keine `mediaUrl` mehr: Ein zweites Gerät (z. B. der PC mit der Poster-Migration) hatte die Anleitung mit einer veralteten Kopie gespeichert, nachdem das Handy den Clip hochgeladen hatte – letzter Schreiber gewinnt.
- **DB-Trigger `instr_keep_media`:** Beim Speichern übernimmt der Server `mediaUrl`/`mediaPath`/`posterUrl` aus der alten Zeile, wenn die neue sie für denselben `mediaId` nicht hat. Damit kann kein Gerät mehr einen hochgeladenen Clip „vergessen“. Betroffene Zeilen wurden repariert.
- Poster-Migration arbeitet jetzt auf einer frischen Server-Kopie statt auf dem Objekt im Speicher; `saveInstr` ergänzt URLs, die dieses Gerät selbst hochgeladen hat.

## v0.25 – Mitlaufende Symbole, Install-Banner, App-Feinschliff
- **Symbole laufen im Video mit** (Option, `annotations/track.js`): Im Editor bei einem Video-Schritt → Symbol wählen → Zeile „Video“: **Fest** (wie bisher: Video hält 1 s an) oder **📍 Mitlaufen**. Dann verfolgt die App die Stelle, auf die das Symbol zeigt (Pfeilspitze bzw. Mitte), Bild für Bild bis zum Clip-Ende – Block-Matching auf einem verkleinerten Graubild, komplett im Browser, ca. 3–8 s Rechenzeit. Ergebnis liegt als `a.track = {t0, dt, pts}` (Verschiebungen alle 0,1 s) am Symbol. Im Viewer bleibt so ein Symbol ab seinem Zeitpunkt sichtbar und wandert mit; das Video hält dafür nicht an. Verliert der Tracker die Spur (schneller Schwenk, Verdeckung), läuft das Symbol bis dahin mit – Toast sagt wo. 3D-Neigung/Drehung und Animationen bleiben kombinierbar. Alle anderen Symbole verhalten sich wie bisher.
- **Viewer-Text** größer: Titel 24 px fett, Beschreibung 17 px, Warnhinweis 15 px; Textblock max. 55 % der Höhe, scrollt bei Bedarf.
- **Statusleiste/Overscroll** am Handy: Bereich über der Kopfzeile ist jetzt schwarz (kein weißer Streifen beim Ziehen), Pinch-Zoom der ganzen App ist aus (Viewport + Gesten-Sperre; Editor-Pinch am Symbol bleibt).
- **Install-Banner** am Handy (Dashboard + Login): blauer Kasten oben, „Jetzt einrichten“ → nativer Prompt (Android) oder bebilderter Guide; „×“ schweigt 7 Tage.
- **Service Worker** (`sw.js`): gebaute Dateien (`assets/`, `fonts/`, `vendor/`) werden jetzt cache-first geladen – der Start braucht keinen Round-Trip zu GitHub Pages mehr; alte Builds fliegen beim nächsten Release aus dem Cache. **sw.js muss mit hochgeladen werden.**
- Tests: `tracktest` (synthetisches Video `tests/move.webm`, Pfeil folgt dem Quadrat auf ±3 %), Test-Server kann Range-Requests (nötig zum Seeken).

## v0.24.1 – Ladezeit
- **Ursache:** Die Vorschaubilder (Poster) jedes Schritts lagen als Data-URL **in der Anleitung selbst** – 30–130 KB pro Schritt, im Workspace ar-giri.com 3,2 MB. Jeder Seitenaufruf hat die komplette Tabelle geladen (und jede Speicherung im Editor die ganze Zeile hochgeladen, bis 1,2 MB).
- **Delta-Sync** (`core/translate.js` → `loadInstrs`): Der Server wird nur nach `id, updated_at` gefragt (ein paar Bytes je Anleitung); komplette Zeilen kommen nur für das, was sich seit der lokalen Kopie geändert hat. Unveränderte Anleitungen behalten ihr Objekt im Speicher.
- **Poster in Storage** (`core/posters.js`): Neue Schritte bekommen `posterUrl` (kleines JPEG unter `<ws>/<instr>/<media>.poster.jpg`), sobald das Medium hochgeladen ist. Alte Anleitungen werden im Hintergrund migriert (Creator/Admin, online, eine Anleitung nach der anderen) – `poster` verschwindet aus der Zeile. Offline-Kopien für Werker speichern die Poster mit.
- Dashboard-Thumbnails decodieren kein Video mehr, wenn ein Poster da ist. Workspace und Anleitungen laden parallel.
- Test `perftest`: nach dem ersten Laden nur noch `id, updated_at`-Abfragen; Migration setzt `posterUrl`.
- Bleibt (nicht änderbar ohne `sw.js`): JS/CSS (~140 KB gzip) kommen bei jedem Start von GitHub Pages, Supabase-Client + Schriften aus dem CDN-Cache.

## v0.24 – Login am Handy, Kamera-Kopfzeile
- **Installierte App (Home-Bildschirm):** Der Link aus der Mail öffnet auf dem iPhone immer Safari, nie die App – das ist iOS-seitig so und nicht umgehbar (ohne native App). Deshalb ist in der installierten App der **Code der Hauptweg**: nach „Loslegen“ steht „Code an … gesendet“, das Code-Feld ist groß und fokussiert. Auf Android teilt sich die App den Speicher mit Chrome – dort funktioniert der Link weiterhin (Session wird beim Zurückwechseln übernommen).
- **Mail-Vorlage** `supabase/email-magic-link.html` neu: Code zuerst und groß, Button „Im Browser anmelden“ danach, Hinweis für App-Nutzer. In Supabase → Authentication → Email Templates → Magic Link erneut einfügen (Betreff: `GIRI Go – Dein Code: {{ .Token }}`).
- Wer sich auf dem iPhone per Link im Browser anmeldet, bekommt einmalig den Hinweis, dass die App den Code braucht.
- **Login-Screen:** grüne „GIRI Go“-Zeile über dem Bild weg, Bild am Handy kleiner, in der installierten App ganz ohne Bild.
- **Kamera:** Titel oben links entfernt (nicht mehr dort editierbar), stattdessen Schrittzahl links und „Fertig“ rechts oben; unten nur noch Auslöser + Kamerawechsel.

## v0.23 – Offline für Werker, Installations-Guide, Team-Filter, Sitzungsdauer
- **Offline-Anleitungen**: Jede Anleitung, die ein Werker öffnet, wird automatisch komplett aufs Gerät gespeichert (Schritte, Clips, Fotos, Logo, Symbole – IndexedDB, Store `vcache` + `media` mit `cache:true`). Ohne Netz öffnet der Link die Kopie; bei langsamem Netz kommt die Kopie sofort und die Serverversion zieht nach („Neuere Version – Aktualisieren“). Pill unten: „Wird gespeichert 3/12“ → „Offline verfügbar“. Im Seitenmenü: Status + „Vom Gerät entfernen“. Kopien, die 90 Tage nicht geöffnet wurden, räumen sich selbst auf.
- **Startseite ohne Login** zeigt „Auf diesem Gerät gespeichert“ – die installierte App ist damit für Werker sofort nützlich.
- **Installations-Guide** (`installGuide()` in `app/pwa.js`): bebilderte 3 Schritte für iPhone (Teilen → Zum Home-Bildschirm → Hinzufügen), Android (⋮ → App installieren → Installieren, oder direkt per nativem Prompt) und PC. Erreichbar über Dashboard-Hinweis („So geht’s“), Profil, Viewer-Menü, Ende der Anleitung und die gespeicherte Liste.
- **Team-Filter** im Dashboard: Chips „Alle · Team A · Team B · Ohne Team“. Nicht-Admins sehen nur die Teams, in denen sie selbst sind – auch auf den Projekt-/Anleitungskarten. Auswahl bleibt pro Sitzung (`gg_team`).
- **Sitzungsdauer**: Nutzer bleiben standardmäßig 14 Tage angemeldet (Zeitpunkt der Anmeldung in `gg_login_at`), danach automatische Abmeldung. Admin ändert den Wert im Admin-Panel → `workspaces.settings.sessionDays` (Trigger `ws_settings_guard`: nur Admins dürfen `settings` ändern).
- DB: `workspaces.settings jsonb` (siehe `supabase/schema.sql`), IndexedDB-Version 2.
- **0.23.1 Hotfix:** Ein noch offener Tab mit der alten Version blockierte das IndexedDB-Upgrade (v1→v2) – die App hing im Spinner. Jetzt: nach 3 s Speicher-Fallback, automatischer Neuversuch, Verbindungen schließen sich bei künftigen Upgrades selbst (`onversionchange`). Test `dbblock`.

## v0.22 – Offline-Härtung
- **Lokale Kopie:** Anleitungen, Profil und Workspace werden auf dem Gerät gespiegelt. Ohne Netz startet die App trotzdem, zeigt die lokale Kopie („Kein Netz – du siehst die lokale Kopie“) und man kommt in Aufnahme und Editor.
- **Speicher-Warteschlange:** Jede Änderung (auch die Schrittliste nach einer Aufnahme) wird zuerst lokal gespeichert und dann zum Server geschickt. Schlägt das fehl, bleibt sie als „ausstehend“ markiert und wird automatisch nachgeschoben – sobald Netz da ist, bei jedem Seitenwechsel, nach jedem Clip-Upload.
- **Status-Pille** unten: „Offline · 2 Aufnahmen, 1 Änderung – werden hochgeladen, sobald Netz da ist“ bzw. „… warten auf Upload · tippen zum Wiederholen“. Beim Schließen der Seite mit ausstehenden Uploads fragt der Browser nach.
- **Aufnahmen ohne Anleitung:** Papierkorb-Seite listet Clips, die auf dem Gerät liegen, aber in keiner Anleitung mehr stehen – „Als Schritt anhängen“ (an die ursprüngliche oder eine gewählte Anleitung) oder löschen.
- Clips lagen schon vorher zuerst lokal und wurden im Hintergrund hochgeladen; das bleibt so. Auf iPhones die App installieren (Home-Bildschirm), sonst räumt iOS Browser-Speicher nach 7 Tagen Nichtbenutzung weg.

## v0.21 – Feedback-Runde
- **Papierkorb:** Gelöschte Anleitungen landen 30 Tage im Papierkorb (Dashboard → Papierkorb): wiederherstellen oder endgültig löschen; öffentliche Links gelöschter Anleitungen sind sofort tot. Gelöschte **Schritte** liegen unten in der Schrittliste unter „Papierkorb“ (Medien bleiben erhalten) – zurückholen oder endgültig löschen. Backend: Spalte `deleted_at`, angepasste Policy und `open_instr` (bereits im Projekt), `purge_trash()` als Reserve.
- **Login-Link auf dem Handy:** Nach dem Klick auf den Link geht es sofort weiter – kein Tippen mehr nötig.
- **Auf anderem Gerät geändert:** Die geöffnete Anleitung aktualisiert sich automatisch, wenn gerade nichts getippt wird; sonst blauer Banner mit „Aktualisieren“. Beim Zurückkehren in den Tab wird zusätzlich geprüft, ob die Anleitung woanders weiterbearbeitet wurde (Websockets sterben in Hintergrund-Tabs). Projektseiten, Statistik und Papierkorb aktualisieren sich ebenfalls.
- **Editor:** Kopfzeile der Schrittliste ohne Importieren/Kapitel – beides sitzt in der Karte „Schritt hinzufügen“ (Aufnehmen · Bilder/Videos wählen · Kapitel). Der markierte Schritt hat ein Papierkorb-Symbol direkt in der Zeile. Das Kapitel des markierten Schritts ist immer aufgeklappt (z. B. nach der Aufnahme).
- **Aufnahme:** nur noch ein Ausgang (grüner Haken), kein Import-Knopf mehr; im „Schritt N ersetzen“-Balken gibt es Löschen.
- **Feedback:** Auf dem PC nur „Foto / Video wählen“; Aufnehmen-Knöpfe erscheinen nur auf Geräten mit Kamera-Aufruf.
- **Logo:** Endseite der Anleitung mit großem Logo ohne Rahmen (heller Schein auf dunklem Hintergrund), Startkarte und Kopfzeile etwas größer; PDF: Logo größer auf dem Deckblatt und klein in jeder Kopfzeile.
- Versionsnummer auch auf dem Handy in der Kopfzeile.

## Entwicklung & Release (ab v0.20)
- Der Code ist in **ES-Module** aufgeteilt (`src/`, siehe `src/README.md`) und wird mit **Vite** zu einer statischen Seite gebaut: `index.html` + `assets/` im Repo-Root. Diese beiden sind **generiert** – nicht von Hand ändern; Änderungen in `app/index.html` bzw. `src/`.
- Lokal: `npm install` → `npm run dev` (Live-Server) → `npm run build` (schreibt `index.html` + `assets/`) → `npm test` (Playwright-Suite gegen den gebauten Stand, Supabase gemockt; braucht ein installiertes Chromium, Pfad über `GG_CHROME=`).
- **Version hochzählen:** nur in `app/index.html` (`window.APP_VERSION = '…'`) – die App zeigt sie an und die Auto-Update-Prüfung vergleicht genau diese Zeile.
- **Release:** `npm run build`, dann alles außer `node_modules/` und `index3.html` ins Repo-Root laden (GitHub Pages liefert `index.html` + `assets/` aus). Alte Dateien in `assets/` dürfen liegen bleiben.
- Rückweg: jede ältere Version (z. B. das v0.19-ZIP) kann jederzeit wieder ins Root geladen werden – Datenbank und Speicher sind vom Code unabhängig.

## Setup (einmalig, ca. 10 Minuten)

### 1. Supabase-Schema anlegen
1. supabase.com → Projekt öffnen → **SQL Editor** → **New query**
2. Inhalt von `supabase/schema.sql` einfügen → **Run**
3. Ergebnis: Tabellen `profiles`, `instructions`, `runs`, Storage-Bucket `media`, alle Policies, Realtime.

### 2. Auth konfigurieren (Magic Link)
1. **Authentication → URL Configuration**
   - Site URL: `https://go.ar-giri.de/`
   - Redirect URLs: `https://go.ar-giri.de/**` hinzufügen (für lokale Entwicklung zusätzlich `http://localhost:5173/**`)
2. **Authentication → Providers → Email**: Enabled, „Confirm email" darf an bleiben (Magic Link bestätigt automatisch).
3. Für den Team-Einsatz nötig: **Authentication → Emails → SMTP Settings** eigenen Mailserver eintragen (aktuell Resend: Host `smtp.resend.com`, Port 465, User `resend`, Passwort = Resend-API-Key, Absender `giri-go@ar-giri.de`, „Minimum interval per user“ 60). Der eingebaute Mailversand ist auf wenige Mails pro Stunde begrenzt.
   - Damit die Mails schnell ankommen: In Resend die Domain `ar-giri.de` verifizieren (DNS: SPF, DKIM, DMARC – Status „Verified“). Ohne Verifizierung landen die Mails verzögert oder im Spam.
   - **Neue Nutzer bekommen die Mail „Confirm your email address“** (Supabase-Vorlage „Confirm sign up“, englisch, ohne Code), solange „Confirm email“ aktiv ist. Entweder in Authentication → Providers → Email „Confirm email“ **ausschalten** (dann bekommt jeder die GIRI-Vorlage mit Code) oder unter Authentication → Emails → Templates → „Confirm sign up“ den Inhalt von `supabase/email-magic-link.html` mit Betreff „GIRI Go: Dein Login-Link“ eintragen.
   - Fehler „Error sending magic link email“ beim Login = Supabase kommt nicht bei Resend rein. Ursache in den Supabase-Logs (Authentication → Logs): `535 Authentication credentials invalid` heißt Passwort/Username stimmen nicht exakt (Key ohne Leerzeichen einfügen, Username genau `resend`). Absenderadresse muss auf der verifizierten Domain liegen.
   - Diagnose bei Verzögerung: Resend → Emails zeigt pro Mail „sent“ → „delivered“ mit Zeitstempel. Meldet Resend sofort „delivered“, hängt die Mail im empfangenden Postfach (Google Workspace: Admin-Konsole → E-Mail-Protokollsuche).
   - Supabase → Authentication → Rate Limits: „Rate limit for sending emails“ bei eigenem SMTP z. B. auf 100/Stunde setzen.
   - Wer sich per Google/Microsoft anmeldet, braucht die Mail gar nicht (2b/2c).

### 2b. Google-Login (ab v0.14)
1. Google Cloud Console → APIs & Dienste → Anmeldedaten → **OAuth-Client-ID** (Webanwendung). Autorisierte Weiterleitungs-URI: `https://hcomtmogkuxxchrnticq.supabase.co/auth/v1/callback`. OAuth-Zustimmungsseite: „Extern“ + **In Produktion** (für die Scopes E-Mail/Profil ist keine Google-Prüfung nötig); solange sie auf „Testing“ steht, können sich nur eingetragene Testnutzer anmelden.
2. Supabase → **Authentication → Sign In / Providers → Google** → Enabled, Client-ID + Client-Secret eintragen → Save.
3. Fertig – der Button „Mit Google anmelden“ erscheint auf der Login-Seite automatisch, sobald der Provider aktiv ist (die App fragt `/auth/v1/settings` ab). Name kommt aus dem Google-Profil.

### 2c. Microsoft-Login (ab v0.15.1, für Kunden mit Microsoft 365)
1. Azure-Portal / Entra Admin Center → App-Registrierungen → **Neue Registrierung**: Name „GIRI Go“, unterstützte Kontotypen „Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten“, Redirect-URI (Web): `https://hcomtmogkuxxchrnticq.supabase.co/auth/v1/callback`.
2. Zertifikate & Geheimnisse → **Neuer geheimer Clientschlüssel** (Wert kopieren, wird nur einmal angezeigt). API-Berechtigungen: `email`, `openid`, `profile`, `User.Read` (Standard).
3. Supabase → **Authentication → Providers → Azure** → Enabled, Anwendungs-ID (Client) + Secret, Azure Tenant URL `https://login.microsoftonline.com/common` → Save. Button „Mit Microsoft anmelden“ erscheint automatisch.

### 2d. Workspace-Zuordnung bei SSO
- Firmen-Adresse (z. B. `@kunde.de`) → Workspace = Domain, wie beim Magic Link.
- Öffentliche Anbieter (gmail.com, outlook.com, gmx, web.de, icloud …) → persönlicher Workspace pro Adresse, damit fremde Gmail-Nutzer nie im selben Workspace landen.

### 3. Hosting (Cloudflare Workers, seit v12.39)
1. Repo `https://github.com/GIRIGO26/GIRI-GO`, Branch `main`; Cloudflare baut mit `npm run build:cf` (Ordner `dist/`) und veröffentlicht automatisch bei jedem Push.
2. Nach 1–2 Minuten erreichbar unter `https://go.ar-giri.de/`. Installierte Apps holen die neue Version beim nächsten Öffnen (Versions-Check im Service Worker).
3. Lokal: `npm run dev` (Vite, `http://localhost:5173`), Tests: `npm test`.

### 4. Erster Login
- App öffnen → E-Mail + Name eingeben → Link in der Mail antippen.
- Beim ersten Login legt die App eine Beispiel-Anleitung im Workspace an.
- Rolle (Creator / Prüfer / Betrachter) oben rechts über den Namen ändern.
- Workspace = E-Mail-Domain: alle mit `@ar-giri.com` sehen dieselben Anleitungen.

## Konfiguration
Supabase-URL und Publishable Key stehen oben in `index.html` unter `window.GIRI_CONFIG`. Das sind öffentliche Frontend-Keys; die Sicherheit liegt in den Row-Level-Security-Policies.

## Datenmodell
- `instructions` – eine Zeile pro Anleitung, Schritte/Kapitel/Symbole/Freigaben als JSON in `data`
- `runs` – eine Zeile pro Checklisten-Durchführung (Werker, Zeitstempel je Schritt, Nicht-OK-Notizen + Beweisfoto)
- Storage `media/<workspace>/<anleitung>/<id>.mp4|jpg` – Clips und Fotos; `media/runs/<run>/…` – Beweisfotos
- Clips werden erst lokal (IndexedDB) gespeichert und dann im Hintergrund hochgeladen (Fortschritt oben in der App).

## Rollen, Teams, Projekte (ab v0.9)
- Rollen: **Super Admin** (alles, inkl. Admin-Panel), **Creator** (aufnehmen, bearbeiten, freigeben), **Freigeber/Approver** (freigeben), **Betrachter**. Der erste Benutzer eines Workspace ist Super Admin. Admins laden Benutzer ein (Login-Link per Mail, Rolle vorab wählbar), vergeben Rollen, legen Teams an und ordnen Projekte Teams zu (Zahnrad oben rechts oder „Admin“ auf der Startseite).
- Startseite = Projektübersicht (Karten), „Alle Anleitungen“ als flache Liste. Im Projekt werden neue Anleitungen direkt im Projekt angelegt.
- Checklisten-Durchführungen werden schon während der Arbeit gespeichert (Status „läuft“ im Job-Done-Protokoll) und beim Abschließen finalisiert.
- **Projekte** (Ordner) organisieren Anleitungen. Ohne Team-Zuordnung sehen alle im Workspace das Projekt; mit Zuordnung nur die Team-Mitglieder (Rolle im Team gilt für die Anleitungen des Projekts).
- Veröffentlichte Links/QR-Codes funktionieren immer ohne Login. Die Projekt-Sichtbarkeit wird derzeit in der App geprüft (Datenbank-Regeln pro Projekt folgen).
- **Link-Passwort (ab v0.14):** Pro Projekt (Projektseite → „Passwort“) und/oder pro Team (Admin-Panel → Team → „Passwort“). Gesetzt = wer den öffentlichen Link öffnet, muss das Passwort einmal pro Gerät eingeben (Projekt-Passwort oder Passwort eines zugeordneten Teams). Standard: aus. Gespeichert wird nur ein Salted-SHA-256-Hash; geschützte Anleitungen sind für Anonyme auch per API nicht lesbar (`open_instr`-RPC prüft serverseitig). Hinweis: Die Medien-Dateien selbst liegen im öffentlichen Storage-Bucket und sind bei Kenntnis der Datei-URL weiterhin abrufbar.
- Ab v0.13 lassen sich auch einzelne Anleitungen Teams zuordnen (Editor → „Freigabe & Einstellungen“ → „Zugriff (Teams)“ oder Admin-Panel → „Zugriff (Teams)“). Die Team-Zuordnung der Anleitung gilt zusätzlich zu den Teams des Projekts; nichts angehakt = wie das Projekt.

## QR-Poster pro Projekt (v0.19)
- Projektseite → „QR-Poster“ (auch im „…“-Menü neben Umbenennen / Link-Passwort / Löschen): ein DIN-A4-PDF mit Kopfzeile in der Akzentfarbe (Logo, Firma, Projektname) und pro Anleitung einer Kachel: erstes Bild, Titel, großer QR-Code, Schritte/Version. Bis 4 Anleitungen groß in 2 Spalten, ab 5 in 3 Spalten, weitere Seiten automatisch.
- Optionen: nur veröffentlichte Anleitungen (Standard), mit/ohne Bild, mit/ohne Firma/Logo. Entwürfe und Anleitungen in Prüfung werden – falls mitgedruckt – als solche markiert (ihre Links funktionieren erst nach Veröffentlichung).
- Menü „…“ auf der Projektseite ersetzt die einzelnen Knöpfe für Passwort und Löschen.

## Werker-Feedback (v0.18)
- v0.18.1: Im Feedback-Dialog drei Wege für Medien – **Foto aufnehmen**, **Video aufnehmen**, **Aus Mediathek** (Bild oder Video importieren). Der separate „Anmerkung“-Knopf pro Schritt ist weg – ein Mechanismus pro Schritt (Feedback); Notiz + Foto gibt es weiterhin bei „Nicht OK“ im Job-Done-Protokoll.
- v0.18.1 Editor: Link/QR · PDF · Statistik stehen rechts neben den Reitern „Schritte / Freigabe & Einstellungen“; Reihenfolge in den Einstellungen: Checkliste → Modus → Feedback erlauben; „Zugriff (Teams)“ ist eingeklappt; bei den Übersetzungen steht, dass „PDF“ neben der Sprache das PDF in dieser Sprache lädt. Ein PDF in einer anderen Sprache schaltet die Oberfläche nicht mehr um.
- In jeder veröffentlichten Anleitung steht unter jedem Schritt und am Ende ein Feedback-Knopf (Sprechblase). Der Werker wählt **Anleitung verbessern** oder **Prozess verbessern**, schreibt einen Hinweis, hängt optional ein **Foto oder Video** an (Handy-Kamera) und schickt ab – ohne Login.
- Der Creator sieht offene Rückmeldungen als blaue Sprechblasen-Zahl auf der Anleitungs-Karte, als Banner im Editor und in der Statistik unter dem Reiter **Feedback** (mit Bild/Video-Vorschau).
- **Als Schritt übernehmen:** Foto oder Video aus dem Feedback wird direkt als neuer Schritt hinter dem Schritt eingefügt, auf den sich das Feedback bezieht (Text des Werkers als Beschreibung). Danach ist das Feedback automatisch „erledigt“. Ohne Medium: „Zum Schritt“ springt in den Editor. Außerdem „Erledigt“ / „Verwerfen“.
- Abschaltbar pro Anleitung: Freigabe & Einstellungen → „Feedback von Werkern erlauben“ (Standard: an).
- Backend: Tabelle `feedback` (Schema in `supabase/schema.sql`, bereits im Projekt angelegt), Medien im Bucket `media` unter `runs/fb/…` (gleiche Regel wie Beweisfotos).

## 3D-Symbole, Animation, Schritte importieren (v0.17)
- v0.18: Pfeile nochmals dünner (auch gedreht), Neigen/Drehen bis ±70°, „Hüpfen“ beim Pfeil zieht sich vom Ziel zurück und schnellt wieder auf den Punkt – die Spitze landet immer dort, wo sie gesetzt wurde.
- Symbole sind schlanker (dünnere Pfeile, Ringe, Rahmen, weniger Tiefe) – wirken filigraner, bleiben aber gut lesbar.
- **3D:** Symbol antippen → unter dem Chip erscheinen die Regler **Neigen** (kippt nach vorn/hinten) und **Drehen** (dreht nach links/rechts, ±60°). Der Pfeil dreht sich um seine Spitze, alles andere um die Mitte; die Seitenwand folgt der echten Perspektive. „Flach“ setzt zurück. Gilt für Pfeil, Kreis, Rechteck, Text, Warnschilder und eigene Symbole; Nummern/Häkchen/Kreuz (Kugeln) und Emojis bleiben rund.
- **Animation** pro Symbol: Keine · Pulsieren (atmet) · Hüpfen (zwei kurze Hüpfer Richtung Ziel, dann Pause) · Blinken (zweimal, dann Pause). Läuft im Editor und in der Anleitung (auch wenn das Video für die Symbole anhält); im PDF steht das Symbol still.
- **Schritt hinzufügen:** Am Ende der Schrittliste steht eine Karte mit „Aufnehmen“ und „Bilder / Videos wählen“ (Handy: Fotomediathek, mehrere auf einmal). Jede Datei wird ein Schritt, angehängt am Ende. Am PC weiterhin: Dateien auf die Seite ziehen (Einfügen nach dem markierten Schritt).
- Gespeichert wird pro Symbol `tx`/`ty` (Grad) und `anim` – ältere Anleitungen bleiben unverändert (flach, ohne Animation).

## Design & Bedienung (v0.16)
- Dashboard: Kennzahlen als ruhige Zeile statt vier Kacheln; Projekte als Cover-Karten (Bilder der Anleitungen, Name und Anzahl im Bild, Schloss bei Link-Passwort); Anleitungs-Karten mit drei klaren Aktionen (Bearbeiten · Nächsten Schritt aufnehmen · Link/QR) und „…“-Menü für Vorschau, PDF, Statistik, Verschieben, Löschen. Klick auf die Karte öffnet die Anleitung.
- Kopfzeile: Avatar mit Initialen statt Name+Rolle; Profil-Sheet zeigt Name, E-Mail, Rolle, Version. Abmelden liegt im Profil.
- Aufnahme: Zeit und Bewertung („Perfekt“ · „Wird lang …“ · „Zu lang“) stehen als Pille **über** dem Auslöser, nicht mehr darunter – bleibt beim Halten lesbar.
- Editor: unscharfer Bildhintergrund hinter Querformat-Medien wie im Viewer; Kapitelnamen in der Liste mit Auslassungspunkten.
- Kleinigkeiten: Escape schließt jeden Dialog, Seiten blenden weich ein, Ein-/Mehrzahl bei „1 Schritt“/„2 Schritte“, Kapitel-Kacheln mit Fortschrittsbalken sobald eine Checkliste aktiv ist.

## Design & Bedienung (v0.15)
- Komplett überarbeitetes Stylesheet (ein Designsystem statt gewachsener Schichten): ruhigere Flächen, Hairline-Karten, 12-px-Radien, konsistente Buttons (Mint = die eine „Los“-Aktion, Blau = Primäraktion, Weiß = sekundär), lesbare Kontraste im Viewer, unscharfer Bildhintergrund statt schwarzer Balken bei Querformat-Medien auf dem Handy.
- Editor: Werkzeuge als gruppierter Block (Markieren · Status · Sicherheit · Bilder), nie mehr seitlich scrollen; Formatleisten stehen unter den Textfeldern; Titel des Schritts und Anleitung in voller Breite.
- Symbole in Pseudo-3D: Pfeile und Rahmen als Blöcke mit Tiefe, Nummern/Häkchen/Kreuze als glänzende Kugeln, Warnschilder mit Kante – in Bild, Video, Viewer und PDF identisch.
- Login: nach „Loslegen“ ein Warte-Screen mit Code-Eingabe und Countdown für „Erneut senden“ (90 s) – ein neuer Link macht den alten ungültig, deshalb wird nicht mehr sofort nachgefordert. Google-Login erscheint automatisch, sobald der Provider in Supabase aktiv ist.

## Titel formatieren (ab v0.14)
- Schritt-Titel haben eine Mini-Leiste: **B** (fett), 🔗 (Link), 🔒 (nicht übersetzen). `==M6==`, `**fett**` und Links funktionieren in Schritt-, Kapitel- und Anleitungstiteln (Viewer, Listen, PDF als Klartext).

## Video-Symbole (ab v0.14)
- Jedes Symbol gehört zu genau einem Zeitpunkt (grüne Marke auf der Zeitleiste, weiß = ausgewählt). Im Editor ist es nur sichtbar, wenn der Abspielkopf ±0,3 s daneben steht; wer den Abspielkopf wegzieht, sieht es nicht mehr – so wie später der Werker (Video hält dort 1 s).

## Übersetzungen
- Ein Link für alle Sprachen: Der Werker wählt oben in der Anleitung die Sprache (Flagge). Die Übersetzung läuft live über die Edge Function `translate` (DeepL, Key im Vault) und wird in der Anleitung zwischengespeichert.
- Text zwischen `==` und `==` wird nicht übersetzt (z. B. `==M6==`). `**fett**`, Listen (`- ` / `1. `) und Links `[Text](https://…)` bleiben erhalten.
- Die App-Oberfläche selbst gibt es in Deutsch und Englisch; jede weitere Sprache (FR, ES, IT, NL, PL, CS, TR, PT, RO, HU) wird beim ersten Wechsel einmal per DeepL übersetzt, serverseitig in `ui_tx` zwischengespeichert und auf dem Gerät gemerkt (Sprachmenü oben rechts, im Viewer über die Flagge).

## PDF in jeder Sprache
- PDF-Button → Sprachauswahl mit allen 13 Sprachen (inkl. Chinesisch). Fehlende Übersetzungen werden vorher per DeepL erstellt und in der Anleitung gespeichert.
- Aufbau (ab v0.13): Deckblatt (Titel, Dokumentenlenkung, Kapitelverzeichnis mit Seitenzahlen, Historie), jedes Kapitel auf einer neuen Seite, pro bestätigungspflichtigem Schritt ein Kästchen „Bestätigt“, Unterschrift nur einmal ganz am Ende, GIRI-Go-Logo oben rechts und Dokument-Nr./Seite unten auf jeder Seite, Schrift Montserrat.
- Schriften liegen im Repo unter `fonts/` (Montserrat für alle europäischen Sprachen, Noto Sans SC für Chinesisch) und werden beim ersten Export geladen.

## Checkliste
- Modus je Anleitung (Einstellungen): **Jeder Schritt**, **Nur pro Kapitel** (eine Bestätigung am Ende jedes Kapitels) oder **Nur markierte Schritte** (im Schritt „Bestätigung nötig“ ankreuzen). Zähler, Job-Done-Protokoll, Auto-Abschluss und PDF-Kästchen richten sich nach den bestätigungspflichtigen Schritten.
- Jeder Schritt hat neben „Erledigt / Nicht OK“ einen Notiz-Button: Anmerkung und Foto sind bei jedem Schritt möglich, nicht nur bei „Nicht OK“.
- Sprache lässt sich schon auf dem Start-Screen („Bereit?“) über die Flagge wählen.
- Sind alle Schritte bestätigt, wird die Durchführung beim Verlassen automatisch abgeschlossen; beim Wiedereinstieg mit allem bestätigt bietet die App direkt „Abschließen“ an.

## Kapitelübersicht & Kapitel-Links (ab v0.13)
- Hat eine Anleitung mehr als ein Kapitel, startet der Viewer mit einer Kapitelübersicht (Kacheln mit Vorschaubild, Schrittzahl, Fortschritt). Ein Kapitel → direkt in die Anleitung.
- Kapitel sind direkt verlinkbar: `…#/v/<id>/1`, `…#/v/<id>/2` usw. (auch mit Sprache: `…#/v/<id>/2/en`). Beim Scrollen aktualisiert sich die URL auf das aktuelle Kapitel; die Übersicht ist über den Titel oben oder das Menü jederzeit erreichbar.

## Eigene Symbole (ab v0.13)
- Editor → Werkzeug „Eigene“ → „Hochladen“: PNG (mit Transparenz), JPG, WebP oder SVG. Bilder werden im Browser auf 512 px verkleinert, als PNG nach `media/<workspace>/symbols/` geladen und in `workspaces.symbols` für den ganzen Workspace gespeichert (Mehrfachauswahl möglich, Löschen über das × in der Bibliothek).
- Darstellung je Symbol umschaltbar (Chip unter dem Bild): **Leuchten** (weißer Rand + farbiges Leuchten, ideal für transparente PNGs) oder **Sticker** (weiße Karte mit farbigem Rahmen, ideal für Fotos). Farbe über die Farbfelder, Größe/Drehung wie bei allen Symbolen. Gilt in Bild, Video, Viewer und PDF.

## Fotos & Videos importieren
- Editor: „Importieren“ im Schritte-Panel (Handy: Fotomediathek, Mehrfachauswahl) oder Dateien einfach auf die Seite ziehen (PC). Aufnahme-Screen: Import-Symbol oben rechts.
- Jede Datei wird ein eigener Schritt, eingefügt nach dem markierten Schritt, in Aufnahmereihenfolge (Datei-Datum). Fotos werden auf 1600 px verkleinert (JPEG), Videos unverändert übernommen (max. 80 MB, Anfangs-Trim 15 s).
- iPhone-Videos im HEVC-Format laufen nur in Safari. Für die Bearbeitung am PC in den iPhone-Einstellungen unter Kamera → Formate „Maximale Kompatibilität“ wählen.

## Als App installieren (PWA)
- Android/Chrome/Edge: Beim ersten Öffnen erscheint „Als App installieren“ (auch im Profil-Menü). iPhone/iPad: Safari → Teilen → „Zum Home-Bildschirm“.
- Dateien im Repo: `manifest.webmanifest`, `sw.js` (Service Worker: App-Shell offline, Bibliotheken gecacht, Daten immer live), `icons/`.
- Neue Version: einfach alle Dateien aus dem Release-Ordner hochladen (überschreiben). `sw.js` muss nicht angepasst werden – die App holt `index.html` immer frisch (HTTP-Cache wird umgangen).
- Ab v0.14 aktualisiert sich die installierte App selbst: Bei jedem Wechsel in die App (und alle 30 min) wird die Version geprüft; auf Startseite/Projekt/Admin/Statistik/Login und im Viewer vor dem Start wird sofort neu geladen, mitten in Editor, Aufnahme oder Checkliste erscheint der blaue Hinweis „Neue Version“ und der Reload passiert beim nächsten Wechsel zur Startseite.
- Login in der installierten App: Wird der Magic Link im Browser geöffnet (Android/Desktop teilen den Speicher mit der App), übernimmt die App die Anmeldung beim nächsten Öffnen automatisch. Auf dem iPhone sind Safari und Home-Bildschirm-App getrennt – dort den Code aus der Mail eingeben (wird bei 6 Ziffern automatisch geprüft).
- Login in der installierten App: Der Magic Link öffnet sich im Browser, nicht in der App. Deshalb gibt es im Login ein Code-Feld. Die Vorlage für die Login-Mail liegt in `supabase/email-magic-link.html` (Supabase → Authentication → Email Templates → Magic Link, Body komplett ersetzen).

## HubSpot-Sync (ab v0.14)
- Kontakt-Eigenschaften in HubSpot: `GIRIGO-ID` (Benutzer-ID), `GIRIGO-LastInstructionCreated` (Datum der neuesten Anleitung), `GIRIGO-NumberOfInstructionViews` (Aufrufe aller Anleitungen dieses Benutzers). Abgleich per E-Mail: existiert der Kontakt, werden nur diese drei Felder aktualisiert; sonst wird ein Kontakt (E-Mail, Vor-/Nachname) angelegt.
- Läuft fast in Echtzeit: Datenbank-Trigger (neues Profil, neue Anleitung, neuer Aufruf) → `pg_net` → Edge Function `hubspot-sync` → HubSpot. Die Funktion berechnet die Werte immer frisch aus der Datenbank.
- Setup: HubSpot → Private App mit Scopes `crm.objects.contacts.read/write` → Token als Vault-Secret `hubspot_token` (Supabase → Integrations → Vault). Kompletter Neuabgleich aller Benutzer: `POST …/functions/v1/hubspot-sync` mit Header `x-giri-secret` (Vault `hs_sync_secret`) und Body `{"all":true}`.
- Kontakt vorhanden (Suche per E-Mail) → nur die drei Felder werden gesetzt; nicht vorhanden → Kontakt wird angelegt. Legt HubSpot ihn in derselben Sekunde selbst an (409), wird der bestehende Kontakt aktualisiert – keine Duplikate.

## Video-Konvertierung
- Jeder Clip wird im Browser (WebCodecs) zu H.264-MP4 mit max. 1280 px und ~2 Mbit/s konvertiert: Importe sofort beim Import, Aufnahmen (z. B. WebM von Android) im Hintergrund vor dem Upload. Geht auf iOS 16.4+, Chrome, Edge, Safari; wo WebCodecs fehlt, bleibt das Original.
- `login.jpg` ist das Bild rechts auf der Login-Seite (austauschbar, ca. 1600 px breit).


## v0.28.1 – GIRI-Leitfaden für den KI-Import
- Neuer Grund-Prompt („GIRI-Leitfaden“): eine Handlung pro Schritt (Video ≤ 5 s), Orientierung „Wo bin ich? Wo muss ich hin? Was tun?“, Titel 2–5 Wörter („Box öffnen“), Kapitel bei langen Anleitungen, Ton klar und leicht motivierend.
- Leitfaden vor dem Upload anpassbar (pro Gerät); Admins können ihn als Workspace-Standard speichern. Feste Regeln (nichts erfinden, Werte exakt) gelten immer.
- Neu pro Schritt: Aufnahme-Tipp 🎬 (was im Video zu sehen sein soll) – im Editor und in der Aufnahme sichtbar, wegklickbar.
- Modell: gemini-3.8-flash bevorzugt; in Frankfurt (europe-west3) noch nicht verfügbar → automatischer Rückfall auf gemini-3.5-flash in Frankfurt.

## v0.28.2 – Leere Schritte aus dem PDF-Import, Hintergrund aufgeräumt
- KI-Import: Schritte ohne Bild im PDF bleiben leer (keine künstliche Titelkarte mehr). Option im Prüfdialog: „Leer – später filmen“.
- Editor: leere Schritte mit gestricheltem Vorschaubild, Hinweis „N Schritte warten auf Aufnahme → Jetzt filmen“, Bühne mit Titel + 🎬-Hinweis und „Jetzt aufnehmen“.
- Kamera: Text-Karte oben (Schritt n von N · Kapitel, Titel, Beschreibung, Warnhinweis, 🎬). Startet automatisch beim ersten leeren Schritt und springt nach jeder Aufnahme zum nächsten leeren.
- Web-Anleitung/PDF/QR-Poster: leere Schritte zeigen „Bild folgt“ bzw. nur Text; Cover-Bild = erster Schritt mit Aufnahme.
- Hintergrund: Seite wächst jetzt mit dem Inhalt (vorher schwarze Streifen hinter langen Seiten, v. a. Editor und Freigabe & Einstellungen).
- Freigabe & Einstellungen am PC zweispaltig (Freigabe rechts), auf dem Handy Freigabe zuerst.

## v0.28.3 – Kapitel-Bug, Platzhalter-Bilder, KI konfigurieren
- **Bug:** Das erste Kapitel ließ sich nicht zuklappen (das Kapitel des ausgewählten Schritts wurde bei jedem Neuzeichnen wieder geöffnet). Jetzt öffnet es sich nur, wenn die Auswahl wechselt.
- **Kapitel auf dem Handy:** großer Pfeil (44 px), Antippen des Titels klappt zu/auf, statt drei winziger Knöpfe ein ⋯-Menü (Umbenennen, Nach oben, Nach unten, Löschen). Am PC bleiben die Knöpfe inline (32 px).
- **Platzhalter aus dem PDF:** Bilder aus dem Dokument sind Platzhalter (`placeholder:'pdf'`), bis der Schritt gefilmt ist. Editor: „PDF“-Marke auf dem Vorschaubild, Hinweisbalken über dem Bild mit „Jetzt aufnehmen“ / „Bild behalten“. Der Balken „N Schritte noch filmen“ zählt leere und Platzhalter-Schritte.
- **Kamera:** startet beim ersten noch zu filmenden Schritt; Text-Karte oben (Schritt n von N · Kapitel · Status, Titel, Beschreibung, Warnhinweis, 🎬-Tipp, kleines Dokument-Bild), ‹ › zum Springen, Antippen der Karte = eine Zeile (freie Sicht). Nach jeder Aufnahme automatisch zum nächsten offenen Schritt.
- **KI konfigurieren:** eigene Karte auf der Admin-Seite (`#/admin/ai`) mit dem Workspace-Leitfaden, Speichern/Standard. Erreichbar über „✦ KI konfigurieren“ im Dashboard (PC-Leiste und ⋯-Menü) sowie aus dem PDF-Import-Dialog.
- Fix: Freigabe-Zweispalter nur im Editor (nicht auf der Admin-Seite).

## v0.29.0 – Tempo: Dashboard ohne Wartezeit, Kaltstart aus dem Gerät, Mess-Protokoll
- **Dashboard:** Aufruf-Statistik und offenes Feedback wurden bisher bei jedem Aufruf **vor** dem Zeichnen nacheinander vom Server geholt (zwei Runden). Jetzt: letzte bekannte Zahlen sofort, beide Abfragen parallel im Hintergrund, frische Zahlen werden in die Karten eingesetzt.
- **Kaltstart (App neu geöffnet / Seite neu geladen):** Der lokale Spiegel vom letzten Besuch wird sofort gezeichnet (Modus „lokal“), der Server-Abgleich folgt im Hintergrund. Vorher: Profil → Liste → geänderte Zeilen → Workspace nacheinander, dann erst Bild.
- **App-Hülle (sw.js):** index.html kommt sofort aus dem Cache und wird im Hintergrund erneuert. Neue Version → Service Worker meldet es der Seite → Versionsprüfung → Neuladen zum sicheren Zeitpunkt. Aufrufe mit `?v=` umgehen den Cache. `reloadForUpdate` wartet jetzt auf das Leeren des Caches.
- **Mess-Protokoll `client_log`:** langsame Screenwechsel (> 1,5 s), jeder erste Screen nach dem Start und JS-Fehler landen mit Version, Gerät, Netzart (4g/3g, RTT) und Phasen (Login, Sync, Aufbau) in der Datenbank. Nur Einfügen für die App (auch Werker), Lesen nur für Admins des Workspace, automatisch weg nach 30 Tagen. Max. 40 Einträge pro Sitzung, nie blockierend.
- Live-Anzeige auf dem Gerät weiterhin: Versionsnummer 5× tippen → Chip mit den letzten Ladezeiten.
- Index `views(ws, instr_id)` für die Aufruf-Statistik.

## v0.30.0 – UX: Startseite, Editor und Begriffe
- **Begriffe:** „Projekt“ heißt jetzt überall **„Ordner“** (DE) / „Folder“ (EN). Ein Ordner enthält Anleitungen – das versteht jeder ohne Erklärung. Nur Texte in `i18n.js`, Datenmodell unverändert (`folder`).
- **Startseite:** Anleitungen sind der Inhalt (Liste, sortiert nach letzter Änderung, Status als farbige Kante). Ordner sind eine Filterleiste darüber („Alle · 📁 Linie 3 · … · +“), kein eigener Tab und keine großen leeren Ordnerkarten mehr. Ordner-Ansicht `#/p/<id>` = dieselbe Liste, gefiltert, mit Ordnername als Überschrift und ⋯ (QR-Poster, Umbenennen, Passwort, Löschen).
- **Weniger Knöpfe:** Kopfzeile nur „Neue Anleitung“ + ⋯ (Statistik, Papierkorb, Neuer Ordner, Branding, Verwaltung, KI). KPI-Zeile, Tabs, „Zuletzt bearbeitet“ und die vier Knöpfe pro Karte sind weg – Karte antippen = öffnen, ⋯ = alles andere. Team-Filter nur, wenn es mindestens zwei Teams gibt. „N Anleitungen warten auf Freigabe“ als Hinweis-Filter für Freigeber. Suche ab 9 Anleitungen.
- **Neue Anleitung:** ein Dialog mit Titel, Ordner-Auswahl und „Aus PDF erstellen“ (vorher zwei Dialoge).
- **Editor Kopfzeile:** Aufnehmen · Zur Freigabe · ⋯. Rückgängig **und neu: Wiederholen** im ⋯-Menü (Tastatur: Strg+Z / Strg+Shift+Z bzw. Strg+Y).
- **Editor auf dem Handy:** zwei Screens statt einer langen Seite. Screen 1 = Schrittliste. Schritt antippen → Screen 2 = nur dieser Schritt: Leiste „‹ Schritte · 2 von 5 · ‹ › · ⋯“, Bild, Markierungen, Texte. Kopfzeile der Anleitung wird dabei ausgeblendet. ⋯ an der Leiste = Neu aufnehmen, Danach aufnehmen, Datei ersetzen, Schritt löschen. Tabs sind auf dem Handy weg; „Freigabe & Einstellungen“ über ⋯, mit „‹ Schritte“ zurück.
- **Werkzeuge auf dem Handy:** ein Knopf „Ins Bild markieren“ öffnet ein Blatt mit allen Symbolen (Pfeil, Kreis, Text, Warnung …) – statt 12 Knöpfen dauerhaft im Blick. Am PC bleiben die Gruppen sichtbar.
- **Warnhinweis** ist eingeklappt, solange leer („⚠ Warnhinweis hinzufügen“).
- Tests an die neue Struktur angepasst (Ordner-Chips, Karten-Menü, Tabs auf dem Handy).

## v0.30.1 – Aufnahme-Screen entrümpelt
- **Karte zum Schritt** ist standardmäßig kompakt (~150 px): „1/5 · Kapitel · offen/PDF“, Titel, je eine Zeile Warnhinweis und 🎬-Tipp, „mehr ›“. Antippen = alles (Beschreibung, volle Texte, Bild aus dem Dokument). ‹ › und × sitzen in der Kopfzeile der Karte, der Papierkorb ist aus der Kamera raus (Löschen im Editor).
- **Status-Schilder:** Upload-Fortschritt und „Offline · 3 warten“ sind in der Kamera kleine Chips oben in der Mitte – nicht mehr über Karte oder Auslöser. Auf normalen Seiten bleibt der ausführliche Text. Hinweis-Toasts erscheinen in der Kamera oberhalb der Vorschauleiste.
- **„Tippen = Foto · Halten = Video“** nur bei den ersten fünf Aufnahmen auf dem Gerät; danach erscheint das Schild nur während der Aufnahme (Timer, „wird lang“).
- Alte Karten-Regeln aus `06-editor.css` entfernt; alle Kamera-Regeln liegen in `05-capture.css`.

## v0.31.0 – Update-Fehler behoben, Premium-Look
- **Bug (seit 0.29):** Die App-Hülle kommt aus dem Cache – und die interne Versionsprüfung bekam denselben Cache zurück statt der Datei vom Server. Neue Releases wurden daher nicht erkannt. Jetzt geht die Prüfung immer ins Netz (`?v=check…`, im Service Worker: jede Nicht-Navigation zu index.html = Netz zuerst) und der Service Worker meldet eine neue Hülle mit Wiederholversuchen an die Seite. Test `tests/swtest.mjs` simuliert den Service Worker.
- **Premium-Pass (CI 75/20/5):** Schwarz/Weiß tragen die Oberfläche, Blau ist Akzent (Auswahl, zweite Aktion, Links), Mint nur noch für Erfolg/Veröffentlicht/Fortschritt. Hauptaktionen (Neue Anleitung, Aufnehmen, Loslegen, Fertig …) sind schwarz bzw. in der Kamera weiß. Engere Radien (14/12/8), Hairline-Ränder, ruhige Schatten, Überschriften 700 statt 800, Chips schwarz statt blau, Beispiel-Tag neutral.
- **Login:** Bild als Hero mit Botschaft „Weniger erklären. Mehr machen.“ (Kicker „GIRI Go“), Formular mit schwarzem „Loslegen“. Der Installations-Banner erscheint erst nach der Anmeldung.
- Alle Regeln liegen in `src/styles/09-premium.css` (überschreibt gezielt), Kamera-„Fertig“ weiß, Auswahlrahmen in der Vorschauleiste weiß.

## v0.31.1 – Der Name ist GIRI
- Das Produkt heißt in der Oberfläche schlicht **GIRI** (kein „Go“-Badge, kein „GIRI Go“ in Texten, PDF-Fußzeilen, QR-Blatt, Installations-Hinweisen, App-Titel und Manifest). Projekt-/Ordnername und Domain `go.ar-giri.de` bleiben technisch unverändert.
- Absendername der Login-Mails: in Supabase (SMTP-Einstellung) auf „GIRI“ ändern, wenn Resend eingerichtet wird.

## v0.31.2 – Schrittwechsel ohne Flackern
- **Editor:** Einen Schritt anklicken (oder ‹ ›, Pfeiltasten) verschiebt nur noch die Markierung – die Liste mit ihren Vorschaubildern bleibt stehen. Vorher wurde die komplette Liste neu gebaut und jedes Bild kurz schwarz. Nur wenn der Schritt in einem zugeklappten Kapitel liegt, wird die Liste neu gezeichnet (das Kapitel öffnet sich). Der Papierkorb pro Zeile wird per CSS nur in der markierten Zeile gezeigt.
- **Vorschaubilder im Speicher:** Einmal aufgelöste Poster-Adressen merkt sich die App (`posterMem`); Listen, Kamera-Leiste und Dashboard-Karten setzen sie beim Zeichnen sofort statt nach einem asynchronen Datenbank-Lookup. Wird ein Medium ersetzt oder gekürzt, leert `posterCache.clear()` auch diesen Speicher.

## v0.32.0 – Import aus GIRI Classic
- **Admin → „Import aus GIRI Classic“** (auch im ⋯-Menü der Startseite, Route `#/admin/import`): Server-Adresse (vorbelegt `https://ar-giri.cloud`, Testserver `https://ar-giri.rocks`), E-Mail und Passwort des bisherigen GIRI-Kontos eingeben → Verbinden. Danach eine Liste aller Anleitungen, nach Projekt gruppiert, mit Status und Version; Projekte/Einzelne an- und abwählen, drei Optionen, „importieren“. Jede Anleitung bekommt eine Fortschrittszeile, Fehler pro Zeile mit „Nochmal“; am Ende „Weitere importieren“ (bereits importierte sind markiert und abgewählt).
- **Was übernommen wird:** Titel, Erstelldatum, Kapitel (Reihenfolge nach `position`, lose Schritte davor), Schritte mit Titel + Beschreibung, pro Schritt-Slot das beste Medium (Video vor Bild, größte Datei ≤ 120 MB; Qualitätsvarianten mit gleichem `pattern-slot-index` zählen als eins), Schritt-Symbole als Workspace-Symbole (einmal kopiert, per `oldId` wiederverwendet) als Sticker auf dem Schritt, das alte Projekt als Ordner (gleichnamiger Ordner wird wiederverwendet), Status: **veröffentlicht bleibt veröffentlicht** (Version und alte Freigaben – technisch/Datenschutz mit Name und Datum – landen in Freigabe und Historie, Notiz „Import aus GIRI Classic (host)“), alles andere wird Entwurf. Schritte ohne Medium werden **leere Schritte** („noch filmen“). Übersprungen: versteckte Schritte, 3D-Objekte, Teams, Dateien über 150 MB (→ leerer Schritt, wird in der Zeile gezählt). Herkunft steht in `instr.source` (`kind:'giri-classic'`, Server, alte ID, Version, Beschreibung).
- **Datenfluss / Sicherheit:** Edge Function `giri-import` (nur Workspace-Admins, Session wird serverseitig geprüft). Login gegen `POST /api/v2/auth/login` des alten Servers; das Session-Token lebt nur im Browser-Speicher der laufenden Seite und wird bei jedem Aufruf mitgeschickt – **nichts davon wird gespeichert**, das Passwortfeld wird nach dem Verbinden geleert. Medien werden **Server-zu-Server** kopiert (signierte URL des alten Servers → Storage `media/<ws>/<instr>/<media>.<ext>`, Symbole nach `<ws>/symbols/`), Pfad muss unter dem eigenen Workspace liegen; nur `https://`-Server, keine privaten Hosts. Poster (Vorschaubilder) macht der Browser aus dem kopierten Medium. Chat/Support bekommt nie Zugangsdaten – alles läuft in der App.
- **API-Basis:** GIRI Classic API v2 (Scalar-Doku unter `/api/v2/docs`, Umschlag `{stat, data, error}`; `projects`, `teams`, `instructions` seitenweise mit `page_size` 500; `instructions/{id}` mit `chapters[].steps[]`, `steps[]`, `step_media[]` (Tags `pattern-slot-index:n`), `icons[]`). Die OpenAPI-Spezifikation des Testservers liegt vorübergehend in `public._giri_api_spec` (kann nach dem Go-live gelöscht werden).
- Test `migtest` (Mock-Altserver mit 2 Projekten, 3 Anleitungen, Kapiteln, losem Schritt, Qualitätsvarianten, verstecktem Schritt, Symbol, zu großem Video, falschem Passwort, http-Server): 28 → 29 Tests grün.

## v0.32.1 – Classic-Muster (Vorher/Nachher, eigene Templates) beim Import
- **Entscheidung:** GIRI bekommt **kein** Muster-/Slot-System (mehrere Bilder pro Schritt). Ein Classic-Schritt mit Muster wird beim Import in **einen GIRI-Schritt pro Slot** zerlegt, in Slot-Reihenfolge, direkt hintereinander. Begründung: GIRI = eine Handlung pro Schritt, ein kurzes Video/Foto, Wischen am Handy – 3–4 Kacheln pro Schritt wären am Handy winzig und würden Editor, Kamera-Durchlauf, Viewer, PDF, Checkliste, Übersetzung und KI-Import komplizierter machen; „Vorher → Nachher“ zeigt ein 5-s-Video ohnehin von selbst. Das Muster war das Foto-Notbehelf-Format.
- **Abbildung:** Slot-Beschriftung aus dem Classic-Muster (`pattern.labels` in der UI-Sprache, sonst Standardsprache, sonst Name; „Vorher - Nachher“ wird an ` - ` in Slots geteilt) landet im Titel: „Schraube anziehen – Vorher“, „Schraube anziehen – Nachher“. Passt die Beschriftung nicht zur Slot-Zahl, gilt der Slot-Slug aus dem Media-Tag (`pattern-slot:morgen` → „Morgen“); bei nur einem Slot wird die Beschriftung als Zusatz angehängt („Schraube – Anziehen“), sofern sie nicht schon der Titel ist. Beschreibung steht auf **jedem** Teil (jeder Schritt bleibt allein verständlich), Schritt-Symbole nur auf dem ersten. Qualitätsvarianten (mehrere Dateien mit gleichem `pattern-slot-index`) bleiben ein Slot.
- **Nichts geht verloren:** Jeder importierte Schritt trägt `origin` (`step` = alte Schritt-ID, bei Mustern zusätzlich `slot`, `of`, `label`, `pattern`). Damit lässt sich die Gruppe später jederzeit wieder erkennen – z. B. für eine Vorher/Nachher-Ansicht oder eine Nebeneinander-Darstellung im PDF, falls Kunden das nachfragen. Keine UI-Änderung in GIRI.
- Edge Function `giri-import` v3 gibt das Muster je Schritt mit (`pattern`: id, name, labels, default_language, label_visible). Test `migtest` erweitert: Vorher/Nachher (Slots in vertauschter Reihenfolge), 3 Slots mit Slug-Fallback, Einzel-Slot mit Beschriftung.

## v0.33.0 – Links mit Schlüssel, Teilen-Dialog, Importer-Liste
- **Öffentliche Links tragen jetzt einen Schlüssel:** `#/v/<id>/<key>` – 24 Zeichen (144 Bit Zufall), pro Anleitung in `instr.shareKey`, im Browser erzeugt (beim Anlegen, spätestens beim Veröffentlichen/Teilen). Alle bestehenden Anleitungen wurden per Migration mit Schlüsseln versorgt. Die frühere Regel „veröffentlichte Anleitungen sind für anon per REST lesbar“ ist weg – **ohne Schlüssel liest niemand ohne Login mehr etwas** (vorher konnte man mit dem öffentlichen API-Key alle veröffentlichten Anleitungen aller Workspaces auflisten). `open_instr(p_id, p_pw, p_key)` prüft den Schlüssel; alte Links ohne Schlüssel bekommen eine „Link veraltet“-Seite. Policies für Views/Durchführungen/Feedback laufen über `instr_public()` (security definer), damit Werker ohne Login weiter eintragen können. `translate` (v8) verlangt für anonyme Aufrufe ebenfalls den Schlüssel. Sprach-/Kapitel-Argumente bleiben: `#/v/<id>/<key>/<kapitel>/<sprache>`.
- **Konsequenz:** Bereits gedruckte QR-Codes/Links ohne Schlüssel funktionieren nicht mehr – bitte neu drucken (QR-Blatt / Poster-PDF erzeugen die neuen Links automatisch). Eingeloggte Mitglieder des Workspace öffnen weiterhin auch ohne Schlüssel.
- **Teilen-Dialog:** Der Link ist ein anklickbarer Link (öffnet die Anleitung in einem neuen Tab), dazu Button „Anleitung öffnen ↗“; der QR-Code ist ebenfalls anklickbar; „Kopieren“ bleibt als Zweitaktion. Der QR-Code kodiert den längeren Link.
- **Importer-Liste:** Zeile 2 je Anleitung mit Erstelldatum, Änderungsdatum, Team und Ersteller (falls der Server ihn liefert – die dokumentierte API v2 hat kein Ersteller-Feld; ersatzweise der Freigeber aus `approvals`). Leiste über der Liste: Suche, Sortierung (Name, Neueste, Älteste, Zuletzt geändert, Status), „Nur noch nicht importierte“, „Ältere Versionen zeigen“ (Classic-Versionsgruppen: standardmäßig nur die neueste Version je Gruppe, Chip „n ältere Versionen“), „Alle/Keine“. Ordner lassen sich zusammenklappen (Pfeil oder Klick auf den Namen); Kopfzeile zeigt gewählt/gesamt. Auswahl überlebt Suchen/Sortieren; importiert wird, was sichtbar angehakt ist; importierte werden abgewählt.
- Tests: `linktest` (Schlüssel ab Geburt, Teilen-Dialog, alter Link → veraltet, richtiger Schlüssel → Viewer, falscher → veraltet, Mitglied ohne Schlüssel, anonymer Tabellenzugriff leer), `migtest` erweitert (Metazeile, Versionsgruppen, Sortieren, Suchen, Zuklappen, Alle/Keine). Mock emuliert die entfallene anon-Policy. 31 Tests grün.

## v0.34.0 – Kopfzeile mit einem Menü, Struktur-Import, PDF-Karte, Installations-Anleitung
- **Kopfzeile:** links Logo · Trennstrich · **wo bin ich** („Anleitungen“, Ordnername, „Editor“, „Administration“, „Import aus GIRI Classic“ …), rechts **ein** Knopf (Avatar + Name + ☰) → das App-Menü: Workspace (Neuer Ordner, Statistik, Papierkorb, Branding), Verwaltung (Administration, KI konfigurieren, Import aus GIRI Classic – nur Admins), App (Sprache, App installieren, Profil & Name, Abmelden), Fußzeile „GIRI v… · workspace“ (5× tippen = Mess-Chip). Zahnrad, Sprach-Knopf, Versionsnummer und das ⋯ neben „Neue Anleitung“ auf der Startseite sind weg – alles im Menü. Am Handy bleibt der Ort sichtbar (statt der Versionsnummer).
- **Editor → Freigabe & Einstellungen:** Die Karte „Übersetzungen“ heißt jetzt **„PDF herunterladen“** und tut genau das: „Original“ lädt das SOP-PDF, jede Sprache übersetzt bei Bedarf (DeepL) und lädt sofort das PDF in dieser Sprache (✓ = Übersetzung gespeichert, ↻ = Text geändert, × = Übersetzung entfernen). Hinweis, dass der Web-Link nichts davon braucht (Werker wählt die Sprache selbst).
- **Import aus GIRI Classic → „2 · Struktur übernehmen“** (Edge Function `giri-import` v5, Aktion `structure`: `/users`, `/teams` + `/teams/{id}/members`, `/projects`): Nutzer mit der eigenen E-Mail-Domain werden übernommen – bestehende bekommen die Rolle (nie der Importeur selbst, Admins werden nicht herabgestuft), neue landen als Einladung in `workspaces.invites` und bekommen die Rolle beim ersten Login (optional sofort Login-Mail). Rollen: team_admin/creator/editor → Creator, approver/technical_approver/compliance_* → Freigeber, viewer → Betrachter, Org-Admin → Admin (Trigger `handle_new_user` akzeptiert jetzt `role:'admin'` in Einladungen). Teams werden mit Mitgliedern angelegt (`oldId` merkt die Classic-ID, Wiederholung aktualisiert), Projekte werden Ordner (`oldId`) und bekommen als Team-Zugriff die Teams, deren Anleitungen im Projekt liegen. Importierte Anleitungen tragen zusätzlich ihr Classic-Team (`instr.teams`). Andere E-Mail-Domains werden aufgelistet und übersprungen (GIRI ordnet Nutzer über die Domain zu). Vorschau vor dem Klick, Ergebniszeile danach.
- **App installieren:** Die Anleitung zeigt jetzt große, realistische Bildschirme (iPhone: Safari-Leiste mit Teilen-Symbol → Teilen-Menü mit „Zum Home-Bildschirm“ → Bestätigen mit echtem GIRI-Icon; Android: ⋮ → Chrome-Menü „App installieren“ → Dialog; PC: Installieren-Symbol in der Adressleiste → Dialog), jeder Schritt mit blauer Markierung und Tipp-Punkt, breiterer Dialog, größere Überschrift.
- Tests: `migtest` um den Struktur-Import erweitert (Rollen, Einladung, übersprungene Domain, Teams mit Mitgliedern, Ordner→Teams, Anleitung→Team), Menü-Selektoren (`#tbmenu`), PDF-Karte in `r19test`.

## v0.35.0 – Feedback: wo es landet, Mail an den Ersteller
- **Wo landet Feedback?** Editor-Knopf heißt jetzt **„Statistik & Feedback“** und zeigt die Zahl offener Rückmeldungen als Badge; die Seite `#/results/<id>` trägt denselben Namen. Unter „Freigabe & Einstellungen → Werker-Feedback erlauben“ steht es jetzt ausdrücklich („Rückmeldungen landen unter Statistik & Feedback dieser Anleitung – und als Zähler auf der Startseite“) mit Knopf „Feedback öffnen“. Bestehend bleiben: Banner oben im Editor bei offenem Feedback, Zähler-Chip auf der Anleitungskarte.
- **Mail an den Ersteller (Standard: an):** Neuer Schalter „Ersteller per E-Mail benachrichtigen“ unter dem Feedback-Schalter (`instr.fbNotify`, aus = `false`). Bei jedem neuen Feedback schickt die Datenbank (Trigger `feedback_notify_ins` → pg_net) die Edge Function `feedback-notify` los: sie lädt Feedback, Anleitung und das Profil des Erstellers (`instructions.owner`), prüft den Schalter und sendet über **Resend** (Absender `GIRI <giri@ar-giri.de>`, Domain in Resend verifiziert, Sende-Key nur für diese Domain im Vault `resend_api_key`, Shared Secret `hs_sync_secret`). Inhalt: Titel, Schritt, Art (Anleitung/Prozess), Werker, Text, Foto/Video-Link, Knopf „Feedback ansehen“ (→ `#/results/<id>`, Login nötig), Abschalt-Hinweis. `feedback.notified_at` verhindert Doppelversand. Live getestet (Mail an bjoern@ar-giri.com, Resend-ID zurück).
- Offen: Mail-Sprache ist Deutsch; Empfänger ist nur der Ersteller (Freigeber/Admins bewusst nicht). Ein globaler Schalter pro Nutzer („keine Feedback-Mails“) fehlt noch – bei Bedarf im Profil ergänzen.

## v0.35.1 – Feedback-Mail auch an Freigeber (optional)
- Zweiter Schalter unter „Ersteller per E-Mail benachrichtigen“: **„Auch Freigeber benachrichtigen“** (`instr.fbNotifyReviewers`, Standard aus). Empfänger dann zusätzlich alle Profile mit Rolle Freigeber, die die Anleitung sehen dürfen: bei Team-Einschränkung (Ordner-Teams ∪ Anleitungs-Teams) nur die Freigeber-Mitglieder dieser Teams, sonst alle Freigeber des Workspace. Beide Schalter sind unabhängig (Ersteller aus + Freigeber an geht). Edge Function `feedback-notify` v2.

## v0.35.2 – Import: schneller und robust gegen langsame Altserver
- **Befund (Import von ar-giri.cloud, 28.9.):** Einzelne Medien-Kopien brauchten 25–60 s, weil der alte Server die Dateien nur langsam ausliefert (kalter Speicher); nach 60 s bricht sein Proxy mit 504 ab. Bisher ließ ein einziger solcher Abbruch die ganze Anleitung fehlschlagen (die bis dahin kopierten Dateien blieben verwaist), und die Kopien liefen streng nacheinander.
- **Jetzt:** Medien werden **drei gleichzeitig** kopiert; jede Kopie wird bei Fehlern **bis zu 3× wiederholt** (2 s / 6 s Pause), die Edge Function versucht ihrerseits einmal neu und kappt eine Quelle nach 100 s. Scheitert ein Medium endgültig oder ist es zu groß, wird der Schritt als **leerer Schritt (zum Nachfilmen)** angelegt und die Anleitung trotzdem fertig importiert – die Zeile zeigt „n ohne Medium“. Nur Login-/Rechtefehler brechen die Anleitung noch ab. Fortschrittszeile mit MB-Zähler. Dateigrenze 120 MB (Speicher der Function).
- `origin.failed` (`too_large` | `copy`) und `origin.media` (alte Medien-ID) markieren die betroffenen Schritte – damit lässt sich später gezielt nachholen. Test `migtest`: wackeliges Medium (2. Versuch klappt) und totes Medium (leerer Schritt, Anleitung trotzdem importiert). Edge Function `giri-import` v6.

## v0.36.0 – Startseite: Team zuerst, Ordner skalieren
- **Befund:** Nach dem Struktur-Import aus ar-giri.cloud standen 260 Ordner-Chips („Arbeitsplatz 100 … 259“, fast alle leer) über 30 Team-Chips – unbenutzbar. Das Classic-Modell ist „Team → Projekte“.
- **Team ist jetzt der Oberfilter:** die Team-Zeile steht oben (bis 10 Teams Chips, darüber ein Auswahlfeld mit Zähler) und filtert **Ordner und Anleitungen**. Ein Ordner gehört zu einem Team über seine Team-Zuordnung (`folder.teams`, beim Import aus den Anleitungen abgeleitet); Ordner ohne Team erscheinen unter „Alle“ und „Ohne Team“.
- **Ordner-Bereich:** bis 12 Ordner wie bisher Chips. Darüber ein Panel mit Suchfeld, Zähler, Scrollbereich (max. 4 Zeilen); **leere Ordner sind ab 20 Ordnern standardmäßig ausgeblendet** („41 leere Ordner anzeigen“ schaltet um, Sitzung merkt sich das); mehr als 60 Treffer → „… n weitere – bitte suchen“.
- **Aufräumen:** Verwaltung → Ordner-Zugriff → „Leere Ordner löschen“ (mit Rückfrage, Zahl wird angezeigt). Importer-Struktur: neuer Schalter „Leere Projekte überspringen“ (Standard an) – Projekte ohne Anleitungen werden gar nicht erst zu Ordnern.
- Test `foldertest` (12 Teams → Auswahlfeld, 42 Ordner → Panel, Suche, Leere ein/aus, Team-Filter auf Ordner, Massenlöschung).

## v12.36.1 – Versionsschema, Sprache in der Leiste, Import-Feinschliff
- **Versionsnummer:** ab jetzt `12.36.x` – Classic steht bei 12, die zweite Zahl läuft von 0.36 weiter. Die Update-Prüfung vergleicht nur auf Ungleichheit, der Sprung von 0.36.0 löst also normal ein Update aus.
- **Kopfzeile:** Sprachumschalter (Flagge) steht wieder in der Leiste, links vom Menü-Knopf; alles andere bleibt im Menü.
- **Import:** Platzhalter-Muster von Classic („Without template“, „Kein Template“, „Standard“) erzeugen keinen Titel-Zusatz mehr; ein Schritt mit nur einem Slot bekommt grundsätzlich keinen Zusatz. Bei nummerierten Mustern („1 - 2 - 3 - 4“) landet die Slot-Nummer als „Titel (3)“ – über den Slot-Index des Mediums, nicht mehr über die Reihenfolge. **HTML aus Classic** (TipTap: `<ul><li><p>…`, `<strong>`, `<a>`, `<br>`) wird in GIRI-Text umgesetzt: Listen als „- “/„1. “-Zeilen, fett als `**…**`, Links als `[Text](url)`, Absätze als Zeilen; auf beiden Seiten (Edge Function v7 und `htmlToMd` in `src/core/richtext.js`). Bereits importierte Test-Anleitungen wurden per SQL bereinigt (Titel-Zusatz entfernt, HTML-Tags raus); Aufzählungen dort erscheinen als Zeilen – bei Bedarf löschen und neu importieren.
- Ein Ordner darf mehreren Teams gehören (bestätigt) – bleibt so.

## v12.37.0 – Umzug nach Frankfurt (Supabase eu-central-1)
- Neues Supabase-Projekt `GIRI (Frankfurt)` (`hcomtmogkuxxchrnticq`, eu-central-1). Die App zeigt ab dieser Version dorthin (`window.GIRI_CONFIG` in `app/index.html`).
- Daten 1:1 übernommen (gleiche IDs): Auth-Nutzer + Logins, Profile, Workspaces, Anleitungen, Views, Runs, Feedback, UI-Übersetzungen, AI-Usage; alle Medien-/Poster-URLs auf das neue Projekt umgeschrieben; Storage-Bucket `media` inkl. Policies, Dateien Server-zu-Server kopiert (Edge Function `mig-copy`, danach gelöscht).
- Secrets (DeepL, Resend, HubSpot, Sync-Secret, Google-Serviceaccount) Server-zu-Server in den Vault kopiert. Neu: `google_sa_json` im Vault + `get_google_sa()` – `pdf-analyze` (v3) liest den Google-Serviceaccount aus dem Vault, wenn kein Function-Secret gesetzt ist.
- `pdf-analyze`: Test-Hintertür (`x-giri-test`, Location-Probe) entfernt. `translate`: neuer Publishable Key in der Allowlist.
- Umstellung: altes Projekt wird nach Delta-Sync eingefroren, bleibt 1–2 Wochen als Fallback, dann löschen. Migrations-Helfer (`giri_export*` alt, `_mig*` neu) nach dem Umzug entfernen.
- Offen im Dashboard des neuen Projekts (nicht per API setzbar): Auth → Site URL / Redirect URLs (`https://go.ar-giri.de`), Google-Provider (Client-ID/Secret + neue Callback-URL in der Google-Konsole), SMTP (Resend).

## v12.37.1 – Auto-Update repariert, Suche, Import-Feinschliff
- **Auto-Update**: Der Versions-Check in der App war seit einer Zeilenzusammenlegung auskommentiert (Code hinter einem `//`) und lief nie – installierte Apps (Mac, iPhone) blieben auf alten Versionen. Repariert; Check beim Start, alle 30 Min und bei jedem Zurückholen der App. Bereits installierte Apps holen sich diese Version beim nächsten Kaltstart über den Service Worker.
- **App-Icon**: nur noch das GIRI-Logo (kein „GO“-Badge), alle Größen neu (`icons/*`, `?v=2`). iOS zeigt das neue Icon erst nach Entfernen + erneutem „Zum Home-Bildschirm“.
- **Leere Schritte** (kein Text, kein Bild/Video, keine Symbole) werden Werkern nicht mehr angezeigt; im Editor bleiben sie sichtbar. Der Classic-Import legt solche Schritte gar nicht erst an.
- **Import**: Pattern-Slots ohne Datei („1 - 2 - 3 - 4“ mit nur einem Bild) erzeugen keine leeren „(2)…(4)“-Schritte mehr; Originaldatum aus Classic bleibt erhalten (Änderungsdatum, Versionsdatum = letzte Freigabe), `saveInstr(i, {keepDate:true})`.
- **Mehr als 1000 Anleitungen**: die Liste lädt seitenweise (PostgREST-Limit 1000 pro Anfrage) – vorher blieb sie bei 1000 stehen.
- **Eine Suche** für Ordner und Anleitungen, Volltext (Titel, Kapitel, Schritt-Texte, Warnhinweise, Ersteller; mehrere Wörter = alle müssen vorkommen), sucht über alle Ordner; Ordner-Chips zeigen Namens- und Inhaltstreffer. Das separate Ordner-Suchfeld ist weg.
- **Ordner löschen** mit Inhalt: Dialog fragt „nur Ordner“ oder „samt Anleitungen in den Papierkorb“.
- Team-Auswahl: eigener Pfeil, kompakte Breite.
- Tests: `blanktest` (leere Schritte, >1000), Erweiterungen in `foldertest`/`migtest`. 32 Tests grün.

## v12.38.0 – Startseite neu sortiert, erster Start schneller
- **Reihenfolge**: Titel „Anleitungen / SOPs“ → **Neue Anleitung** (blau, groß, links) + Suche in einer Zeile → **Für dich** (Anleitungen, die auf Freigabe warten · offene Rückmeldungen von Werkern, je als Filter-Chip) → Als-App-installieren → Team → Ordner → Liste. Auf dem Handy untereinander, Knopf und Chips in voller Breite.
- „Für dich“ wächst mit: weitere Punkte (z. B. noch zu filmende Schritte) kommen an dieselbe Stelle. Feedback-Chip filtert die Liste auf Anleitungen mit offenem Feedback (`stF='fb'`).
- **Als App installieren** am PC: gleicher blauer Verlauf wie das Handy-Banner (`.inst-banner.desk`), sitzt unter der Suche statt über dem Titel.
- **Erster Start auf einem Gerät**: Anleitungen werden in 40er-Paketen mit 4 parallelen Anfragen geladen (vorher 20er-Pakete nacheinander → bei 1.000+ Anleitungen ~10 s). Danach kommt der lokale Spiegel zum Zug, wie gehabt.
- Neuer Button-Stil `.btn.primary` (Blau-Verlauf), Icon `IC.search`, Keys `dash_h1`, `inbox_h`, `inbox_fb_*`.

## v12.38.1 – 1.000+ Anleitungen ohne Hänger
- **Liste seitenweise**: 40 Karten, der Rest kommt beim Scrollen (IntersectionObserver) oder per „{n} weitere anzeigen“. Vorher wurden alle Karten samt Vorschaubild auf einmal gebaut – bei 1.095 Anleitungen fror die Seite. Vorschaubilder `loading="lazy"`.
- **Cloudflare + Service Worker**: der Host leitet `/index.html` auf `/` um; die gecachte, umgeleitete Antwort (`/?v=check…`) wurde beim nächsten Start zur Seitenadresse. Der SW speichert die Shell jetzt ohne Antwort-URL (`plain()`), Versions-Check fragt `/` statt `/index.html`.
- **Alte Medienlinks**: Geräte mit lokalem Spiegel schrieben Irland-URLs zurück. Frankfurt-DB: Trigger `instr_rewrite_old_urls` / `ws_rewrite_old_urls` schreiben `goorpzgcxhtjbaothluv` → `hcomtmogkuxxchrnticq` bei jedem Insert/Update um; App: `fixLegacyHosts()` (`src/core/config.js`) beim Laden aus dem Spiegel.

## v12.38.2 – Startseite: Luft und Rhythmus
- Titel bekommt eine ruhige Unterzeile („1.088 Anleitungen · 24 Teams · 468 Ordner“), größere Abstände zwischen den Blöcken (18/16/22 px statt überall 12).
- Install-Hinweis am PC ist eine schlanke Zeile (Icon · Text · „So geht’s“ · Später · ×), kein Plakat mehr; auf dem Handy bleibt das große Banner.
- **Filterkarte**: Team-Auswahl und Ordner in einer Karte. Kopfzeile: `Team ▾` links, rechts „Ordner 468 · 41 leere ausblenden · Alle 468 Ordner“. Chips kompakt (kein Ordner-Icon, Zähler als stille Zahl), bei vielen Ordnern zwei Reihen sichtbar mit Ausblendung, Rest klappt per „Alle … Ordner“ auf (`gg_fexp`), bei Suche automatisch offen. Kein Scrollbalken mehr in der Karte.
- Neue Keys `folders_all`, `folders_less`; CSS-Block „v12.38.2“ in `09-premium.css`.

## v12.39.0 – Rollen wie GIRI Classic, Schutz vor gegenseitigem Überschreiben, Impressum, Update-Rettung
- **8 Team-Rollen 1:1 aus Classic** (`src/core/roles.js`, Quelle: help.ar-giri.com/administratoren/rollen-berechtigungen): Viewer · Editor · Approver · Technical Approver · Compliance Approver · Compliance Manager · Creator · Team Admin, plus Org-Admin (Workspace). Rollen gelten pro Team; ohne Team-Zuordnung zählt die Workspace-Rolle. Rechte als Capabilities (`can(instr, 'edit' | 'approve_tech' | 'approve_dsgvo' | 'lock' | 'links' | 'projects' | 'users' | 'team' | 'analytics')`), `canAny`, `canIn(teamIds)`. Alte Namen bleiben gültig (`reviewer` → Approver).
- Auswirkungen: Editor bearbeitet, hat aber keine Weblinks/QR; Technical Approver gibt nur technisch frei, Compliance Approver nur DSGVO, Approver beides; Ordner anlegen/umbenennen/löschen nur Creator/Team Admin; Statistik nur Team Admin (Editor sieht die Feedback-Seite); Freigeber öffnen die Anleitung per „Prüfen & freigeben“ (Titel/Schritte gesperrt, Freigabe-Knöpfe aktiv).
- Verwaltung: Nutzer- und Team-Rollen mit allen acht Rollen; aufklappbare Karte „Rollen & Berechtigungen“ mit Beschreibung und Matrix. Import aus Classic übernimmt die Rollen 1:1. DB: `my_can_write()` (Workspace- **oder** Team-Rolle ≠ Viewer) in den Schreib-Policies, `handle_new_user` akzeptiert alle Rollen in Einladungen (Migration `v003_roles_like_classic`).
- **Zwei Editoren**: jeder Speichervorgang ist an die Version gebunden, von der die Kopie stammt (`_base` = Server-`updated_at`; `update … where updated_at = base`). Hat inzwischen jemand anderes gespeichert, fragt ein Dialog: „Aktuellen Stand laden“ oder „Trotzdem überschreiben“. `lastBy` nennt, wer zuletzt gespeichert hat. Test `locktest`.
- **Impressum / Datenschutz & AVV**: Links im Login-Fuß und im App-Menü (`LEGAL` in `config.js`).
- **Update-Rettung im Service Worker**: beim Aktivieren eines neuen SW wird die Shell frisch geholt; steckt ein Fenster auf einer Version vor 12.37.1 (kaputter Versions-Check), wird es direkt auf die neue Version navigiert – Home-Bildschirm-Apps holen die neue Version so beim nächsten Öffnen, ohne zweimal neu starten zu müssen.
- Tests: `roletest` (7 Rollen × Startseite/Menü/Editor), `locktest`. 34 Tests grün.

## v12.40.0 – Symbole & Platzieren: ISO 7010, neue 3D-Objekte, Bibliothek, Platzieren mit dem Finger
- **ISO 7010 komplett** (`symbols/iso/`, 332 Zeichen, `index.json` mit Nummer, deutschem/englischem Namen, Klasse und Seitenverhältnis): Warnung (W), Verbot (P), Gebot (M), Rettung (E), Brandschutz (F). Im Bild als 3D-Schild mit weißem Rand, Kante in der Klassenfarbe und Glanz; kein Farbwechsel (Normfarben). Wird wie die App-Dateien vom Service Worker gecacht und ist in `build:cf` enthalten.
- **Neue 3D-Objekte** (`src/annotations/draw.js`): Drehpfeil (↻/↺, Proportionen wie der gelbe Classic-Pfeil), Pin, Daumen hoch/runter, Smiley froh/traurig – alle mit derselben Extrusion, Rand und Glanz wie Pfeil, Haken und Kreuz. Ein Set, ein Look.
- **Symbolbibliothek** (`src/annotations/library.js`, Sheet unter dem Bild): Reiter Markieren · Status · Sicherheit (ISO, mit Gruppen-Chips) · Eigene (Hochladen) · Emoji, Volltextsuche über alle Namen („gehör“ → Gehörschutz benutzen), „Zuletzt“ merkt sich die letzten Symbole. Vorschauen sind echte Renderings der Bild-Engine.
- **Platzieren neu gedacht**: erst aufs Bild tippen (Markierung erscheint), dann Symbol wählen – es landet genau dort. Ohne Tipp: Bildmitte. Ziehen verschiebt, **Pinch** skaliert und dreht (zwei Finger). Kein Kippschieber mehr: die Leiste unter dem Bild hat vier Lagen (Frontal · Liegend · Wand links · Wand rechts), für die Feinabstimmung gibt es den **Orbit-Griff** unter dem Symbol (seitlich ziehen = drehen, hoch/runter = kippen, rastet bei 0°, Doppeltipp = flach); beim Ziehen zeigt eine gestrichelte Ebene mit Gradzahl die Lage. Griffe bleiben immer im Bild (auch bei Symbolen am Rand), der nächstgelegene Griff gewinnt.
- Leiste unter dem Bild außerdem: Farben (außer bei ISO/Bild), Kleiner/Größer, Duplizieren, Löschen, Animation. Der PC behält die Schnellleiste mit Drag & Drop, der Knopf „Ins Bild markieren“ ist jetzt der blaue Aufruf unter dem Bild.
- Tests: `libtest` (Telefon: Tipp-Platzierung, Sheet, Suche, Zuletzt, 3D-Typen, Orbit-Griff), `animtest` (Lagen + Orbit), `symtest`. 35 Tests grün.

## v12.41.0 – Symbole wie Classic, ein Symbol-Menü, Video-Import verkleinert selbst
- **Symbole nach dem Classic-Vorbild** (`src/annotations/draw.js`): Drehpfeil ↻/↺ jetzt wie das Classic-Objekt – fast geschlossener Ring, großer 90°-Winkelkopf, weiße Fläche mit farbigem Rand und Seitenwand; Daumen hoch/runter blockig mit Manschette, einfarbig facettiert (kein Umriss); Pin mit weißem Ring-Auge; Smiley mit dunklem Innenring und ovalen Augen. `tests/symsheet.mjs` rendert das ganze Set nach `tests/out/sym-all.png`.
- **Ein Symbol-Menü statt Knopf + Leiste** (`src/annotations/library.js`): `symbolPanel(host, opts)` ist die Bibliothek (Reiter Zuletzt · Markieren · Status · Sicherheit/ISO 7010 · Eigene · Emoji, Suche, echte 3D-Vorschauen). Am PC sitzt sie als Panel unter dem Bild (`#symdock`, Klick = platzieren, aufs Bild ziehen = genau dort). Am Telefon öffnet der blaue Knopf „Ins Bild markieren“ dieselbe Bibliothek als Sheet (`symbolSheet`). Die alten Schnellwerkzeuge Warnung/Elektrisch/Heiß sind aus den Menüs raus (ISO W001/W012/W017 ersetzen sie; alte Anleitungen zeigen sie weiter).
- **Video-Import** (`src/media/import.js`): keine 80-MB-Grenze mehr – nicht-mp4, > 1280 px oder > 25 MB werden im Browser verkleinert (H.264, ≤ 1280 px, erste 60 s, ~2 Mbit/s, Fortschritt „Video wird verkleinert …“). Nur wenn der Browser nicht konvertieren kann, gilt weiter 80 MB – dann mit klarer Meldung. „Datei ersetzen“ geht denselben Weg. Fehler erscheinen in einem Dialog (nicht mehr als flüchtiger Toast), der Erfolgs-Toast nennt „2 Videos + 1 Foto importiert“, gekürzte Videos werden gemeldet. Test `bigvidtest`.
- Tests: `symtest`, `check4`, `r14test` an das Panel angepasst. 36 Tests grün.

## v12.42.0 – Startseite: Navigator links, Status-Filter und Sortierung
- **Navigator** (`src/views/dashboard.js`, PC ≥ 901 px als feste Spalte links, `#dnav`): *Alle Anleitungen* → **Team** (jedes Team mit Anzahl, „Ohne Team“) → **Ordner** des gewählten Teams (alphabetisch, mit Anzahl; ab 13 Ordnern eine Ordnersuche, ab 21 werden leere Ordner eingeklappt – „n leere Ordner anzeigen“; die Suche findet auch leere). Die Liste scrollt in der Spalte, nichts wird mehr abgeschnitten. „+“ legt einen Ordner an (Creator/Team Admin). Die alte Filterkarte mit Chips ist weg.
- **Telefon**: der Knopf „Bereich“ über der Liste (aktueller Ordner/Team) öffnet denselben Navigator als Sheet.
- **Status-Filter** über der Liste: Alle · Veröffentlicht · Entwurf · In Prüfung (+ „Mit Feedback“, sobald offenes Feedback da ist), jeweils mit Anzahl im aktuellen Bereich; die „Für dich“-Kacheln setzen denselben Filter.
- **Sortierung**: Zuletzt geändert · Zuletzt erstellt · Zuletzt veröffentlicht · Titel A–Z (bleibt in der Sitzung). Beim Veröffentlichen wird jetzt `publishedAt` gesetzt (Import aus Classic hatte es schon; ältere Anleitungen nehmen das letzte Versions-Datum).
- Die Suche oben sucht Anleitungen (Titel, Schritte, Ersteller) – Ordner sucht man im Navigator.
- Tests: `foldertest`, `teamtest`, `check4` an den Navigator angepasst. 36 Tests grün.

## v12.43.0 – Editor: aufgeräumt, Video-Bearbeitung flüssig, Knöpfe bleiben bedienbar
- **Kopf**: nur noch Titel · Status · Version · Schrittzahl und die Knöpfe *Aufnehmen · Vorschau · Zur Freigabe*. Freigabe & Einstellungen, Link/QR, PDF und Statistik & Feedback (mit Zähler offener Rückmeldungen als Punkt am ⋯) liegen im ⋯-Menü; keine Reiterzeile, keine doppelte „Schritte“-Überschrift. Die Einstellungen haben oben „Zurück zu den Schritten“.
- **Liste**: der gewählte Schritt hat einen dunklen Rahmen und eine schwarze Nummer – unabhängig von den Kapitelfarben. Ein eingeklapptes Kapitel zeigt „1 Schritt“ / „n Schritte“ statt nur einer Zahl (das erklärte „4 von 5“: ein eingeklapptes Kapitel).
- **Leerer Schritt** (`textOnly`): in der Hinzufügen-Karte und unter jedem Bild („Danach einfügen“); Text-Schritte tauchen nicht in „n Schritte noch filmen“ auf, Bild/Video lässt sich jederzeit nachreichen.
- **Medien-Aktionen** unter dem Bild in zwei Gruppen: *Dieser Schritt* (Neu aufnehmen · Datei ersetzen) · *Danach einfügen* (Aufnehmen · Bilder/Videos · Leerer Schritt); das ⋯ am Telefon bietet dasselbe.
- **Video**: Tipp aufs laufende Video hält an und zeigt „＋ Hier markieren“ am Tipp-Punkt (Telefon: öffnet die Bibliothek, PC: hebt das Panel hervor); ein Tipp auf ein pausiertes Video startet es nicht mehr. Der Pause-Knopf gewinnt gegen die automatische 1-s-Pause an Symbolen (Icon zeigt die Absicht). Die grünen Marker auf der Zeitleiste sind Griffe: ziehen verschiebt den Zeitpunkt des Symbols, antippen wählt es. Der DOM um die Leinwand (Pills, Marker, Auswahlleiste) wird nur noch bei Änderungen neu gebaut – vorher 60× pro Sekunde beim Abspielen, was Tipps am Telefon verschluckte.
- **Hängende Knöpfe am Telefon**: die Schrittleiste wird vor jedem Warten gerendert und per Delegation bedient, ein Fehler beim Aufbau der Bühne wird gemeldet statt still zu bleiben; `mediaUrl` fällt nach 3 s auf die Server-Kopie zurück; IndexedDB-Anfragen haben einen 6-s-Wachhund (iOS lässt sie nach dem Hintergrund hängen) und eine geschlossene Verbindung wird neu geöffnet; Schritte werden beim Öffnen normalisiert (`ann`-Array), eine kaputte Listenzeile reißt die anderen nicht mit. Test `hangtest`.
- **Textformat**: Fett / Nicht übersetzen über mehrere markierte Zeilen wirkt zeilenweise (Listen-Präfix bleibt außen), zweimal = wieder weg.
- **Symbol-Bibliothek**: Emoji mit Gruppen-Chips und Suche direkt im Sheet/Panel (kein Extra-Fenster), „Eigene“ lädt direkt aus dem Sheet hoch (ein Bild → sofort platziert), „Verwalten …“ für Löschen. Tests `vidtest`, `hangtest`; `linktest`, `roletest`, `fbtest`, `r19test`, `trashtest`, `symtest`, `check4` angepasst. 38 Tests grün.

## v12.44.0 – Auswahlleiste schlank, Emoji-Gruppen eindeutig, Installations-Hinweis bleibt
- **Auswahlleiste unter dem Bild** (gewähltes Symbol): nur noch Farbe · Animation (· Bild-Stil bei eigenen Bildern · Statisch/Folgen bei Video). Lage-Chips (Frontal/Liegend/Wand), Duplizieren, Größer/Kleiner und der Löschen-Knopf sind raus – Größe/Drehung machen Anfasser bzw. zwei Finger, Kippen der Griff unter dem Symbol, Löschen der Papierkorb an der Symbol-Pill (statt ×).
- **Emoji-Reiter**: „Zuletzt verwendet“ ist beschriftet, die Gruppe ist ein Aufklappmenü („Gruppe: Smileys ▾“) statt einer Reihe Icons, die wie Emojis zum Antippen aussahen. Platzierte Emojis sind größer (0,24 statt 0,16).
- **Installations-Hinweis**: nach „Später“/× bleibt eine schmale Zeile „📲 GIRI Go als App installieren · So geht’s“ auf der Startseite, solange die App nicht installiert ist (PC und Telefon).
- Tests `animtest`, `libtest`, `check4` angepasst. 38 Tests grün.

## v12.50.0 – Am Handy per QR-Code anmelden, Mails zweisprachig

- **Am Handy anmelden ohne zweite Mail** (`src/views/devicelogin.js`, Edge Function `device-login`, Tabelle `device_logins` – Migration `v014`): am PC oben aufs Profil → „Auf dem Handy anmelden“ zeigt einen QR-Code (3 Minuten, einmal). Handy: Kamera-App oder auf der Anmeldeseite „QR-Code vom PC scannen“ (eigener Scanner: `BarcodeDetector`, sonst `vendor/jsQR.min.js`, Apache-2.0). Das Handy zeigt eine zweistellige Zahl, die tippt man am PC ein → das Handy hat eine eigene Sitzung (Einmal-Token aus `generateLink`, eingelöst mit `verifyOtp` – es geht keine Mail raus).
- **Sicherheit:** Geheimnis nur im QR (gespeichert als SHA-256); nur das Handy, das zuerst gescannt hat, kann die Anmeldung abholen (zweites Geheimnis); die Zahl schickt der Server nie an den PC (Number Matching wie bei Microsoft) – falsche Zahl = abgebrochen; Token genau einmal; 10 Codes pro Person und Stunde, ein neuer Code ersetzt den offenen. Das Handy zeigt, als wer es angemeldet wird, mit „Abbrechen – das bin nicht ich“; ist dort schon jemand anderes angemeldet, fragt es vorher. Unabhängiges Review am 3. 10. eingearbeitet. Ohne `v014` sagt der PC „noch nicht eingerichtet“.
- **Abmelden** meldet nur noch dieses Gerät ab (vorher alle Geräte); im Profil neu: „Auf allen Geräten abmelden“.
- **Mails zweisprachig:** Einladung (`invite-notify` v2 mit `mail.ts`), Feedback-Mail (`feedback-notify` v2) und Code-Mail (`supabase/email-magic-link.html`) enthalten Deutsch und Englisch; oben rechts springt „🇬🇧 English ↓“ zur anderen Sprache, dort führt „↑ 🇩🇪 Deutsch“ zurück. Die Einladung beginnt in der Sprache, die der Admin gewählt hat. Keine Ziffernzahl mehr im Text (die Codes haben 8 Stellen); das Code-Feld nimmt 6–10 Ziffern und schickt bei 8 von selbst ab.
- „GIRI GO“ in der Einladung kam aus dem Profilnamen des Einladenden, nicht aus einer Vorlage. Download-Dateien heißen `giri-…` statt `giri-go-…`.
- Tests: `qrlogin` (PC + Handy: Link-Scan, Kamera-Scan mit Testbild, Zahl eintippen, falsche Zahl, Abbrechen am Handy, abgelaufen, ersetzt, Kontowechsel, Abmelden nur hier), `tests/fn/device-login.test.ts` (die Edge Function selbst in Deno mit Supabase-Stub: `deno run --allow-env --import-map=import_map.json device-login.test.ts` in `tests/fn`). 56 Tests grün.

## v12.49.0 – Runde vom 2. Oktober abends: Viewer aufgeräumt, Editor-Kopf neu, eine Seite scrollt

- **Werker-Ansicht:** jede Information nur einmal – Schrittzahl und Kapitel stehen nur noch oben in der Leiste (vorher dreimal: oben, unter dem Bild, in der Antwortleiste). Die Antwortleiste hat nur noch die zwei Buttons „Nicht OK“ / „Erledigt“ in voller Breite. Auf der Kapitelkarte wiederholt die obere Leiste das Kapitel nicht.
- **Übersetzung der Oberfläche:** die Edge Function `translate` nimmt höchstens 600 Texte pro Aufruf, die App hat ~1100 – alles danach blieb deutsch (z. B. „Foto / Video wählen“, „Schritt erledigt?“ auf Spanisch). Jetzt in Teilen zu 500; fehlt trotzdem etwas, gilt Englisch statt Deutsch; alte halbe Übersetzungen auf den Geräten werden verworfen.
- **Editor-Kopf:** drei Unterseiten als Tabs – Bearbeiten · Einstellungen (`#/settings/<id>`) · Auswertung; die Vorschau ist ein Button ganz rechts. Einstellungen = Ablage & Zugriff (Ordner ändern, Teams), Checkliste, Feedback. „PDF herunterladen“ nur noch im ⋯-Menü (fragt die Sprache). Freigabe = ein Dialog (Status-Chip, Button „Freigeben“, ⋯ → „Freigabe & Verlauf“): je Freigabe „Freigeben / Ablehnen“, wenn man das Recht hat, sonst „Wartet auf eine Person mit dem Recht …“; nichts mehr doppelt. Die Auswertung hat denselben Kopf.
- **Unter dem Schritt** nur noch „Neu aufnehmen“ und „Datei ersetzen“ („Danach einfügen“ entfernt – neue Schritte über die Karte am Listenende).
- **Eine Seite, ein Scrollbalken** (`src/ui/flowsticky.js`): Schrittliste, Schritt-Spalte und der Navigator der Startseite haben keinen eigenen Scrollbereich mehr. Passt eine Spalte ins Fenster, bleibt sie stehen; ist sie länger, läuft sie mit der Seite und hält an ihrem Ende. Nach Wahl eines Schritts ist sein Bild immer im Blick.
- **Mitlaufen (Tracking) am Handy:** vorher ein Hinweis „am PC einrichten“ mit „Trotzdem hier versuchen“. Die Bildauswertung lädt das Video jetzt sichtbar-unsichtbar in die Seite und startet es einmal (iPhone liefert sonst schwarze Bilder) und meldet einen Fehler statt still nicht mitzulaufen.
- Test `ux49` (Viewer, Spanisch, Editor-Kopf, Freigabe je Recht, Einstellungen, Scrollen, Tracking-Hinweis); angepasst: orient, chaptest, r19test, vidtest, fbtest, trashtest, roletest, uifix2 (55 Tests).

## v12.48.2 – Zwei an einer Anleitung, Demo für bis zu 5 Admins, Löschen im Master-Panel

- **Zusammenführen statt Überschreiben** (`src/core/merge.js`): speichern zwei Personen dieselbe Anleitung, werden die Änderungen gegen den gemeinsamen Ausgangsstand verglichen. Verschiedene Schritte oder Felder (Titel, Text, neue/gelöschte/verschobene Schritte) werden automatisch zusammengeführt („Zusammengeführt mit den Änderungen von …“). Nur wenn beide dieselbe Stelle geändert haben, fragt ein Dialog „Fassung von X / Meine Fassung“ – und auch dann bleiben alle anderen Änderungen erhalten. Der Ausgangsstand liegt auch im Gerätespeicher, damit funktioniert es nach Offline-Arbeit und Neuladen.
- Wird eine offene Anleitung woanders in den Papierkorb gelegt, sagt ein Hinweis das (statt „auf anderem Gerät geändert“).
- **Master-Panel** (neue Edge Function `master-admin`, nur Plattform-Admins, mit Protokoll in `mail_log`): Demo für 1–5 Personen (alle Admin, ein gemeinsames Team, Einladungsmails), Person löschen (Anmeldung + Profil, Anleitungen bleiben), offene Einladungen erneut senden / zurückziehen, Workspace löschen (mit eingetippter Kennung; Personen, Anleitungen, Durchläufe, Medien). Plattform-Admins und Workspaces mit Plattform-Admin sind geschützt.
- Tests: `collab` (zwei Browser an einer gemeinsamen Test-Datenbank, `/__db` im Test-Server), `mergeunit`, `mastertest` erweitert (54 Tests).

## v12.48.1 – UX-Durchlauf über Geräte

- Neuer Test `tests/ux_sweep.mjs`: 9 Seiten × iPhone SE / 13 Pro / Android / iPad / Desktop (DE + EN) – misst seitliches Scrollen, abgeschnittene Texte, Tippflächen, rohe Übersetzungsschlüssel, defekte Bilder
- Tippflächen auf Touch-Geräten ≈ 44 px (unsichtbar vergrößert, Optik unverändert); Kopfleisten-Buttons schrumpfen nicht mehr bei langem Titel; Auswahlfelder/Eingaben mind. 44 px hoch
- `supabase/tests/security.sql`: Erwartung „anonym sieht keine Workspace-Zeilen“ = 0
- Review-Dokument: Go-live-Testplan (Rollen, Geräte, Erstnutzer)

## v12.48.0 – Review vom 1. Oktober: Sicherheit, Orientierung, Checkliste, Offline, Einladungen
Grundlage: Review von Felix, Ewald und Björn (Checkliste mit Status im Doc „GIRI — Review follow-up“).

**Sicherheit – Migration `v013_security_hardening.sql` (vor dem Go-Live anwenden, danach `supabase/tests/security.sql`)**
- **Identität**: Die E-Mail (und ID) eines Profils ändert nur noch das System – sie folgt der Login-Adresse (Trigger auf `auth.users`). Vorher konnte jeder angemeldete Nutzer die E-Mail im eigenen Profil ändern und damit Team-Rollen anderer oder den Plattform-Admin übernehmen. `is_master()` liest die Adresse des Logins, nicht des Profils. Rolle/Admin ändern nur Admins, nie die eigene.
- **Workspace-Zeile**: Teams, Einladungen, Einstellungen, Branding und Name nur noch Admins (und Plattform-Admins); Ordner brauchen das Recht `projects`, eigene Symbole `edit`. Vorher konnte ein Creator sich selbst als Team-Admin eintragen oder Admins einladen.
- **Lesen**: Workspace-Zeilen sieht nur, wer dazugehört (plus Plattform-Admins). Vorher konnte jeder angemeldete Nutzer alle Workspaces lesen (Mitglieder, E-Mails, Rollen, Link-Passwort-Hashes). Werker-Links ohne Login bekommen das Branding über `ws_brand(ws)` – nur das Branding.
- **Storage**: Auflisten/Lesen über die API nur im eigenen Workspace-Ordner (vorher: alle Dateien aller Workspaces auflistbar); öffentliche Datei-URLs funktionieren weiter.
- Fehlende Workspace-Zeilen für Konten vor v12.47 werden nachgetragen; Tabelle `mail_log` (nur Service-Role) für die Limits der Einladungs-Mails.

**Einladungen**
- Neue Edge Function **`invite-notify`**: echte Einladungs-Mail (Deutsch oder Englisch, im Dialog wählbar) – wer lädt ein, in welche Firma, mit welcher Rolle; Knopf „Jetzt anmelden“ öffnet die Anmeldeseite mit eingetragener Adresse (`#/join/<mail>`); die drei Schritte; **Gültigkeit**: die Einladung bleibt offen, bis die Person sich anmeldet oder der Admin sie zurückzieht, der Code aus der zweiten Mail gilt 60 Minuten und einmal. Antwort geht an die einladende Person.
- Missbrauchsschutz: nur offene Einladungen des eigenen Workspace, nur Admins/Plattform-Admins, 1 Mail pro Minute und 5 pro Tag je Einladung, 30 pro Tag je Workspace (Kunden 200), 300 pro Stunde gesamt. Solange `v013` fehlt, verschickt die Function nichts und die App schickt wie bisher die Code-Mail.
- Verwaltung: offene Einladungen als Liste mit „eingeladen …“ / „Mail …“, **Erneut senden**, Zurückziehen mit Rückfrage; Hinweis, wenn die Person schon Mitglied ist oder GIRI in einem anderen Bereich nutzt. Master-Demo und Classic-Strukturimport verschicken dieselbe Einladung.
- Anmeldeseite aus der Einladung: Adresse eingetragen, Namensfeld offen, Hinweis „Du wurdest eingeladen“, Knopf „Anmelden“. Am Handy steht die Impressum-Zeile jetzt unter dem Formular.
- Mail-Vorlage `supabase/email-magic-link.html` neu: „GIRI“, Deutsch + Englisch, „gültig 60 Minuten, nur einmal“. **In Supabase für „Magic Link“ und „Confirm sign up“ einfügen**; „Email OTP Expiration“ muss 3600 s sein.

**Orientierung**
- Kopfzeile mit **Pfad** (Anleitungen › Ordner › Anleitung, jedes Glied anklickbar); der Zurück-Pfeil geht eine Ebene hoch; am Handy steht der volle Pfad in einer schmalen Zeile darunter.
- Eine Anleitung hat drei **Reiter**: Bearbeiten · Vorschau · Auswertung (Zähler offener Rückmeldungen am Reiter). Aus der Auswertung führt der Reiter bzw. Pfad zurück zur Anleitung (vorher: Sackgasse).
- **Editor-Kopf**: Titel, Status-Chip (öffnet Freigabe & Einstellungen), Version, Schrittzahl, „geändert … von …“; am PC bleibt der Kopf beim Scrollen stehen.
- **Avatar** → Profil (eigenes Foto, Name, Sprache, Abmelden); daneben **≡** → App-Menü (Statistik, Papierkorb · Verwaltung, Branding, KI, Import nur für Admins · Master · Installieren, Sprache, Beta). Branding nur noch für Admins.
- **Startseite**: Install-Banner → Meldungen → Kopf mit „Neue Anleitung“ und Suche → Filter. Status in der Reihenfolge Alle · Entwurf · In Prüfung · Veröffentlicht; aktive Filter als Chips mit „Zurücksetzen“. Navigator: erst Ordner, dann Teams, beide einklappbar (Teams bei > 6 eingeklappt), Suche bei vielen Teams, höchstens 40 Ordner + „alle zeigen“, „?“ erklärt Ordner und Teams.
- **Neuer Ordner**: ein Dialog (Name, sichtbar für alle oder ausgewählte Teams) statt zwei verschiedener Wege.
- **Verwaltung**: Teams als aufklappbare Karten mit Mitgliederzahl und Suche; Ordner- und Anleitungs-Zugriff einklappbar mit Suche, 50 Zeilen + „alle“.
- **Editor**: Kapitel wie Schritte per Griff ziehen (kein Kontextmenü), Umbenennen per Tipp auf den Namen.

**Werker-Ansicht mit Checkliste**
- Feste Leiste unten: **OK / Nicht OK** für den Schritt im Bild. Ohne Antwort geht es nicht weiter: Schritte danach sind ausgeblendet, Sprünge über Liste oder Übersicht werden abgelehnt. Vor dem Start darf man ein Kapitel wählen (auch per Kapitel-Link) – die Sperre beginnt dann dort, frühere Kapitel zählen als offen.
- **Kapitelkarten** zwischen den Kapiteln („Kapitel 1 erledigt – weiter mit Kapitel 2“).
- **Ehrliches Ende**: „Alles OK“, „Fertig – N Schritte nicht OK“ oder „N Schritte offen“ (mit Sprung zum offenen Schritt); Abschließen mit offenen Schritten fragt nach.
- Knöpfe auf der Markenfarbe lesbar (helle Markenfarbe → dunkle Schrift); kein Haken mehr in der Sprachliste.

**Offline**
- Flugmodus: „Neue Anleitung“ öffnet sofort die Kamera (vorher Warten aufs Netz, zweiter Tipp = zweite Anleitung); Startseite und Workspace kommen sofort vom Gerät.
- **Offline-Änderungen gingen verloren**: der Offline-Spiegel löschte das Kennzeichen „noch hochzuladen“ – behoben; Hochladen wird alle 30 s und beim Zurückkehren in die App erneut versucht.
- **Leere Seite offline nach einem Update**: Der Service Worker übernimmt eine neue Version erst, wenn alle Dateien dieser Version im Cache liegen; alte Dateien werden erst danach gelöscht.
- **Flackern** am PC: Seiten werden nur neu gezeichnet, wenn sich wirklich etwas geändert hat; die Scrollposition bleibt.
- Startseite: Globus-Symbol raus; dafür „Offline verfügbar machen“ für eine Anleitung oder einen ganzen Ordner (⋯-Menü) und eine Markierung „auf dem Gerät“.
- iPhone: kein Balken mehr am unteren Rand (Abstand für den Home-Balken sitzt jetzt am Inhalt).

**Import aus GIRI Classic**
- Versionsnummer, Datum der ersten Version und der letzten Änderung bleiben erhalten (vorher: Version 0 und Importdatum); ältere Versionen derselben Gruppe stehen als Historie in der Anleitung; ein Entwurf hat die Version davor.

**Texte**: alle Oberflächentexte DE/EN geprüft (1056 Schlüssel, deckungsgleich), fehlende Übersetzungen ergänzt; „KI“ im Deutschen, „AI“ im Englischen.

Tests: neu `chkgate`, `orient`, `invitetest`, `airplane`; angepasst `foldertest`, `trashtest`, `check4`, `chaptest`, `runtest`, `fbtest`, `r19test`, `uifix2`, `migtest`. 51 Tests.

## v12.47.2 – „GIRI“ statt „GIRI Go“, Logo in CI-Blau, BETA-Chip, ISO-Hinweis beim Login
- **Produktname**: überall in der Oberfläche „GIRI“ (Install-Banner, Menü, Master-Panel, Registrierungs-Mail); im PDF-Kopf steht nur noch das Logo, kein „GO“-Badge mehr. Kommentare/Doku im Code behalten „GIRI Go“ als Projektname.
- **Logo/App-Icon**: der blaue Pfeil war Indigo `#3B4DA6` – jetzt CI-Primärblau `#004EAD` (Icons 192/512/maskable, Apple-Touch, Favicon, Topbar-Logo, PDF-/Poster-Logo). Icon-URLs auf `?v=3` – Android/PC holen das neue Icon beim nächsten Manifest-Update; auf dem iPhone bleibt das alte Icon, bis die App neu auf den Home-Bildschirm gelegt wird.
- **BETA-Chip** neben dem Logo (alle Seiten, auch Login); Tipp darauf erklärt: App wird laufend ausgebaut, Anleitungen bleiben erhalten, Feedback an giri@ar-giri.de.
- **Login-Seite**: Kasten unter der Anmeldung „AR-Experts GmbH ist ISO 27001 zertifiziert. Diese neue Version der App befindet sich gerade in der Zertifizierung – Abschluss bis Ende 2026 geplant. Daten liegen in Frankfurt (EU).“
- Test `betatest`. 47 Tests.

## v12.47.1 – Installations-Banner ganz oben, Editor-Feinschliff, Werker-Endbildschirm im hellen Design
- **„Als App installieren“** ist jetzt ein dunkles Banner **ganz oben** auf der Startseite (über „Anleitungen / SOPs“), PC und Handy gleich, mit der Aussage „dann geht es auch offline“. Es erscheint **bei jedem Start im Browser** neu – „Später“ blendet es nur für diesen Tab aus. In der installierten App gibt es kein Banner. (Die frühere Karte/Zeile mit 7-Tage-Pause ist raus.)
- **Editor · Schritt hinzufügen**: Kacheln mit großen Symbolen (26 px) und Text darunter, auch am PC – das „T“ von „Leerer Schritt“ hatte keine Größe und füllte die Kachel.
- **Editor · Warnhinweis** steht jetzt **unter** Titel und Beschreibung (gestrichelter Knopf „Warnhinweis hinzufügen“), nicht mehr rechts neben dem Titel.
- **Editor · Formatierung** (B · Link · Nicht übersetzen · Liste · Nummeriert): einzelne Pillen mit Abstand statt einer grauen Leiste.
- **Editor · Papierkorb** (gelöschte Schritte): Pfeil, der sich beim Aufklappen dreht, plus „antippen zum Aufklappen“.
- **Editor · Versionsnummer** im Kopf zählt nach dem Veröffentlichen sofort hoch (wurde nur beim Öffnen gesetzt).
- **Werker-Link im hellen Design**: Untertitel und Zähler-Chips auf dem blauen „Geschafft“-Bildschirm waren grau auf blau bzw. weiß auf hellgrau; auf der Karte „Abgeschlossen“ war der Knopf „Schließen“ weiß auf weiß (leer). Alles lesbar, Test `uifix2`.

## v12.47.0 – Go-Live-Paket: Selbst-Registrierung, Pläne, Master-Admin · Editor-Feinschliff · Offline-Fehler
**Plattform (Migrationen v010–v012, Edge-Function `signup-notify`)**
- **Selbst-Registrierung**: Wer sich anmeldet, landet nach fester Reihenfolge: **1.** Einladung in irgendeinem Workspace (jede Domain erlaubt) → dort mit der eingeladenen Rolle · **2.** Workspace mit derselben Firmen-Domain und „Domain offen“ → dort als Creator · **3.** sonst ein **eigener Workspace** (Admin, Testphase 30 Tage, Domain geschlossen). Gleiche E-Mail-Domain heißt also **nicht** gleicher Account – der erste Nutzer lädt Kollegen unter Admin → Nutzer ein. Bestehende Workspaces (ar-giri.com) bleiben wie bisher: Domain offen, Plan `active`.
- **Benachrichtigung**: bei jeder Registrierung geht eine Mail an die Plattform-Admins (Person, Rolle, Workspace, Art: neuer Trial / Einladung / Domain, Plan, Nutzer- und Anleitungszahl, Knopf „Master-Admin öffnen“). HubSpot-Abgleich läuft weiter wie bisher (`hs_on_profile`).
- **Pläne pro Workspace**: `trial` (Testphase), `active`, `demo`, `suspended`; Gültig-bis, Plätze, interne Notiz, Firmenname, „Domain offen“. Dashboard zeigt bei Testphase/Demo „noch N Tage“, nach Ablauf „abgelaufen – melde dich“ (weiter nutzbar), bei `suspended` „pausiert“ – dann sind Anleitungen nur noch lesbar (der Server lehnt Schreiben ab). Normale Admins können Plan-Felder nicht ändern (Trigger verwirft es).
- **Master-Admin** (`#/master`, Menüeintrag nur für Plattform-Admins – Tabelle `platform_admins`, Start: bjoern@ar-giri.com): alle Workspaces mit Plan, Nutzern, Anleitungen, letztem Login; Suche; Plan bearbeiten; **Nutzer in einen anderen Workspace verschieben** (mit oder ohne Anleitungen); **Workspaces zusammenführen** (Nutzer, Anleitungen, Teams, Ordner, Symbole, Einladungen wandern, der leere Workspace wird gelöscht); Nutzerliste mit „Login-Link senden“; **Demo-Konto anlegen** (Workspace mit Plan `demo`, Einladung für die Interessenten-Adresse, optional Login-Link); weitere Plattform-Admins hinzufügen. Alle Funktionen prüfen `is_master()` im SQL.
- **Einladungen** akzeptieren jetzt jede E-Mail-Adresse (vorher nur die Firmen-Domain).
- Tests: `supabase/tests/signup.sql` (12 Fälle, auf Frankfurt grün), `mastertest` (Browser: Menü/Zugriff, Tabelle, Plan speichern, verschieben, Demo, zusammenführen, Banner trial/abgelaufen/pausiert, Einladung fremde Domain).

**Editor / Bedienung**
- **Emoji-Vorschau** im Symbol-Reiter ist groß (66 px statt 11 px – eine Beschriftungsregel hatte seit v12.44 die Größe überschrieben); Kacheln 100 px.
- **Wischen am Handy**: Wisch nach links/rechts über dem Bild wechselt zum nächsten/vorigen Schritt (≥ 60 px, schnell, ohne Symbol unter dem Finger).
- **Anleitung kopieren**: ⋯-Menü der Karte (Übersicht) und im Editor → „Duplizieren“: Kopie „Kopie von …“ als Entwurf mit eigenen IDs, Medien werden serverseitig kopiert, Fortschrittsanzeige, danach direkt im Editor.
- **„Schritt hinzufügen“**-Menü: Überschrift ist jetzt als Titel der Knöpfe darunter erkennbar (Versalien, Trennlinie, grauer Kasten).
- **Offline-Lampe**: „Offline“-Pille schwarz mit gelbem Punkt und gelbem Rand statt gelb auf gelb.
- **Login-Seite**: die Liste „auf diesem Gerät gespeicherte Anleitungen“ steht unter der Anmeldung mit klarer Überschrift („Ohne Anmeldung: …“) statt davor.

**Offline / Flugmodus**
- Kein „Fehler: Load failed“ mehr nach einer Aufnahme im Flugmodus: die Upload-Warteschlange startet gar nicht erst ohne Netz, ein abgelehnter Upload wird still in die Warteschlange zurückgelegt, Netzfehler werden nicht mehr als Fehler-Toast gezeigt.
- Neue Anleitung offline + mehrere Schritte: alle Schritte bleiben in der Übersicht (der Offline-Spiegel hatte neuere Objekte im Speicher durch ältere Kopien ersetzt) und es gibt keinen falschen Konflikt „auf anderem Gerät geändert“ mehr (der Upload hatte eine zweite Serverkopie mit altem Stand gespeichert). Test `offlinerec`.

45 Tests grün (v12.47.1: 46).

## v12.46.1 – Vorladen auf drei Schritte
- **Web-Anleitung (Werker-Link)**: Der Viewer lädt jetzt den sichtbaren Schritt plus **drei Schritte voraus** und einen zurück (vorher 1,5 Bildschirmhöhen in beide Richtungen); weiter entfernte Clips werden wieder freigegeben.
- **Editor am Handy**: Hintergrund-Cache holt die nächsten **drei** Schritte statt zwei (PC unverändert: alle).

## v12.46.0 – Video-Cache im Editor: Clips kommen im Hintergrund aufs Gerät
- **Vorladen**: Beim Öffnen einer Anleitung im Editor holt die App die Clips/Fotos der Schritte im Hintergrund vom Server und legt sie auf dem Gerät ab (IndexedDB, `media` mit `cache:true, editor:true`) – Reihenfolge: die Schritte nach dem gewählten zuerst, dann die davor, der aktuelle zuletzt (den spielt der Player derweil vom Server). **PC: alle Schritte, Handy: nur die nächsten zwei** (Datenvolumen). Stopp, sobald unter 300 MB Speicher frei sind oder der Browser die Quote meldet. Erster Download läuft 1,5 s nach dem Öffnen, einer nach dem anderen, damit das laufende Video nicht ausgebremst wird.
- **Effekt**: Schrittwechsel ist danach sofort (`blob:`-URL statt Server), auch offline; beim zweiten Öffnen liegt alles schon da. Der grüne Punkt links oben am Vorschaubild zeigt „Clip ist auf diesem Gerät“ (auch für hier aufgenommene Clips).
- **Aufräumen**: Einträge stehen in `localStorage` `gg_ecache` (id, Anleitung, Zeit) – kein Lesen der Blobs. Einmal täglich (20 s nach dem Start) fliegen Clips raus, deren Anleitung 14 Tage nicht im Editor war; Clips, die eine Offline-Kopie eines Werkers braucht, bleiben. Jedes Öffnen im Editor verlängert um 14 Tage.
- Neu: `src/media/preload.js` (`preloadInstr`, `pruneEditorCache`, `touchEditorCache`), Test `preloadtest` (Reihenfolge, Punkt, blob-Wiedergabe, Handy-Limit, Aufräumen mit Offline-Kopie).

## v12.45.1 – Editor am PC: Symbolleiste kommt ins Bild, Video zeigt sofort das Standbild
- **Symbolleiste unter dem Bild (PC)**: Die Bühne ist am PC eine eigene Scroll-Spalte; die Bibliothek stand unter dem Bild außerhalb des sichtbaren Bereichs – man sah nur die Reiter am unteren Rand, „es klappte nichts aus“. Jetzt scrollt ein Klick auf Reiter, Kategorie oder Gruppe die ganze Leiste ins Bild, ein Klick auf ein Symbol scrollt das Bild zurück (das Symbol liegt dann sichtbar in der Mitte). Die Leiste ist höher (bis 52 % der Fensterhöhe statt 236 px).
- **Video-Schritt**: Das Standbild (Poster) erscheint sofort, dazu ein Ladekreis, bis das Video vom Server da ist (vorher: schwarze Fläche, „lädt ewig“ – die Ladezeit selbst hängt an der Videogröße, ≤ 1280 px/60 s ≈ 15 MB).
- **Schnellerer Schrittwechsel**: Die 3D-Vorschauen der Symbolkacheln werden einmal gezeichnet und danach kopiert (die Leiste wurde bei jedem Schrittwechsel komplett neu gerendert).
- Neuer Test `docktest` (Sichtbarkeit der Leiste nach Reiter-Klick, Bild nach Auswahl, Poster/Ladekreis, Zeiten).

## v12.45.0 – Rechte auf dem Server (Freigaben, Team-Sichtbarkeit, Rollen), DSGVO-Auskunft/-Löschung
Bis hierhin prüfte die Datenbank nur grob (Workspace, „mehr als Viewer“); wer freigeben, veröffentlichen oder fremde Team-Anleitungen
ändern darf, entschied allein die Oberfläche. Jetzt entscheidet die Datenbank – mit denselben Regeln wie `src/core/roles.js`.
- **Migration `v005_server_side_authorisation`**: Rollen/Fähigkeiten als SQL (`norm_role`, `role_caps`, `my_roles_in`, `my_can`, `my_can_any`);
  Policies pro Team-Rolle (Anlegen/Löschen = Bearbeitungsrecht, Ändern = Bearbeiten oder Freigabe-/Sperrrecht); Trigger `instr_authz_guard`:
  technische bzw. DSGVO-Freigabe nur mit der passenden Rolle, **Veröffentlichen nur mit beiden Freigaben**, Inhaltsänderungen nur mit
  Bearbeitungsrecht (Metadaten wie Freigaben/Status/Historie zählen nicht als Inhalt); Service-Rolle und Wartungsfunktionen bleiben frei.
- **`v006`**: Org-Admin = `is_admin` **oder** Rolle `admin` – wie `my_admin()` und die App. **`v007`**: `profiles.role` akzeptiert die acht
  Classic-Rollen (bisher scheiterten Rollen-Menü und Einladungen mit Editor/Tech-Freigeber/… an einer alten DB-Prüfung).
- **`v008` Team-Sichtbarkeit als Policy, schnell**: Spalte `instructions.teams_eff` (eigene Teams ∪ Ordner-Teams, nur existierende), per
  Trigger auf `instructions` und Kaskade aus `workspaces` (Ordner/Teams geändert) gepflegt; die Select-Policy vergleicht die Spalte mit den
  Teams des Aufrufers (einmal pro Abfrage ermittelt). Kopf-Abfrage der 1.095 Anleitungen: 710 ms → 1,5 ms. Außerdem: **keine Rechte in
  fremden Teams** – eine Anleitung mit Team, in dem man nicht Mitglied ist, gibt keine Rolle mehr (vorher fiel die DB und die App auf die
  Workspace-Rolle zurück; ein Creator konnte so Anleitungen für fremde Teams anlegen). `rolesIn()` in der App gleichgezogen.
- **`v009`**: Trigger-Funktionen nicht per API aufrufbar, `search_path` der Helfer fixiert. Advisor: 0 ERROR; WARNs = gewollte öffentliche
  Werker-Funktionen und Policy-Helfer, die nur über den Aufrufer Auskunft geben.
- **DSGVO**: `gdpr_export_user(email)` (Profil, Team-Mitgliedschaften, Einladungen, erstellte/bearbeitete/freigegebene Anleitungen, Feedback,
  Durchläufe, KI-Protokoll als JSON) und `gdpr_erase_user(email)` (Login + Profil + Mitgliedschaften + Einladungen weg; Name in Anleitungen,
  Freigaben, Historie, Feedback, Durchläufen → „Gelöschter Nutzer“; KI-Protokoll entkoppelt; die Anleitungen bleiben der Firma) – nur Org-Admins.
  Admin → Nutzer: ⤓ Auskunft als JSON-Datei, 🗑 Nutzer löschen (mit Erklärung im Bestätigungsdialog).
- **Tests**: `supabase/tests/authz.sql` – 29 Prüfungen als simulierte Nutzer (Creator, Editor, Viewer, Tech-Freigeber, Team-Viewer/-Editor,
  Admin, anonym): Sichtbarkeit, Anlegen/Ändern/Löschen, Freigaben, Veröffentlichen, Kaskade der Team-Spalte, DSGVO-Export/-Löschung,
  Laufzeit der Kopf-Abfrage; jede Schreibaktion läuft in einem Savepoint und wird zurückgerollt. Alle 29 grün auf Frankfurt.
  Neuer Playwright-Test `authztest` (Admin-DSGVO-Knöpfe, abgelehnte Änderung, Sichtbarkeit fremder Ordner).
- **App**: lehnt der Server eine Änderung ab (42501), wird sie nicht als „offline gespeichert“ endlos wiederholt, sondern verworfen und der
  Serverstand geladen (Hinweis). Classic-Import: ohne Bearbeitungsrecht für das Team der Anleitung wird die Zeile übersprungen (klare Meldung
  statt Serverfehler); ohne beide Freigaberechte kommt eine in Classic veröffentlichte Anleitung als Entwurf mit Vermerk in der Historie.
  `effRole`/`ROLE_RANK` (ungenutzt) entfernt.
- `supabase/schema.sql` um v005–v009 ergänzt; `ARCHITECTURE.md` (§3 Sicherheit, §4 Datenmodell, §7 Schulden) aktualisiert.

## v12.44.1 – Sicherheits-Aufräumen, CI, Architektur-Dokument, größere Emoji-Kacheln
- **Migrations-Helfer entfernt**: im alten Irland-Projekt `giri_export`, `giri_export_delta`, `giri_export_vault` gelöscht; im Frankfurt-Projekt `_mig_fetch`/`_mig_fetch_delta`/`_mig_apply` und die Tabellen `_mig`/`_mig_obj` (Migration `v004_cleanup_migration_helpers`); die Edge Functions `mig-env` (alt) und `mig-copy` (neu) antworten nur noch 410 und tragen keine Logik/Geheimnisse mehr (im Dashboard löschen). Supabase-Advisor: keine ERROR-Meldungen mehr; die verbleibenden WARNs sind gewollte öffentliche Funktionen (`open_instr`, `instr_public`, `instr_locked`, `feedback_poke` – Werker-Links ohne Login) und der Hinweis „Leaked-Password-Protection“ (es gibt keine Passwörter: Login per Code/Link oder Google).
- `purge_trash()` nur noch für die Service-Rolle, `my_can_write()` nicht mehr anonym aufrufbar, `search_path` der URL-Rewrite-Trigger fixiert.
- **CI**: `.github/workflows/ci.yml` – Build + komplette Playwright-Suite bei jedem Push/PR, Screenshots als Artifact.
- **`ARCHITECTURE.md`**: Laufzeit (Browser · Cloudflare · Supabase Frankfurt · DeepL/Vertex europe-west3/Resend/HubSpot), wo Sicherheit verbindlich geprüft wird (RLS, Edge Functions, Storage-Policies) und was nur Oberfläche ist, Datenmodell, Offline/Sperren, Bauen/Testen/Release, bekannte Schulden.
- Emoji-Kacheln in der Bibliothek: Glyphe 46 px (vorher 30 px), Kacheln entsprechend größer.
