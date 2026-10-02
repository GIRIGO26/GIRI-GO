import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// GIRI – master-admin (v1, v12.48.1): actions only a platform admin (table platform_admins, matched against the e-mail of the LOGIN,
// not of the profile) may run. They need the service role because they reach across workspaces, into auth.users and into storage.
//   create_demo     {name, days, emails[1..5], team}  → a demo workspace: every listed person is invited as org admin, all in ONE team
//   withdraw_invite {ws, email}                       → an open invitation is removed (the address can be invited again anywhere)
//   delete_user     {email}                           → the login, the profile and its team memberships go; the person's instructions
//                                                       stay in the workspace (they belong to the company). Platform admins are refused.
//   delete_workspace{ws, confirm}                     → everything of a workspace: people (logins), instructions, runs, views, feedback,
//                                                       logs, media files, the workspace row. confirm must repeat the ws id. A workspace
//                                                       with a platform admin in it is refused (protects ar-giri.com).
// Every action is written to mail_log (kind 'master:<action>') as an audit trail.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "demo";
const rnd = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "login_required" }, 401);
    const { data: u, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !u?.user?.email) return json({ error: "login_required" }, 401);
    const me = u.user.email.toLowerCase();
    const { data: pa } = await admin.from("platform_admins").select("email");
    const masters = new Set((pa || []).map((x: { email: string }) => String(x.email).toLowerCase()));
    if (!masters.has(me)) return json({ error: "platform_admin_only" }, 403);
    const body = await req.json().catch(() => ({}));
    const act = String(body.action || "");
    const audit = async (ws: string, to: string, ok = true, error: string | null = null) => {
      await admin.from("mail_log").insert({ ws: ws || "-", kind: "master:" + act, by_user: u.user.id, to_email: to || "-", ok, error });
    };

    if (act === "create_demo") {
      const emails: string[] = [...new Set<string>((Array.isArray(body.emails) ? body.emails : []).map((e: unknown) => String(e || "").trim().toLowerCase()).filter(Boolean))];
      if (!emails.length || emails.length > 5) return json({ error: "emails_1_to_5" }, 400);
      const bad = emails.filter((e) => !MAIL.test(e)); if (bad.length) return json({ error: "bad_email", emails: bad }, 400);
      const { data: taken } = await admin.from("profiles").select("email, ws").in("email", emails);
      if (taken && taken.length) return json({ error: "already_member", emails: taken.map((t: { email: string; ws: string }) => t.email + " (" + t.ws + ")") }, 409);
      const name = String(body.name || "").trim().slice(0, 80) || "Demo " + emails[0].split("@")[1];
      const days = Math.max(1, Math.min(365, Number(body.days) || 30));
      const ws = "demo-" + slug(name) + "-" + rnd(4);
      const at = Date.now();
      const team = { id: "t" + rnd(8), name: String(body.team || "").trim().slice(0, 60) || name, members: emails.map((e) => ({ email: e, role: "team_admin" })) };
      const row = {
        ws, name, brand: {}, folders: [], symbols: [], settings: {}, teams: [team],
        invites: emails.map((e) => ({ email: e, role: "admin", at, by: "master", team: team.id })),
        plan: "demo", plan_until: new Date(at + days * 864e5).toISOString(), open_domain: false, owner_email: emails[0],
        plan_note: "Demo-Konto (" + emails.length + " Admin" + (emails.length > 1 ? "s" : "") + ", angelegt von " + me + ")", updated_at: new Date(at).toISOString(),
      };
      const { error } = await admin.from("workspaces").insert(row);
      if (error) { await audit(ws, emails.join(","), false, error.message); return json({ error: error.message }, 500); }
      await audit(ws, emails.join(","));
      return json({ ok: true, ws, emails, team: team.name, until: row.plan_until });
    }

    if (act === "withdraw_invite") {
      const ws = String(body.ws || ""), email = String(body.email || "").trim().toLowerCase();
      const { data: w } = await admin.from("workspaces").select("invites").eq("ws", ws).maybeSingle();
      if (!w) return json({ error: "not_found" }, 404);
      const left = (w.invites || []).filter((i: { email: string }) => String(i.email).toLowerCase() !== email);
      await admin.from("workspaces").update({ invites: left }).eq("ws", ws);
      await audit(ws, email);
      return json({ ok: true, removed: (w.invites || []).length - left.length });
    }

    // removes a person (login + profile) and their team memberships; instructions stay with the company
    const dropUser = async (p: { id: string; email: string; ws: string }) => {
      const { data: w } = await admin.from("workspaces").select("teams").eq("ws", p.ws).maybeSingle();
      if (w && Array.isArray(w.teams)) {
        const teams = w.teams.map((tm: { members?: { email: string }[] }) => ({ ...tm, members: (tm.members || []).filter((m) => String(m.email).toLowerCase() !== p.email.toLowerCase()) }));
        await admin.from("workspaces").update({ teams }).eq("ws", p.ws);
      }
      await admin.from("instructions").update({ owner: null }).eq("owner", p.id);
      const { error } = await admin.auth.admin.deleteUser(p.id); // profiles go with it (on delete cascade)
      if (error) { await admin.from("profiles").delete().eq("id", p.id); return error.message; }
      return null;
    };

    if (act === "delete_user") {
      const email = String(body.email || "").trim().toLowerCase();
      if (masters.has(email)) return json({ error: "is_platform_admin" }, 400);
      const { data: p } = await admin.from("profiles").select("id, email, ws").eq("email", email).maybeSingle();
      if (!p) {
        // a login without profile (e.g. a sign-up that never finished) is removed too
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const au = list?.users?.find((x) => (x.email || "").toLowerCase() === email);
        if (!au) return json({ error: "not_found" }, 404);
        await admin.auth.admin.deleteUser(au.id); await audit("-", email);
        return json({ ok: true, login_only: true });
      }
      const err = await dropUser(p); await audit(p.ws, email, !err, err);
      return err ? json({ error: err }, 500) : json({ ok: true, ws: p.ws });
    }

    if (act === "delete_workspace") {
      const ws = String(body.ws || "");
      if (!ws || body.confirm !== ws) return json({ error: "confirm_mismatch" }, 400);
      const { data: people } = await admin.from("profiles").select("id, email, ws").eq("ws", ws);
      if ((people || []).some((p: { email: string }) => masters.has(String(p.email).toLowerCase()))) return json({ error: "has_platform_admin" }, 400);
      const out: Record<string, number> = { users: 0, instructions: 0, files: 0 };
      for (const p of people || []) { if (!(await dropUser(p))) out.users++; }
      // media: <ws>/… plus run photos (runs/<run id>/…) and feedback photos (runs/fb/<instruction id>/…)
      const { data: runs } = await admin.from("runs").select("id").eq("ws", ws);
      const { data: ins } = await admin.from("instructions").select("id").eq("ws", ws);
      const prefixes = [ws, ...(runs || []).map((r: { id: string }) => "runs/" + r.id), ...(ins || []).map((i: { id: string }) => "runs/fb/" + i.id)];
      const listAll = async (prefix: string): Promise<string[]> => {
        const files: string[] = []; let offset = 0;
        for (;;) {
          const { data } = await admin.storage.from("media").list(prefix, { limit: 1000, offset });
          if (!data || !data.length) break;
          for (const f of data) { const path = prefix + "/" + f.name; if (f.id) files.push(path); else files.push(...await listAll(path)); }
          if (data.length < 1000) break; offset += 1000;
        }
        return files;
      };
      for (const pre of prefixes) {
        const files = await listAll(pre);
        for (let k = 0; k < files.length; k += 500) { const { error } = await admin.storage.from("media").remove(files.slice(k, k + 500)); if (!error) out.files += Math.min(500, files.length - k); }
      }
      out.instructions = (ins || []).length;
      for (const tbl of ["runs", "views", "feedback", "ai_usage", "client_log", "instructions"]) await admin.from(tbl).delete().eq("ws", ws);
      await admin.from("workspaces").delete().eq("ws", ws);
      await audit(ws, "-", true, JSON.stringify(out));
      return json({ ok: true, ...out });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
