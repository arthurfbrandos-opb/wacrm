import { TerminalWindow } from '@/components/ui/terminal-window'
import { Skeleton } from '@/components/dashboard/skeleton'
import type { OsEventRow } from '@/lib/dashboard/os-types'

interface OsActivityFeedProps {
  data: OsEventRow[] | null
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function OsActivityFeed({ data }: OsActivityFeedProps) {
  return (
    <TerminalWindow title="os/atividade">
      <div className="p-4">
        {data === null ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <p className="font-mono text-sm text-muted-foreground">
            sem eventos ainda — a espinha enche conforme os agentes agem.
          </p>
        ) : (
          <ul className="space-y-2 font-mono text-sm">
            {data.map((e) => (
              <li
                key={e.id}
                className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2 last:border-0"
              >
                <span className="truncate">
                  <span className="text-primary">› {e.agent ?? 'sistema'}</span>
                  <span className="text-muted-foreground"> · {e.summary ?? e.kind}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </TerminalWindow>
  )
}
