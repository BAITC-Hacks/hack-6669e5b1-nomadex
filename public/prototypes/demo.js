"use strict";
const app = document.querySelector("#app");
const key = new URLSearchParams(location.search).get("example") || "requests";
const titles = { requests: "Заявки со статусами", stock: "Остатки и пороги", knowledge: "Поиск в базе знаний", booking: "Запись на свободное время", feedback: "Темы обратной связи" };
document.querySelector("#title").textContent = titles[key] || "Пример не найден";
function element(tag, text, parent = app) { const node = document.createElement(tag); if(text) node.textContent = text; parent.append(node); return node; }
function control(label, tag = "input") { const wrapper = element("label", label); return element(tag, "", wrapper); }
function option(select, text, value) { const node = element("option", text, select); node.value = value; }
function list() { const node = element("ul"); node.setAttribute("aria-live", "polite"); return node; }
if (key === "requests") {
  const rows = [{text:"Уточнить доставку",done:false},{text:"Подготовить предложение",done:true}];
  const form = element("form"); const input = element("input", "", form); input.setAttribute("aria-label","Новая заявка"); input.required = true; input.maxLength = 150;
  element("button", "Добавить заявку", form).type = "submit";
  const filter = control("Показать заявки", "select"); option(filter,"Все","all"); option(filter,"Открытые","open"); option(filter,"Завершённые","done");
  const output = list();
  function render() { output.replaceChildren(); rows.forEach(row => { if(filter.value === "open" && row.done || filter.value === "done" && !row.done) return; const item=element("li",row.text + (row.done ? " — завершена" : " — открыта"),output); const button=element("button",row.done ? "Открыть снова" : "Завершить",item); button.onclick=()=>{row.done=!row.done;render();}; }); }
  form.onsubmit=e=>{e.preventDefault();if(input.value.trim()){rows.push({text:input.value.trim(),done:false});input.value="";render();}}; filter.onchange=render; render();
} else if (key === "stock") {
  const rows=[{name:"Блокноты",qty:4},{name:"Ручки",qty:20},{name:"Папки",qty:2}]; const threshold=control("Показать остатки ниже порога"); threshold.type="number";threshold.min="0";threshold.value="5";const output=list();
  function render(){output.replaceChildren();rows.filter(row=>row.qty<Number(threshold.value)).forEach(row=>element("li",`${row.name}: ${row.qty} шт. — пополнить`,output));if(!output.children.length)element("li","Пополнение не требуется",output);} threshold.oninput=render;render();
} else if (key === "knowledge") {
  const rows=["Возврат: проверьте тестовый номер заказа и согласуйте способ возврата.","Доставка: укажите город и желаемую дату в карточке заявки.","Скидка: используйте только согласованные условия демонстрации."];const input=control("Поиск по инструкциям"); const output=list();function render(){output.replaceChildren();rows.filter(row=>row.toLowerCase().includes(input.value.toLowerCase())).forEach(row=>element("li",row,output));if(!output.children.length)element("li","Ничего не найдено",output);}input.oninput=render;render();
} else if (key === "booking") {
  const slots=["10:00","11:00","14:00"];const output=list();slots.forEach(time=>{const row=element("li",time,output);const button=element("button","Записаться",row);button.onclick=()=>{button.disabled=true;button.textContent="Запись подтверждена";};});
} else if (key === "feedback") {
  const rows=[{topic:"Доставка",text:"Посылка прибыла позже ожидаемого."},{topic:"Сервис",text:"Быстро ответили на вопрос."},{topic:"Доставка",text:"Удобный интервал получения."}];const filter=control("Тема отзыва","select");for(const topic of ["Все","Доставка","Сервис"])option(filter,topic,topic);const output=list();function render(){output.replaceChildren();rows.filter(row=>filter.value==="Все"||row.topic===filter.value).forEach(row=>element("li",`${row.topic}: ${row.text}`,output));}filter.onchange=render;render();
} else element("p","Выберите один из примеров выше.");
