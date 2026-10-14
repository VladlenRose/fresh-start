ALTER TABLE public.products ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.products(id) ON DELETE SET NULL;

CREATE POLICY "Admins update unowned products" ON public.products FOR UPDATE TO authenticated
  USING (owner_id IS NULL AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (owner_id IS NULL AND public.has_role(auth.uid(), 'admin'));

-- Snapshot is taken once; re-linking a request (e.g. merge) keeps the original copy
CREATE OR REPLACE FUNCTION public.trade_request_snapshot_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.product_snapshot IS NOT NULL THEN
    NEW.product_snapshot := OLD.product_snapshot;
  ELSIF NEW.product_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id) THEN
    SELECT jsonb_build_object('title', p.title, 'description', p.description,
             'category', p.category, 'unit', p.unit, 'supplier', p.supplier,
             'captured_at', now())
      INTO NEW.product_snapshot FROM public.products p WHERE p.id = NEW.product_id;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.product_snapshot := OLD.product_snapshot;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.admin_merge_products(_keep uuid, _dup uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE moved integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _keep = _dup THEN RAISE EXCEPTION 'Выберите два разных товара'; END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = _keep AND status <> 'Архив') THEN RAISE EXCEPTION 'Оставляемый товар не найден или в архиве'; END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = _dup AND status <> 'Архив') THEN RAISE EXCEPTION 'Дубль не найден или уже в архиве'; END IF;
  UPDATE trade_requests SET product_id = _keep WHERE product_id = _dup;
  GET DIAGNOSTICS moved = ROW_COUNT;
  UPDATE products SET status = 'Архив', merged_into = _keep WHERE id = _dup;
  RETURN moved;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_merge_products(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_merge_products(uuid, uuid) TO authenticated;