import React, { useState, type FormEvent } from "react";
import { selectTeamPoints, type Actor, type AppState, type Proposal, type StoreAction } from "./store";

type Props = { state: AppState; proposal: Proposal; actor: Actor; points?: number; onAction: (action: StoreAction) => void };

export default function ResultPanel({ state, proposal, actor, points, onAction }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const task = state.tasks.find(t => t.id === proposal.taskId);
  const isTeam = actor.kind === "team" && actor.id === proposal.teamId;
  const isOwner = actor.kind === "business" && actor.id === task?.businessId;
  if (!task?.decisionFinalizedAt || proposal.status !== "selected" || (!isTeam && !isOwner)) return null;
  const result = state.results.find(r => r.proposalId === proposal.id);
  const team = state.teams.find(t => t.id === proposal.teamId)!;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) { setError("Опишите результат этапа перед отправкой."); return; }
    setError(null);
    onAction({ type: "submitResult", actor, taskId: proposal.taskId, proposalId: proposal.id, text });
  }

  return <section className="result-panel" aria-label={`Результат команды ${team.name}`}>
    <h3>Результат этапа</h3>
    <p className="notice">Один этап на выбранную команду. После подтверждения бизнесом — +10 баллов. Баллы не влияют на рейтинг задачи и каталог.</p>
    {result ? <>
      <p className="multiline">{result.text}</p>
      {result.confirmedAt ? <p className="result-status" role="status">Результат подтверждён {new Date(result.confirmedAt).toLocaleString("ru-RU")}. Начислено +10 баллов.</p> : <>
        <p className="notice" role="status">Результат отправлен и ожидает подтверждения бизнеса. Баллы пока не начислены.</p>
        {isOwner && <button type="button" className="primary" onClick={() => onAction({ type: "confirmResult", actor, taskId: proposal.taskId, proposalId: proposal.id, confirmedAt: new Date().toISOString() })}>Подтвердить результат и начислить +10</button>}
      </>}
    </> : isTeam ? <form onSubmit={submit} aria-label={`Отправка результата ${team.name}`}>
      <label className="field">Что сделано за этап?<textarea required rows={4} value={text} onChange={e => { setText(e.target.value); setError(null); }} placeholder="Опишите выполненную работу и полученный результат" /></label>
      <p className="notice">Проверьте текст: после отправки результат нельзя изменить.</p>
      {error && <p className="warning" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={!text.trim()}>Отправить результат</button>
    </form> : <p className="notice">Команда ещё не отправила результат этапа.</p>}
    <p className="team-points">Всего баллов команды: <strong>{points ?? selectTeamPoints(state, proposal.teamId)}</strong></p>
  </section>;
}
