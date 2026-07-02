"use client";

// Visão geral do workspace — read-first. Os tiles de produção/publicação ligam
// nas fatias ③/④; até lá ficam "em breve" explícito (nunca fingir prontidão).
import { useAuth } from "@/hooks/use-auth";
import { useWorkspaceModules } from "@/hooks/use-workspace-modules";
import { buildWorkspaceMenu } from "@/lib/workspace/catalog";

const SOON_TILES = [
  { key: "producao", label: "Produção do mês", hint: "peças produzidas × franquia do plano" },
  { key: "proximas", label: "Próximas publicações", hint: "agenda das redes conectadas" },
  { key: "uso", label: "Uso do plano", hint: "consumo de créditos em linguagem simples" },
];

export default function WorkspaceOverviewPage() {
  const { profile, account } = useAuth();
  const { states, loading } = useWorkspaceModules();
  const firstName = profile?.full_name?.split(" ")[0] ?? "";

  const moduleRows = states
    ? buildWorkspaceMenu(states).filter((m) => m.key !== "overview" && m.key !== "config")
    : [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Visão geral
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold text-foreground">
          {firstName ? `Bem-vindo, ${firstName}` : "Bem-vindo"}
        </h1>
        {account?.name ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Workspace de <span className="text-foreground">{account.name}</span>
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {SOON_TILES.map((t) => (
          <div key={t.key} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-sm font-medium text-foreground">{t.label}</p>
              <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                em breve
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t.hint}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="font-mono text-sm font-medium text-foreground">Módulos do seu plano</p>
        {loading ? (
          <p className="mt-2 text-xs text-muted-foreground">carregando…</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {moduleRows.map((m) => (
              <li
                key={m.key}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2"
              >
                <span className="font-mono text-sm text-foreground">{m.label}</span>
                <span
                  className={
                    m.state === "on"
                      ? "rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary"
                      : "rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
                  }
                >
                  {m.state === "on" ? "ativo" : m.state === "coming_soon" ? "em breve" : "no seu plano"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
