import { normalizeField, type Field } from "../shared/contract";
export const criteria: { key: Field; label: string; weight: number; hint: string }[] = [
  { key: "problemContext", label: "Проблема и контекст", weight: 20, hint: "Опишите, что происходит и кому это мешает." },
  { key: "expectedResult", label: "Ожидаемый результат", weight: 20, hint: "Укажите конкретный результат и формат передачи." },
  { key: "acceptanceCriteria", label: "Критерии приёмки", weight: 20, hint: "Опишите способ проверки результата." },
  { key: "scope", label: "Границы задачи", weight: 15, hint: "Укажите, что входит в работу и что исключено." },
  { key: "resources", label: "Данные и ресурсы", weight: 15, hint: "Перечислите доступные материалы или подтвердите их отсутствие." },
  { key: "timingConstraints", label: "Сроки и ограничения", weight: 10, hint: "Укажите срок и ограничения или их явное отсутствие." }
];
export function calculateRating(fields: Record<Field, string | null>) {
  const breakdown = criteria.map(item => ({ ...item, earned: normalizeField(fields[item.key]) ? item.weight : 0 }));
  return { total: breakdown.reduce((sum, item) => sum + item.earned, 0), breakdown };
}
