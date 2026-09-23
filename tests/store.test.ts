import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_STORAGE_KEY, createSeedState, loadAppState, reduceStore, resetAppState, saveAppState, storeSchema, taskDraft } from "../src/store";
import { createEmptyDraft } from "../src/types";
class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}
const actor = { kind: "business" as const, id: "business-demo" };
test("seed contains all task, profile and proposal records with valid references", () => {
  const state = createSeedState();
  assert.equal(state.tasks.length, 10); assert.equal(state.tasks.filter(t => t.status === "draft").length, 5);
  assert.equal(state.teams.length, 5); assert.equal(state.proposals.length, 5); assert.deepEqual(state.results, []);
  assert.equal(state.businesses.length, 1);
});
test("existing state takes precedence; seed is not reinserted on reload", () => {
  const storage = new MemoryStorage();
  let state = loadAppState(storage).state;
  state = reduceStore(state, { type: "create", actor, id: "new" });
  state = reduceStore(state, { type: "edit", actor, taskId: "new", draft: { ...createEmptyDraft(), title: "Мой черновик", description: "Новая проблема" } });
  assert.ok(saveAppState(state, storage));
  const loaded = loadAppState(storage); assert.equal(loaded.blocked, false); assert.deepEqual(loaded.state, state);
  assert.equal(loaded.state.tasks.length, 11);
});
test("legacy draft migrates once and remains backed up", () => {
  const storage = new MemoryStorage();
  const legacy = JSON.stringify({ schemaVersion: 2, draft: { ...createEmptyDraft(), title: "Старый", description: "Мой текст" }, confirmed: true });
  storage.setItem("nomadex-draft-v2", legacy);
  const loaded = loadAppState(storage); assert.equal(loaded.state.tasks.length, 11);
  assert.equal(loaded.state.tasks[0].title, "Старый"); assert.equal(loaded.state.tasks[0].confirmed, true);
  assert.ok(saveAppState(loaded.state, storage)); assert.equal(loadAppState(storage).state.tasks.length, 11);
  assert.equal(storage.getItem("nomadex-draft-v2"), legacy);
});
test("corrupt state and dangling references block automatic overwrite", () => {
  const storage = new MemoryStorage();
  for (const value of ["{broken", JSON.stringify({ ...createSeedState(), teams: [] })]) {
    storage.setItem(APP_STORAGE_KEY, value); assert.equal(loadAppState(storage).blocked, true);
    assert.equal(storage.getItem(APP_STORAGE_KEY), value);
  }
  const state = createSeedState(); state.tasks[0].readinessScore = 100;
  assert.equal(storeSchema.safeParse(state).success, false);
});
test("edits invalidate confirmation and recalculate rating without altering other tasks", () => {
  let state = createSeedState(); const task = state.tasks[0]; const other = state.tasks[1];
  state = reduceStore(state, { type: "confirm", actor, taskId: task.id, confirmed: true });
  state = reduceStore(state, { type: "edit", actor, taskId: task.id, draft: { ...taskDraft(task), resources: "Данных нет" } });
  assert.equal(state.tasks[0].confirmed, false); assert.equal(state.tasks[0].readinessScore, 35); assert.deepEqual(state.tasks[1], other);
});
test("team, another business and published task edits are rejected", () => {
  const state = createSeedState(); const task = state.tasks[0];
  for (const invalid of [{ kind: "team" as const, id: "team-001" }, { kind: "business" as const, id: "other" }]) {
    assert.throws(() => reduceStore(state, { type: "edit", actor: invalid, taskId: task.id, draft: taskDraft(task) }));
    assert.throws(() => reduceStore(state, { type: "create", actor: invalid, id: "new" }));
  }
  assert.throws(() => reduceStore(state, { type: "edit", actor, taskId: "task-001", draft: taskDraft(task) }));
  assert.throws(() => reduceStore(state, { type: "create", actor, id: task.id }));
});
test("explicit reset restores seed without resurrecting legacy or erasing other storage", () => {
  const storage = new MemoryStorage(); storage.setItem(APP_STORAGE_KEY, "broken");
  storage.setItem("nomadex-draft-v1", "broken legacy"); storage.setItem("unrelated", "keep");
  const result = resetAppState(storage); assert.equal(result.blocked, false);
  assert.equal(loadAppState(storage).state.tasks.length, 10); assert.equal(storage.getItem("unrelated"), "keep");
  assert.equal(storage.getItem("nomadex-draft-v1"), "broken legacy");
});
test("storage denial falls back to memory and reports failed writes", () => {
  const storage = new MemoryStorage(); storage.getItem = () => { throw Error("denied"); }; storage.setItem = () => { throw Error("quota"); };
  assert.equal(loadAppState(storage).blocked, true); assert.equal(saveAppState(createSeedState(), storage), false);
  assert.equal(resetAppState(storage).blocked, true);
});

