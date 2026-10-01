# GIRI Go – Quellcode (ab v0.20)

Ein Vite-Projekt, das zu **einer statischen Seite** gebaut wird (`index.html` + `assets/` im Repo-Root = das, was GitHub Pages ausliefert).

```
app/index.html      Einstieg (HTML-Shell, CDN-Bibliotheken, Version, Supabase-Konfiguration) – hier die Version hochzählen
src/main.js         Start: Sprache, Event-Listener, Boot (Supabase-Client, erster Render)
src/styles/         Stylesheet, nach Bereichen getrennt (Tokens, Shell, Primitives, Dashboard, Capture, Editor, Viewer, Login)
src/core/           Grundlagen: i18n, Storage (IndexedDB), Supabase-Client, State (S + G), Workspace, Rich-Text, Übersetzung (DeepL), Link-Passwörter, Upload-Queue, Auth (inkl. Sitzungsdauer), Helfer, Offline-Spiegel (offline.js), Offline-Kopien für Werker (viewcache.js), Einladungs-Mail (invite.js)
src/ui/             Icons, Topbar (Pfad, Profil, App-Menü), Reiter einer Anleitung (instrnav.js), Charts
src/annotations/    Symbole auf Bild/Video: Zeichnen, 3D, Animation, Handles (gemeinsam für Editor, Viewer, PDF)
src/views/          Seiten: Login, Dashboard/Projekte, Capture (Kamera), Editor, Viewer (Werker), Statistik, Admin, Ergebnisse/Feedback, Share, Branding, Symbole
src/media/          Video-Konverter (WebCodecs → MP4), Import/Ersetzen von Schritten
src/pdf/            Schriften, SOP-Export, QR-Poster
src/app/            Router, PWA/Update-Check, Beispiel-Anleitung
tests/              Playwright-Suite gegen den gebauten Stand (`npm test`), Supabase durch einen In-Memory-Mock ersetzt
supabase/           Schema (SQL), Edge Functions, Mail-Vorlage
```

Konventionen
- `S` (in `core/state.js`) hält Nutzer, Anleitungen, Workspace; `G` hält die veränderlichen Einzelwerte (Sprache, Supabase-Client, Update-Status …). Module importieren beides bei Bedarf.
- Jede Funktion lebt in genau einem Modul und wird explizit exportiert/importiert – kein globaler Namensraum.
- Datenmodell und Backend sind unverändert gegenüber v0.19 (gleiche Tabellen, gleiche RLS).
