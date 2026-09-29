# Migrationen

Eine Datei pro Änderung am Datenbankschema, angewendet über das Supabase-MCP (`apply_migration`) oder die CLI, **und** derselbe Block
angehängt an `../schema.sql` (die vollständige Historie seit v0). Die Migrationen v001–v004 wurden vor Einführung dieses Ordners
direkt in `schema.sql` geführt (Supabase-Migrationsliste: `v001…v004`).

| Datei | Version | Inhalt |
|---|---|---|
| `v005_server_side_authorisation.sql` | 12.45.0 | Rollen/Fähigkeiten als SQL, Policies pro Team-Rolle, Freigabe-Trigger `instr_authz_guard`, DSGVO-RPCs |
| `v006_org_admin_alias.sql` | 12.45.0 | Org-Admin = `is_admin` oder Rolle `admin` (wie `my_admin()` und die App) |
| `v007_profile_roles_check.sql` | 12.45.0 | `profiles.role` akzeptiert die acht Classic-Rollen |
| `v008_visibility_performance.sql` | 12.45.0 | Spalte `teams_eff` + Trigger/Kaskade, Sichtbarkeits-Policy ohne JSON-Scans, keine Rechte in fremden Teams |
| `v009_advisor_cleanup.sql` | 12.45.0 | Trigger-Funktionen nicht per API aufrufbar, `search_path` der Helfer |

Prüfung nach jeder Rechte-Änderung: `../tests/authz.sql` (als `postgres` ausführen, alle Zeilen `ok = true`; jede Schreibaktion wird
zurückgerollt).
