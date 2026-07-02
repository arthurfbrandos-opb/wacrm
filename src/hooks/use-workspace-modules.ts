"use client";

// Hook de estados de módulo do workspace (conta atual). Uma busca por montagem;
// RLS garante o escopo. Consumidores gatam em `loading` antes de decidir rota/menu.
// O client Supabase nasce DENTRO do effect (padrão do use-auth) — criar no render
// quebra o prerender do build, que roda sem env.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadModuleStates } from "@/lib/workspace/queries";
import type { ModuleStates } from "@/lib/workspace/catalog";

export function useWorkspaceModules() {
  const [states, setStates] = useState<ModuleStates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    loadModuleStates(supabase)
      .then((s) => {
        if (alive) setStates(s);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { states, loading, error };
}
