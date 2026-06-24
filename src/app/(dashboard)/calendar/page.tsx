"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { TerminalWindow } from "@/components/ui/terminal-window";
import { Button } from "@/components/ui/button";
import {
  AppointmentDialog,
  type AppointmentLite,
} from "@/components/calendar/appointment-dialog";

interface ApptRow {
  id: string;
  scheduled_at: string;
  notes: string | null;
  contact_id: string;
  deal_id: string | null;
  contact: { id: string; name: string | null; phone: string } | null;
  deal: { id: string; title: string } | null;
}

const SP = "America/Sao_Paulo";
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** SP day key ("YYYY-MM-DD") for an ISO instant. */
const spDayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: SP }).format(new Date(iso));
/** SP "HH:mm" for an ISO instant. */
const spTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

const pad = (n: number) => String(n).padStart(2, "0");
/** Local Date → "YYYY-MM-DD" (browser is SP, matches spDayKey). */
const localKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function CalendarPage() {
  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Anchor the visible month. `view` is always the 1st of the month.
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState<Date>(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AppointmentLite | null>(null);
  const [defaultDate, setDefaultDate] = useState<string | undefined>(undefined);

  // 6-week grid (42 cells) starting on the Sunday on/before the 1st.
  const cells = useMemo(() => {
    const firstWeekday = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
    const start = new Date(view.getFullYear(), view.getMonth(), 1 - firstWeekday);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [view]);

  const load = useCallback(async () => {
    setLoading(true);
    const start = cells[0];
    const end = new Date(cells[41]);
    end.setDate(end.getDate() + 1);
    const supabase = createClient();
    const { data } = await supabase
      .from("appointments")
      .select(
        "id, scheduled_at, notes, contact_id, deal_id, contact:contacts(id, name, phone), deal:deals(id, title)",
      )
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .order("scheduled_at", { ascending: true });
    setAppts((data ?? []) as unknown as ApptRow[]);
    setLoading(false);
  }, [cells]);

  useEffect(() => {
    // load() flips its own loading flag; legit data-sync effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Index appointments by SP day key.
  const byDay = useMemo(() => {
    const m = new Map<string, ApptRow[]>();
    for (const a of appts) {
      const k = spDayKey(a.scheduled_at);
      const list = m.get(k);
      if (list) list.push(a);
      else m.set(k, [a]);
    }
    return m;
  }, [appts]);

  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP,
    month: "long",
    year: "numeric",
  }).format(view);
  const todayKey = localKey(today);

  function openCreate(dateKey?: string) {
    setEditing(null);
    setDefaultDate(dateKey);
    setDialogOpen(true);
  }
  function openEdit(a: ApptRow) {
    setEditing({
      id: a.id,
      scheduled_at: a.scheduled_at,
      notes: a.notes,
      contact_id: a.contact_id,
      deal_id: a.deal_id,
    });
    setDefaultDate(undefined);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-5">
      {/* Header — terminal prompt */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-mono text-2xl font-bold tracking-tight text-foreground">
            <CalendarDays className="size-6 text-primary" />
            <span className="text-primary">▸</span> calendário
          </h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            # reuniões agendadas (pelo Ian e manuais)
          </p>
        </div>
        <Button
          onClick={() => openCreate()}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          Novo agendamento
        </Button>
      </div>

      <TerminalWindow title="calendar" bodyClassName="flex flex-col">
        {/* Month nav */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="font-mono text-sm font-semibold capitalize text-foreground">
            {monthLabel}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setView(new Date(today.getFullYear(), today.getMonth(), 1))}
              className="rounded-md border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              hoje
            </button>
            <button
              type="button"
              aria-label="Mês anterior"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Próximo mês"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="px-2 py-2 text-center font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Day grid */}
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const key = localKey(d);
              const inMonth = d.getMonth() === view.getMonth();
              const isToday = key === todayKey;
              const dayAppts = byDay.get(key) ?? [];
              return (
                <button
                  type="button"
                  key={key + i}
                  onClick={() => openCreate(key)}
                  aria-label={`Novo agendamento em ${d.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}`}
                  className={[
                    "min-h-24 border-b border-r border-border p-1.5 text-left align-top transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50",
                    i % 7 === 0 ? "border-l" : "",
                    inMonth ? "" : "bg-muted/20",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-xs",
                      isToday
                        ? "bg-primary font-bold text-primary-foreground"
                        : inMonth
                        ? "text-foreground"
                        : "text-muted-foreground",
                    ].join(" ")}
                  >
                    {d.getDate()}
                  </span>
                  <div className="mt-1 space-y-1">
                    {dayAppts.slice(0, 3).map((a) => (
                      <span
                        key={a.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Agendamento ${spTime(a.scheduled_at)} — ${a.contact?.name || a.contact?.phone || "sem nome"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(a);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            openEdit(a);
                          }
                        }}
                        className="block truncate rounded bg-primary-soft px-1.5 py-0.5 font-mono text-[11px] text-primary hover:bg-primary-soft-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      >
                        {spTime(a.scheduled_at)} {a.contact?.name || a.contact?.phone || "—"}
                      </span>
                    ))}
                    {dayAppts.length > 3 && (
                      <span className="block px-1.5 font-mono text-[10px] text-muted-foreground">
                        +{dayAppts.length - 3} mais
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </TerminalWindow>

      <AppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        appointment={editing}
        defaultDate={defaultDate}
        onSaved={load}
      />
    </div>
  );
}
