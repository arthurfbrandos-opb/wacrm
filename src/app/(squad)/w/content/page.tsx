"use client";

// Dashboard da Squad Content — números reais das peças (read-first).
// Franquia do plano entra quando o pricing oficial for reconciliado (spec-mãe §13).
import Link from "next/link";
import { CalendarClock, Cog, FileCheck, Send } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { TerminalWindow } from "@/components/ui/terminal-window";
import { useContentPieces } from "@/hooks/use-content-pieces";
import {
  buildContentDashboard,
  KIND_LABEL,
  STATUS_LABEL,
} from "@/lib/workspace/content";

export default function SquadContentDashboardPage() {
  const { pieces, error } = useContentPieces();
  const dash = pieces ? buildContentDashboard(pieces, new Date()) : null;
  const recent = (pieces ?? []).slice(0, 6);

  const tiles = dash
    ? [
        {
          label: "Produção do mês",
          value: String(dash.producedThisMonth),
          hint: "peças criadas no mês",
          icon: Cog,
        },
        {
          label: "Pra aprovar",
          value: String(dash.waitingApproval),
          hint: "esperando o seu OK",
          icon: FileCheck,
        },
        {
          label: "Agendadas",
          value: String(dash.scheduledUpcoming),
          hint: "próximas publicações",
          icon: CalendarClock,
        },
        {
          label: "Publicadas no mês",
          value: String(dash.publishedThisMonth),
          hint: "já no ar",
          icon: Send,
        },
      ]
    : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
          Squad Content · Dashboard
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-foreground">
          Gestão das suas redes
        </h1>
        {/* Atalhos do ciclo — tudo a 1 clique do dashboard. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { href: "/w/content/chat", label: "falar com a squad" },
            { href: "/w/content/linha-editorial", label: "linha editorial" },
            { href: "/w/content/kanban", label: "kanban" },
            { href: "/w/content/calendario", label: "calendário" },
          ].map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="rounded-full border border-border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              {a.label} ▸
            </Link>
          ))}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Falha ao carregar: {error}</p>
      ) : pieces === null ? (
        <p className="font-mono text-sm text-muted-foreground">carregando…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map((t) => (
              <MetricCard
                key={t.label}
                title={t.label}
                value={t.value}
                icon={t.icon}
                subtitle={t.hint}
              />
            ))}
          </div>

          <TerminalWindow title="squad/dashboard">
            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-sm font-medium text-foreground">Últimas peças</p>
                <Link
                  href="/w/content/kanban"
                  className="font-mono text-xs text-primary hover:underline"
                >
                  ver kanban ▸
                </Link>
              </div>
              {recent.length === 0 ? (
                <p className="mt-3 font-mono text-xs text-muted-foreground">
                  ▸ Nenhuma peça ainda — a produção aparece aqui.
                </p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {recent.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/w/content/pecas/${p.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/40 p-3 transition-colors hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                          {p.title}
                        </span>
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                          {KIND_LABEL[p.kind]}
                        </span>
                        <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary">
                          {STATUS_LABEL[p.status]}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TerminalWindow>
        </>
      )}
    </div>
  );
}
