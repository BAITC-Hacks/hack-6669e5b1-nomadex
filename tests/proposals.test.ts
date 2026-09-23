import { test } from "node:test";
import assert from "node:assert/strict";
import { createSeedState, loadAppState, reduceStore, saveAppState, selectCatalog, type StoreAction } from "../src/store";
const owner = { kind: "business" as const, id: "business-demo" };
const submit = { type: "submitProposal", actor: { kind: "team", id: "team-003" }, taskId: "task-001", id: "proposal-new",
  proposal: { approach: "Собрать реестр", expectedResult: "Прототип реестра", timing: "2 дня", skills: ["React"], plan: ["Согласовать поля", "Собрать и проверить"], link: "https://example.com/demo" } } satisfies StoreAction;
const decide = { type: "finalizeDecision", actor: owner, taskId: "task-001", selectedProposalIds: ["proposal-001"], confirmed: true, finalizedAt: "2026-09-23T15:00:00Z" } satisfies StoreAction;
test("team submission preserves task and other proposals; duplicate submission is rejected", () => {
  const initial = createSeedState(); const state = reduceStore(initial, submit);
  assert.equal(state.proposals.length, 6); assert.equal(state.proposals.at(-1)?.teamId, "team-003");
  assert.equal(state.proposals.at(-1)?.status, "submitted"); assert.deepEqual(state.tasks, initial.tasks);
  assert.throws(() => reduceStore(state, { ...submit, id: "duplicate" }), /уже отправила/);
});
test("only existing teams may submit to published open tasks at any rating", () => {
  const state = createSeedState();
  for (const actor of [owner, { kind: "team" as const, id: "missing" }]) assert.throws(() => reduceStore(state, { ...submit, actor }));
  assert.throws(() => reduceStore(state, { ...submit, taskId: "task-draft-001" }));
  assert.throws(() => reduceStore(state, { ...submit, taskId: "missing" }));
  assert.throws(() => reduceStore(state, { ...submit, id: "proposal-001" }));
  assert.equal(reduceStore(state, { ...submit, taskId: "task-005" }).proposals.at(-1)?.taskId, "task-005");
});
test("submission rejects missing fields and unsafe links without changing state", () => {
  const state = createSeedState(); const original = structuredClone(state);
  for (const patch of [{ approach: " " }, { expectedResult: "" }, { timing: "" }, { plan: [] }, { plan: [" "] }, { link: "javascript:alert(1)" }, { link: "data:text/html,test" }, { link: "/relative" }, { link: "https://user:pass@example.com" }]) {
    assert.throws(() => reduceStore(state, { ...submit, proposal: { ...submit.proposal, ...patch } }));
  }
  assert.deepEqual(state, original);
});
test("business can finalize one, several or no teams atomically", () => {
  for (const selectedProposalIds of [["proposal-001"], ["proposal-001", "proposal-002"], []]) {
    const initial = createSeedState(); const state = reduceStore(initial, { ...decide, selectedProposalIds });
    assert.equal(state.tasks.find(t => t.id === decide.taskId)?.decisionFinalizedAt, decide.finalizedAt);
    assert.deepEqual(state.proposals.filter(p => p.taskId === decide.taskId && p.status === "selected").map(p => p.id), selectedProposalIds);
    assert.ok(state.proposals.filter(p => p.taskId === decide.taskId && !selectedProposalIds.includes(p.id)).every(p => p.status === "rejected"));
    assert.deepEqual(state.proposals.filter(p => p.taskId !== decide.taskId), initial.proposals.filter(p => p.taskId !== decide.taskId));
    assert.deepEqual(selectCatalog(state).map(t => [t.id, t.readinessScore]), selectCatalog(initial).map(t => [t.id, t.readinessScore]));
    assert.throws(() => reduceStore(state, submit), /закрыт/);
    assert.throws(() => reduceStore(state, decide), /уже зафиксировано/);
  }
});
test("decision requires owner, explicit confirmation and proposals from this task", () => {
  const state = createSeedState(); const original = structuredClone(state);
  for (const patch of [
    { actor: { kind: "team" as const, id: "team-001" } }, { actor: { kind: "business" as const, id: "other" } },
    { confirmed: false }, { confirmed: false, selectedProposalIds: [] }, { selectedProposalIds: ["proposal-003"] },
    { selectedProposalIds: ["missing"] }, { selectedProposalIds: ["proposal-001", "proposal-001"] },
    { finalizedAt: "invalid" }, { taskId: "task-draft-001", selectedProposalIds: [] }
  ]) assert.throws(() => reduceStore(state, { ...decide, ...patch }));
  const withOtherBusiness = { ...state, businesses: [...state.businesses, { id: "other", name: "Другой бизнес", description: "" }] };
  assert.throws(() => reduceStore(withOtherBusiness, { ...decide, actor: { kind: "business", id: "other" } }), /владельцу/);
  assert.deepEqual(state, original);
});
test("empty task can close with explicit zero selection", () => {
  const state = reduceStore(createSeedState(), { ...decide, taskId: "task-004", selectedProposalIds: [] });
  assert.ok(state.tasks.find(t => t.id === "task-004")?.decisionFinalizedAt);
  assert.throws(() => reduceStore(state, { ...submit, taskId: "task-004" }));
});
test("submitted proposals and final decision survive storage reload without duplication", () => {
  let raw: string | null = null;
  const storage: Storage = { length: 1, clear: () => { raw = null; }, key: () => null, removeItem: () => { raw = null; }, getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
  let state = reduceStore(createSeedState(), submit);
  assert.ok(saveAppState(state, storage)); state = loadAppState(storage).state;
  state = reduceStore(state, { ...decide, selectedProposalIds: [submit.id, "proposal-002"] });
  assert.ok(saveAppState(state, storage)); const loaded = loadAppState(storage);
  assert.equal(loaded.blocked, false); assert.deepEqual(loaded.state, state);
  assert.equal(loaded.state.proposals.length, 6); assert.throws(() => reduceStore(loaded.state, submit));
});
