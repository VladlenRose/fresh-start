import { useQuery } from "@tanstack/react-query";
import { ImagePlus, Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listProductRequests, updateProduct, uploadProductImage, type Product } from "@/lib/api";
import { CATEGORIES } from "@/lib/catalog-meta";

export function EditProduct({ product, locked, onClose, onSaved }: { product: Product; locked: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.description ?? "");
  const [category, setCategory] = useState(product.category ?? CATEGORIES[1]);
  const [unit, setUnit] = useState(product.unit ?? "шт");
  const [price, setPrice] = useState(String(product.price));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const requests = useQuery({ queryKey: ["product-requests", product.$id], queryFn: () => listProductRequests(product.$id) });

  async function save() {
    setBusy(true);
    try {
      const imageId = file ? await uploadProductImage(file) : undefined;
      await updateProduct(product.$id, {
        price: Number(price) || 0,
        ...(imageId ? { imageId } : {}),
        ...(locked ? {} : { title: title.trim(), description: description.trim(), category, unit }),
      });
      toast.success("Товар сохранён");
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? "");
      toast.error(msg.includes("PRODUCT_LOCKED") ? "По товару уже есть заявки — название и характеристики изменить нельзя" : "Не удалось сохранить товар");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Редактировать товар</DialogTitle></DialogHeader>
        {locked && (
          <p className="flex items-start gap-2 rounded-xl bg-gold/10 p-3 text-xs text-gold">
            <Lock className="mt-0.5 size-3 shrink-0" />
            По товару уже есть торговые заявки. Название и характеристики зафиксированы — можно менять только цену и фото.
          </p>
        )}
        <div className="space-y-3">
          <div className="space-y-2"><Label>Название</Label><Input value={title} disabled={locked} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-2"><Label>Описание</Label><Textarea rows={3} value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Цена, ₽</Label><Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div className="space-y-2"><Label>Единица</Label><Input value={unit} disabled={locked} onChange={(e) => setUnit(e.target.value)} /></div>
          </div>
          <div className="space-y-2">
            <Label>Категория</Label>
            <Select value={category} onValueChange={setCategory} disabled={locked}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.slice(1).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border p-3 text-sm text-dim">
            <ImagePlus className="size-4" /> {file ? file.name : "Заменить фото"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {(requests.data?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <div className="text-sm font-medium text-ink">Заявки по товару</div>
              <ul className="space-y-1 text-xs text-dim">
                {requests.data!.map((r) => (
                  <li key={r.id}>{r.kind === "buy" ? "Покупка" : "Продажа"} · {r.title} · {new Date(r.created_at).toLocaleDateString("ru-RU")}</li>
                ))}
              </ul>
            </div>
          )}
          <Button className="w-full" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Сохранить"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
