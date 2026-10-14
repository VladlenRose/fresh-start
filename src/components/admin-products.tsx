import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { GitMerge, Pencil } from "lucide-react";

import { EditProduct } from "@/components/edit-product";
import { Button } from "@/components/ui/button";
import { listCatalogProducts, listUnownedProducts, mergeProducts, productRequestCounts, type Product } from "@/lib/api";

/** Модерация товаров: только для администратора (права проверяет база). */
export function AdminProducts() {
  const qc = useQueryClient();
  const unowned = useQuery({ queryKey: ["admin-unowned-products"], queryFn: listUnownedProducts });
  const all = useQuery({ queryKey: ["products", "catalog"], queryFn: listCatalogProducts });
  const ids = (unowned.data ?? []).map((p) => p.$id);
  const counts = useQuery({
    queryKey: ["product-request-counts", ids.join(",")],
    queryFn: () => productRequestCounts(ids),
    enabled: ids.length > 0,
  });
  const [edit, setEdit] = useState<Product | null>(null);
  const [keep, setKeep] = useState("");
  const [dup, setDup] = useState("");

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-unowned-products"] });
    await qc.invalidateQueries({ queryKey: ["products"] });
    await qc.invalidateQueries({ queryKey: ["product-request-counts"] });
  };

  const merge = useMutation({
    mutationFn: () => mergeProducts(keep, dup),
    onSuccess: async (n) => {
      toast.success(`Товары объединены. Перенесено заявок: ${n}`);
      setDup("");
      await refresh();
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? "Не удалось объединить"),
  });

  const products = all.data ?? [];
  const label = (p: Product) => `${p.title}${p.category ? ` · ${p.category}` : ""}${p.ownerId ? "" : " (без владельца)"}`;

  return (
    <section className="glass-panel space-y-6 rounded-2xl p-6">
      <div>
        <h2 className="text-base font-semibold text-ink">Товары без владельца</h2>
        <p className="mt-1 text-xs text-dim">Созданы из заявок. После первой заявки название и характеристики зафиксированы.</p>
        <ul className="mt-3 divide-y divide-border">
          {(unowned.data ?? []).map((p) => (
            <li key={p.$id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{p.title}</div>
                <div className="text-xs text-dim">
                  {[p.category, p.unit].filter(Boolean).join(" · ")}
                  {counts.data?.[p.$id] ? ` · заявок: ${counts.data[p.$id]} · зафиксирован` : ""}
                </div>
              </div>
              <Button variant="ghost" size="icon" aria-label="Редактировать" onClick={() => setEdit(p)}><Pencil className="size-4" /></Button>
            </li>
          ))}
          {unowned.data?.length === 0 && <li className="py-2 text-sm text-dim">Таких товаров нет</li>}
        </ul>
      </div>

      <div>
        <h2 className="text-base font-semibold text-ink">Объединить дубли</h2>
        <p className="mt-1 text-xs text-dim">Заявки дубля перейдут на оставленный товар, дубль уйдёт в архив и пропадёт из каталога. Копии в старых заявках не меняются.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <select className="h-10 rounded-md border border-border bg-background px-2 text-sm" value={keep} onChange={(e) => setKeep(e.target.value)}>
            <option value="">Оставить товар…</option>
            {products.map((p) => <option key={p.$id} value={p.$id}>{label(p)}</option>)}
          </select>
          <select className="h-10 rounded-md border border-border bg-background px-2 text-sm" value={dup} onChange={(e) => setDup(e.target.value)}>
            <option value="">Дубль (в архив)…</option>
            {products.filter((p) => p.$id !== keep).map((p) => <option key={p.$id} value={p.$id}>{label(p)}</option>)}
          </select>
          <Button
            disabled={!keep || !dup || merge.isPending}
            onClick={() => {
              const k = products.find((p) => p.$id === keep), d = products.find((p) => p.$id === dup);
              if (window.confirm(`Объединить «${d?.title}» с «${k?.title}»? Дубль уйдёт в архив.`)) merge.mutate();
            }}
          >
            <GitMerge className="size-4" /> Объединить
          </Button>
        </div>
      </div>

      {edit && (
        <EditProduct
          product={edit}
          locked={!!counts.data?.[edit.$id]}
          onClose={() => setEdit(null)}
          onSaved={async () => { setEdit(null); await refresh(); }}
        />
      )}
    </section>
  );
}
