import { useEffect, useMemo, useState } from "react";
import { calculateRating } from "./rating";
import { loadDraft, saveDraft } from "./storage";
import type { Analysis, Draft, Profile } from "./types";

const labels: Record<keyof Draft, string> = {
  title: "Название задачи", description: "Что происходит сейчас?", target: "Кому или чему это мешает?",
  desiredResult: "Какой результат нужен?", acceptanceCriteria: "Как бизнес проверит результат?",
  scope: "Что входит и что исключено?", resources: "Какие данные и ресурсы доступны?",
  constraints: "Сроки и ограничения"
};

export default function App() {
  const [profile, setProfile] = useState<Profile>("business");
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState(true);
  const rating = useMemo(() => calculateRating(draft), [draft]);

  useEffect(() => { setSaved(saveDraft(draft)); }, [draft]);

  function update(key: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setConfirmed(false);
  }

  async function analyze() {
    const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    const data = await response.json() as Analysis;
    setAnalysis(data);
  }

  return <main className="shell">
    <header className="topbar">
      <div><span className="eyebrow">NOMadEX / MVP</span><h1>Задача, которую можно понять</h1><p>Путь от идеи бизнеса к команде — с понятными пробелами и решениями человека.</p></div>
      <label className="profile">Демо-профиль<select value={profile} onChange={(e) => setProfile(e.target.value as Profile)}><option value="business">Представитель бизнеса</option><option value="team">Студенческая команда</option></select></label>
    </header>
    <section className="status"><span className="dot" />{saved ? "Черновик сохраняется локально" : "Сохранение недоступно — продолжайте, но не закрывайте вкладку"}<span className="mode">Режим: {analysis?.mode === "openai" ? "OpenAI" : "резерв"}</span></section>
    <div className="layout">
      <section className="card">
        <div className="card-head"><div><span className="eyebrow">Шаг 1–3</span><h2>{profile === "business" ? "Опишите бизнес-задачу" : "Каталог задач"}</h2></div><span className="pill">Черновик</span></div>
        {profile === "business" ? <>
          <p className="muted">Начните с короткого описания. После анализа система задаст вопросы, но не будет придумывать ответы за вас.</p>
          {(Object.keys(labels) as Array<keyof Draft>).map((key) => <label className="field" key={key}>{labels[key]}{key === "title" ? <input value={draft[key]} onChange={(e) => update(key, e.target.value)} placeholder="Например: сократить время обработки заявок" /> : <textarea value={draft[key]} onChange={(e) => update(key, e.target.value)} rows={key === "description" ? 4 : 3} placeholder="Пока неизвестно можно оставить пустым" />}</label>)}
          <div className="actions"><button className="primary" onClick={analyze} disabled={!draft.description.trim()}>Найти пробелы и вопросы</button><button onClick={() => { setAnalysis(null); setConfirmed(false); }}>Сбросить подтверждение</button></div>
          {analysis && <div className="analysis"><div className="analysis-title"><strong>Уточнения</strong><span className="pill">{analysis.mode === "openai" ? "OpenAI" : "резерв"}</span></div><ol>{analysis.questions.map((question) => <li key={question}>{question}</li>)}</ol>{analysis.suggestions.length > 0 && <p className="hint">{analysis.suggestions.join(" · ")}</p>}</div>}
          <div className="confirm"><label><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Я проверил текущую версию карточки</label><button className="primary" disabled={!confirmed || !draft.title.trim() || !draft.description.trim()} onClick={() => alert("Следующим этапом публикация появится в общем каталоге.")}>Подтвердить карточку</button></div>
        </> : <div className="empty"><h3>Каталог подключается следующим этапом</h3><p>Переключитесь в профиль бизнеса, чтобы подготовить первую задачу.</p></div>}
      </section>
      <aside className="side">
        <div className="score"><span className="eyebrow">Готовность</span><strong>{rating.total}<small>/100</small></strong><div className="meter"><i style={{width: rating.total + "%"}} /></div><p>Рейтинг показывает полноту сведений, а не качество бизнеса или вероятность успеха.</p></div>
        <div className="card breakdown"><h3>Из чего складывается рейтинг</h3>{rating.breakdown.map((item) => <div className="criterion" key={item.key}><span>{item.label}</span><b>{item.earned}/{item.weight}</b></div>)}</div>
      </aside>
    </div>
  </main>;
}