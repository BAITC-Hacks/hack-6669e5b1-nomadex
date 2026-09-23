import { useEffect, useMemo, useRef, useState } from "react";
import { calculateRating } from "./rating";
import { loadDraft, resetDraft, saveDraft, withDraft } from "./storage";
import { createEmptyDraft, draftSchema, type Draft, type Profile } from "./types";
import { analyzeTask } from "./analysis";
import { fieldKeys, requestSchema, normalizeField, fallback, parseAnalysis, type Analysis, type AnalysisInput, type Field } from "../shared/contract";
import { SYSTEM_PROMPT } from "../shared/prompt";
import seed from "../docs/source-data.json";

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
export default function App() {
  const [initial] = useState(loadDraft);
  const [state, setState] = useState(initial.state);
  const [blocked, setBlocked] = useState(initial.blocked);
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [saved, setSaved] = useState(!initial.blocked);
  const [profile, setProfile] = useState<Profile>("business");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [stale, setStale] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [capturedInput, setCapturedInput] = useState<AnalysisInput | null>(null);
  const [invalidDemo, setInvalidDemo] = useState("not-json");
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const { draft, confirmed } = state;
  const rating = useMemo(() => calculateRating(draft), [draft]);
  useEffect(() => {
    if (blocked) return;
    const ok = saveDraft(state); setSaved(ok);
    if (!ok) setStorageWarning("Сохранение недоступно. Изменения остаются в памяти до закрытия вкладки.");
  }, [state, blocked]);
  useEffect(() => () => controller.current?.abort(), []);
  function changed() {
    revision.current++; controller.current?.abort(); setBusy(false); setStale(true); setWarning(null);
  }
  function update(key: TextKey, value: string) {
    changed();
    setState(current => withDraft(current, { ...current.draft, [key]: fieldKeys.includes(key as Field) && value === "" ? null : value }));
  }
  function answer(questionId: string, field: Field, value: string) {
    changed();
    setState(current => withDraft(current, { ...current.draft,
      answers: [...current.draft.answers.filter(a => a.questionId !== questionId || a.field !== field), { questionId, field, answer: value }].slice(-20) }));
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
    } catch { /* Редактирование или смена профиля отменяет устаревший запрос. */ }
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
  function loadExample(id: string) {
    const example = seed.drafts.find(d => d.id === id);
    if (!example || !window.confirm("Заменить рабочий черновик выбранным примером?")) return;
    changed(); setAnalysis(null);
    setState({ schemaVersion: 2, confirmed: false, draft: draftSchema.parse({ title: example.title, description: example.description,
      industry: example.industry, ...Object.fromEntries(fieldKeys.map(k => [k, example[k]])), answers: example.answers }) });
  }
  function reset() {
    if (!window.confirm("Удалить рабочий черновик и его старую копию? Остальные данные браузера сохранятся.")) return;
    changed(); setAnalysis(null);
    const ok = resetDraft(); setBlocked(!ok); setSaved(ok);
    setStorageWarning(ok ? null : "Хранилище недоступно. Новый черновик останется только в памяти.");
    setState({ schemaVersion: 2, draft: createEmptyDraft(), confirmed: false });
  }
  return <main className="shell">
    <header className="topbar">
      <div><span className="eyebrow">NomadEX / прототип</span><h1>Задача, которую можно понять</h1><p>Опишите задачу, уточните сведения и проверьте карточку.</p></div>
      <label className="profile">Демо-профиль<select value={profile} onChange={e => { changed(); setProfile(e.target.value as Profile); }}><option value="business">Представитель бизнеса</option>{seed.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    </header>
    <p className="notice">Демонстрация в одном браузере: профили используют локальные данные, синхронизации между устройствами нет.</p>
    <section className="status"><span className="dot" />{saved && !blocked ? "Черновик сохраняется локально" : "Работа без сохранения"}<span className="mode">{!analysis ? "Анализ ещё не запускался" : stale ? "Анализ устарел" : analysis.mode === "openai" ? "OpenAI" : "Локальная заглушка"}</span></section>
    {storageWarning && <p className="warning" role="alert">{storageWarning}</p>}
    <div className="layout">
      <section className="card">
        <div className="card-head"><h2>{profile === "business" ? "Рабочий черновик" : "Каталог задач"}</h2><span className="pill">{confirmed ? "Проверено человеком" : "Черновик"}</span></div>
        {profile === "business" ? <>
          <label className="field">Загрузить пример черновика<select value="" onChange={e => loadExample(e.target.value)}><option value="">Выберите пример</option>{seed.drafts.map(d => <option key={d.id} value={d.id}>{d.title} — {d.readinessScore}/100</option>)}</select></label>
          <p className="muted">Неизвестное можно оставить пустым. Ответы AI не добавляют факты в карточку.</p>
          {(Object.keys(labels) as TextKey[]).map(key => <label className="field" key={key}>{labels[key]}{key === "title" || key === "industry" ? <input maxLength={200} value={draft[key]} onChange={e => update(key, e.target.value)} /> : <textarea maxLength={key === "description" ? 8000 : 2000} value={draft[key] ?? ""} onChange={e => update(key, e.target.value)} onBlur={e => { if (key !== "description" && normalizeField(e.target.value) === null) update(key, ""); }} rows={key === "description" ? 4 : 3} />}</label>)}
          <div className="actions"><button className="primary" onClick={analyze} disabled={busy || !draft.description.trim()}>{busy ? "Анализируем…" : "Найти пробелы и вопросы"}</button><button onClick={localQuestions}>Локальные подсказки</button><button onClick={reset}>Сбросить черновик</button></div>
          {warning && <p className="warning" role="alert">{warning}</p>}
          {analysis && <div className="analysis"><strong>{analysis.mode === "openai" ? "Вопросы подготовлены OpenAI" : "Локальные подсказки (заглушка AI)"}</strong>{stale && <p>Сведения изменились. Для нового анализа нажмите «Найти пробелы и вопросы».</p>}<ol>{analysis.questions.map(q => {
            const value = draft.answers.find(a => a.questionId === q.id && a.field === q.field)?.answer ?? "";
            return <li key={q.id}><strong>{q.question}</strong><p>{q.reason}</p><label className="field">Ответ (можно пропустить)<textarea maxLength={2000} value={value} onChange={e => answer(q.id, q.field, e.target.value)} /></label><button disabled={!value.trim()} onClick={() => { const combined = [draft[q.field], value].filter(Boolean).join("\n"); if (combined.length > 2000) { setWarning("Ответ вместе с полем длиннее 2000 символов. Сократите текст перед добавлением."); return; } update(q.field, combined); }}>Добавить ответ в поле «{labels[q.field]}»</button></li>;
          })}</ol></div>}
          <div className="confirm"><label><input type="checkbox" checked={confirmed} disabled={!draft.title.trim() || !draft.description.trim()} onChange={e => setState(s => ({ ...s, confirmed: e.target.checked }))} /> Я проверил текущую версию карточки</label><p>{confirmed ? "Подтверждение сохранено. Публикация ещё не реализована." : "Изменение карточки сбрасывает подтверждение."}</p></div>
          <details><summary>Проверка AI для демонстрации</summary><p>Версия промпта: 1</p><pre>{SYSTEM_PROMPT}</pre><h3>Последний вход</h3><pre>{JSON.stringify(capturedInput, null, 2)}</pre><h3>Проверенный выход</h3><pre>{JSON.stringify(analysis, null, 2)}</pre><select aria-label="Некорректный ответ" value={invalidDemo} onChange={e => setInvalidDemo(e.target.value)}><option value="not-json">Не JSON</option><option value="two">Только два вопроса</option><option value="unknown">Неизвестное поле</option></select><button onClick={invalidResponseDemo}>Проверить неверный ответ</button></details>
        </> : <div className="empty"><h3>Каталог ещё не реализован</h3><p>Доступен выбор пяти демокоманд. Просмотр каталога и отправка отклика — следующие этапы roadmap.</p></div>}
      </section>
      {profile === "business" && <aside className="side"><div className="score"><span className="eyebrow">Готовность</span><strong>{rating.total}<small>/100</small></strong><div className="meter"><i style={{ width: rating.total + "%" }} /></div><p>Полнота сведений, а не оценка бизнеса.</p></div><div className="card breakdown"><h3>Из чего складывается рейтинг</h3>{rating.breakdown.map(item => <div className="criterion" key={item.key}><span>{item.label}</span><b>{item.earned}/{item.weight}</b>{item.earned === 0 && <small>{item.hint}</small>}</div>)}</div></aside>}
    </div>
  </main>;
}
