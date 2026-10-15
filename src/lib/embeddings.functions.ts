import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MODEL = "google/gemini-embedding-2";

export type SemanticProduct = {
  id: string; title: string; category: string | null; unit: string | null;
  image_id: string | null; kind: string; description: string | null; similarity: number;
};

const textOf = (p: { title: string; category: string | null; kind: string }) =>
  `${p.kind === "service" ? "Услуга" : "Товар"}: ${p.title}${p.category ? ` (${p.category})` : ""}`;

async function embed(input: string[]): Promise<number[][]> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, input }),
    });
    if (res.ok) {
      const j = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      const out: number[][] = [];
      for (const d of j.data) out[d.index] = d.embedding;
      return out;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 300));
      continue;
    }
    if (res.status === 402) throw new Error("Закончились ИИ-кредиты для смыслового поиска");
    throw new Error(`Смысловой поиск недоступен (${res.status})`);
  }
}

/** Досчитывает эмбеддинги товаров, у которых их нет или изменилось название. */
async function syncEmbeddings() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("products")
    .select("id, title, category, kind, embedding_text")
    .neq("status", "Архив")
    .limit(500);
  const stale = (data ?? []).filter((p) => p.embedding_text !== textOf(p)).slice(0, 50);
  if (!stale.length) return;
  const vecs = await embed(stale.map(textOf));
  await Promise.all(
    stale.map((p, i) =>
      supabaseAdmin.from("products").update({ embedding: JSON.stringify(vecs[i]), embedding_text: textOf(p) } as never).eq("id", p.id),
    ),
  );
}

export const semanticProductSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ query: z.string().min(2).max(300), count: z.number().int().min(1).max(20).default(8) }).parse(d))
  .handler(async ({ data, context }): Promise<SemanticProduct[]> => {
    await syncEmbeddings();
    const [vec] = await embed([data.query]);
    const { data: rows, error } = await context.supabase.rpc("match_products", { _query: JSON.stringify(vec), _count: data.count });
    if (error) throw new Error(error.message);
    return (rows ?? []) as SemanticProduct[];
  });

export const refreshProductEmbeddings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await syncEmbeddings();
    return { ok: true };
  });
