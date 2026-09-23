import type { Draft } from "./types";

const criteria = [
  { key: "problem", label: "Проблема и контекст", weight: 20, fields: ["description", "target"] as const },
  { key: "result", label: "Ожидаемый результат", weight: 20, fields: ["desiredResult"] as const },
  { key: "acceptance", label: "Критерии приёмки", weight: 20, fields: ["acceptanceCriteria"] as const },
  { key: "scope", label: "Границы задачи", weight: 15, fields: ["scope"] as const },
  { key: "resources", label: "Исходные данные и ресурсы", weight: 15, fields: ["resources"] as const },
  { key: "constraints", label: "Сроки и ограничения", weight: 10, fields: ["constraints"] as const }
];

export function calculateRating(draft: Draft) {
  const breakdown = criteria.map((criterion) => {
    const complete = criterion.fields.every((field) => {
      const value = draft[field].trim().toLowerCase();
      return value.length > 0 && value !== "не знаю" && value !== "уточняется";
    });
    return { ...criterion, earned: complete ? criterion.weight : 0 };
  });
  return { total: breakdown.reduce((sum, item) => sum + item.earned, 0), breakdown };
}