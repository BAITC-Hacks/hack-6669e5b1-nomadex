import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { z } from "zod";

const app = express();
app.use(express.json());

const requestSchema = z.object({
  title: z.string().default(""),
  description: z.string().default(""),
  target: z.string().default(""),
  desiredResult: z.string().default(""),
  acceptanceCriteria: z.string().default(""),
  scope: z.string().default(""),
  resources: z.string().default(""),
  constraints: z.string().default("")
});

const responseSchema = z.object({
  questions: z.array(z.string()).min(3).max(6),
  suggestions: z.array(z.string()).max(6)
});

const fallback = (body: z.infer<typeof requestSchema>) => {
  const questions = [
    body.target.trim() ? "Какие признаки покажут, что проблема решена для этой аудитории?" : "Кому именно мешает описанная проблема?",
    body.desiredResult.trim() ? "В каком формате команда должна передать результат?" : "Какой конкретный результат нужен бизнесу?",
    body.acceptanceCriteria.trim() ? "Кто и по каким данным подтвердит результат?" : "Как бизнес проверит, что результат достигнут?"
  ];
  return { questions, suggestions: ["Добавьте наблюдаемый результат", "Укажите ограничения или явно отметьте их отсутствие"], mode: "mock" as const };
};

app.post("/api/analyze", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Некорректные данные черновика" });

  if (!process.env.OPENAI_API_KEY) return res.json(fallback(parsed.data));

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Ты анализируешь полноту бизнес-задачи. Верни JSON с questions (минимум 3 конкретных вопроса) и suggestions. Не выдумывай сведения, не выбирай исполнителя и не меняй поля." },
        { role: "user", content: JSON.stringify(parsed.data) }
      ]
    });
    const candidate = JSON.parse(completion.choices[0]?.message?.content || "{}");
    const valid = responseSchema.safeParse(candidate);
    if (!valid.success) return res.json({ ...fallback(parsed.data), error: "Ответ AI не прошёл проверку; показаны резервные вопросы" });
    return res.json({ ...valid.data, mode: "openai" as const });
  } catch {
    return res.json({ ...fallback(parsed.data), error: "OpenAI недоступен; показаны резервные вопросы" });
  }
});

app.listen(Number(process.env.PORT || 8787), () => console.log("NomadEX AI server is running"));