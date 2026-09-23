import type { Draft } from "./types";

const KEY = "nomadex-draft-v1";

export function loadDraft(): Draft {
  try {
    const value = localStorage.getItem(KEY);
    return value ? JSON.parse(value) as Draft : { title: "", description: "", target: "", desiredResult: "", acceptanceCriteria: "", scope: "", resources: "", constraints: "" };
  } catch {
    return { title: "", description: "", target: "", desiredResult: "", acceptanceCriteria: "", scope: "", resources: "", constraints: "" };
  }
}

export function saveDraft(draft: Draft) {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}