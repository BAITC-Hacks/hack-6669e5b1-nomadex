import { z } from "zod";
import seed from "../docs/source-data.json";
import { outputSchema } from "../shared/contract";
import { createEmptyDraft, draftSchema, type Draft } from "./types";
import { calculateRating } from "./rating";
import { loadDraft } from "./storage";

const id = z.string().min(1);
const text = z.string().trim().min(1);
const date = z.string().datetime();
const businessSchema = z.object({ id, name: text, description: z.string() }).strict();
const teamSchema = z.object({ id, name: text, interests: text, skills: z.array(text), technologies: z.array(text) }).strict();
export const taskSchema = draftSchema.extend({
  id, businessId: id, status: z.enum(["draft", "published"]), confirmed: z.boolean(),
  publishedAt: date.nullable(), decisionFinalizedAt: date.nullable(), scoringVersion: z.literal(1),
  readinessScore: z.number().int().min(0).max(100), questions: z.array(outputSchema.shape.questions.element).max(6)
}).strict().superRefine((task, ctx) => {
  if (task.readinessScore !== calculateRating(task).total) ctx.addIssue({ code: "custom", message: "Рейтинг не совпадает с заполненными полями" });
  if (task.status === "published" && (!task.confirmed || !task.publishedAt || !task.title.trim() || !task.description.trim())) ctx.addIssue({ code: "custom", message: "Опубликованная карточка не подтверждена или не заполнена" });
  if (task.status === "draft" && (task.publishedAt !== null || task.decisionFinalizedAt !== null)) ctx.addIssue({ code: "custom", message: "У черновика не может быть публикации или решения" });
});
const proposalSchema = z.object({
  id, taskId: id, teamId: id, approach: text, expectedResult: text, timing: text,
  skills: z.array(text), plan: z.array(text).min(1), link: text,
  status: z.enum(["submitted", "selected", "rejected"])
}).strict();
export const proposalInputSchema = proposalSchema.pick({ approach: true, expectedResult: true, timing: true, skills: true, plan: true, link: true }).extend({
  link: text.refine(value => {
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  }, "Укажите полную ссылку http:// или https:// без логина и пароля")
}).strict();
export type ProposalInput = z.infer<typeof proposalInputSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
const resultSchema = z.object({ proposalId: id, text, confirmedAt: date.nullable() }).strict();
export const storeSchema = z.object({
  schemaVersion: z.literal(2), businesses: z.array(businessSchema).min(1), teams: z.array(teamSchema),
  tasks: z.array(taskSchema), proposals: z.array(proposalSchema), results: z.array(resultSchema)
}).strict().superRefine((state, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const ids = [...state.businesses, ...state.teams, ...state.tasks, ...state.proposals].map(item => item.id);
  if (new Set(ids).size !== ids.length) fail("Повторяющиеся идентификаторы");
  const businesses = new Set(state.businesses.map(b => b.id));
  const teams = new Set(state.teams.map(t => t.id));
  const tasks = new Map(state.tasks.map(t => [t.id, t]));
  for (const task of state.tasks) if (!businesses.has(task.businessId)) fail("Владелец задачи отсутствует");
  const pairs = state.proposals.map(p => JSON.stringify([p.taskId, p.teamId]));
  if (new Set(pairs).size !== pairs.length) fail("Повторный отклик команды");
  for (const proposal of state.proposals) {
    const task = tasks.get(proposal.taskId);
    if (!task || task.status !== "published" || !teams.has(proposal.teamId)) fail("Неверные связи отклика");
    if (task && Boolean(task.decisionFinalizedAt) !== (proposal.status !== "submitted")) fail("Статус отклика не согласован с решением");
  }
  if (new Set(state.results.map(r => r.proposalId)).size !== state.results.length) fail("Повторный результат");
  for (const result of state.results) if (!state.proposals.some(p => p.id === result.proposalId && p.status === "selected")) fail("Результат относится к невыбранной команде");
});
export type AppState = z.infer<typeof storeSchema>;
export type Task = AppState["tasks"][number];
export type Actor = { kind: "business" | "team"; id: string };
export type StoreAction =
  | { type: "create"; actor: Actor; id: string }
  | { type: "edit"; actor: Actor; taskId: string; draft: Draft }
  | { type: "confirm"; actor: Actor; taskId: string; confirmed: boolean }
  | { type: "publish"; actor: Actor; taskId: string; publishedAt: string }
  | { type: "submitProposal"; actor: Actor; taskId: string; id: string; proposal: ProposalInput }
  | { type: "finalizeDecision"; actor: Actor; taskId: string; selectedProposalIds: string[]; confirmed: boolean; finalizedAt: string };

