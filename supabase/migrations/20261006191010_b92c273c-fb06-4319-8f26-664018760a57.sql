CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users view own role, admins view all" ON public.user_roles
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Current user's role (defaults to 'user')
CREATE OR REPLACE FUNCTION public.my_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT role FROM public.user_roles WHERE user_id = auth.uid()), 'user'::public.app_role)
$$;

-- First admin bootstrap: only works while no admin exists
CREATE OR REPLACE FUNCTION public.claim_first_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN RETURN false; END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (auth.uid(), 'admin')
  ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.admin_exists()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin')
$$;

-- Admin: list users with roles
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(user_id uuid, email text, name text, company text, role public.app_role)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  SELECT p.user_id, p.email, p.name, p.company,
         COALESCE(r.role, 'user'::public.app_role)
  FROM public.profiles p LEFT JOIN public.user_roles r ON r.user_id = p.user_id
  ORDER BY p.created_at;
END $$;

-- Admin: assign role
CREATE OR REPLACE FUNCTION public.admin_set_role(_user_id uuid, _role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _user_id = auth.uid() AND _role <> 'admin' THEN RAISE EXCEPTION 'Нельзя снять роль администратора с самого себя'; END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (_user_id, _role)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
END $$;

REVOKE EXECUTE ON FUNCTION public.claim_first_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_set_role(uuid, public.app_role) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.claim_first_admin(), public.admin_list_users(), public.admin_set_role(uuid, public.app_role), public.my_role(), public.admin_exists() TO authenticated;

DROP POLICY IF EXISTS "Owners update requests" ON public.trade_requests;
DROP POLICY IF EXISTS "Owners delete requests" ON public.trade_requests;
CREATE POLICY "Owners or admins update requests" ON public.trade_requests
FOR UPDATE TO authenticated
USING (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Owners or admins delete requests" ON public.trade_requests
FOR DELETE TO authenticated
USING (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'));