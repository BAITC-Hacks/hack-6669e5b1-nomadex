import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { calculateRating } from "../src/rating";
import { createEmptyDraft } from "../src/types";
import { loadDraft, saveDraft, resetDraft, STORAGE_KEY, withDraft } from "../src/storage";
import { fallback, parseAnalysis, requestSchema, emptyFields, type AnalysisInput } from "../shared/contract";
import { createApp, createOpenAIAnalyzer, AnalysisFailure, type Analyzer } from "../server/app";
import { analyzeTask } from "../src/analysis";
import { SYSTEM_PROMPT } from "../shared/prompt";
const input: AnalysisInput = { schemaVersion: 2, description: "Заявки теряются между таблицами", fields: emptyFields(), previousAnswers: [] };
function payload() { const { mode: _mode, promptVersion: _version, ...result } = fallback(input); return result; }
class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}
test("all seed task and draft scores match the actual rating function", () => {
  const data = JSON.parse(readFileSync(new URL("../docs/source-data.json", import.meta.url), "utf8"));
  for (const item of [...data.tasks, ...data.drafts]) assert.equal(calculateRating(item).total, item.readinessScore, item.id);
  const fields = { ...emptyFields(), expectedResult: "не знаю", resources: "данных нет" };
  assert.equal(calculateRating(fields).total, 20);
  fields.resources = null as unknown as string;
  assert.equal(calculateRating(fields).total, 0);
});
test("malformed JSON and structurally invalid saves stay intact", () => {
  for (const raw of ["{broken", JSON.stringify({ schemaVersion: 2, draft: {}, confirmed: true })]) {
    const storage = new MemoryStorage(); storage.setItem(STORAGE_KEY, raw);
    assert.equal(loadDraft(storage).blocked, true); assert.equal(storage.getItem(STORAGE_KEY), raw);
  }
});
test("confirmation survives a reload and edits invalidate it", () => {
  const storage = new MemoryStorage();
  const state = { schemaVersion: 2 as const, draft: { ...createEmptyDraft(), title: "Заявки", description: "Теряются заявки" }, confirmed: true };
  assert.ok(saveDraft(state, storage)); assert.equal(loadDraft(storage).state.confirmed, true);
  assert.equal(withDraft(state, { ...state.draft, title: "Новая версия" }).confirmed, false);
  storage.setItem("unrelated", "keep"); assert.ok(resetDraft(storage)); assert.equal(storage.getItem("unrelated"), "keep");
});
test("old valid draft migrates without losing user text", () => {
  const storage = new MemoryStorage(); const old = { title: "Заявки", description: "Описание", target: "Менеджерам", desiredResult: "Реестр", acceptanceCriteria: "Проверка", scope: "Границы", resources: "Данные", constraints: "Срок" };
  storage.setItem("nomadex-draft-v1", JSON.stringify(old));
  const loaded = loadDraft(storage); assert.equal(loaded.blocked, false);
  assert.equal(loaded.state.draft.problemContext, "Описание\nМенеджерам"); assert.equal(loaded.state.draft.expectedResult, "Реестр");
  assert.equal(storage.getItem("nomadex-draft-v1"), JSON.stringify(old));
});
test("storage denied does not crash", () => {
  const storage = new MemoryStorage(); storage.getItem = () => { throw Error("denied"); }; storage.setItem = () => { throw Error("quota"); };
  assert.equal(loadDraft(storage).blocked, true); assert.equal(saveDraft({ schemaVersion: 2, draft: createEmptyDraft(), confirmed: false }, storage), false);
});
test("strict AI parsing rejects unknown facts, duplicate IDs and too few distinct questions", () => {
  const good = payload(); assert.ok(parseAnalysis(JSON.stringify(good)));
  for (const raw of ["not JSON", JSON.stringify({ ...good, selectedTeam: "team-001" }), JSON.stringify({ ...good, questions: good.questions.slice(0, 2) }), JSON.stringify({ ...good, questions: Array(3).fill(good.questions[0]) }), JSON.stringify({ ...good, questions: good.questions.slice(0, 3).map((q, i) => ({ ...q, id: String(i), question: "  ОДИН   вопрос  " })) })]) assert.throws(() => parseAnalysis(raw));
});
test("fallback covers missing fields and verifies complete fields", () => {
  const few = fallback({ ...input, fields: { ...input.fields, acceptanceCriteria: "Проверка" } });
  assert.ok(few.questions.every(q => q.field !== "acceptanceCriteria" || q.kind === "verification"));
  const answered = fallback({ ...input, previousAnswers: [{ questionId: "q1", field: "resources", answer: "Есть CSV" }] });
  assert.ok(!answered.missingFields.includes("resources"));
  const full = fallback({ ...input, fields: Object.fromEntries(Object.keys(input.fields).map(k => [k, "Сообщено пользователем"])) as AnalysisInput["fields"] });
  assert.equal(full.questions.length, 3); assert.ok(full.questions.every(q => q.kind === "verification"));
});
test("request limits and published prompt match the contract", () => {
  assert.equal(requestSchema.safeParse({ ...input, description: "x".repeat(8001) }).success, false);
  assert.equal(requestSchema.safeParse({ ...input, teamId: "secret" }).success, false);
  const doc = readFileSync(new URL("../docs/ai-contract.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  for (const ending of ["\n", "\r\n"]) {
    const normalized = doc.replace(/\n/g, ending).replace(/\r\n/g, "\n");
    assert.equal(SYSTEM_PROMPT, /```text\n([\s\S]*?)\n```/.exec(normalized)?.[1]);
  }
});
async function endpoint(analyze: Analyzer, run: (url: string) => Promise<void>) {
  const server = createApp(analyze); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const addr = server.address(); assert.ok(addr && typeof addr !== "string");
  try { await run(`http://127.0.0.1:${addr.port}/api/analyze-task`); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
test("HTTP endpoint validates request before calling provider", async () => {
  let calls = 0;
  await endpoint(async () => { calls++; return JSON.stringify(payload()); }, async url => {
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await post(url, { description: "bad contract" })).status, 400);
    assert.equal(calls, 0);
    const response = await post(url, input); assert.equal(response.status, 200);
    const data = await response.json() as { mode: string; questions: unknown[] }; assert.equal(data.mode, "openai"); assert.equal(data.questions.length, 6); assert.equal(calls, 1);
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 400);
  });
});
test("invalid provider output becomes a safe error", async () => {
  await endpoint(async () => JSON.stringify({ ...payload(), budget: 100 }), async url => {
    const res = await post(url, input); assert.equal(res.status, 502); assert.deepEqual(await res.json(), { code: "INVALID_OUTPUT" });
  });
});
test("missing OpenAI configuration is explicit; no model call", async () => {
  await endpoint(createOpenAIAnalyzer({}), async url => {
    const res = await post(url, input); assert.equal(res.status, 503); assert.deepEqual(await res.json(), { code: "NOT_CONFIGURED" });
  });
});
test("endpoint returns controlled provider error without raw secrets", async () => {
  await endpoint(async () => { throw new AnalysisFailure("RATE_LIMIT", 503); }, async url => {
    const res = await post(url, input); assert.deepEqual(await res.json(), { code: "RATE_LIMIT" });
  });
});
test("client handles offline, non-JSON and server errors with explicit fallback", async t => {
  const mockFetch = t.mock.method(globalThis, "fetch");
  for (const value of [() => Promise.reject(Error("offline")), () => Promise.resolve(new Response("not JSON")), () => Promise.resolve(new Response(JSON.stringify({ code: "AUTH_FAILED" }), { status: 502 }))]) {
    mockFetch.mock.mockImplementation(value);
    const result = await analyzeTask(input); assert.equal(result.analysis.mode, "mock"); assert.ok(result.warning); assert.ok(result.analysis.questions.length >= 3);
  }
});
test("client accepts only validated OpenAI response and propagates cancellation", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ ...payload(), mode: "openai", promptVersion: 2 })));
  assert.equal((await analyzeTask(input)).analysis.mode, "openai");
  const controller = new AbortController(); controller.abort();
  t.mock.method(globalThis, "fetch", async () => { throw Error("aborted"); });
  await assert.rejects(analyzeTask(input, controller.signal));
});