export function createSeedState(): AppState {
  // Validate the entire seed, including declared scores and cross-entity links.
  return storeSchema.parse({ schemaVersion: seed.schemaVersion, businesses: seed.businesses, teams: seed.teams,
    tasks: [...seed.drafts, ...seed.tasks], proposals: seed.proposals, results: [] });
}
export function taskDraft(task: Task): Draft {
  return draftSchema.parse(Object.fromEntries(Object.keys(createEmptyDraft()).map(key => [key, task[key as keyof Draft]])));
}
function owner(state: AppState, actor: Actor, task?: Task) {
  if (actor.kind !== "business" || !state.businesses.some(b => b.id === actor.id) || (task && task.businessId !== actor.id)) throw new Error("Действие доступно только владельцу задачи.");
}
export function reduceStore(state: AppState, action: StoreAction): AppState {
  if (action.type === "create") {
    owner(state, action.actor);
    const task: Task = { ...createEmptyDraft(), id: action.id, businessId: action.actor.id,
      status: "draft", confirmed: false, publishedAt: null, decisionFinalizedAt: null,
      scoringVersion: 1, readinessScore: 0, questions: [] };
    return storeSchema.parse({ ...state, tasks: [...state.tasks, task] });
  }
  const task = state.tasks.find(t => t.id === action.taskId);
  if (!task) throw new Error("Задача не найдена.");
  if (action.type === "submitProposal") {
    if (action.actor.kind !== "team" || !state.teams.some(t => t.id === action.actor.id)) throw new Error("Отклик может подать только команда.");
    if (task.status !== "published" || task.decisionFinalizedAt) throw new Error("Приём предложений по этой задаче закрыт.");
    if (state.proposals.some(p => p.taskId === task.id && p.teamId === action.actor.id)) throw new Error("Команда уже отправила предложение по этой задаче.");
    const proposal = { ...proposalInputSchema.parse(action.proposal), id: action.id, taskId: task.id, teamId: action.actor.id, status: "submitted" as const };
    return storeSchema.parse({ ...state, proposals: [...state.proposals, proposal] });
  }
  owner(state, action.actor, task);
  if (action.type === "finalizeDecision") {
    if (task.status !== "published" || task.decisionFinalizedAt) throw new Error("Решение уже зафиксировано или задача ещё не опубликована.");
    if (!action.confirmed) throw new Error("Подтвердите окончательное решение, включая отказ всем командам.");
    const selected = new Set(action.selectedProposalIds);
    if (selected.size !== action.selectedProposalIds.length || [...selected].some(id => !state.proposals.some(p => p.id === id && p.taskId === task.id))) throw new Error("Выберите только предложения этой задачи без повторений.");
    return storeSchema.parse({ ...state,
      tasks: state.tasks.map(t => t.id === task.id ? { ...t, decisionFinalizedAt: date.parse(action.finalizedAt) } : t),
      proposals: state.proposals.map(p => p.taskId === task.id ? { ...p, status: selected.has(p.id) ? "selected" : "rejected" } : p)
    });
  }
  if (task.status !== "draft") throw new Error("Опубликованная карточка уже зафиксирована.");
  let updated: Task;
  if (action.type === "edit") {
    const draft = draftSchema.parse(action.draft);
    updated = { ...task, ...draft, readinessScore: calculateRating(draft).total, confirmed: false };
  } else if (action.type === "publish") {
    if (!task.confirmed || !task.title.trim() || !task.description.trim()) throw new Error("Проверьте и подтвердите текущую карточку перед публикацией.");
    updated = { ...task, status: "published", publishedAt: date.parse(action.publishedAt), readinessScore: calculateRating(task).total };
  } else {
    if (action.confirmed && (!task.title.trim() || !task.description.trim())) throw new Error("Перед подтверждением заполните название и описание.");
    updated = { ...task, confirmed: action.confirmed };
  }
  return storeSchema.parse({ ...state, tasks: state.tasks.map(t => t.id === task.id ? updated : t) });
}

export const APP_STORAGE_KEY = "nomadex-state-v2";
export type LoadedState = { state: AppState; blocked: boolean; warning: string | null };
export function loadAppState(storage?: Storage): LoadedState {
  const initial = createSeedState();
  try {
    const target = storage ?? localStorage;
    const saved = target.getItem(APP_STORAGE_KEY);
    if (saved !== null) return { state: storeSchema.parse(JSON.parse(saved)), blocked: false, warning: null };
    if (target.getItem("nomadex-draft-v2") !== null || target.getItem("nomadex-draft-v1") !== null) {
      const legacy = loadDraft(target);
      if (legacy.blocked) return { state: initial, blocked: true, warning: legacy.warning };
      const imported: Task = { ...legacy.state.draft, id: "task-imported-local-draft", businessId: initial.businesses[0].id,
        status: "draft", confirmed: legacy.state.confirmed && Boolean(legacy.state.draft.title.trim() && legacy.state.draft.description.trim()),
        publishedAt: null, decisionFinalizedAt: null, readinessScore: calculateRating(legacy.state.draft).total,
        scoringVersion: 1, questions: [] };
      return { state: storeSchema.parse({ ...initial, tasks: [imported, ...initial.tasks] }), blocked: false,
        warning: "Рабочий черновик перенесён в список задач. Исходная копия сохранена." };
    }
    return { state: initial, blocked: false, warning: null };
  } catch {
    return { state: initial, blocked: true, warning: "Сохранение недоступно или повреждено. Исходные данные не перезаписаны; демонстрационные данные открыты только в памяти." };
  }
}
export function saveAppState(state: AppState, storage?: Storage): boolean {
  try { (storage ?? localStorage).setItem(APP_STORAGE_KEY, JSON.stringify(storeSchema.parse(state))); return true; }
  catch { return false; }
}
export function resetAppState(storage?: Storage): LoadedState {
  const state = createSeedState();
  const saved = saveAppState(state, storage);
  return { state, blocked: !saved, warning: saved ? null : "Сброс выполнен только в памяти: хранилище недоступно." };
}

export function selectCatalog(state: AppState): Task[] {
  return state.tasks.filter(t => t.status === "published").sort((a, b) =>
    b.readinessScore - a.readinessScore ||
    Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function selectOwnedTasks(state: AppState, actor: Actor): Task[] {
  if (actor.kind !== "business") return [];
  return state.tasks.filter(t => t.businessId === actor.id);
}
