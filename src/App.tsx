import { useEffect, useReducer, useState } from "react";
import type { Profile } from "./types";
import { loadAppState, reduceStore, resetAppState, saveAppState, selectCatalog, selectOwnedTasks, selectTeamPoints, type AppState, type Actor, type StoreAction } from "./store";
import DraftEditor from "./DraftEditor";
import Proposals from "./Proposals";
import { TaskView } from "./TaskView";

type View = "mine" | "catalog";
type Session = { state: AppState; error: string | null };
type Action = { type: "change"; action: StoreAction } | { type: "reset"; state: AppState };
function reducer(current: Session, action: Action): Session {
  if (action.type === "reset") return { state: action.state, error: null };
  try { return { state: reduceStore(current.state, action.action), error: null }; }
  catch (error) { return { ...current, error: error instanceof Error ? error.message : "Действие не выполнено." }; }
}
export default function App() {
  const [initial] = useState(loadAppState);
  const [{ state, error }, dispatch] = useReducer(reducer, { state: initial.state, error: null });
  const [blocked, setBlocked] = useState(initial.blocked);
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [saved, setSaved] = useState(!initial.blocked);
  const [profile, setProfile] = useState<Profile>("business");
  const [view, setView] = useState<View>("mine");
  const [selectedId, setSelectedId] = useState<string | null>(initial.state.tasks.find(t => t.status === "draft")?.id ?? null);
  const actor: Actor = { kind: profile === "business" ? "business" : "team", id: profile === "business" ? state.businesses[0].id : profile };
  const catalog = selectCatalog(state);
  const owned = selectOwnedTasks(state, actor);
  const visible = view === "catalog" ? catalog : owned;
  const selected = visible.find(t => t.id === selectedId);
  useEffect(() => {
    if (blocked) return;
    const ok = saveAppState(state); setSaved(ok);
    if (!ok) setStorageWarning("Сохранение недоступно. Изменения остаются в памяти до закрытия вкладки.");
  }, [state, blocked]);
  function changeView(next: View) {
    setView(next); setSelectedId(null);
  }
  function changeProfile(next: Profile) {
    setProfile(next); setView(next === "business" ? "mine" : "catalog"); setSelectedId(null);
  }
  function createTask() {
    const id = `task-${crypto.randomUUID()}`;
    dispatch({ type: "change", action: { type: "create", actor, id } }); setView("mine"); setSelectedId(id);
  }
  function reset() {
    if (!window.confirm("Вернуть демонстрационные данные? Созданные задачи и изменения в этом приложении будут удалены. Остальные данные браузера сохранятся.")) return;
    const loaded = resetAppState(); dispatch({ type: "reset", state: loaded.state });
    setBlocked(loaded.blocked); setSaved(!loaded.blocked); setStorageWarning(loaded.warning);
    setSelectedId(null); setProfile("business"); setView("mine");
  }
  return <main className="shell">
    <header className="topbar"><div><span className="eyebrow">NomadEX / прототип</span><h1>Задача, которую можно понять</h1><p>Уточните задачу и опубликуйте её для студенческих команд.</p></div><label className="profile">Демо-профиль<select value={profile} onChange={e => changeProfile(e.target.value as Profile)}><option value="business">Представитель бизнеса</option>{state.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></header>
    <p className="notice">Демонстрация в одном браузере. Каталог общий для всех пяти команд, синхронизации между устройствами нет.</p>
    {actor.kind === "team" && <p className="team-points" role="status">Баллы вашей команды: <strong>{selectTeamPoints(state, actor.id)}</strong>. За каждый подтверждённый результат — +10. Баллы не влияют на доступ к задачам и их рейтинг.</p>}
    <section className="status"><span className="dot" />{saved && !blocked ? "Данные сохраняются локально" : "Работа без сохранения"}<button className="reset-link" onClick={reset}>Сбросить демоданные</button></section>
    {storageWarning && <p className="warning" role="alert">{storageWarning}</p>}
    {error && <p className="warning" role="alert">{error}</p>}
    <nav className="view-tabs" aria-label="Разделы приложения">{profile === "business" && <button aria-pressed={view === "mine"} onClick={() => changeView("mine")}>Мои задачи ({owned.length})</button>}<button aria-pressed={view === "catalog"} onClick={() => changeView("catalog")}>Общий каталог ({catalog.length})</button>{profile === "business" && <button className="primary" onClick={createTask}>Новая задача</button>}</nav>
    <section aria-label={view === "mine" ? "Список моих задач" : "Общий каталог"}>
      <h2>{view === "mine" ? "Мои задачи" : "Общий каталог"}</h2>
      <p className="notice">{view === "mine" ? "Черновики видны только бизнесу. Выберите задачу, чтобы продолжить её подготовку." : "Выше расположены задачи с более полным описанием. При равном рейтинге сначала идут новые публикации."}</p>
      {visible.length === 0 ? <div className="card empty">{view === "mine" ? "Задач пока нет. Создайте первую." : "Опубликованных задач пока нет."}</div> : <div className="task-list">{visible.map((task, index) => <button className={`task-list-item ${task.id === selectedId ? "selected" : ""}`} key={task.id} aria-pressed={task.id === selectedId} onClick={() => setSelectedId(task.id)}><span className="task-list-top"><span className="eyebrow">{view === "catalog" ? `#${index + 1} · ` : ""}{task.industry || "Отрасль не указана"}</span><b>{task.readinessScore}/100</b></span><strong>{task.title || "Без названия"}</strong><span className="task-excerpt">{task.description || "Добавьте описание задачи"}</span><span className="pill">{task.status === "published" ? task.decisionFinalizedAt ? "Приём закрыт" : "Открыт приём предложений" : task.confirmed ? "Готово к публикации" : "Черновик"}</span></button>)}</div>}
    </section>
    <div className="task-detail">{selected?.status === "draft" && profile === "business" ? <DraftEditor key={selected.id} task={selected} onEdit={draft => dispatch({ type: "change", action: { type: "edit", actor, taskId: selected.id, draft } })} onConfirm={confirmed => dispatch({ type: "change", action: { type: "confirm", actor, taskId: selected.id, confirmed } })} onPublish={() => { dispatch({ type: "change", action: { type: "publish", actor, taskId: selected.id, publishedAt: new Date().toISOString() } }); setView("catalog"); }} /> : selected?.status === "published" ? <><TaskView task={selected} businessName={state.businesses.find(b => b.id === selected.businessId)?.name ?? "Бизнес"} /><Proposals key={`${selected.id}-${profile}`} state={state} task={selected} actor={actor} onAction={action => dispatch({ type: "change", action })} /></> : <p className="notice">Выберите карточку из списка для просмотра.</p>}</div>
  </main>;
}
