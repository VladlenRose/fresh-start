import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PROMPT = `Ты — OCR. Распознай весь текст на изображении (накладная, счёт, спецификация, рукописная заметка).
Верни ТОЛЬКО распознанный текст на исходном языке, сохраняя строки и числа (количества, цены, сроки, единицы измерения). Таблицы передай построчно через " | ".
Ничего не добавляй и не комментируй. Если текста нет — верни пустую строку.`;

export const recognizeImageText = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      image: z.string().regex(/^data:(image\/[a-z0-9.+-]+|application\/pdf);base64,/i).max(16_000_000),
      name: z.string().max(200).optional(),
    }).parse(d),
  )
  .handler(async ({ data }): Promise<{ text: string }> => {
    // PDF пока не поддерживается через Groq (см. ниже)
    if (data.image.startsWith("data:application/pdf")) {
      throw new Error("PDF пока не поддерживается. Загрузите фото страницы.");
    }

    // Ключ читается из окружения сервера (.env или секреты)
    const key = process.env["GROQ_API_KEY"];
    if (!key) throw new Error("Не задан GROQ_API_KEY");

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        temperature: 0,
        // Отключает режим рассуждений, чтобы в ответе не было лишнего текста.
        // Если Groq вернёт ошибку 400 про этот параметр, удалите строку.
        reasoning_effort: "none",
        messages: [
          { role: "system", content: PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Распознай весь текст документа." },
              { type: "image_url", image_url: { url: data.image } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json())?.error?.message ?? ""; } catch { /* ignore */ }
      if (res.status === 429) throw new Error("Слишком много запросов, попробуйте через минуту");
      throw new Error(msg || `Сервис распознавания недоступен (${res.status})`);
    }

    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    return { text: text.trim() };
  });
