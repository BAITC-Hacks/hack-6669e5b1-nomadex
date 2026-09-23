import { calculateRating } from "./rating";
import type { Task } from "./store";
export function Rating({ task }: { task: Task }) {
  const rating = calculateRating(task);
  return <aside className="side" aria-label="Рейтинг задачи"><div className="score"><span className="eyebrow">Готовность</span><strong>{rating.total}<small>/100</small></strong><div className="meter"><i style={{ width: rating.total + "%" }} /></div><p>Полнота сведений, а не оценка бизнеса.</p></div><div className="card breakdown"><h3>Из чего складывается рейтинг</h3>{rating.breakdown.map(item => <div className="criterion" key={item.key}><span>{item.label}</span><b>{item.earned}/{item.weight}</b>{item.earned === 0 && <small>{item.hint}</small>}</div>)}</div></aside>;
}
export function TaskView({ task, businessName }: { task: Task; businessName: string }) {
  return <div className="layout"><article className="card" aria-label="Опубликованная карточка"><div className="card-head"><div><span className="eyebrow">{task.industry || "Отрасль не указана"}</span><h2>{task.title}</h2></div><span className="pill">Опубликовано</span></div><p className="notice">{businessName} · {new Date(task.publishedAt!).toLocaleString("ru-RU")}</p><p className="multiline">{task.description}</p><dl className="task-fields">{calculateRating(task).breakdown.map(item => <div key={item.key}><dt>{item.label}</dt><dd className="multiline">{task[item.key] || "Пока не указано"}</dd></div>)}</dl><p className="notice">Карточка подтверждена бизнесом и зафиксирована. Подача предложений появится на следующем этапе.</p></article><Rating task={task} /></div>;
}
