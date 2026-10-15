import { useEffect, useState } from "react";
import { AlertTriangle, ImagePlus, Loader2, Package, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { uploadProductImage } from "@/lib/api";
import { CATEGORIES, fallbackImage } from "@/lib/catalog-meta";
import { semanticProductSearch } from "@/lib/embeddings.functions";
import { cn } from "@/lib/utils";

export type PickedProduct = { id: string; title: string; category: string | null; unit: string | null; kind?: string; image_id?: string | null };

type Row = PickedProduct & { description: string | null; similarity?: number };

const KIND_LABEL: Record<string, string> = { product: "Товар", service: "Услуга" };

async function browseCatalog(): Promise<Row[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, title, category, unit, description, image_id, kind")
    .neq("status", "Архив")
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw error;
  return (data ?? []) as Row[];
}

async function keywordSearch(q: string): Promise<Row[]> {
  const words = q.trim().replace(/[%,()]/g, " ").split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
  if (!words.length) return [];
  const { data, error } = await supabase
    .from("products")
    .select("id, title, category, unit, description, image_id, kind")
    .neq("status", "Архив")
    .or(words.map((w) => `title.ilike.%${w}%`).join(","))
    .limit(8);
  if (error) throw error;
  return (data ?? []) as Row[];
}

/** Смысловой поиск по эмбеддингам; при сбое — поиск по словам. */
export function useProductSearch() {
  const semantic = useServerFn(semanticProductSearch);
  return async (q: string, minSim = 0.55): Promise<Row[]> => {
    if (q.trim().length < 2) return [];
    try {
      const rows = await semantic({ data: { query: q.trim(), count: 8 } });
      return rows.filter((r) => r.similarity >= minSim);
    } catch {
      return keywordSearch(q);
    }
  };
}

function Thumb({ r }: { r: PickedProduct }) {
  return <img src={r.image_id || fallbackImage(r.id)} alt="" loading="lazy" className="size-10 shrink-0 rounded-lg object-cover" />;
}

export function ProductPicker({
  value,
  onChange,
  seed,
}: {
  value: PickedProduct | null;
  onChange: (p: PickedProduct | null) => void;
  /** Название, извлечённое ИИ из свободного текста: подставляется в поиск. */
  seed?: string;
}) {
  const search = useProductSearch();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => { if (seed) { setQ(seed); setCreating(false); } }, [seed]);

  useEffect(() => {
    if (value || creating) return;
    const empty = q.trim().length < 2;
    if (empty && !focused) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try { setResults(empty ? await browseCatalog() : await search(q)); } catch { setResults([]); } finally { setLoading(false); }
    }, empty ? 0 : 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, value, creating, focused]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
        <Thumb r={value} />
        <div className="flex-1 text-sm">
          <div className="font-medium text-ink">{value.title}</div>
          <div className="text-xs text-dim">{[KIND_LABEL[value.kind ?? "product"], value.category, value.unit].filter(Boolean).join(" · ")}</div>
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
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        placeholder="Найдите товар или услугу в каталоге"
      />
      {loading && <Loader2 className="size-4 animate-spin text-brand" />}
      {results.length > 0 && (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {q.trim().length < 2 && <li className="px-3 py-1.5 text-xs text-dim">В каталоге сейчас</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-foreground/5" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(r)}>
                <Thumb r={r} />
                <span className="flex-1">
                  <span className="font-medium text-ink">{r.title}</span>
                  <span className="block text-xs text-dim">{[KIND_LABEL[r.kind ?? "product"], r.category, r.unit].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && q.trim().length >= 2 && results.length === 0 && <p className="text-xs text-dim">Похожих карточек не найдено.</p>}
      <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
        <Plus className="size-4" /> Нет нужного — создать карточку
      </Button>
    </div>
  );
}

function CreateProduct({ initialTitle, onCancel, onCreated }: { initialTitle: string; onCancel: () => void; onCreated: (p: PickedProduct) => void }) {
  const search = useProductSearch();
  const [kind, setKind] = useState<"product" | "service">("product");
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[1]);
  const [unit, setUnit] = useState("шт");
  const [term, setTerm] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [similar, setSimilar] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      try { setSimilar(title.trim().length >= 2 ? (await search(title, 0.7)).slice(0, 5) : []); } catch { setSimilar([]); }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const exact = similar.find((s) => norm(s.title) === norm(title) && norm(s.category) === norm(category));

  async function create() {
    if (title.trim().length < 2) { toast.error("Введите название"); return; }
    if (exact) { toast.error("Такая карточка уже есть — выберите её"); return; }
    setBusy(true);
    try {
      const imageId = file ? await uploadProductImage(file) : null;
      const attrs = kind === "service" && term.trim() ? { term: term.trim() } : {};
      const { data, error } = await supabase.rpc("create_product_from_request", {
        _title: title, _description: description, _category: category, _unit: unit, _image_id: imageId ?? "", _kind: kind, _attrs: attrs,
      });
      if (error) throw error;
      toast.success("Карточка создана и выбрана");
      onCreated({ id: data as string, title: title.trim(), category, unit, kind, image_id: imageId });
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "";
      toast.error(msg.includes("PRODUCT_DUPLICATE") ? "Такая карточка уже есть в каталоге" : "Не удалось создать карточку");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/60 p-4">
      <div className="inline-flex rounded-full border border-border p-1">
        {(["product", "service"] as const).map((k) => (
          <button key={k} type="button" onClick={() => { setKind(k); setUnit(k === "service" ? "час" : "шт"); }}
            className={cn("rounded-full px-4 py-1 text-xs font-medium", kind === k ? "bg-brand text-brand-foreground" : "text-dim")}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="space-y-2"><Label>Название</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      {similar.length > 0 && (
        <div className="space-y-1 rounded-lg bg-gold/10 p-3 text-xs text-gold">
          <div className="flex items-center gap-1 font-medium"><AlertTriangle className="size-3" /> Возможно, такая карточка уже есть:</div>
          {similar.map((s) => (
            <button key={s.id} type="button" className="flex items-center gap-2 underline" onClick={() => onCreated(s)}>
              <Package className="size-3" />{s.title}{s.category ? ` · ${s.category}` : ""}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2"><Label>Характеристики</Label><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === "service" ? "Состав работ, квалификация, условия" : "Материал, размеры, комплектация"} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Категория</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.slice(1).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2"><Label>{kind === "service" ? "Единица времени" : "Единица"}</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
      </div>
      {kind === "service" && <div className="space-y-2"><Label>Срок оказания</Label><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Например: 5 рабочих дней" /></div>}
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border p-3 text-sm text-dim">
        <ImagePlus className="size-4" /> {file ? file.name : "Фото"}
        <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {exact && <p className="text-xs text-destructive">Точно такая карточка уже есть в каталоге — выберите её выше.</p>}
      <div className="flex gap-2">
        <Button type="button" onClick={create} disabled={busy || !!exact}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Создать карточку"}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  );
}
