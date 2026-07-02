"use client";

// Calendário da Squad Content — grade mensal (segunda-primeiro), peças no dia
// do agendamento (ou publicação). Navegação mês a mês.
import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useContentPieces } from "@/hooks/use-content-pieces";
import { buildMonthGrid } from "@/lib/workspace/content";

const MONTH_FMT = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

export default function SquadContentCalendarPage() {
  const { pieces, error } = useContentPieces();
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const shift = (delta: number) => {
    setAnchor((a) => {
      const d = new Date(a.year, a.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const grid = pieces ? buildMonthGrid(anchor.year, anchor.month, pieces) : null;
  const today = new Date();
  const isToday = (d: Date) =>
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Squad Content · Calendário
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold capitalize text-foreground">
            {MONTH_FMT.format(new Date(anchor.year, anchor.month, 1))}
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Mês anterior"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Próximo mês"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Falha ao carregar: {error}</p>
      ) : grid === null ? (
        <p className="text-sm text-muted-foreground">carregando…</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-160 rounded-xl border border-border bg-card p-2">
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <p
                  key={d}
                  className="px-2 py-1 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  {d}
                </p>
              ))}
              {grid.flat().map((day, i) => (
                <div
                  key={i}
                  className={
                    "min-h-20 rounded-lg border p-1.5 " +
                    (day.inMonth ? "border-border/60 bg-background" : "border-transparent opacity-40")
                  }
                >
                  <p
                    className={
                      "font-mono text-[10px] " +
                      (isToday(day.date)
                        ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary"
                        : "text-muted-foreground")
                    }
                  >
                    {day.date.getDate()}
                  </p>
                  <div className="mt-1 flex flex-col gap-1">
                    {day.pieces.map((p) => (
                      <Link
                        key={p.id}
                        href={`/w/content/pecas/${p.id}`}
                        title={p.title}
                        className="truncate rounded border border-primary/30 bg-primary/10 px-1 py-0.5 font-mono text-[10px] text-primary hover:bg-primary/20"
                      >
                        {p.title}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
