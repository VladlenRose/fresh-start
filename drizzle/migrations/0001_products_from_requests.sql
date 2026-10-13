ALTER TABLE public.products ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.products ALTER COLUMN owner_id DROP NOT NULL;
COMMENT ON COLUMN public.products.owner_id IS 'Seller-owner; NULL for products created from a trade request until ownership is decided';

CREATE OR REPLACE FUNCTION public.create_product_from_request(
  _title text, _description text, _category text, _unit text, _image_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _t text := btrim(coalesce(_title, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF length(_t) < 2 OR length(_t) > 200 THEN RAISE EXCEPTION 'Некорректное название товара'; END IF;
  IF EXISTS (SELECT 1 FROM public.products p
             WHERE lower(btrim(p.title)) = lower(_t)
               AND coalesce(lower(p.category), '') = coalesce(lower(btrim(_category)), '')) THEN
    RAISE EXCEPTION 'PRODUCT_DUPLICATE: такой товар уже есть в каталоге';
  END IF;
  INSERT INTO public.products(owner_id, created_by, title, description, category, unit, image_id, price, status)
  VALUES (NULL, auth.uid(), _t, nullif(btrim(_description), ''), nullif(btrim(_category), ''),
          nullif(btrim(_unit), ''), nullif(_image_id, ''), 0, 'Активен')
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_product_from_request(text, text, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_product_from_request(text, text, text, text, text) TO authenticated;