import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { Database } from "../server/database";
import { createPlatform } from "../server/platform";
import { copyDatabase, recoverEvent, seedDatabase } from "../server/maintenance";
import { createEmptyDraft } from "../src/types";
import { fallback, emptyFields } from "../shared/contract";
import { type Command, type Session, type Snapshot } from "../shared/api";

const origin = "http://localhost:5173";
const password = "test-only-password-2026";
type Client = Session & { cookie: string };
async function fixture(t: TestContext, secureCookies = false) {
  const root = resolve("node_modules/.tmp"); mkdirSync(root, { recursive: true });
  const folder = mkdtempSync(join(root, "nomadex-backend-")); const path = join(folder, "app.sqlite");
  const db = new Database(path); let analyzed = 0;
  const server = createPlatform(db, { origins: [origin], secureCookies, staticRoot: resolve("public"), analyze: async input => { analyzed++; const { mode: _mode, promptVersion: _version, ...output } = fallback(input); return JSON.stringify(output); } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw Error();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); });
  async function req(path: string, client?: Client, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }), ...(client ? { Cookie: client.cookie, "X-CSRF-Token": client.csrfToken } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any, headers: response.headers };
  }
  async function register(role: "business" | "team", label = randomUUID()) {
    const r = await req("/api/auth/register", undefined, { email: `${label}@example.test`, password, role, name: label, interests: "Прототипы", skills: ["React"], technologies: ["TypeScript"] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return { ...r.body, cookie: r.headers.get("set-cookie")!.split(";")[0] } as Client;
  }
  async function snapshot(client: Client): Promise<Snapshot> { const r = await req("/api/state", client); assert.equal(r.status, 200); return r.body; }
  async function command(client: Client, command: Command, revision?: number, requestId = randomUUID()) {
    return req("/api/commands", client, { requestId, expectedRevision: revision ?? (await snapshot(client)).revision, command });
  }
  async function published(client: Client) {
    const created = await command(client, { type: "create" }); assert.equal(created.status, 200);
    const id: string = created.body.createdId;
    assert.equal((await command(client, { type: "edit", taskId: id, draft: { ...createEmptyDraft(), title: "Общая задача", description: "Нужен реестр заявок" } })).status, 200);
    assert.equal((await command(client, { type: "confirm", taskId: id, confirmed: true })).status, 200);
    assert.equal((await command(client, { type: "publish", taskId: id })).status, 200);
    return id;
  }
  return { db, path, folder, base, req, register, snapshot, command, published, analyzed: () => analyzed };
}
const proposal = { approach: "Создать реестр", expectedResult: "Рабочая таблица", timing: "Неделя", skills: [], plan: ["Согласовать", "Реализовать"], link: "https://example.com/prototype" };

test("accounts use hashed passwords, opaque cookies, login, expiration and revocable sessions", async t => {
  const f = await fixture(t, true); const team = await f.register("team");
  assert.equal((await f.snapshot(team)).state.businesses.length, 0);
  const row = f.db.sql.prepare("SELECT password_hash FROM accounts WHERE id=?").get(team.account.id)!;
  assert.match(String(row.password_hash), /^scrypt\$/); assert.ok(!String(row.password_hash).includes(password));
  const login = await f.req("/api/auth/login", undefined, { email: team.account.email.toUpperCase(), password });
  assert.equal(login.status, 200); assert.match(login.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/); assert.match(login.headers.get("set-cookie")!, /Secure/);
  assert.equal((await f.req("/api/auth/login", undefined, { email: team.account.email, password: "wrong-password-123" })).status, 401);
  assert.equal((await f.req("/api/auth/login", undefined, { email: "missing@example.test", password })).status, 401);
  assert.equal((await f.req("/api/auth/session")).status, 401);
  assert.equal((await f.req("/api/auth/logout", team, {})).status, 200);
  assert.equal((await f.req("/api/state", team)).status, 401);
  const client = { ...login.body, cookie: login.headers.get("set-cookie")!.split(";")[0] } as Client;
  f.db.sql.exec("UPDATE sessions SET expires_at=0");
  assert.equal((await f.req("/api/state", client)).status, 401);
});

test("origin, CSRF, validation, untrusted actor and unauthenticated writes are rejected", async t => {
  const f = await fixture(t); const business = await f.register("business");
  const body = { requestId: randomUUID(), expectedRevision: 1, command: { type: "create" } };
  assert.equal((await f.req("/api/commands", undefined, body)).status, 401);
  assert.equal((await f.req("/api/commands", business, body, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await f.req("/api/commands", business, body, { "X-CSRF-Token": "forged" })).status, 403);
  assert.equal((await f.req("/api/commands", business, body, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await f.req("/api/commands", business, { ...body, command: { type: "create", actor: business.account.actor } })).status, 400);
  assert.equal((await f.req("/api/commands", business, { ...body, command: { type: "create", readinessScore: 100 } })).status, 400);
  assert.equal((await f.req("/api/commands", business, { ...body, command: { type: "create", junk: "x".repeat(270000) } })).status, 413);
  assert.equal(f.db.readState().tasks.length, 0);
});

test("drafts and proposals are private; direct requests cannot change another owner's task", async t => {
  const f = await fixture(t); const a = await f.register("business"); const b = await f.register("business"); const team = await f.register("team"); const other = await f.register("team");
  const create = await f.command(a, { type: "create" }); const taskId = create.body.createdId;
  assert.equal((await f.snapshot(b)).state.tasks.length, 0); assert.equal((await f.snapshot(team)).state.tasks.length, 0);
  for (const client of [b, team]) assert.equal((await f.command(client, { type: "edit", taskId, draft: createEmptyDraft() })).status, 404);
  assert.equal((await f.command(team, { type: "create" })).status, 403);
  const pub = await f.published(a);
  assert.equal((await f.command(b, { type: "confirm", taskId: pub, confirmed: true })).status, 403);
  assert.equal((await f.command(team, { type: "publish", taskId: pub })).status, 403);
  assert.equal((await f.command(team, { type: "submitProposal", taskId: pub, proposal })).status, 200);
  assert.equal((await f.snapshot(a)).state.proposals.length, 1);
  assert.equal((await f.snapshot(b)).state.proposals.length, 0); assert.equal((await f.snapshot(other)).state.proposals.length, 0);
  const audit = await f.req("/api/audit", team);
  assert.ok(audit.body.events.length); assert.ok(!JSON.stringify(audit.body).includes("before_json"));
  assert.ok(audit.body.events.every((e: { action: string }) => !["create", "publish"].includes(e.action)));
});

test("two independent users complete shared workflow with selected results and one-time points", async t => {
  const f = await fixture(t); const a = await f.register("business"); const team = await f.register("team"); const rejected = await f.register("team");
  const taskId = await f.published(a);
  assert.equal((await f.snapshot(team)).state.tasks[0].id, taskId);
  const submit = await f.command(team, { type: "submitProposal", taskId, proposal }); const proposalId = submit.body.createdId;
  const second = await f.command(rejected, { type: "submitProposal", taskId, proposal });
  assert.equal((await f.command(team, { type: "submitProposal", taskId, proposal })).status, 422);
  assert.equal((await f.command(team, { type: "submitResult", taskId, proposalId, text: "Слишком рано" })).status, 422);
  assert.equal((await f.command(a, { type: "finalizeDecision", taskId, selectedProposalIds: [proposalId], confirmed: true })).status, 200);
  assert.equal((await f.command(rejected, { type: "submitResult", taskId, proposalId: second.body.createdId, text: "Не выбраны" })).status, 422);
  assert.equal((await f.command(rejected, { type: "submitResult", taskId, proposalId, text: "Чужой" })).status, 403);
  assert.equal((await f.command(team, { type: "submitResult", taskId, proposalId, text: "  Готов реестр  " })).status, 200);
  assert.equal((await f.snapshot(team)).teamPoints[team.account.actor.id], 0);
  assert.equal((await f.command(team, { type: "confirmResult", taskId, proposalId })).status, 403);
  const confirmed = await f.command(a, { type: "confirmResult", taskId, proposalId }); assert.equal(confirmed.status, 200);
  const revision = confirmed.body.revision;
  assert.equal((await f.command(a, { type: "confirmResult", taskId, proposalId })).body.revision, revision);
  assert.equal((await f.snapshot(team)).teamPoints[team.account.actor.id], 10);
  assert.equal(f.db.readState().tasks.find(t => t.id === taskId)!.readinessScore, 0);
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM decisions").get()!.n, 1);
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM audit WHERE action='confirmResult'").get()!.n, 1);
});

test("optimistic locking rejects stale parallel edits and receipts deduplicate ambiguous retries", async t => {
  const f = await fixture(t); const a = await f.register("business"); const revision = (await f.snapshot(a)).revision;
  const parallel = await Promise.all([f.command(a, { type: "create" }, revision), f.command(a, { type: "create" }, revision)]);
  assert.deepEqual(parallel.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.db.readState().tasks.length, 1);
  const requestId = randomUUID(); const current = (await f.snapshot(a)).revision;
  const first = await f.command(a, { type: "create" }, current, requestId);
  const retry = await f.command(a, { type: "create" }, current, requestId);
  assert.equal(first.body.createdId, retry.body.createdId); assert.equal(first.body.revision, retry.body.revision);
  assert.equal(f.db.readState().tasks.length, 2);
  assert.equal((await f.command(a, { type: "confirm", taskId: first.body.createdId, confirmed: false }, current, requestId)).status, 409);
});

test("database restart, backup and restore preserve records, sessions, receipts and migrations", async t => {
  const f = await fixture(t); const a = await f.register("business"); const taskId = await f.published(a);
  const path = join(f.folder, "backup.sqlite"); await copyDatabase(f.path, path);
  const copy = new Database(path);
  try {
    assert.deepEqual(copy.readState(), f.db.readState()); assert.equal(copy.revision(), f.db.revision());
    assert.equal(copy.sql.prepare("PRAGMA user_version").get()!.user_version, 1);
    assert.equal(copy.sql.prepare("SELECT count(*) AS n FROM sessions").get()!.n, 1);
    assert.equal(copy.readState().tasks[0].id, taskId);
  } finally { copy.close(); }
  const restarted = new Database(path);
  try { assert.equal(restarted.readState().tasks[0].status, "published"); } finally { restarted.close(); }
  await assert.rejects(copyDatabase(f.path, path), /EEXIST/);
});

test("critical business state can be recovered from an audit event in a separate backup", async t => {
  const f = await fixture(t); const a = await f.register("business"); const taskId = await f.published(a);
  const event = f.db.sql.prepare("SELECT id FROM audit WHERE action='publish'").get()!;
  await f.command(a, { type: "finalizeDecision", taskId, selectedProposalIds: [], confirmed: true });
  const path = join(f.folder, "recovery.sqlite"); await copyDatabase(f.path, path);
  const recovered = new Database(path);
  try {
    recoverEvent(recovered, Number(event.id));
    assert.equal(recovered.readState().tasks[0].decisionFinalizedAt, null);
    assert.ok(f.db.readState().tasks[0].decisionFinalizedAt);
    assert.equal(recovered.sql.prepare("SELECT count(*) AS n FROM sessions").get()!.n, 0);
    assert.equal(recovered.sql.prepare("SELECT count(*) AS n FROM accounts").get()!.n, 1);
    assert.equal(recovered.sql.prepare("SELECT count(*) AS n FROM audit WHERE action='recover'").get()!.n, 1);
  } finally { recovered.close(); }
});

test("demo seed imports real IDs and accounts once, without wiping an existing database", async t => {
  const f = await fixture(t); const emails = await seedDatabase(f.db, password);
  assert.equal(emails.length, 6); assert.equal(f.db.readState().tasks.length, 10);
  const login = await f.req("/api/auth/login", undefined, { email: "business-demo@demo.invalid", password });
  assert.equal(login.status, 200); assert.equal(login.body.account.actor.id, "business-demo");
  const before = f.db.readState(); await assert.rejects(seedDatabase(f.db, password), /empty database/);
  assert.deepEqual(f.db.readState(), before);
});

test("AI gateway requires a business session and CSRF before invoking the provider", async t => {
  const f = await fixture(t); const a = await f.register("business"); const team = await f.register("team");
  const input = { schemaVersion: 2, description: "Нужен реестр заявок", fields: emptyFields(), previousAnswers: [] };
  assert.equal((await f.req("/api/analyze-task", undefined, input)).status, 401);
  assert.equal((await f.req("/api/analyze-task", team, input)).status, 403);
  assert.equal((await f.req("/api/analyze-task", a, input, { "X-CSRF-Token": "bad" })).status, 403);
  assert.equal(f.analyzed(), 0);
  assert.equal((await f.req("/api/analyze-task", a, input)).status, 200); assert.equal(f.analyzed(), 1);
});

test("login throttling limits repeated guesses and does not reveal internals", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.req("/api/auth/login", undefined, { email: "unknown@example.test", password })).status, 401);
  const result = await f.req("/api/auth/login", undefined, { email: "unknown@example.test", password });
  assert.equal(result.status, 429); assert.equal(result.body.code, "RATE_LIMIT");
  assert.doesNotMatch(JSON.stringify(result.body), /SELECT|scrypt|stack|password_hash/);
});

