import { z } from "zod";
import { createEmptyDraft, draftSchema, type Draft } from "./types";
export const STORAGE_KEY = "nomadex-draft-v2";
const LEGACY_KEY = "nomadex-draft-v1";
const storedSchema = z.object({ schemaVersion: z.literal(2), draft: draftSchema, confirmed: z.boolean() }).strict();
export type DraftState = z.infer<typeof storedSchema>;
export type LoadedDraft = { state: DraftState; blocked: boolean; warning: string | null };
const empty = (): DraftState => ({ schemaVersion: 2, draft: createEmptyDraft(), confirmed: false });
const legacySchema = z.object({ title: z.string(), description: z.string(), target: z.string(), desiredResult: z.string(), acceptanceCriteria: z.string(), scope: z.string(), resources: z.string(), constraints: z.string() }).strict();
export function loadDraft(storage?: Storage): LoadedDraft {
  try {
    const target = storage ?? localStorage;
    const value = target.getItem(STORAGE_KEY);
    if (value !== null) return { state: storedSchema.parse(JSON.parse(value)), blocked: false, warning: null };
    const old = target.getItem(LEGACY_KEY);
    if (old !== null) {
      const d = legacySchema.parse(JSON.parse(old));
      const draft = draftSchema.parse({ ...createEmptyDraft(), title: d.title, description: d.description,
        problemContext: [d.description, d.target].filter(Boolean).join("\n") || null,
        expectedResult: d.desiredResult || null, acceptanceCriteria: d.acceptanceCriteria || null,
        scope: d.scope || null, resources: d.resources || null, timingConstraints: d.constraints || null });
      return { state: { schemaVersion: 2, draft, confirmed: false }, blocked: false, warning: "Старый черновик перенесён в новую структуру; проверьте поля перед подтверждением." };
    }
    return { state: empty(), blocked: false, warning: null };
  } catch {
    return { state: empty(), blocked: true, warning: "Сохранение недоступно или повреждено. Исходные данные не перезаписаны; изменения пока хранятся только в памяти." };
  }
}
export function saveDraft(state: DraftState, storage?: Storage): boolean {
  try { (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(storedSchema.parse(state))); return true; } catch { return false; }
}
export function resetDraft(storage?: Storage): boolean {
  try { const target = storage ?? localStorage; target.removeItem(STORAGE_KEY); target.removeItem(LEGACY_KEY); return true; } catch { return false; }
}
export function withDraft(state: DraftState, draft: Draft): DraftState { return { ...state, draft, confirmed: false }; }
