import { useEffect, useState } from "react";
import { calculateRating } from "./rating";
import { taskDraft, type StoreAction, type Task, type Actor } from "./store";
import type { Snapshot } from "../shared/api";
import DraftEditor from "./DraftEditor";

type Props = { task: Task; revision: number; actor: Actor; busy: boolean; onAction: (action: StoreAction, revision?: number) => Promise<Snapshot | null>; onPublished: () => void; onDirtyChange: (dirty: boolean) => void };
export default function RemoteDraft({ task, revision, actor, busy, onAction, onPublished, onDirtyChange }: Props) {
  const [local, setLocal] = useState(task); const [dirty, setDirty] = useState(false);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [editorKey, setEditorKey] = useState(0);
  useEffect(() => { if (!dirty) { setLocal(task); setBaseRevision(revision); } }, [task, revision, dirty]);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save() {
    const result = await onAction({ type: "edit", actor, taskId: task.id, draft: taskDraft(local) }, baseRevision);
    if (result) { setLocal(result.state.tasks.find(t => t.id === task.id)!); setBaseRevision(result.revision); setDirty(false); }
  }
  return <>
    <div className="card save-draft"><p role="status">{dirty ? "Есть несохранённые изменения. Сохраните их перед подтверждением." : "Черновик сохранён на сервере."}</p>
      {dirty && revision !== baseRevision && <p className="warning">На сервере появились изменения. Ваш текст сохранён в форме; скопируйте нужные фрагменты перед загрузкой серверной версии.</p>}
      <div className="actions"><button className="primary" disabled={!dirty || busy} onClick={() => void save()}>Сохранить черновик</button>
        <button disabled={busy} onClick={() => { if (dirty && !window.confirm("Загрузить серверную версию? Несохранённые изменения этой формы будут заменены.")) return; setLocal(task); setBaseRevision(revision); setDirty(false); setEditorKey(v => v + 1); }}>Загрузить серверную версию</button></div>
    </div>
    <DraftEditor key={editorKey} task={local} actionsDisabled={dirty || busy} onEdit={draft => { setLocal({ ...local, ...draft, confirmed: false, readinessScore: calculateRating(draft).total }); setDirty(true); }} onConfirm={confirmed => { void onAction({ type: "confirm", actor, taskId: task.id, confirmed }); }} onPublish={() => { void onAction({ type: "publish", actor, taskId: task.id, publishedAt: "" }).then(result => { if (result) onPublished(); }); }} />
  </>;
}
