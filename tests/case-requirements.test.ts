import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { fieldKeys, emptyFields, fallback, parseAnalysis } from "../shared/contract";
import { calculateRating, criteria, readinessLevel } from "../src/rating";
import { APP_STORAGE_KEY, createSeedState, migrateV2, loadAppState, saveAppState, selectCatalog, proposalInputSchema } from "../src/store";
import { legacyScore } from "../src/legacy";
import { Rating } from "../src/TaskView";
const newFields = ["need", "users", "businessContact", "interactionFormat", "feedbackProcess"] as const;
function previousState() {
  const state = createSeedState();
  return { ...state, schemaVersion: 2, tasks: state.tasks.map(task => {
    const old: Record<string, unknown> = { ...task, scoringVersion: 1, readinessScore: legacyScore(task) };
    for (const key of newFields) delete old[key];
    return old;
  }) };
}
class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}
test("case weights require every part of grouped criteria, including confirmed communication", () => {
  assert.deepEqual(criteria.map(c => c.weight), [20,20,15,15,10,10,10]);
  const full = Object.fromEntries(fieldKeys.map(k => [k, "Указано бизнесом"])) as ReturnType<typeof emptyFields>;
  assert.equal(calculateRating(full).total, 100);
  for (const criterion of criteria) for (const field of criterion.fields) {
    for (const unknown of [null, "  ", "не знаю"]) {
      const rating = calculateRating({ ...full, [field]: unknown });
      assert.equal(rating.total, 100 - criterion.weight, field);
      assert.ok(rating.breakdown.find(c => c.key === criterion.key)!.hint);
    }
  }
});
test("readiness levels have exact case boundaries", () => {
  for (const [score, level] of [[0,"clarify"],[39,"clarify"],[40,"working"],[69,"working"],[70,"ready"],[89,"ready"],[90,"priority"],[100,"priority"]] as const) assert.equal(readinessLevel(score).id,level);
  for(const score of [-1,101,0.5,NaN]) assert.throws(()=>readinessLevel(score));
});
test("catalog filters combine topic and level while reset includes low readiness publications", () => {
  const state=createSeedState(), all=selectCatalog(state);
  assert.deepEqual(all.map(t=>t.readinessScore),[100,90,70,45,15]);
  for(const task of all) assert.ok(selectCatalog(state,{industry:task.industry,level:readinessLevel(task.readinessScore).id}).some(t=>t.id===task.id));
  assert.equal(selectCatalog(state,{industry:all[4].industry,level:"priority"}).length,0);
  assert.equal(selectCatalog(state,{level:"clarify"})[0].id,all[4].id);
  assert.deepEqual(selectCatalog(state,{}),all);
  assert.ok(all.every(t=>t.status==="published"));
});
test("unconfirmed rating is explicitly a preview and confirmed rating is distinct", () => {
  const task=createSeedState().tasks[0];
  const preview=renderToStaticMarkup(createElement(Rating,{task:{...task,confirmed:false}}));
  assert.match(preview,/Предварительный расчёт/); assert.doesNotMatch(preview,/Подтверждённая готовность/);
  const confirmed=renderToStaticMarkup(createElement(Rating,{task:{...task,confirmed:true}}));
  assert.match(confirmed,/Подтверждённая готовность/);
});
test("v2 migration preserves user records, decisions and results without fabricating new facts",()=>{
  const previous=previousState();
  previous.tasks[5].decisionFinalizedAt="2026-09-23T12:00:00Z";
  previous.proposals=previous.proposals.map(p=>p.taskId===previous.tasks[5].id?{...p,status:"selected"}:p);
  previous.results=[{proposalId:previous.proposals[0].id,text:"Наш результат",confirmedAt:"2026-09-23T13:00:00Z"}];
  previous.tasks[0].confirmed=true;
  const snapshot=JSON.stringify(previous), migrated=migrateV2(previous);
  assert.equal(JSON.stringify(previous),snapshot);
  assert.equal(migrated.schemaVersion,3);assert.equal(migrated.tasks.length,previous.tasks.length);
  assert.deepEqual(migrated.proposals,previous.proposals);assert.deepEqual(migrated.results,previous.results);
  for(const task of migrated.tasks){for(const key of newFields)assert.equal(task[key],null); assert.equal(task.readinessScore,calculateRating(task).total);}
  assert.equal(migrated.tasks[0].confirmed,false);assert.equal(migrated.tasks[5].confirmed,true);
  assert.equal(migrated.tasks[5].description,previous.tasks[5].description);
});
test("v2 migration saves once to v3 and preserves the original backup",()=>{
  const storage=new MemoryStorage(), raw=JSON.stringify(previousState());storage.setItem("nomadex-state-v2",raw);
  const loaded=loadAppState(storage);assert.equal(loaded.blocked,false);assert.match(loaded.warning!,/перенесено/);
  assert.ok(saveAppState(loaded.state,storage));storage.setItem("nomadex-state-v2","obsolete");
  assert.deepEqual(loadAppState(storage).state,loaded.state);assert.equal(storage.getItem("nomadex-state-v2"),"obsolete");
  storage.setItem("nomadex-state-v2",raw);assert.equal(storage.getItem("nomadex-state-v2"),raw);
});
test("corrupt legacy scores or references cannot be silently repaired during migration",()=>{
  for(const damage of [(s:ReturnType<typeof previousState>)=>{s.tasks[0].readinessScore=99;},(s:ReturnType<typeof previousState>)=>{s.proposals[0].taskId="missing";}]){
    const old=previousState();damage(old);const storage=new MemoryStorage(),raw=JSON.stringify(old);storage.setItem("nomadex-state-v2",raw);
    assert.equal(loadAppState(storage).blocked,true);assert.equal(storage.getItem("nomadex-state-v2"),raw);assert.equal(storage.getItem(APP_STORAGE_KEY),null);
  }
});
test("AI v2 can report all eleven missing fields and address new requirements",()=>{
  const result=fallback({schemaVersion:2,description:"Нужен сервис",fields:emptyFields(),previousAnswers:[]});
  assert.equal(result.missingFields.length,11);
  const {mode:_,promptVersion:__,...payload}=result;assert.ok(parseAnalysis(JSON.stringify(payload)));
  const fields=Object.fromEntries(fieldKeys.map(k=>[k,newFields.includes(k as typeof newFields[number])?null:"Известно"])) as ReturnType<typeof emptyFields>;
  const newer=fallback({schemaVersion:2,description:"Нужен сервис",fields,previousAnswers:[]});
  for(const field of newFields)assert.ok(newer.questions.some(q=>q.field===field));
});
test("seed prototype links point to shipped interactive pages; unsafe local URLs are rejected",()=>{
  const state=createSeedState();
  for(const proposal of state.proposals){assert.ok(proposalInputSchema.shape.link.safeParse(proposal.link).success);assert.ok(existsSync(new URL("../public"+proposal.link.split("?")[0],import.meta.url)));}
  for(const link of ["//evil.example/path","/prototypes/demo.html?example=unknown","/prototypes/demo.html?example=requests&redirect=https://evil.example","javascript:alert(1)","https://user:pass@example.com"])assert.equal(proposalInputSchema.shape.link.safeParse(link).success,false);
  assert.ok(proposalInputSchema.shape.link.safeParse("https://example.com/my-prototype").success);
  assert.ok(readFileSync(new URL("../public/prototypes/demo.js",import.meta.url),"utf8").includes("textContent"));
});
