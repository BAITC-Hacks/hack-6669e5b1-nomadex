import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ResultPanel from "../src/ResultPanel";
import { APP_STORAGE_KEY, createSeedState, loadAppState, reduceStore, saveAppState, selectCatalog, selectTeamPoints, storeSchema, type AppState, type StoreAction } from "../src/store";

const owner = { kind: "business" as const, id: "business-demo" };
const team = { kind: "team" as const, id: "team-001" };
const submit = { type: "submitResult", actor: team, taskId: "task-001", proposalId: "proposal-001", text: "  Подготовлен реестр заявок. Проверены поиск и экспорт.  " } satisfies StoreAction;
const confirm = { type: "confirmResult", actor: owner, taskId: "task-001", proposalId: "proposal-001", confirmedAt: "2026-09-23T16:00:00Z" } satisfies StoreAction;
function decided(selectedProposalIds = ["proposal-001"]): AppState {
  return reduceStore(createSeedState(), { type: "finalizeDecision", actor: owner, taskId: "task-001", selectedProposalIds, confirmed: true, finalizedAt: "2026-09-23T15:00:00Z" });
}

test("selected team submits one trimmed result; points wait for business confirmation", () => {
  const initial = decided(); const original = structuredClone(initial);
  const state = reduceStore(initial, submit);
  assert.deepEqual(state.results, [{ proposalId: submit.proposalId, text: submit.text.trim(), confirmedAt: null }]);
  assert.equal(selectTeamPoints(state, team.id), 0);
  assert.deepEqual(state.tasks, initial.tasks); assert.deepEqual(state.proposals, initial.proposals);
  assert.deepEqual(initial, original);
  assert.throws(() => reduceStore(state, submit), /уже отправлен/);
});

test("result submission rejects wrong actors, wrong task, non-selected proposals and empty text", () => {
  const state = decided(); const original = structuredClone(state);
  for (const patch of [
    { actor: owner }, { actor: { kind: "team" as const, id: "team-002" } }, { actor: { kind: "team" as const, id: "missing" } },
    { taskId: "task-002" }, { taskId: "task-draft-001" }, { taskId: "missing" },
    { proposalId: "missing" }, { proposalId: "proposal-002" }, { text: " \n\t " }
  ]) assert.throws(() => reduceStore(state, { ...submit, ...patch }));
  assert.throws(() => reduceStore(createSeedState(), submit));
  assert.throws(() => reduceStore(decided([]), submit));
  assert.deepEqual(state, original);
});

test("only task owner can confirm an existing result, including after it is confirmed", () => {
  const initial = decided(); assert.throws(() => reduceStore(initial, confirm), /ещё не отправила/);
  const state = reduceStore(initial, submit);
  const otherBusiness = { ...state, businesses: [...state.businesses, { id: "other", name: "Другой бизнес", description: "" }] };
  const patches = [{ actor: team }, { actor: { kind: "business" as const, id: "other" } }, { taskId: "task-002" }, { proposalId: "missing" }];
  for (const patch of patches) assert.throws(() => reduceStore(otherBusiness, { ...confirm, ...patch }));
  assert.throws(() => reduceStore(state, { ...confirm, confirmedAt: "invalid" }));
  const confirmed = reduceStore(otherBusiness, confirm);
  for (const patch of patches) assert.throws(() => reduceStore(confirmed, { ...confirm, ...patch }));
  assert.equal(state.results[0].confirmedAt, null);
});

test("repeated confirmation is idempotent and never changes catalog, readiness or first timestamp", () => {
  const initial = decided();
  const state = reduceStore(reduceStore(initial, submit), confirm);
  assert.equal(selectTeamPoints(state, team.id), 10);
  assert.equal(selectTeamPoints(state, "team-002"), 0);
  for (let i = 0; i < 5; i++) assert.strictEqual(reduceStore(state, { ...confirm, confirmedAt: "2026-09-24T16:00:00Z" }), state);
  assert.equal(state.results[0].confirmedAt, confirm.confirmedAt);
  assert.deepEqual(state.tasks, initial.tasks); assert.deepEqual(state.proposals, initial.proposals);
  assert.deepEqual(selectCatalog(state), selectCatalog(initial));
  assert.throws(() => reduceStore(state, { ...submit, text: "Замена текста" }));
});

