"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CalendarDays, Clock, Loader2, User } from "lucide-react";

interface ApptRow {
  id: string;
  scheduled_at: string;
  notes: string | null;
  contact: { id: string; name: string | null; phone: string } | null;
  deal: { id: string; title: string } | null;
}

const SP = "America/Sao_Paulo";
const dayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: SP }).format(new Date(iso)); // 2026-06-23
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP,
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(new Date(iso));
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/** Pull any meet/calendly link out of the free-text note so it's clickable. */
function extractLink(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

export default function CalendarPage() {
  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from("appointments")
        .select(
          "id, scheduled_at, notes, contact:contacts(id, name, phone), deal:deals(id, title)",
        )
        .gte("scheduled_at", start.toISOString())
        .order("scheduled_at", { ascending: true });
      if (cancelled) return;
      setAppts((data ?? []) as unknown as ApptRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Group by SP day, preserving the ascending order.
  const groups: { key: string; iso: string; items: ApptRow[] }[] = [];
  for (const a of appts) {
    const k = dayKey(a.scheduled_at);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(a);
    else groups.push({ key: k, iso: a.scheduled_at, items: [a] });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <CalendarDays className="size-6 text-primary" />
          Calendário
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reuniões agendadas (diagnósticos marcados pelo Pedro e manuais). Sincronizadas
          com o Google Agenda do Arthur.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Carregando…
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Nenhuma reunião futura agendada.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.key}>
              <h2 className="mb-2 text-sm font-semibold capitalize text-foreground">
                {dayLabel(g.iso)}
              </h2>
              <div className="space-y-2">
                {g.items.map((a) => {
                  const link = extractLink(a.notes);
                  return (
                    <div
                      key={a.id}
                      className="flex gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                    >
                      <div className="flex w-14 shrink-0 items-center gap-1 text-sm font-medium text-primary">
                        <Clock className="size-3.5" />
                        {timeLabel(a.scheduled_at)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          <User className="size-3.5 text-muted-foreground" />
                          {a.contact?.name || a.contact?.phone || "Sem contato"}
                          {a.deal?.title && (
                            <span className="text-xs font-normal text-muted-foreground">
                              · {a.deal.title}
                            </span>
                          )}
                        </p>
                        {a.notes && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {a.notes}
                          </p>
                        )}
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 inline-block text-xs text-primary hover:underline"
                          >
                            Abrir reunião ↗
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
