"use client";

// Kanban da Squad Content — read-first (fatia ③). Aprovar/pedir ajuste entram
// na fatia ⑤ (os_approvals); arrastar card não existe: quem move é o processo.
import Link from "next/link";
import { useContentPieces } from "@/hooks/use-content-pieces";
import {
  groupByStatus,
  KANBAN_COLUMNS,
  KIND_LABEL,
} from "@/lib/workspace/content";

const DATE_FMT = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

export default function SquadContentKanbanPage() {
  const { pieces, error } = useContentPieces();
  const grouped = pieces ? groupByStatus(pieces) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Squad Content · Kanban
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold text-foreground">
          Esteira de produção
        </h1>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Falha ao carregar: {error}</p>
      ) : grouped === null ? (
        <p className="text-sm text-muted-foreground">carregando…</p>
      ) : (
        <div className="grid gap-3 overflow-x-auto pb-2 lg:grid-cols-6">
          {KANBAN_COLUMNS.map((col) => {
            const items = grouped.get(col.status) ?? [];
            return (
              <div
                key={col.status}
                className="flex min-w-52 flex-col rounded-xl border border-border bg-card"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <p className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {col.label}
                  </p>
                  <span className="font-mono text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-2">
                  {items.length === 0 ? (
                    <p className="px-1 py-2 text-center text-[11px] text-muted-foreground/60">—</p>
                  ) : (
                    items.map((p) => {
                      const dateIso = p.scheduled_at ?? p.published_at;
                      return (
                        <Link
                          key={p.id}
                          href={`/w/content/pecas/${p.id}`}
                          className="rounded-lg border border-border/60 bg-background p-2.5 transition-colors hover:border-primary/40 hover:bg-muted"
                        >
                          <p className="line-clamp-2 font-mono text-xs font-medium text-foreground">
                            {p.title}
                          </p>
                          <div className="mt-2 flex items-center justify-between gap-1">
                            <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                              {KIND_LABEL[p.kind]}
                            </span>
                            {dateIso ? (
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {DATE_FMT.format(new Date(dateIso))}
                              </span>
                            ) : null}
                          </div>
                        </Link>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
