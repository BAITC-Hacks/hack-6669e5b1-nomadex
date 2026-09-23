import { useState, type FormEvent } from "react";
import { sessionSchema, type Session } from "../shared/api";
import { request, setCsrfToken } from "./api";

export default function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [register, setRegister] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "business", interests: "", skills: "", technologies: "" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const list = (s: string) => s.split(",").map(v => v.trim()).filter(Boolean);
      const body = register ? { ...form, skills: list(form.skills), technologies: list(form.technologies) } : { email: form.email, password: form.password };
      const session = sessionSchema.parse(await request(register ? "/api/auth/register" : "/api/auth/login", body));
      setCsrfToken(session.csrfToken); onLogin(session);
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось войти."); }
    finally { setBusy(false); }
  }
  return <main className="shell auth-shell"><span className="eyebrow">NomadEX</span><h1>Задачи бизнеса. Команды. Общий результат.</h1>
    <form className="card auth-form" onSubmit={submit}>
      <h2>{register ? "Создать аккаунт" : "Войти"}</h2>
      <p className="notice">Работайте с общим каталогом со своих устройств.</p>
      <fieldset disabled={busy}>
        {register && <><label className="field">Название бизнеса или команды<input required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field">Роль<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="business">Бизнес</option><option value="team">Команда</option></select></label></>}
        <label className="field">Электронная почта<input required type="email" autoComplete="username" maxLength={254} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
        <label className="field">Пароль (не менее 12 символов)<input required type="password" minLength={12} maxLength={128} autoComplete={register ? "new-password" : "current-password"} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
        {register && form.role === "team" && <>{([['interests', 'Интересы команды'], ['skills', 'Навыки — через запятую'], ['technologies', 'Технологии — через запятую']] as const).map(([key, label]) => <label className="field" key={key}>{label}<input maxLength={1000} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}</>}
        {error && <p className="warning" role="alert">{error}</p>}
        <div className="actions"><button className="primary" type="submit">{busy ? "Подождите…" : register ? "Зарегистрироваться" : "Войти"}</button><button type="button" onClick={() => { setRegister(!register); setError(""); }}>{register ? "Уже есть аккаунт" : "Создать аккаунт"}</button></div>
      </fieldset>
    </form>
  </main>;
}
