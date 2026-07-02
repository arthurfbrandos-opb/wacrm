"use client";

// Tela Squads — times que tocam um processo completo. Abrir uma squad leva pro
// ambiente próprio dela (sub-navegação · fatia ③). Squad em breve fica visível.
import Link from "next/link";
import { Zap } from "lucide-react";
import { useWorkspaceModules } from "@/hooks/use-workspace-modules";
import { buildSquads } from "@/lib/workspace/catalog";

export default function WorkspaceSquadsPage() {
  const { states, loading, error } = useWorkspaceModules();
  const squads = states ? buildSquads(states) : [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Squads
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold text-foreground">
          Seus times de agentes
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada squad cuida de um processo inteiro e tem a própria ferramenta de gestão.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Falha ao carregar: {error}</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">carregando…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {squads.map((s) => (
            <div key={s.key} className="flex flex-col rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                    <Zap className="h-4 w-4" />
                  </span>
                  <p className="font-mono text-sm font-medium text-foreground">{s.name}</p>
                </div>
                <span
                  className={
                    s.state === "on"
                      ? "rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary"
                      : "rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
                  }
                >
                  {s.state === "on" ? "ativa" : s.state === "coming_soon" ? "em breve" : "no seu plano"}
                </span>
              </div>
              <p className="mt-3 flex-1 text-xs text-muted-foreground">{s.description}</p>
              {s.state === "on" && s.href ? (
                <Link
                  href={s.href}
                  className="mt-4 w-full rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-center font-mono text-sm font-medium text-primary transition-colors hover:bg-primary/20"
                >
                  Abrir ferramenta ▸
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className="mt-4 w-full cursor-not-allowed rounded-lg border border-border px-3 py-2 font-mono text-sm text-muted-foreground opacity-60"
                >
                  {s.state === "coming_soon" ? "Em breve" : "Disponível no seu plano"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
