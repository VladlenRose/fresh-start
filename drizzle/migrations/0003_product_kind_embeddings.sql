CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'product' CHECK (kind IN ('product','service'));
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS attrs jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS embedding extensions.vector(3072);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS embedding_text text;

CREATE OR REPLACE FUNCTION public.products_lock_after_request()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.title, NEW.description, NEW.category, NEW.unit, NEW.supplier, NEW.kind)
       IS DISTINCT FROM (OLD.title, OLD.description, OLD.category, OLD.unit, OLD.supplier, OLD.kind)
     AND EXISTS (SELECT 1 FROM public.trade_requests r WHERE r.product_id = OLD.id) THEN
    RAISE EXCEPTION 'PRODUCT_LOCKED: по товару уже есть заявки — название и характеристики изменить нельзя';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.trade_request_snapshot_product()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.product_snapshot IS NOT NULL THEN
    NEW.product_snapshot := OLD.product_snapshot;
  ELSIF NEW.product_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id) THEN
    SELECT jsonb_build_object('title', p.title, 'description', p.description,
             'category', p.category, 'unit', p.unit, 'supplier', p.supplier,
             'kind', p.kind, 'attrs', p.attrs, 'captured_at', now())
      INTO NEW.product_snapshot FROM public.products p WHERE p.id = NEW.product_id;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.product_snapshot := OLD.product_snapshot;
  END IF;
  RETURN NEW;
END $function$;

DROP FUNCTION IF EXISTS public.create_product_from_request(text, text, text, text, text);
CREATE FUNCTION public.create_product_from_request(_title text, _description text, _category text, _unit text, _image_id text, _kind text DEFAULT 'product', _attrs jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _id uuid; _t text := btrim(coalesce(_title, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF length(_t) < 2 OR length(_t) > 200 THEN RAISE EXCEPTION 'Некорректное название товара'; END IF;
  IF _kind NOT IN ('product','service') THEN RAISE EXCEPTION 'Некорректный тип'; END IF;
  IF EXISTS (SELECT 1 FROM public.products p
             WHERE lower(btrim(p.title)) = lower(_t) AND p.status <> 'Архив'
               AND coalesce(lower(p.category), '') = coalesce(lower(btrim(_category)), '')) THEN
    RAISE EXCEPTION 'PRODUCT_DUPLICATE: такой товар уже есть в каталоге';
  END IF;
  INSERT INTO public.products(owner_id, created_by, title, description, category, unit, image_id, price, status, kind, attrs)
  VALUES (NULL, auth.uid(), _t, nullif(btrim(_description), ''), nullif(btrim(_category), ''),
          nullif(btrim(_unit), ''), nullif(_image_id, ''), 0, 'Активен', _kind, coalesce(_attrs, '{}'::jsonb))
  RETURNING id INTO _id;
  RETURN _id;
END $function$;
GRANT EXECUTE ON FUNCTION public.create_product_from_request(text,text,text,text,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.match_products(_query text, _count int DEFAULT 8)
 RETURNS TABLE(id uuid, title text, category text, unit text, image_id text, kind text, description text, similarity float8)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
  SELECT p.id, p.title, p.category, p.unit, p.image_id, p.kind, p.description,
         1 - (p.embedding <=> _query::extensions.vector) AS similarity
  FROM public.products p
  WHERE p.embedding IS NOT NULL AND p.status <> 'Архив'
  ORDER BY p.embedding <=> _query::extensions.vector
  LIMIT least(greatest(_count, 1), 30)
$$;
REVOKE ALL ON FUNCTION public.match_products(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_products(text, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.product_pair_similarity(_ref uuid, _ids uuid[])
 RETURNS TABLE(product_id uuid, similarity float8)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
  SELECT p.id, CASE WHEN p.id = r.id THEN 1 ELSE 1 - (p.embedding <=> r.embedding) END
  FROM public.products r JOIN public.products p ON p.id = ANY(_ids)
  WHERE r.id = _ref AND (p.id = r.id OR (p.embedding IS NOT NULL AND r.embedding IS NOT NULL))
$$;
GRANT EXECUTE ON FUNCTION public.product_pair_similarity(uuid, uuid[]) TO authenticated;