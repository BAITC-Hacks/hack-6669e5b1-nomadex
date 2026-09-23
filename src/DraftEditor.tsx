import { useEffect, useRef, useState } from "react";
import type { Draft } from "./types";
import { calculateRating } from "./rating";
import { taskDraft, type Task } from "./store";
import { analyzeTask } from "./analysis";
import { fieldKeys, requestSchema, normalizeField, fallback, parseAnalysis, type Analysis, type AnalysisInput, type Field } from "../shared/contract";
import { SYSTEM_PROMPT } from "../shared/prompt";
import { Rating } from "./TaskView";

type TextKey = Exclude<keyof Draft, "answers">;
const labels: Record<TextKey, string> = {
  title: "Название задачи", description: "Краткое исходное описание", industry: "Отрасль",
  problemContext: "Что происходит и кому это мешает?", expectedResult: "Какой результат и в каком формате нужен?",
  acceptanceCriteria: "Как бизнес проверит результат?", scope: "Что входит и что исключено?",
  resources: "Какие данные и ресурсы доступны?", timingConstraints: "Сроки и ограничения"
};
function toInput(draft: Draft): AnalysisInput {
  return { schemaVersion: 1, description: draft.description,
    fields: Object.fromEntries(fieldKeys.map(k => [k, normalizeField(draft[k])])) as AnalysisInput["fields"], previousAnswers: draft.answers };
}
type Props = { task: Task; onEdit: (draft: Draft) => void; onConfirm: (confirmed: boolean) => void; onPublish: () => void };
export default function DraftEditor({ task, onEdit, onConfirm, onPublish }: Props) {
  const draft = taskDraft(task);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [stale, setStale] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [capturedInput, setCapturedInput] = useState<AnalysisInput | null>(null);
  const [invalidDemo, setInvalidDemo] = useState("not-json");
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function changed() {
    revision.current++; controller.current?.abort(); setBusy(false); setStale(true); setWarning(null);
  }
  function update(key: TextKey, value: string) {
    if (value === (draft[key] ?? "")) return;
    changed(); onEdit({ ...draft, [key]: fieldKeys.includes(key as Field) && value === "" ? null : value });
  }
  function answer(questionId: string, field: Field, value: string) {
    changed(); onEdit({ ...draft, answers: [...draft.answers.filter(a => a.questionId !== questionId || a.field !== field), { questionId, field, answer: value }].slice(-20) });
  }
  async function analyze() {
    const parsed = requestSchema.safeParse(toInput(draft));
    if (!parsed.success) { setWarning("Введите описание и соблюдайте ограничения длины полей."); return; }
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const version = revision.current;
    setBusy(true); setWarning(null); setCapturedInput(parsed.data);
    try {
      const result = await analyzeTask(parsed.data, request.signal);
      if (version !== revision.current || request.signal.aborted) return;
      setAnalysis(result.analysis); setWarning(result.warning); setStale(false);
    } catch { /* Отмена при смене карточки или редактировании. */ }
    finally { if (controller.current === request) setBusy(false); }
  }
  function localQuestions() {
    const input = requestSchema.safeParse(toInput(draft));
    if (!input.success) { setWarning("Сначала введите описание задачи."); return; }
    controller.current?.abort(); setBusy(false); setCapturedInput(input.data);
    setAnalysis(fallback(input.data)); setStale(false); setWarning("Выбраны локальные подсказки. Это не ответ OpenAI.");
  }
  function invalidResponseDemo() {
    const input = requestSchema.safeParse(toInput(draft));
    if (!input.success) { setWarning("Сначала введите описание задачи."); return; }
    const { mode: _mode, promptVersion: _version, ...payload } = fallback(input.data);
    const raw = invalidDemo === "not-json" ? "not JSON" : invalidDemo === "two" ? JSON.stringify({ ...payload, questions: payload.questions.slice(0, 2) }) : JSON.stringify({ ...payload, selectedTeam: "team-001" });
    try { parseAnalysis(raw); setWarning("Тестовый ответ неожиданно прошёл проверку."); }
    catch { localQuestions(); setWarning("Некорректный тестовый ответ отклонён. Карточка сохранена; показаны локальные вопросы."); }
  }
  return <div className="layout">
    <section className="card" aria-label="Редактор задачи">
      <div className="card-head"><h2>Карточка задачи</h2><span className="pill">{task.confirmed ? "Проверено человеком" : "Черновик"}</span></div>
      <p className="notice">{!analysis ? "Анализ ещё не запускался" : stale ? "Сведения изменились: анализ устарел" : analysis.mode === "openai" ? "Вопросы подготовлены OpenAI" : "Локальные подсказки (заглушка AI)"}</p>
      <p className="muted">Неизвестное можно оставить пустым. AI не добавляет факты в карточку.</p>
      {(Object.keys(labels) as TextKey[]).map(key => <label className="field" key={key}>{labels[key]}{key === "title" || key === "industry" ? <input maxLength={200} value={draft[key]} onChange={e => update(key, e.target.value)} /> : <textarea maxLength={key === "description" ? 8000 : 2000} value={draft[key] ?? ""} onChange={e => update(key, e.target.value)} onBlur={e => { if (key !== "description" && normalizeField(e.target.value) === null) update(key, ""); }} rows={key === "description" ? 4 : 3} />}</label>)}
      <div className="actions"><button className="primary" onClick={analyze} disabled={busy || !draft.description.trim()}>{busy ? "Анализируем…" : "Найти пробелы и вопросы"}</button><button onClick={localQuestions}>Локальные подсказки</button></div>
      {warning && <p className="warning" role="alert">{warning}</p>}
      {analysis && <div className="analysis"><strong>{analysis.mode === "openai" ? "Вопросы OpenAI" : "Локальные вопросы"}</strong><ol>{analysis.questions.map(q => {
        const value = draft.answers.find(a => a.questionId === q.id && a.field === q.field)?.answer ?? "";
        return <li key={q.id}><strong>{q.question}</strong><p>{q.reason}</p><label className="field">Ответ (можно пропустить)<textarea maxLength={2000} value={value} onChange={e => answer(q.id, q.field, e.target.value)} /></label><button disabled={!value.trim()} onClick={() => { const combined = [draft[q.field], value].filter(Boolean).join("\n"); if (combined.length > 2000) { setWarning("Сократите ответ: вместе с полем он длиннее 2000 символов."); return; } update(q.field, combined); }}>Добавить ответ в поле «{labels[q.field]}»</button></li>;
      })}</ol></div>}
      {draft.answers.length > 0 && <details><summary>Сохранённые ответы ({draft.answers.length})</summary><ul>{draft.answers.map(a => <li key={`${a.questionId}-${a.field}`}><strong>{labels[a.field]}</strong><p className="multiline">{a.answer || "Без ответа"}</p></li>)}</ul></details>}
      <div className="confirm"><label><input type="checkbox" checked={task.confirmed} disabled={!draft.title.trim() || !draft.description.trim()} onChange={e => onConfirm(e.target.checked)} /> Я проверил текущую версию карточки</label><button className="primary" disabled={!task.confirmed || !draft.title.trim() || !draft.description.trim()} onClick={onPublish}>Опубликовать в каталоге</button></div>
      <p className="notice">Любая правка сбрасывает подтверждение. После публикации карточка фиксируется; задача с неполными сведениями доступна всем с текущим рейтингом {calculateRating(task).total}/100.</p>
      <details><summary>Проверка AI для демонстрации</summary><p>Версия промпта: 1</p><pre>{SYSTEM_PROMPT}</pre><h3>Последний вход</h3><pre>{JSON.stringify(capturedInput, null, 2)}</pre><h3>Проверенный выход</h3><pre>{JSON.stringify(analysis, null, 2)}</pre><select aria-label="Некорректный ответ" value={invalidDemo} onChange={e => setInvalidDemo(e.target.value)}><option value="not-json">Не JSON</option><option value="two">Только два вопроса</option><option value="unknown">Неизвестное поле</option></select><button onClick={invalidResponseDemo}>Проверить неверный ответ</button></details>
    </section>
    <Rating task={task} />
  </div>;
}
