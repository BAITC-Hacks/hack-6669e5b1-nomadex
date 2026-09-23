import React from "react";
import { fieldKeys, fieldLabels } from "../shared/contract";
import { calculateRating, readinessLevel } from "./rating";
import type { Task } from "./store";
export function Rating({ task }: { task: Task }) {
  const rating = calculateRating(task);
  const level = readinessLevel(rating.total);
  return <aside className="side" aria-label="Рейтинг задачи"><div className="score"><span className="eyebrow">{task.confirmed ? "Подтверждённая готовность" : "Предварительный расчёт"}</span><strong>{rating.total}<small>/100</small></strong><p>{level.label}</p><div className="meter"><i style={{ width: rating.total + "%" }} /></div><p>{task.confirmed ? "Поля проверены бизнесом. Полнота сведений, не оценка компании." : "Баллы будут подтверждены после проверки заполненных полей бизнесом."}</p></div><div className="card breakdown"><h3>Из чего складывается рейтинг</h3>{rating.breakdown.map(item => <div className="criterion" key={item.key}><span>{item.label}</span><b>{item.earned}/{item.weight}</b>{item.earned === 0 && <small>Уточните: {item.hint}</small>}</div>)}</div></aside>;
}
export function TaskView({ task, businessName }: { task: Task; businessName: string }) {
  return <div className="layout"><article className="card" aria-label="Опубликованная карточка"><div className="card-head"><div><span className="eyebrow">{task.industry || "Тема не указана"}</span><h2>{task.title}</h2></div><span className={`pill readiness-${readinessLevel(task.readinessScore).id}`}>{readinessLevel(task.readinessScore).label}</span></div><p className="notice">{businessName} · {new Date(task.publishedAt!).toLocaleString("ru-RU")}</p><p className="multiline">{task.description}</p><dl className="task-fields">{fieldKeys.map(key => <div key={key}><dt>{fieldLabels[key]}</dt><dd className="multiline">{task[key] || "Пока не указано"}</dd></div>)}</dl><p className="notice">Карточка подтверждена бизнесом и зафиксирована.</p></article><Rating task={task} /></div>;
}
