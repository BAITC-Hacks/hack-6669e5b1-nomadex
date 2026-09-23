export * from "../shared/domain";
import { createSeedState, migrateV2, storeSchema, type AppState, type Task } from "../shared/domain";
import { loadDraft } from "./storage";
import { calculateRating } from "./rating";

export const APP_STORAGE_KEY = "nomadex-state-v3";
export type LoadedState = { state: AppState; blocked: boolean; warning: string | null };
export function loadAppState(storage?: Storage): LoadedState {
  const initial = createSeedState();
  try {
    const target = storage ?? localStorage;
    const saved = target.getItem(APP_STORAGE_KEY);
    if (saved !== null) return { state: storeSchema.parse(JSON.parse(saved)), blocked: false, warning: null };
    const previous = target.getItem("nomadex-state-v2");
    if (previous !== null) return { state: migrateV2(JSON.parse(previous)), blocked: false, warning: "Сохранение перенесено: новые сведения пока неизвестны, рейтинг пересчитан по шкале кейса. Исходная копия сохранена." };
    if (target.getItem("nomadex-draft-v2") !== null || target.getItem("nomadex-draft-v1") !== null) {
      const legacy = loadDraft(target);
      if (legacy.blocked) return { state: initial, blocked: true, warning: legacy.warning };
      const imported: Task = { ...legacy.state.draft, id: "task-imported-local-draft", businessId: initial.businesses[0].id,
        status: "draft", confirmed: legacy.state.confirmed && Boolean(legacy.state.draft.title.trim() && legacy.state.draft.description.trim()),
        publishedAt: null, decisionFinalizedAt: null, readinessScore: calculateRating(legacy.state.draft).total,
        scoringVersion: 2, questions: [] };
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
