import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, Sparkles, Upload, X, Reply } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { uploadProductImage } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { analyzeRequestText } from "@/lib/requests.functions";
import { cn } from "@/lib/utils";

const TITLE = "Торговые заявки AI-Mall — купить или продать с ИИ";
const DESCRIPTION =
  "Создайте заявку на покупку или продажу: ИИ разберёт текст, а система подберёт встречные предложения.";

export const Route = createFileRoute("/requests")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RequestsPage,
});

type Kind = "sell" | "buy";
type ParamKey = "qty" | "price" | "term" | "payment" | "basis" | "warranty" | "regularity";
type Param = {
  priority: number;
  ignore: boolean;
  min: string;
  max: string;
  unit: string;
  value: string;
};
type Params = Record<ParamKey, Param>;

const LABELS: Record<ParamKey, string> = {
  qty: "Количество",
  price: "Цена",
  term: "Сроки поставки",
  payment: "Условия оплаты",
  basis: "Базис поставки",
  warranty: "Гарантия и приемка",
  regularity: "Регулярность",
};
const OPTIONS: Partial<Record<ParamKey, string[]>> = {
  payment: ["100% предоплата", "50/50", "постоплата", "отсрочка"],
  basis: ["самовывоз", "доставка силами поставщика", "ТК"],
  regularity: ["разовая", "еженедельно", "ежемесячно"],
};
const RANGE: Partial<Record<ParamKey, string>> = { qty: "", price: "₽", term: "дней" };
const KEYS = Object.keys(LABELS) as ParamKey[];

const emptyParam = (): Param => ({ priority: 50, ignore: false, min: "", max: "", unit: "", value: "" });
const emptyParams = (): Params =>
  Object.fromEntries(KEYS.map((k) => [k, emptyParam()])) as Params;

type Stored = { id: string; owner_id: string; kind: Kind; title: string; params: Params; extra: string | null; created_at: string; response_to: string | null; attachment_url: string | null };
type Zone = "green" | "yellow" | "red";
type Ref = { kind: Kind; params: Params; id: string; title: string };

const n = (s: string) => (s.trim() === "" ? null : Number(s));

function overlapScore(a: Param, b: Param, key: ParamKey): number | null {
  if (a.ignore || b.ignore) return null;
  if (RANGE[key] !== undefined) {
    const [a1, a2, b1, b2] = [n(a.min), n(a.max), n(b.min), n(b.max)];
    if ([a1, a2, b1, b2].some((v) => v === null || Number.isNaN(v))) return null;
    const lo = Math.max(a1!, b1!);
    const hi = Math.min(a2!, b2!);
    if (hi >= lo) return 1;
    const span = Math.max(a2! - a1!, b2! - b1!, 1);
    return Math.max(0, 1 - (lo - hi) / span);
  }
  if (!a.value.trim() || !b.value.trim()) return null;
  return a.value.trim().toLowerCase() === b.value.trim().toLowerCase() ? 1 : 0;
}

const mid = (p: Param) => {
  const a = n(p.min), b = n(p.max);
  if (a === null && b === null) return null;
  return ((a ?? b!) + (b ?? a!)) / 2;
};

function stemWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[^а-яёa-z0-9]/gi, "")
    .replace(/(ами|ями|ов|ев|ей|ия|ья|ие|ье|ам|ям|ом|ем|ах|ях|ую|юю|ое|ее|ые|ие|ый|ий|ой|а|я|о|е|ы|и|у|ю)$/u, "");
}

const SEMANTIC_CLUSTERS: string[][] = [
  ["дверь", "окно", "стеклопакет", "профиль", "фурнитур", "наличник"],
  ["кирпич", "блок", "цемент", "бетон", "раствор", "песок", "щебень"],
  ["арматур", "прокат", "труб", "швеллер", "балк", "уголок", "лист"],
  ["куртк", "костюм", "спецодежд", "перчатк", "обув", "ботинок", "каск"],
  ["ведро", "лопат", "метл", "таз", "инвентар", "бочк", "канистр"],
  ["стол", "стул", "кресл", "шкаф", "диван", "полк", "тумб"],
  ["ноутбук", "компьютер", "сервер", "монитор", "клавиатур", "мыш"],
];

