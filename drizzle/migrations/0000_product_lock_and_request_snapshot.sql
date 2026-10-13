ALTER TABLE public.trade_requests
  ADD COLUMN product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN product_snapshot jsonb;
CREATE INDEX trade_requests_product_id_idx ON public.trade_requests(product_id);

CREATE OR REPLACE FUNCTION public.trade_request_snapshot_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.product_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id) THEN
    SELECT jsonb_build_object('title', p.title, 'description', p.description,
             'category', p.category, 'unit', p.unit, 'supplier', p.supplier,
             'captured_at', now())
      INTO NEW.product_snapshot FROM public.products p WHERE p.id = NEW.product_id;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.product_snapshot := OLD.product_snapshot;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trade_requests_snapshot BEFORE INSERT OR UPDATE ON public.trade_requests
  FOR EACH ROW EXECUTE FUNCTION public.trade_request_snapshot_product();

CREATE OR REPLACE FUNCTION public.products_lock_after_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.title, NEW.description, NEW.category, NEW.unit, NEW.supplier)
       IS DISTINCT FROM (OLD.title, OLD.description, OLD.category, OLD.unit, OLD.supplier)
     AND EXISTS (SELECT 1 FROM public.trade_requests r WHERE r.product_id = OLD.id) THEN
    RAISE EXCEPTION 'PRODUCT_LOCKED: по товару уже есть заявки — название и характеристики изменить нельзя';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER products_lock BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_lock_after_request();

CREATE OR REPLACE FUNCTION public.product_request_counts(_ids uuid[])
RETURNS TABLE(product_id uuid, cnt bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.product_id, count(*) FROM public.trade_requests r WHERE r.product_id = ANY(_ids) GROUP BY r.product_id
$$;
REVOKE EXECUTE ON FUNCTION public.product_request_counts(uuid[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.product_request_counts(uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.trade_request_snapshot_product() FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.products_lock_after_request() FROM anon, public, authenticated;