// tests/fn/device-login.test.ts – the QR hand-over of the edge function device-login, end to end against the in-memory stub
// Run: node tests/run_fn.mjs   (needs Deno; see the file)
import { db, links, users } from "./supabase-stub.ts";
Deno.env.set("SUPABASE_URL", "http://stub"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub");
const PC = "aa.bb.cc", OTHER = "dd.ee.ff";
users[PC] = { id: "u1", email: "bjoern@ar-giri.com" }; users[OTHER] = { id: "u2", email: "anna@ar-giri.com" };
let handler: (r: Request) => Promise<Response> = async () => new Response("");
// @ts-ignore – capture the handler instead of listening on a port
Deno.serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown() {} }; };
const call = async (body: unknown, jwt?: string) => { const r = await handler(new Request("http://x", { method: "POST", headers: jwt ? { Authorization: "Bearer " + jwt } : {}, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() }; };
await import("../../supabase/functions/device-login/index.ts");
const log = (...a: unknown[]) => console.log(...a);
db.device_logins = []; db.profiles = [{ id: "u1", name: "Björn" }];
log("create without login:", (await call({ action: "create" })).j.error);
const c1 = await call({ action: "create" }, PC); log("create:", c1.s, "| secret length", c1.j.secret.length, "| stored only as a hash:", db.device_logins[0].secret_hash !== c1.j.secret && !JSON.stringify(db.device_logins).includes(c1.j.secret));
const { id, secret } = c1.j;
log("claim with a wrong secret:", (await call({ action: "claim", id, secret: secret.slice(0, -1) + (secret.endsWith("A") ? "B" : "A") })).j.error);
log("status by another person:", (await call({ action: "status", id }, OTHER)).j.error);
log("approve before the scan:", (await call({ action: "approve", id, ok: true, code: 10 }, PC)).j.error);
const cl = await call({ action: "claim", id, secret, device: "iPhone · Safari <script>" }); log("claim:", cl.s, "| number", cl.j.code, "| claim secret", cl.j.claim?.length, "| name", cl.j.name, "| email", cl.j.email);
log("second scan:", (await call({ action: "claim", id, secret, device: "Android" })).j.error);
const st = await call({ action: "status", id }, PC); log("PC sees:", st.j.status, "|", st.j.device, "| PC gets the number from the server:", "code" in st.j);
// the attack from the review: someone who only saw the QR polls in a loop
log("poll with the QR secret only (no claim secret):", (await call({ action: "poll", id, secret })).j.error, "| with a made-up claim:", (await call({ action: "poll", id, secret, claim: secret })).j.error);
log("phone polls before the PC allows:", (await call({ action: "poll", id, secret, claim: cl.j.claim })).j.status, "| tokens so far:", links.length);
log("approve without the number:", (await call({ action: "approve", id, ok: true }, PC)).j.error);
const c1b = await call({ action: "create" }, PC); const clb = await call({ action: "claim", id: c1b.j.id, secret: c1b.j.secret, device: "x" });
log("approve with a wrong number:", (await call({ action: "approve", id: c1b.j.id, ok: true, code: clb.j.code === 99 ? 98 : clb.j.code + 1 }, PC)).j.error, "| then the phone sees:", (await call({ action: "poll", id: c1b.j.id, secret: c1b.j.secret, claim: clb.j.claim })).j.status);
// the real flow (a fresh code – the one above was replaced by c1b)
const c2 = await call({ action: "create" }, PC); const cl2 = await call({ action: "claim", id: c2.j.id, secret: c2.j.secret, device: "iPhone · Safari" });
log("approve with the number from the phone:", (await call({ action: "approve", id: c2.j.id, ok: true, code: String(cl2.j.code) }, PC)).j.status);
const p1 = await call({ action: "poll", id: c2.j.id, secret: c2.j.secret, claim: cl2.j.claim }); log("poll after approve:", p1.j.status, "| token:", !!p1.j.token_hash, "| type", p1.j.type, "| for", p1.j.email);
log("poll again:", (await call({ action: "poll", id: c2.j.id, secret: c2.j.secret, claim: cl2.j.claim })).j.status, "| tokens issued:", links.length);
// e-mail changed after the code was made → the token is for the current e-mail
const c3 = await call({ action: "create" }, PC); const cl3 = await call({ action: "claim", id: c3.j.id, secret: c3.j.secret }); await call({ action: "approve", id: c3.j.id, ok: true, code: cl3.j.code }, PC);
users[PC].email = "bjoern.neu@ar-giri.com"; log("token after an e-mail change goes to:", (await call({ action: "poll", id: c3.j.id, secret: c3.j.secret, claim: cl3.j.claim })).j.email); users[PC].email = "bjoern@ar-giri.com";
// cancel on the phone
const c4 = await call({ action: "create" }, PC); const cl4 = await call({ action: "claim", id: c4.j.id, secret: c4.j.secret });
log("cancel on the phone:", (await call({ action: "cancel", id: c4.j.id, secret: c4.j.secret, claim: cl4.j.claim })).j.status, "| PC sees:", (await call({ action: "status", id: c4.j.id }, PC)).j.status, "| PC can still allow:", (await call({ action: "approve", id: c4.j.id, ok: true, code: cl4.j.code }, PC)).j.error);
// replaced + expiry
const c5 = await call({ action: "create" }, PC); const c6 = await call({ action: "create" }, PC);
log("older open code after a new one:", (await call({ action: "claim", id: c5.j.id, secret: c5.j.secret })).j.error);
db.device_logins.find((r) => r.id === c6.j.id).expires_at = new Date(Date.now() - 1000).toISOString();
log("expired code:", (await call({ action: "claim", id: c6.j.id, secret: c6.j.secret })).j.error, "| status for the PC:", (await call({ action: "status", id: c6.j.id }, PC)).j.status);
let last: any = null; for (let k = 0; k < 4; k++) last = await call({ action: "create" }, PC);
log("11th code within an hour:", last.s, last.j.error || "ok");
log("NO ERRORS");