function titleSimilarity(t1: string, t2: string): number {
  const w1 = t1.toLowerCase().split(/\s+/).map(stemWord).filter((s) => s.length > 2);
  const w2 = t2.toLowerCase().split(/\s+/).map(stemWord).filter((s) => s.length > 2);
  if (!w1.length || !w2.length) return 0.5;

  const exact = w1.some((a) => w2.some((b) => a === b || a.startsWith(b) || b.startsWith(a)));
  if (exact) return 1.0;

  for (const cluster of SEMANTIC_CLUSTERS) {
    const has1 = w1.some((w) => cluster.some((c) => w.startsWith(c) || c.startsWith(w)));
    const has2 = w2.some((w) => cluster.some((c) => w.startsWith(c) || c.startsWith(w)));
    if (has1 && has2) return 0.5;
  }

  return 0.0;
}

function matchScore(mine: Params, other: Params, myKind: Kind, myTitle = "", otherTitle = "") {
  const titleSim = titleSimilarity(myTitle, otherTitle);
  if (titleSim === 0) return 0;

  let wsum = 0;
  let total = 0;
  for (const k of KEYS) {
    const s = overlapScore(mine[k], other[k], k);
    if (s === null) continue;
    const w = Math.max(mine[k].priority, 1);
    wsum += w;
    total += w * s;
  }
  let score = wsum === 0 ? 0.5 : total / wsum;
  const m1 = mid(mine.price), m2 = mid(other.price);
  if (!mine.price.ignore && !other.price.ignore && m1 && m2 && m1 > 0 && m2 > 0) {
    const ratio = m2 / m1;
    const weight = 0.5 + mine.price.priority / 100;
    const coef = Math.pow(ratio, weight);
    score = myKind === "sell" ? score * coef : score / coef;
  }
  score = score * titleSim;
  return Math.max(0, Math.min(1, score));
}


const zoneOf = (s: number): Zone => (s >= 0.75 ? "green" : s >= 0.4 ? "yellow" : "red");
const ZONE_DOT: Record<Zone, string> = { green: "bg-emerald-500", yellow: "bg-amber-400", red: "bg-destructive" };
const ZONE_LABEL: Record<Zone, string> = { green: "Подходит", yellow: "Частично", red: "Слабо" };

function fmtParam(k: ParamKey, p?: Param) {
  if (!p) return "—";
  if (p.ignore) return "Не важно";
  if (RANGE[k] !== undefined) {
    if (!p.min && !p.max) return "—";
    return `${p.min || "…"} — ${p.max || "…"} ${k === "qty" ? p.unit : RANGE[k]}`.trim();
  }
  return p.value || "—";
}

