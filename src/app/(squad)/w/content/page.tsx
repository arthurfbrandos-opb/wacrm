"use client";

// Dashboard da Squad Content — números reais das peças (read-first).
// Franquia do plano entra quando o pricing oficial for reconciliado (spec-mãe §13).
import Link from "next/link";
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
        { label: "Produção do mês", value: dash.producedThisMonth, hint: "peças criadas no mês" },
        { label: "Pra aprovar", value: dash.waitingApproval, hint: "esperando o seu OK" },
        { label: "Agendadas", value: dash.scheduledUpcoming, hint: "próximas publicações" },
        { label: "Publicadas no mês", value: dash.publishedThisMonth, hint: "já no ar" },
      ]
    : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Squad Content · Dashboard
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold text-foreground">
          Gestão das suas redes
        </h1>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Falha ao carregar: {error}</p>
      ) : pieces === null ? (
        <p className="text-sm text-muted-foreground">carregando…</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl border border-border bg-card p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t.label}
                </p>
                <p className="mt-1 font-mono text-3xl font-semibold text-foreground">{t.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
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
              <p className="mt-3 text-xs text-muted-foreground">
                Nenhuma peça ainda — a produção aparece aqui.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {recent.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/w/content/pecas/${p.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 transition-colors hover:bg-muted"
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
        </>
      )}
    </div>
  );
}
