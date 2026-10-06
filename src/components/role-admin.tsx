import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, useRole, type AppRole } from "@/hooks/use-role";

type Row = { user_id: string; email: string | null; name: string | null; company: string | null; role: AppRole };

export function RoleAdmin() {
  const { role, isAdmin, refetch } = useRole();
  const qc = useQueryClient();

  const adminExists = useQuery({
    queryKey: ["admin-exists"],
    enabled: !isAdmin,
    queryFn: async () => {
      const { data } = await supabase.rpc("admin_exists" as never);
      return !!data;
    },
  });

  const users = useQuery({
    queryKey: ["admin-users"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const claim = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("claim_first_admin" as never);
      if (error) throw error;
      if (!data) throw new Error("Администратор уже назначен");
    },
    onSuccess: async () => {
      await refetch();
      toast.success("Вы назначены администратором");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Ошибка"),
  });

  const setRole = useMutation({
    mutationFn: async (v: { id: string; role: AppRole }) => {
      const { error } = await supabase.rpc("admin_set_role" as never, { _user_id: v.id, _role: v.role } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Роль обновлена");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Ошибка"),
  });

  return (
    <section className="glass-panel rounded-2xl p-6">
      <h2 className="text-base font-semibold text-ink">Роль</h2>
      <p className="mt-2 text-sm text-dim">Ваша роль: <b className="text-ink">{ROLE_LABELS[role]}</b></p>
      {!isAdmin && adminExists.data === false && (
        <Button variant="outline" className="mt-4 rounded-full" disabled={claim.isPending} onClick={() => claim.mutate()}>
          Стать администратором (админ ещё не назначен)
        </Button>
      )}
      {isAdmin && (
        <div className="mt-5 divide-y divide-border">
          {(users.data ?? []).map((u) => (
            <div key={u.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm text-ink">{u.name || u.email || u.user_id}</div>
                <div className="truncate text-xs text-dim">{[u.email, u.company].filter(Boolean).join(" · ")}</div>
              </div>
              <select
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                value={u.role}
                disabled={setRole.isPending}
                onChange={(e) => setRole.mutate({ id: u.user_id, role: e.target.value as AppRole })}
              >
                <option value="user">{ROLE_LABELS.user}</option>
                <option value="admin">{ROLE_LABELS.admin}</option>
              </select>
            </div>
          ))}
          {users.data?.length === 0 && <p className="py-3 text-sm text-dim">Пользователей нет</p>}
        </div>
      )}
    </section>
  );
}