test("several selected teams receive independent points; same team accumulates across tasks", () => {
  let state = reduceStore(decided(["proposal-001", "proposal-002"]), submit);
  state = reduceStore(state, { ...submit, proposalId: "proposal-002", actor: { kind: "team", id: "team-002" } });
  state = reduceStore(state, confirm);
  assert.equal(selectTeamPoints(state, "team-002"), 0);
  state = reduceStore(state, { ...confirm, proposalId: "proposal-002" });
  assert.equal(selectTeamPoints(state, "team-002"), 10);
  state = reduceStore(state, { type: "submitProposal", actor: team, taskId: "task-004", id: "another-proposal", proposal: { approach: "Прототип", expectedResult: "Отчёт", timing: "2 дня", plan: ["Собрать"], skills: [], link: "https://example.com" } });
  state = reduceStore(state, { type: "finalizeDecision", actor: owner, taskId: "task-004", selectedProposalIds: ["another-proposal"], confirmed: true, finalizedAt: "2026-09-23T15:00:00Z" });
  state = reduceStore(state, { ...submit, taskId: "task-004", proposalId: "another-proposal" });
  state = reduceStore(state, { ...confirm, taskId: "task-004", proposalId: "another-proposal" });
  assert.equal(selectTeamPoints(state, team.id), 20);
  assert.equal(selectTeamPoints(state, "team-002"), 10);
  assert.equal(selectTeamPoints(state, "missing"), 0);
});

test("pending and confirmed results survive reload; replay never adds extra points", () => {
  const data = new Map<string, string>();
  const storage: Storage = { length: 0, key: () => null, clear: () => data.clear(), getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
  let state = reduceStore(decided(), submit);
  for (const points of [0, 10]) {
    if (points) state = reduceStore(state, confirm);
    assert.equal(saveAppState(state, storage), true);
    const loaded = loadAppState(storage);
    assert.equal(loaded.blocked, false); assert.deepEqual(loaded.state, state);
    assert.equal(selectTeamPoints(loaded.state, team.id), points);
    assert.throws(() => reduceStore(loaded.state, submit));
    state = loaded.state;
  }
  assert.strictEqual(reduceStore(state, confirm), state);
  const corrupt = JSON.stringify({ ...state, results: [...state.results, state.results[0]] });
  data.set(APP_STORAGE_KEY, corrupt);
  assert.equal(loadAppState(storage).blocked, true);
  assert.equal(data.get(APP_STORAGE_KEY), corrupt);
});

test("stored results reject duplicates, broken links, unselected teams and invalid timestamps", () => {
  const state = reduceStore(decided(), submit); const result = state.results[0];
  for (const results of [[result, result], [{ ...result, proposalId: "missing" }], [{ ...result, proposalId: "proposal-002" }], [{ ...result, confirmedAt: "invalid" }], [{ ...result, text: " " }]]) {
    assert.equal(storeSchema.safeParse({ ...state, results }).success, false);
  }
});

test("result panel exposes only the permitted action and escapes submitted text", () => {
  const render = (state: AppState, actor = team, proposalId = submit.proposalId) => renderToStaticMarkup(createElement(ResultPanel, { state, actor, proposal: state.proposals.find(p => p.id === proposalId)!, onAction: () => {} }));
  const initial = decided();
  assert.match(render(initial), /Отправить результат/);
  assert.equal(render(initial, { kind: "team", id: "team-002" }), "");
  assert.equal(render(initial, team, "proposal-002"), "");
  const submitted = reduceStore(initial, { ...submit, text: "<script>alert(1)</script>" });
  assert.doesNotMatch(render(submitted), /<form|<script>|Подтвердить результат/);
  assert.match(render(submitted), /&lt;script&gt;/);
  const businessMarkup = renderToStaticMarkup(createElement(ResultPanel, { state: submitted, actor: owner, proposal: submitted.proposals[0], onAction: () => {} }));
  assert.match(businessMarkup, /Подтвердить результат и начислить/);
  const confirmed = reduceStore(submitted, confirm);
  assert.doesNotMatch(render(confirmed), /<form|<button/);
  assert.match(render(confirmed), /Начислено \+10/);
});
