// tests/fn/supabase-stub.ts – an in-memory stand-in for npm:@supabase/supabase-js in edge-function tests (Deno, see run_fn.mjs).
// Implements only what the functions use: from().select/insert/update/delete with eq/in/gte/lt/limit/order/maybeSingle, a head count,
// auth.getUser(jwt) and auth.admin.generateLink.
export const db: Record<string, any[]> = {};
export const users: Record<string, { id: string; email: string }> = {};
export const links: any[] = [];
class Q {
  t: string; op = "select"; f: ((r: any) => boolean)[] = []; payload: any = null; single = false; head = false; count = false; ret = false;
  constructor(t: string) { this.t = t; if (!db[t]) db[t] = []; }
  select(_c?: string, o?: { head?: boolean; count?: string }) { if (this.op !== "select") this.ret = true; if (o?.head) this.head = true; if (o?.count) this.count = true; return this; }
  eq(k: string, v: unknown) { this.f.push((r) => r[k] === v); return this; }
  in(k: string, a: unknown[]) { this.f.push((r) => a.includes(r[k])); return this; }
  gte(k: string, v: string) { this.f.push((r) => String(r[k]) >= v); return this; }
  lt(k: string, v: string) { this.f.push((r) => String(r[k]) < v); return this; }
  ilike(k: string, v: string) { this.f.push((r) => String(r[k]).toLowerCase() === v.toLowerCase()); return this; }
  limit() { return this; } order() { return this; }
  maybeSingle() { this.single = true; return this; }
  insert(o: any) { this.op = "insert"; this.payload = o; return this; }
  update(o: any) { this.op = "update"; this.payload = o; return this; }
  delete() { this.op = "delete"; return this; }
  then(res: (x: any) => unknown, rej?: (e: unknown) => unknown) {
    const T = db[this.t]; let rows = T.filter((r) => this.f.every((fn) => fn(r))); let data: any = null;
    if (this.op === "insert") { const arr = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((x: any) => ({ created_at: new Date().toISOString(), ...x })); T.push(...arr); data = arr; }
    else if (this.op === "update") { rows.forEach((r) => Object.assign(r, this.payload)); data = this.ret ? rows.map((r) => ({ ...r })) : null; }
    else if (this.op === "delete") { db[this.t] = T.filter((r) => !rows.includes(r)); data = null; }
    else data = this.single ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r }));
    const out = this.count ? { data: this.head ? null : data, count: rows.length, error: null } : { data, error: null };
    return Promise.resolve(out).then(res, rej);
  }
}
export function createClient(_u?: string, _k?: string, _o?: unknown) {
  return {
    from: (t: string) => new Q(t),
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getUser: async (jwt: string) => users[jwt] ? { data: { user: users[jwt] }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } },
      admin: {
        generateLink: async (o: { type: string; email: string }) => { links.push(o); return { data: { properties: { hashed_token: "hashed-" + links.length, verification_type: "magiclink" } }, error: null }; },
        getUserById: async (id: string) => { const u = Object.values(users).find((x) => x.id === id); return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "not found" } }; },
      },
    },
  };
}
