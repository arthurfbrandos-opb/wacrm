"use client";

// Ambiente da Squad Content — stub honesto da fatia ①. A fatia ③ substitui por
// sub-navegação própria (Dashboard · Kanban · Calendário · Chat · Peças).
import Link from "next/link";
import { Zap } from "lucide-react";

const COMING = [
  { key: "dashboard", label: "Dashboard", hint: "uso do plano + produção do mês" },
  { key: "kanban", label: "Kanban", hint: "pauta → produção → aprovação → publicada" },
  { key: "calendario", label: "Calendário", hint: "peças na semana e no mês" },
  { key: "chat", label: "Chat do squad", hint: "peça, ajuste e aprove conversando" },
];

export default function SquadContentPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <Link href="/w/squads" className="hover:text-foreground">
            squads
          </Link>{" "}
          / squad content
        </p>
        <div className="mt-1 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            <Zap className="h-4 w-4" />
          </span>
          <h1 className="font-mono text-2xl font-semibold text-foreground">Squad Content</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          O ambiente de gestão das suas redes está em montagem — estas são as áreas que
          vão ligar aqui:
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {COMING.map((c) => (
          <div key={c.key} className="rounded-xl border border-dashed border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-sm font-medium text-foreground">{c.label}</p>
              <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                em breve
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{c.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