function RequestsPage() {
  const { user } = useAuth();
  const analyze = useServerFn(analyzeRequestText);
  const [kind, setKind] = useState<Kind>("buy");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [params, setParams] = useState<Params>(emptyParams);
  const [extra, setExtra] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<"form" | "registry">("form");
  const [all, setAll] = useState<Stored[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [filter, setFilter] = useState<"all" | "buy" | "sell" | "mine">("all");
  const [query, setQuery] = useState("");
  const [ref, setRef] = useState<Ref | null>(null);
  const [open, setOpen] = useState<Stored | null>(null);
  const [respondTo, setRespondTo] = useState<Stored | null>(null);
  const [editing, setEditing] = useState<Stored | null>(null);
  const { isAdmin } = useRole();

  async function loadAll() {
    setLoadingAll(true);
    const { data, error } = await supabase
      .from("trade_requests")
      .select("id, owner_id, kind, title, params, extra, created_at, response_to, attachment_url")
      .order("created_at", { ascending: false })
      .limit(300);
    setLoadingAll(false);
    if (error) { toast.error(error.message); return; }
    setAll((data ?? []) as unknown as Stored[]);
  }
  useEffect(() => { if (mode === "registry") void loadAll(); }, [mode]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all
      .filter((r) => filter === "all" || (filter === "mine" ? r.owner_id === user?.id : r.kind === filter))
      .filter((r) => !q || r.title.toLowerCase().includes(q) || (r.extra ?? "").toLowerCase().includes(q))
      // При активном подборе пар свои заявки из соответствий исключаем
      .filter((r) => !ref || r.owner_id !== user?.id)
      .map((r) => {
        const counter = ref && r.kind !== ref.kind && r.id !== ref.id;
        const score = counter ? matchScore(ref.params, { ...emptyParams(), ...r.params }, ref.kind, ref.title, r.title) : null;
        return { r, score };
      });
    if (ref) list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    return list;
  }, [all, filter, query, ref, user?.id]);

  function respond(r: Stored) {
    setRespondTo(r);
    setKind(r.kind === "buy" ? "sell" : "buy");
    setTitle(r.title);
    setParams({ ...emptyParams(), ...r.params });
    setExtra("");
    setOpen(null);
    setMode("form");
    window.scrollTo({ top: 0 });
  }
  function startEdit(r: Stored) {
    setEditing(r);
    setRespondTo(null);
    setKind(r.kind);
    setTitle(r.title);
    setParams({ ...emptyParams(), ...r.params });
    setExtra(r.extra ?? "");
    setOpen(null);
    setMode("form");
    window.scrollTo({ top: 0 });
  }
  async function remove(r: Stored) {
    if (!window.confirm(`Удалить заявку «${r.title}»?`)) return;
    const { data, error } = await supabase.from("trade_requests").delete().eq("id", r.id).select("id");
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error("Нет прав на удаление этой заявки"); return; }
    setAll((a) => a.filter((x) => x.id !== r.id));
    if (ref?.id === r.id) setRef(null);
    setOpen(null);
    toast.success("Заявка удалена");
  }
  const fileRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(
    () => [...KEYS].sort((a, b) => params[b].priority - params[a].priority),
    [params],
  );

  const setP = (k: ParamKey, patch: Partial<Param>) =>
    setParams((p) => ({ ...p, [k]: { ...p[k], ...patch } }));

  async function runAnalyze() {
    if (!text.trim()) { toast.error("Введите текст заявки"); return; }
    setAnalyzing(true);
    try {
      const r = await analyze({ data: { text } });
      const s = (v: number | null) => (v === null ? "" : String(Math.round(v * 100) / 100));
      setTitle(r.title ?? "");
      setParams((p) => ({
        ...p,
        qty: { ...p.qty, min: s(r.qtyMin), max: s(r.qtyMax), unit: r.qtyUnit ?? "" },
        price: { ...p.price, min: s(r.priceMin), max: s(r.priceMax) },
        term: { ...p.term, min: s(r.termMin), max: s(r.termMax) },
        payment: { ...p.payment, value: r.payment ?? "" },
        basis: { ...p.basis, value: r.basis ?? "" },
        warranty: { ...p.warranty, value: r.warranty ?? "" },
        regularity: { ...p.regularity, value: r.regularity ?? "" },
      }));
      toast.success("Поля заполнены по тексту");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось проанализировать");
    } finally {
      setAnalyzing(false);
    }
  }

  async function search() {
    if (!user) return;
    if (!title.trim()) { toast.error("Укажите название товара или услуги"); return; }
    setSearching(true);
    try {
      let attachment: string | null = null;
      if (file) attachment = await uploadProductImage(file);
      let savedId: string;
      if (editing) {
        const { data: upd, error } = await supabase
          .from("trade_requests")
          .update({
            kind,
            title: title.trim(),
            params: params as never,
            extra: extra || null,
            ...(attachment ? { attachment_url: attachment } : {}),
          })
          .eq("id", editing.id)
          .select("id");
        if (error) throw error;
        if (!upd?.length) throw new Error("Нет прав на редактирование этой заявки");
        savedId = editing.id;
      } else {
        const { data: saved, error } = await supabase
          .from("trade_requests")
          .insert({
            owner_id: user.id,
            kind,
            title: title.trim(),
            params: params as never,
            extra: extra || null,
            attachment_url: attachment,
            response_to: respondTo?.id ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        savedId = saved.id;
      }
      setRef({ kind, params, id: savedId, title: title.trim() });
      setRespondTo(null);
      setEditing(null);
      setFilter(kind === "buy" ? "sell" : "buy");
      setQuery("");
      setMode("registry");
      toast.success(editing ? "Заявка обновлена" : "Заявка сохранена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSearching(false);
    }
  }

  return (
    <AppShell title="Торговые заявки">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex gap-2 border-b border-border">
          {([["form", "Создать заявку"], ["registry", "Реестр рынка"]] as const).map(([m, l]) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium", mode === m ? "border-brand text-ink" : "border-transparent text-dim hover:text-ink")}>
              {l}
            </button>
          ))}
        </div>

        {mode === "form" ? (<>
        {respondTo && (
          <div className="flex items-center justify-between rounded-xl border border-brand/30 bg-brand/5 px-4 py-3 text-sm text-ink">
            <span>Встречная заявка на: <b>{respondTo.title}</b> ({respondTo.kind === "buy" ? "покупка" : "продажа"})</span>
            <Button variant="ghost" size="sm" onClick={() => setRespondTo(null)}><X className="size-4" /></Button>
          </div>
        )}
        <div className="inline-flex rounded-full border border-border bg-background p-1">
          {(["sell", "buy"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "rounded-full px-6 py-2 text-sm font-medium transition-colors",
                kind === k ? "bg-brand text-brand-foreground" : "text-dim hover:text-ink",
              )}
            >
              {k === "sell" ? "Продать" : "Купить"}
            </button>
          ))}
        </div>

        <section className="glass-panel space-y-3 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-ink">Текст заявки</h2>
          <Textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Например: Купим 500 кружек с логотипом по 250 ₽, поставка за 14 дней, оплата 50/50, доставка ТК"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setText("")}>Очистить текст</Button>
            <Button onClick={runAnalyze} disabled={analyzing}>
              {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Анализировать текст
            </Button>
          </div>
        </section>

        <section className="glass-panel space-y-4 rounded-2xl p-6">
          <div>
            <label className="text-sm font-medium text-ink">Название товара или услуги</label>
            <Input className="mt-2" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-3">
            {sorted.map((k) => {
              const p = params[k];
              return (
                <div key={k} className="grid gap-4 rounded-xl border border-border bg-background/60 p-4 md:grid-cols-[180px_1fr]">
                  <div>
                    <div className="flex items-center justify-between text-xs text-dim">
                      <span>Приоритет</span>
                      <span className="font-mono text-ink">{p.priority}%</span>
                    </div>
                    <Slider
                      className="mt-3"
                      min={0}
                      max={100}
                      step={5}
                      value={[p.priority]}
                      onValueChange={([v]) => setP(k, { priority: v ?? 0 })}
                    />
                  </div>
                  <div className={cn("space-y-2", p.ignore && "opacity-50")}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-ink">{LABELS[k]}</span>
                      <label className="flex items-center gap-2 text-xs text-dim">
                        <Checkbox checked={p.ignore} onCheckedChange={(v) => setP(k, { ignore: v === true })} />
                        Не важно
                      </label>
                    </div>
                    {RANGE[k] !== undefined ? (
                      <div className="flex items-center gap-2">
                        <Input disabled={p.ignore} type="number" placeholder="Мин" value={p.min} onChange={(e) => setP(k, { min: e.target.value })} />
                        <span className="text-dim">—</span>
                        <Input disabled={p.ignore} type="number" placeholder="Макс" value={p.max} onChange={(e) => setP(k, { max: e.target.value })} />
                        {k === "qty" ? (
                          <Input disabled={p.ignore} className="w-28" placeholder="ед. изм." value={p.unit} onChange={(e) => setP(k, { unit: e.target.value })} />
                        ) : (
                          <span className="w-12 text-sm text-dim">{RANGE[k]}</span>
                        )}
                      </div>
                    ) : OPTIONS[k] ? (
                      <div className="flex flex-wrap gap-2">
                        {OPTIONS[k]!.map((o) => (
                          <button
                            key={o}
                            type="button"
                            disabled={p.ignore}
                            onClick={() => setP(k, { value: p.value === o ? "" : o })}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs transition-colors",
                              p.value === o ? "border-brand bg-brand text-brand-foreground" : "border-border text-dim hover:text-ink",
                            )}
                          >
                            {o}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Input disabled={p.ignore} value={p.value} onChange={(e) => setP(k, { value: e.target.value })} placeholder="Условия гарантии и приемки" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-ink">Дополнительная информация</label>
              <Button variant="ghost" size="sm" onClick={() => setExtra("")}>
                <X className="size-4" /> Очистить
              </Button>
            </div>
            <Textarea className="mt-2" rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} />
            <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div className="mt-2 flex items-center gap-3">
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> Загрузить фото / спецификацию
              </Button>
              {file && (
  <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs">
    <span className="max-w-[220px] truncate text-foreground">{file.name}</span>
    <button
      type="button"
      onClick={() => {
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      }}
      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
      title="Удалить прикрепленный файл"
    >
      <X className="size-3.5" />
    </button>
  </div>
)}

            </div>
          </div>

          <Button variant="hero" className="h-12 w-full" onClick={search} disabled={searching}>
            {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Поиск соответствий
          </Button>
        </section>

        </>) : (
          <section className="space-y-4">
            {ref && (
              <div className="rounded-xl border border-border bg-background/60 px-4 py-3 text-sm text-dim">
                Ваша заявка сохранена. Встречные заявки отсортированы по светофору — от более подходящих к менее.
                <Button variant="link" size="sm" onClick={() => setRef(null)}>Сбросить подбор</Button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {([["all", "Все"], ["buy", "Покупка"], ["sell", "Продажа"], ["mine", "Мои заявки"]] as const).map(([f, l]) => (
                <button key={f} type="button" onClick={() => setFilter(f)}
                  className={cn("rounded-full border px-4 py-1.5 text-sm", filter === f ? "border-brand bg-brand text-brand-foreground" : "border-border text-dim hover:text-ink")}>
                  {l}
                </button>
              ))}
              <Input className="ml-auto w-full sm:w-64" placeholder="Поиск по заявкам" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {loadingAll ? (
              <div className="grid place-items-center py-12"><Loader2 className="size-5 animate-spin text-brand" /></div>
            ) : rows.length === 0 ? (
              <p className="glass-panel rounded-2xl p-6 text-sm text-dim">
                {ref ? "Пока нет встречных предложений по данному товару. Ваша заявка сохранена и ожидает контрагентов." : "Заявок пока нет."}
              </p>
            ) : (
              <div className="space-y-2">
                {rows.map(({ r, score }) => (
                  <button key={r.id} type="button" onClick={() => setOpen(r)}
                    className="glass-panel flex w-full items-center gap-4 rounded-xl p-4 text-left transition-shadow hover:shadow-lg">
                    {score !== null && <span className={cn("size-3 shrink-0 rounded-full", ZONE_DOT[zoneOf(score)])} />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs text-dim">{r.kind === "buy" ? "Покупка" : "Продажа"}</span>
                        {r.owner_id === user?.id && <span className="text-xs text-brand">Моя</span>}
                        {r.response_to && <span className="text-xs text-dim">встречная</span>}
                      </div>
                      <div className="mt-1 truncate text-sm font-medium text-ink">{r.title}</div>
                      <div className="mt-0.5 truncate text-xs text-dim">
                        Цена: {fmtParam("price", r.params?.price)} · Кол-во: {fmtParam("qty", r.params?.qty)}
                      </div>
                    </div>
                    {score !== null && (
                      <div className="text-right">
                        <div className="font-mono text-sm text-ink">{Math.round(score * 100)}%</div>
                        <div className="text-xs text-dim">{ZONE_LABEL[zoneOf(score)]}</div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
          <DialogContent className="max-w-lg">
            {open && (
              <>
                <DialogHeader>
                  <DialogTitle>{open.title}</DialogTitle>
                </DialogHeader>
                <div className="text-xs text-dim">
                  {open.kind === "buy" ? "Покупка" : "Продажа"} · {new Date(open.created_at).toLocaleDateString("ru-RU")}
                </div>
                <dl className="divide-y divide-border text-sm">
                  {[...KEYS]
                    .sort((a, b) => (open.params?.[b]?.priority ?? 0) - (open.params?.[a]?.priority ?? 0))
                    .map((k) => (
                      <div key={k} className="flex justify-between gap-4 py-2">
                        <dt className="text-dim">{LABELS[k]} <span className="font-mono text-xs">({open.params?.[k]?.priority ?? 0}%)</span></dt>
                        <dd className="text-right text-ink">{fmtParam(k, open.params?.[k])}</dd>
                      </div>
                    ))}
                </dl>
                {open.extra && <p className="text-sm text-dim">{open.extra}</p>}
                {open.attachment_url && (
                  <a href={open.attachment_url} target="_blank" rel="noreferrer" className="text-sm text-brand underline">Вложение</a>
                )}
                {open.owner_id !== user?.id && (
                  <Button variant="hero" className="h-11 w-full" onClick={() => respond(open)}>
                    <Reply className="size-4" /> Откликнуться встречной заявкой
                  </Button>
                )}
                {(open.owner_id === user?.id || isAdmin) && (
                  <div className="flex gap-2">
                    <Button variant="outline" className="h-10 flex-1 rounded-full" onClick={() => startEdit(open)}>
                      Редактировать
                    </Button>
                    <Button variant="outline" className="h-10 flex-1 rounded-full text-destructive" onClick={() => void remove(open)}>
                      Удалить
                    </Button>
                  </div>
                )}
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
