import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type AppRole = "admin" | "user";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Администратор",
  user: "Продавец / покупатель",
};

/** Current user's role. Real permission checks are enforced by the database. */
export function useRole() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["my-role", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_role" as never);
      if (error) throw error;
      return (data as unknown as AppRole) ?? "user";
    },
  });
  const role: AppRole = q.data ?? "user";
  return { role, isAdmin: role === "admin", loading: q.isLoading, refetch: q.refetch };
}
