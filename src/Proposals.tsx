import { useState, type FormEvent } from "react";
import ResultPanel from "./ResultPanel";
import { proposalInputSchema, type Actor, type AppState, type Proposal, type StoreAction, type Task } from "./store";

type Props = { state: AppState; task: Task; actor: Actor; onAction: (action: StoreAction) => void };
const statuses = { submitted: "Ожидает решения", selected: "Команда выбрана", rejected: "Команда не выбрана" };
function ProposalLink({ proposal }: { proposal: Proposal }) {
  // Seed links refer to the synthetic description shown in this same card.
  if (proposal.link === `source-data.md#${proposal.id}`) return <a href={`#details-${proposal.id}`}>Демонстрационное предложение</a>;
  const valid = proposalInputSchema.shape.link.safeParse(proposal.link);
  return valid.success ? <a href={valid.data} target="_blank" rel="noopener noreferrer">{valid.data}</a> : <span>{proposal.link} (ссылка недоступна)</span>;
}
function ProposalCard({ proposal, team, children }: { proposal: Proposal; team: AppState["teams"][number]; children?: React.ReactNode }) {
  return <article className="card proposal-card" aria-label={`Предложение ${team.name}`}>
    <div className="card-head"><h3>{team.name}</h3><span className="pill">{statuses[proposal.status]}</span></div>
    <p className="notice">Интересы: {team.interests}<br />Навыки: {team.skills.join(", ")}<br />Технологии: {team.technologies.join(", ")}</p>
    <dl id={`details-${proposal.id}`} className="task-fields">
      <div><dt>Идея решения</dt><dd className="multiline">{proposal.approach}</dd></div>
      <div><dt>Ожидаемый результат</dt><dd className="multiline">{proposal.expectedResult}</dd></div>
      <div><dt>План действий</dt><dd><ol>{proposal.plan.map((step, i) => <li className="multiline" key={i}>{step}</li>)}</ol></dd></div>
      <div><dt>Срок</dt><dd className="multiline">{proposal.timing}</dd></div>
      <div><dt>Навыки для задачи</dt><dd>{proposal.skills.join(", ") || "Не указаны"}</dd></div>
      <div><dt>Ссылка</dt><dd><ProposalLink proposal={proposal} /></dd></div>
    </dl>{children}
  </article>;
}
function ProposalForm({ task, actor, onAction }: Omit<Props, "state">) {
  const [form, setForm] = useState({ approach: "", expectedResult: "", timing: "", plan: "", skills: "", link: "" });
  const [error, setError] = useState<string | null>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = proposalInputSchema.safeParse({ ...form, plan: form.plan.split("\n").map(s => s.trim()).filter(Boolean), skills: form.skills.split(",").map(s => s.trim()).filter(Boolean) });
    if (!parsed.success) { setError("Заполните идею, результат, хотя бы один шаг плана и срок. Ссылка должна начинаться с http:// или https:// и не содержать логин или пароль."); return; }
    setError(null);
    onAction({ type: "submitProposal", actor, taskId: task.id, id: `proposal-${crypto.randomUUID()}`, proposal: parsed.data });
  }
  const field = (key: keyof typeof form, label: string, rows?: number) => <label className="field">{label}{rows ? <textarea required rows={rows} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /> : <input required={key !== "skills"} type={key === "link" ? "url" : "text"} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />}</label>;
  return <form className="card proposal-form" onSubmit={submit} aria-label="Новое предложение">
    <h3>Подать предложение</h3><p className="notice">Одно предложение от команды на задачу. После отправки оно фиксируется; решение принимает бизнес.</p>
    {field("approach", "Идея решения", 3)}{field("expectedResult", "Ожидаемый результат", 2)}{field("plan", "План действий — каждый шаг с новой строки", 4)}{field("timing", "Предлагаемый срок")}{field("skills", "Навыки для задачи — через запятую (необязательно)")}{field("link", "Ссылка на материалы или портфолио")}
    {error && <p className="warning" role="alert">{error}</p>}<button className="primary" type="submit">Отправить предложение</button>
  </form>;
}
export default function Proposals({ state, task, actor, onAction }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const proposals = state.proposals.filter(p => p.taskId === task.id);
  const own = proposals.find(p => p.teamId === actor.id);
  const isOwner = actor.kind === "business" && actor.id === task.businessId;
  const visible = isOwner ? proposals : proposals.filter(p => p.teamId === actor.id);
  const closed = Boolean(task.decisionFinalizedAt);
  const selectedNames = proposals.filter(p => (closed ? p.status === "selected" : selected.includes(p.id))).map(p => state.teams.find(t => t.id === p.teamId)!.name);
  return <section className="proposals" aria-label="Предложения команд">
    <h2>{isOwner ? `Предложения команд (${proposals.length})` : "Предложение вашей команды"}</h2>
    {closed ? <p className="notice" role="status">Решение принято {new Date(task.decisionFinalizedAt!).toLocaleString("ru-RU")}. Приём предложений закрыт.{isOwner && ` ${selectedNames.length ? `Выбраны: ${selectedNames.join(", ")}.` : "Ни одна команда не выбрана."}`}</p> : <p className="notice">{isOwner ? "Сравните идеи, планы и сроки. Можно выбрать одну, несколько или ни одной команды. Решение принимаете вы." : "Участвовать может любая команда независимо от рейтинга задачи."}</p>}
    {own && !closed && <p role="status" className="notice">Предложение отправлено. Повторный отклик недоступен; ожидайте решения бизнеса.</p>}
    <div className="proposal-grid">{visible.map(p => <ProposalCard key={p.id} proposal={p} team={state.teams.find(t => t.id === p.teamId)!}>
      {isOwner && !closed && <label className="proposal-choice"><input type="checkbox" checked={selected.includes(p.id)} onChange={e => { setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id)); setReviewing(false); }} />Выбрать {state.teams.find(t => t.id === p.teamId)!.name}</label>}
      <ResultPanel state={state} proposal={p} actor={actor} onAction={onAction} />
    </ProposalCard>)}</div>
    {isOwner && !proposals.length && <p className="notice">Откликов пока нет. Можно дождаться предложений или завершить приём без выбора команды.</p>}
    {isOwner && !closed && <div className="card decision">
      {reviewing ? <><h3>Подтвердите окончательное решение</h3><p>{selectedNames.length ? `Выбраны: ${selectedNames.join(", ")}. Остальные предложения будут отклонены.` : "Ни одна команда не выбрана. Все поступившие предложения будут отклонены."}</p><p>Приём новых предложений закроется. Пересмотреть решение в прототипе нельзя.</p><div className="actions"><button className="primary" onClick={() => onAction({ type: "finalizeDecision", actor, taskId: task.id, selectedProposalIds: selected, confirmed: true, finalizedAt: new Date().toISOString() })}>{selected.length ? "Подтвердить выбор команд" : "Подтвердить решение без команд"}</button><button onClick={() => setReviewing(false)}>Вернуться к сравнению</button></div></> : <><p>Предварительно выбрано команд: {selected.length}. Решение ещё не принято.</p><button className="primary" onClick={() => setReviewing(true)}>Проверить решение</button></>}
    </div>}
    {actor.kind === "team" && !own && (closed ? <p className="notice">Ваша команда не подавала предложение. Новые отклики больше не принимаются.</p> : <ProposalForm task={task} actor={actor} onAction={onAction} />)}
  </section>;
}
