import { z } from "zod";

export const fieldKeys = ["problemContext", "expectedResult", "acceptanceCriteria", "scope", "resources", "timingConstraints", "need", "users", "businessContact", "interactionFormat", "feedbackProcess"] as const;
export const fieldSchema = z.enum(fieldKeys);
export type Field = z.infer<typeof fieldSchema>;
export const fieldsSchema = z.object({
  problemContext: z.string().max(2000).nullable(),
  expectedResult: z.string().max(2000).nullable(),
  acceptanceCriteria: z.string().max(2000).nullable(),
  scope: z.string().max(2000).nullable(),
  resources: z.string().max(2000).nullable(),
  timingConstraints: z.string().max(2000).nullable(),
  need: z.string().max(2000).nullable(), users: z.string().max(2000).nullable(),
  businessContact: z.string().max(2000).nullable(), interactionFormat: z.string().max(2000).nullable(), feedbackProcess: z.string().max(2000).nullable()
}).strict();
export const answerSchema = z.object({ questionId: z.string().min(1).max(100), field: fieldSchema, answer: z.string().max(2000) }).strict();
export const requestSchema = z.object({
  schemaVersion: z.literal(2), description: z.string().trim().min(1).max(8000),
  fields: fieldsSchema, previousAnswers: z.array(answerSchema).max(20)
}).strict();
export type AnalysisInput = z.infer<typeof requestSchema>;
export const outputSchema = z.object({
  schemaVersion: z.literal(2), missingFields: z.array(fieldSchema).max(fieldKeys.length),
  questions: z.array(z.object({
    id: z.string().trim().min(1).max(100), field: fieldSchema,
    kind: z.enum(["missing", "verification"]),
    question: z.string().trim().min(1).max(500), reason: z.string().trim().min(1).max(300)
  }).strict()).min(3).max(6)
}).strict();
export type Analysis = z.infer<typeof outputSchema> & { mode: "openai" | "mock"; promptVersion: 2 };
export function parseAnalysis(raw: string): z.infer<typeof outputSchema> {
  if (new TextEncoder().encode(raw).byteLength > 32768) throw new Error("AI_OUTPUT_TOO_LARGE");
  const result = outputSchema.parse(JSON.parse(raw));
  if (new Set(result.questions.map(q => q.id)).size !== result.questions.length) throw new Error("DUPLICATE_ID");
  if (new Set(result.missingFields).size !== result.missingFields.length) throw new Error("DUPLICATE_FIELD");
  const seen = new Set<string>();
  result.questions = result.questions.filter(q => {
    const normalized = q.question.toLocaleLowerCase("ru").replace(/\s+/g, " ").trim();
    if (seen.has(normalized)) return false;
    seen.add(normalized); return true;
  });
  if (result.questions.length < 3) throw new Error("TOO_FEW_QUESTIONS");
  return result;
}
export function normalizeField(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return !trimmed || /^(не знаю|уточняется|пока неизвестно|неизвестно|срок пока уточняется|дата запуска не определена)[.!]?$/iu.test(trimmed) ? null : trimmed;
}
export const emptyFields = (): z.infer<typeof fieldsSchema> => Object.fromEntries(fieldKeys.map(k => [k, null])) as z.infer<typeof fieldsSchema>;
const questions: Record<Field, [string, string]> = {
  problemContext: ["Что происходит сейчас и кому это мешает?", "Какое последствие описанной проблемы важнее всего устранить?"],
  expectedResult: ["Какой конкретный результат и в каком формате должна передать команда?", "Как вы будете использовать указанный результат?"],
  acceptanceCriteria: ["Как бизнес проверит, что результат достигнут?", "Какой пример поможет проверить указанные критерии приёмки?"],
  scope: ["Что входит в первую версию и что из неё исключено?", "Какая часть обозначенных границ задачи наиболее важна для первой версии?"],
  resources: ["Какие обезличенные данные и ресурсы доступны или их пока нет?", "Как команда сможет воспользоваться указанными ресурсами или работать при их отсутствии?"],
  need: ["Что необходимо изменить в текущем процессе?", "Какое из описанных изменений важнее всего?"],
  users: ["Для каких пользователей создаётся решение и что им нужно делать?", "Как описанные пользователи будут применять решение?"],
  businessContact: ["Какой рабочий канал связи с бизнесом доступен команде?", "Доступен ли указанный рабочий канал команде?"],
  interactionFormat: ["Как будут проходить консультации с бизнесом?", "Как команда согласует консультацию в указанном формате?"],
  feedbackProcess: ["Как и когда бизнес будет давать обратную связь по результатам?", "Как команда получит обратную связь по указанному порядку?"],
  timingConstraints: ["Есть ли желаемый срок и ограничения либо их нет?", "Какие из указанных условий нужно учесть в первую очередь?"]
};
export function fallback(input: AnalysisInput): Analysis {
  const order: Field[] = ["acceptanceCriteria", "scope", "resources", "timingConstraints", "problemContext", "need", "expectedResult", "users", "businessContact", "interactionFormat", "feedbackProcess"];
  const missing = order.filter(k => normalizeField(input.fields[k]) === null && !input.previousAnswers.some(a => a.field === k && normalizeField(a.answer) !== null));
  const selected = [...missing, ...order.filter(k => !missing.includes(k))].slice(0, Math.min(6, Math.max(3, missing.length)));
  return { schemaVersion: 2, missingFields: missing, questions: selected.map(field => ({
    id: `local-${field}`, field, kind: missing.includes(field) ? "missing" : "verification",
    question: questions[field][missing.includes(field) ? 0 : 1], reason: "Ответ поможет уточнить соответствующее поле карточки."
  })), mode: "mock", promptVersion: 2 };
}
export const errorMessages: Record<string, string> = {
  NOT_CONFIGURED: "Ключ или модель OpenAI не настроены.", AUTH_FAILED: "OpenAI отклонил ключ доступа.",
  RATE_LIMIT: "Лимит OpenAI исчерпан или запросы временно ограничены.", TIMEOUT: "OpenAI не ответил вовремя.",
  INVALID_OUTPUT: "Ответ OpenAI не прошёл проверку.", AI_UNAVAILABLE: "OpenAI временно недоступен.",
  NETWORK_ERROR: "Сервер анализа недоступен.", INVALID_REQUEST: "Проверьте описание и длину введённых данных."
};

export const fieldLabels: Record<Field, string> = {
  problemContext: "Что происходит сейчас и кому это мешает?", need: "Что необходимо изменить?",
  users: "Для каких пользователей создаётся решение?", resources: "Какие данные и ресурсы доступны?",
  expectedResult: "Какой результат и в каком формате нужен?", acceptanceCriteria: "Как бизнес проверит результат?",
  scope: "Что входит и что исключено?", timingConstraints: "Сроки и ограничения",
  businessContact: "Рабочий контакт бизнеса", interactionFormat: "Формат консультаций", feedbackProcess: "Порядок обратной связи"
};
