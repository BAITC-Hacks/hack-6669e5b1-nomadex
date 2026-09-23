import { useEffect, useRef, useState } from "react";
import { readinessLevel, readinessLevels, type ReadinessLevel } from "./rating";
import { selectCatalog, selectOwnedTasks, type StoreAction } from "./store";
import { type Session, type Snapshot } from "../shared/api";
import { ApiError, change, commandFromAction, getSession, getSnapshot, request, setCsrfToken } from "./api";
import Login from "./Login";
import RemoteDraft from "./RemoteDraft";
import Proposals from "./Proposals";
import { TaskView } from "./TaskView";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false); const [error, setError] = useState("");
  useEffect(() => { void getSession().then(setSession).catch(e => { if (!(e instanceof ApiError) || e.status !== 401) setError("Сервер недоступен. Проверьте подключение и обновите страницу."); }).finally(() => setReady(true)); }, []);
  if (!ready) return <main className="shell"><p role="status">Подключаемся к серверу…</p></main>;
  if (!session) return <>{error && <p className="warning" role="alert">{error}</p>}<Login onLogin={s => { setSession(s); setError(""); }} /></>;
  return <Workspace key={session.account.id} session={session} onLogout={() => { setCsrfToken(""); setSession(null); }} />;
}

function Workspace({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [view, setView] = useState<"mine" | "catalog">(session.account.actor.kind === "business" ? "mine" : "catalog");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [industry, setIndustry] = useState(""); const [level, setLevel] = useState<ReadinessLevel | "">("");
  const actor = session.account.actor;
  const leaveDraft = () => !draftDirty || window.confirm("Есть несохранённый черновик. Покинуть его без сохранения?");
  function accept(next: Snapshot) { if (mounted.current) setSnapshot(current => !current || next.revision >= current.revision ? next : current); }
  async function refresh() {
    try { accept(await getSnapshot()); }
    catch (e) { if (mounted.current) setError(e instanceof ApiError && e.status === 401 ? "Сессия завершилась. Скопируйте несохранённый текст, затем выйдите и войдите снова." : e instanceof Error ? e.message : "Не удалось обновить данные."); }
  }
  useEffect(() => {
    mounted.current = true; void refresh();
    const timer = window.setInterval(() => { if (!inFlight.current) void refresh(); }, 5000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, []);
  async function onAction(action: StoreAction, revision = snapshot?.revision) {
    if (inFlight.current || revision === undefined) return null;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const next = await change({ requestId: crypto.randomUUID(), expectedRevision: revision, command: commandFromAction(action) });
      accept(next); return next;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError("Сессия завершилась. Текст остался в форме; скопируйте его перед повторным входом.");
      else { setError(e instanceof Error ? e.message : "Действие не выполнено."); if (e instanceof ApiError && e.code === "CONFLICT") await refresh(); }
      return null;
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function logout() {
    if (!leaveDraft()) return;
    try { await request("/api/auth/logout", {}); onLogout(); }
    catch (e) { if (e instanceof ApiError && e.status === 401) onLogout(); else setError(e instanceof Error ? e.message : "Не удалось выйти."); }
  }
  function changeView(next: "mine" | "catalog") { if (!leaveDraft()) return; setView(next); setSelectedId(null); setIndustry(""); setLevel(""); }
  async function createTask() {
    if (!leaveDraft()) return;
    const next = await onAction({ type: "create", actor, id: "" });
    if (next?.createdId) { setView("mine"); setSelectedId(next.createdId); }
  }
  if (!snapshot) return <main className="shell"><p role="status">Загружаем общий каталог…</p>{error && <p className="warning" role="alert">{error}</p>}<button onClick={() => void refresh()}>Повторить</button><button onClick={() => void logout()}>Выйти</button></main>;
  const { state } = snapshot;
  const catalog = selectCatalog(state);
  const filtered = selectCatalog(state, { industry, level });
  const industries = [...new Set(catalog.map(t => t.industry).filter(Boolean))].sort();
  const owned = selectOwnedTasks(state, actor);
  const visible = view === "catalog" ? filtered : owned;
  const selected = visible.find(t => t.id === selectedId);
  return <main className="shell">
    <header className="topbar"><div><span className="eyebrow">NomadEX</span><h1>Задача, которую можно понять</h1><p>Уточните задачу и опубликуйте её для студенческих команд.</p></div>
      <div className="profile"><strong>{session.account.name}</strong><span>{actor.kind === "business" ? "Бизнес" : "Команда"} · {session.account.email}</span><button disabled={busy} onClick={() => void logout()}>Выйти</button></div>
    </header>
    <p className="notice">Общий каталог для всех аккаунтов. Данные хранятся на сервере и обновляются каждые 5 секунд.</p>
    {actor.kind === "team" && <p className="team-points" role="status">Баллы вашей команды: <strong>{snapshot.teamPoints[actor.id] ?? 0}</strong>. За каждый подтверждённый результат — +10.</p>}
    <section className="status"><span className="dot" />{busy ? "Сохраняем на сервере…" : "Подключено к общей базе"}<button className="reset-link" disabled={busy} onClick={() => void refresh()}>Обновить данные</button></section>
    {error && <p className="warning" role="alert">{error}</p>}
    <fieldset disabled={busy} className="workspace-fields">
    <nav className="view-tabs" aria-label="Разделы приложения">{actor.kind === "business" && <button aria-pressed={view === "mine"} onClick={() => changeView("mine")}>Мои задачи ({owned.length})</button>}<button aria-pressed={view === "catalog"} onClick={() => changeView("catalog")}>Общий каталог ({catalog.length})</button>{actor.kind === "business" && <button className="primary" onClick={createTask}>Новая задача</button>}</nav>
    <section aria-label={view === "mine" ? "Список моих задач" : "Общий каталог"}>
      <h2>{view === "mine" ? "Мои задачи" : "Общий каталог"}</h2>
      <p className="notice">{view === "mine" ? "Черновики видны только бизнесу. Выберите задачу, чтобы продолжить её подготовку." : "Выше расположены задачи с более полным описанием. При равном рейтинге сначала идут новые публикации."}</p>
      {view === "catalog" && <div className="catalog-filters">
        <label>Тема / отрасль<select value={industry} onChange={e => { setIndustry(e.target.value); setSelectedId(null); }}><option value="">Все темы</option>{industries.map(i => <option key={i} value={i}>{i}</option>)}</select></label>
        <label>Уровень готовности<select value={level} onChange={e => { setLevel(e.target.value as ReadinessLevel | ""); setSelectedId(null); }}><option value="">Все уровни</option>{readinessLevels.map(l => <option key={l.id} value={l.id}>{l.label} ({l.min}–{l.max})</option>)}</select></label>
        <button onClick={() => { setIndustry(""); setLevel(""); setSelectedId(null); }}>Сбросить фильтры</button><span role="status">Показано {filtered.length} из {catalog.length}</span>
      </div>}
      {visible.length === 0 ? <div className="card empty">{view === "mine" ? "Задач пока нет. Создайте первую." : catalog.length ? "Нет задач по выбранным фильтрам. Сбросьте фильтры, чтобы увидеть все задачи." : "Опубликованных задач пока нет."}</div> : <div className="task-list">{visible.map((task, index) => <button className={`task-list-item ${task.id === selectedId ? "selected" : ""} ${task.confirmed && readinessLevel(task.readinessScore).id === "priority" ? "priority-task" : ""}`} key={task.id} aria-pressed={task.id === selectedId} onClick={() => { if (task.id === selectedId || leaveDraft()) setSelectedId(task.id); }}><span className="task-list-top"><span className="eyebrow">{view === "catalog" ? `#${index + 1} · ` : ""}{task.industry || "Отрасль не указана"}</span><b>{!task.confirmed && "Предв. "}{task.readinessScore}/100</b></span><strong>{task.title || "Без названия"}</strong><span className="task-excerpt">{task.description || "Добавьте описание задачи"}</span><span className={`pill readiness-${readinessLevel(task.readinessScore).id}`}>{!task.confirmed && "Предварительно: "}{readinessLevel(task.readinessScore).label}</span><span className="pill">{task.status === "published" ? task.decisionFinalizedAt ? "Приём закрыт" : "Открыт приём предложений" : task.confirmed ? "Готово к публикации" : "Черновик"}</span></button>)}</div>}
    </section>

    <div className="task-detail">{selected?.status === "draft" && actor.kind === "business" ? <RemoteDraft key={selected.id} task={selected} revision={snapshot.revision} actor={actor} busy={busy} onAction={onAction} onDirtyChange={setDraftDirty} onPublished={() => { setIndustry(""); setLevel(""); setView("catalog"); }} /> : selected?.status === "published" ? <><TaskView task={selected} businessName={state.businesses.find(b => b.id === selected.businessId)?.name ?? "Бизнес"} /><Proposals key={selected.id} state={state} task={selected} actor={actor} teamPoints={snapshot.teamPoints} onAction={action => { void onAction(action); }} /></> : <p className="notice">Выберите карточку из списка для просмотра.</p>}</div>
    </fieldset>
  </main>;
}