test("publication requires current confirmation and is idempotent by rejection", () => {
  let state = createSeedState(); const taskId = state.tasks[0].id;
  const publish = { type: "publish" as const, actor, taskId, publishedAt: "2026-09-23T10:00:00.000Z" };
  assert.throws(() => reduceStore(state, publish));
  state = reduceStore(state, { type: "confirm", actor, taskId, confirmed: true });
  const published = reduceStore(state, publish);
  assert.equal(published.tasks.find(t => t.id === taskId)?.status, "published");
  assert.equal(published.tasks.find(t => t.id === taskId)?.readinessScore, 20);
  assert.equal(published.tasks.length, state.tasks.length);
  assert.throws(() => reduceStore(published, publish));
  assert.throws(() => reduceStore(state, { ...publish, actor: { kind: "team", id: "team-001" } }));
  const edited = reduceStore(state, { type: "edit", actor, taskId, draft: { ...taskDraft(state.tasks[0]), title: "Изменённая версия" } });
  assert.throws(() => reduceStore(edited, publish));
});
test("minimum fields are required but a low readiness score does not block publication", () => {
  let state = reduceStore(createSeedState(), { type: "create", actor, id: "empty" });
  assert.throws(() => reduceStore(state, { type: "confirm", actor, taskId: "empty", confirmed: true }));
  state = reduceStore(state, { type: "edit", actor, taskId: "empty", draft: { ...createEmptyDraft(), title: "Короткая задача", description: "Проблема пока описана коротко" } });
  state = reduceStore(state, { type: "confirm", actor, taskId: "empty", confirmed: true });
  state = reduceStore(state, { type: "publish", actor, taskId: "empty", publishedAt: "2026-09-23T10:00:00Z" });
  assert.equal(state.tasks.find(t => t.id === "empty")?.status, "published");
});
test("catalog excludes drafts and sorts score then date then id for every team", async () => {
  const { selectCatalog, selectOwnedTasks } = await import("../src/store");
  let state = createSeedState();
  assert.deepEqual(selectCatalog(state).map(t => t.id), ["task-001", "task-002", "task-003", "task-004", "task-005"]);
  const full = state.tasks.find(t => t.id === "task-001")!;
  state = { ...state, tasks: [...state.tasks, { ...full, id: "new-z", publishedAt: "2026-09-23T10:00:00Z" }, { ...full, id: "new-a", publishedAt: "2026-09-23T10:00:00Z" }] };
  assert.deepEqual(selectCatalog(state).slice(0, 3).map(t => t.id), ["new-a", "new-z", "task-001"]);
  for (const team of state.teams) assert.deepEqual(selectOwnedTasks(state, { kind: "team", id: team.id }), []);
  const storage = new MemoryStorage(); assert.ok(saveAppState(state, storage));
  assert.deepEqual(selectCatalog(loadAppState(storage).state), selectCatalog(state));
});
