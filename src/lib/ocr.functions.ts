import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PROMPT = `Ты — OCR. Распознай весь текст на изображении (накладная, счёт, спецификация, рукописная заметка).
Верни ТОЛЬКО распознанный текст на исходном языке, сохраняя строки и числа (количества, цены, сроки, единицы измерения). Таблицы передай построчно через " | ".
Ничего не добавляй и не комментируй. Если текста нет — верни пустую строку.`;

export const recognizeImageText = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ image: z.string().regex(/^data:(image\/[a-z0-9.+-]+|application\/pdf);base64,/i).max(16_000_000), name: z.string().max(200).optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ text: string }> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Сервис распознавания не настроен");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        instructions: PROMPT,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "Распознай весь текст документа." },
              data.image.startsWith("data:application/pdf")
                ? { type: "input_file", filename: data.name || "document.pdf", file_data: data.image }
                : { type: "input_image", image_url: data.image },
            ],
          },
        ],
      }),
    });

    if (!res.ok || !res.body) {
      let msg = "";
      try { msg = (await res.json())?.error?.message ?? ""; } catch { /* ignore */ }
      if (res.status === 429) throw new Error("Слишком много запросов, попробуйте через минуту");
      if (res.status === 402) throw new Error(msg || "Закончились средства на ИИ-распознавание");
      throw new Error(msg || `Сервис распознавания недоступен (${res.status})`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") out += ev.delta;
          else if (ev.type === "error" || ev.type === "response.failed") {
            throw new Error(ev.error?.message ?? ev.response?.error?.message ?? "Ошибка распознавания");
          }
        } catch (e) {
          if (e instanceof Error && !(e instanceof SyntaxError)) throw e;
        }
      }
    }
    return { text: out.trim() };
  });