test("static serving permits prototypes but blocks traversal, unknown files and malformed paths", async t => {
  const f = await fixture(t);
  const page = await fetch(f.base + "/prototypes/demo.html?example=requests");
  assert.equal(page.status, 200); assert.match(page.headers.get("content-type")!, /text\/html/);
  assert.match(page.headers.get("content-security-policy")!, /script-src 'self'/);
  assert.match(await page.text(), /demo.js/);
  assert.equal((await fetch(f.base + "/prototypes/demo.js")).status, 200);
  assert.equal((await fetch(f.base + "/prototypes/demo.html", { method: "HEAD" })).status, 200);
  for (const path of ["/%2e%2e%2fpackage.json", "/%2e%2e%5cpackage.json", "/.env", "/data/app.sqlite"]) {
    assert.equal((await fetch(f.base + path)).status, 404, path);
  }
  assert.equal((await fetch(f.base + "/%zz")).status, 400);
  assert.equal((await fetch(f.base + "/prototypes/demo.html", { method: "POST" })).status, 405);
});

test("separate database connections share revisions and roll back failed transactions", async t => {
  const f = await fixture(t); const account = (await f.register("business")).account;
  const second = new Database(f.path);
  try {
    const revision = second.revision();
    const command = { requestId: randomUUID(), expectedRevision: revision, command: { type: "create" as const } };
    f.db.change(account, command);
    assert.throws(() => second.change(account, { ...command, requestId: randomUUID() }), /Данные изменились/);
    assert.equal(second.readState().tasks.length, 1);
    const current = second.revision();
    assert.throws(() => second.transaction(() => { second.advance(); throw new Error("test rollback"); }), /test rollback/);
    assert.equal(f.db.revision(), current);
    assert.equal(second.sql.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { second.close(); }
});
