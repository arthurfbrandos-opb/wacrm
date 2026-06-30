import Link from 'next/link'
import { TerminalWindow } from '@/components/ui/terminal-window'
import type { PendingDecision } from '@/lib/dashboard/os-types'

const DOT: Record<string, string> = {
  red: 'bg-red-400',
  warn: 'bg-amber-300',
  normal: 'bg-primary',
}

export function CentralDeAcoes({ data }: { data: PendingDecision[] | null }) {
  return (
    <TerminalWindow title="cockpit/central_de_acoes" className="h-full">
      <div className="space-y-2 p-4">
        {data === null ? (
          <p className="font-mono text-sm text-muted-foreground">carregando…</p>
        ) : data.length === 0 ? (
          <p className="font-mono text-sm text-muted-foreground">▸ nada pendente · tudo em dia.</p>
        ) : (
          data.map((d) => (
            <div
              key={d.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card/40 p-3"
            >
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[d.urgency]}`} aria-hidden />
                <div>
                  <p className="font-mono text-sm font-medium text-foreground">{d.title}</p>
                  <p className="font-mono text-xs text-muted-foreground">{d.subtitle}</p>
                </div>
              </div>
              <Link
                href={d.href}
                className="shrink-0 rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
              >
                {d.cta}
              </Link>
            </div>
          ))
        )}
        <p className="pt-1 font-mono text-[11px] text-muted-foreground">
          Aprovações de conteúdo entram aqui em breve.
        </p>
      </div>
    </TerminalWindow>
  )
}
