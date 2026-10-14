import { useEffect, useState } from "react";
import { AlertTriangle, ImagePlus, Loader2, Package, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { uploadProductImage } from "@/lib/api";
import { CATEGORIES } from "@/lib/catalog-meta";

export type PickedProduct = { id: string; title: string; category: string | null; unit: string | null };

type Row = PickedProduct & { description: string | null };

const clean = (s: string) => s.trim().replace(/[%,()]/g, " ");

async function searchProducts(q: string): Promise<Row[]> {
  const words = clean(q).split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
  if (!words.length) return [];
  const { data, error } = await supabase
    .from("products")
    .select("id, title, category, unit, description")
    .neq("status", "Архив")
    .or(words.map((w) => `title.ilike.%${w}%`).join(","))
    .limit(8);
  if (error) throw error;
  return (data ?? []) as Row[];
}

export function ProductPicker({
  value,
  onChange,
}: {
  value: PickedProduct | null;
  onChange: (p: PickedProduct | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (value || creating) return;
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { setResults([]); return; }
      setLoading(true);
      try { setResults(await searchProducts(q)); } catch { setResults([]); } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, value, creating]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
        <Package className="size-4 text-brand" />
        <div className="flex-1 text-sm">
          <div className="font-medium text-ink">{value.title}</div>
          <div className="text-xs text-dim">{[value.category, value.unit].filter(Boolean).join(" · ") || "Товар из каталога"}</div>
        </div>
        <Button variant="ghost" size="icon" aria-label="Сменить товар" onClick={() => onChange(null)}><X className="size-4" /></Button>
      </div>
    );
  }

  if (creating) {
    return <CreateProduct initialTitle={q} onCancel={() => setCreating(false)} onCreated={(p) => { setCreating(false); onChange(p); }} />;
  }

  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найдите товар в каталоге" />
      {loading && <Loader2 className="size-4 animate-spin text-brand" />}
      {results.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-foreground/5" onClick={() => onChange(r)}>
                <span className="font-medium text-ink">{r.title}</span>
                <span className="ml-2 text-xs text-dim">{[r.category, r.unit].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
        <Plus className="size-4" /> Нет нужного товара — создать
      </Button>
    </div>
  );
}

function CreateProduct({ initialTitle, onCancel, onCreated }: { initialTitle: string; onCancel: () => void; onCreated: (p: PickedProduct) => void }) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[1]);
  const [unit, setUnit] = useState("шт");
  const [file, setFile] = useState<File | null>(null);
  const [similar, setSimilar] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      try { setSimilar(title.trim().length >= 2 ? await searchProducts(title) : []); } catch { setSimilar([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [title]);

  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const exact = similar.find((s) => norm(s.title) === norm(title) && norm(s.category) === norm(category));

  async function create() {
    if (title.trim().length < 2) { toast.error("Введите название товара"); return; }
    if (exact) { toast.error("Такой товар уже есть — выберите его"); return; }
    setBusy(true);
    try {
      const imageId = file ? await uploadProductImage(file) : null;
      const { data, error } = await supabase.rpc("create_product_from_request", {
        _title: title, _description: description, _category: category, _unit: unit, _image_id: imageId ?? "",
      });
      if (error) throw error;
      toast.success("Товар создан и выбран");
      onCreated({ id: data as string, title: title.trim(), category, unit });
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "";
      toast.error(msg.includes("PRODUCT_DUPLICATE") ? "Такой товар уже есть в каталоге" : "Не удалось создать товар");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/60 p-4">
      <div className="text-sm font-medium text-ink">Новый товар</div>
      <div className="space-y-2"><Label>Название</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      {similar.length > 0 && (
        <div className="space-y-1 rounded-lg bg-gold/10 p-3 text-xs text-gold">
          <div className="flex items-center gap-1 font-medium"><AlertTriangle className="size-3" /> Возможно, такой товар уже есть:</div>
          {similar.map((s) => (
            <button key={s.id} type="button" className="block underline" onClick={() => onCreated(s)}>
              {s.title}{s.category ? ` · ${s.category}` : ""}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2"><Label>Характеристики</Label><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Материал, размеры, комплектация" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Категория</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.slice(1).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2"><Label>Единица</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border p-3 text-sm text-dim">
        <ImagePlus className="size-4" /> {file ? file.name : "Фото товара"}
        <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {exact && <p className="text-xs text-destructive">Точно такой товар уже есть в каталоге — выберите его выше.</p>}
      <div className="flex gap-2">
        <Button type="button" onClick={create} disabled={busy || !!exact}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Создать товар"}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  );
}
