import { normalizeField, fieldLabels, type Field } from "../shared/contract";
export const criteria: { key: string; fields: Field[]; label: string; weight: number }[] = [
  { key: "context", fields: ["problemContext", "need"], label: "Контекст и потребность", weight: 20 },
  { key: "resources", fields: ["resources"], label: "Данные и материалы", weight: 20 },
  { key: "expectedResult", fields: ["expectedResult"], label: "Ожидаемый результат", weight: 15 },
  { key: "acceptanceCriteria", fields: ["acceptanceCriteria"], label: "Критерии успеха", weight: 15 },
  { key: "constraints", fields: ["scope", "timingConstraints"], label: "Ограничения", weight: 10 },
  { key: "users", fields: ["users"], label: "Пользователи", weight: 10 },
  { key: "communication", fields: ["businessContact", "interactionFormat", "feedbackProcess"], label: "Связь с бизнесом", weight: 10 }
];
export function calculateRating(fields: Record<Field, string | null>) {
  const breakdown = criteria.map(item => {
    const missing = item.fields.filter(field => !normalizeField(fields[field]));
    return { ...item, earned: missing.length ? 0 : item.weight, hint: missing.map(field => fieldLabels[field]).join("; ") };
  });
  return { total: breakdown.reduce((sum, item) => sum + item.earned, 0), breakdown };
}
export const readinessLevels = [
  { id: "clarify", label: "Черновик — требует уточнения", min: 0, max: 39 },
  { id: "working", label: "Рабочая", min: 40, max: 69 },
  { id: "ready", label: "Готовая", min: 70, max: 89 },
  { id: "priority", label: "Приоритетная", min: 90, max: 100 }
] as const;
export type ReadinessLevel = typeof readinessLevels[number]["id"];
export function readinessLevel(score: number) {
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error("Рейтинг должен быть целым числом от 0 до 100");
  return readinessLevels.find(level => score <= level.max)!;
}
