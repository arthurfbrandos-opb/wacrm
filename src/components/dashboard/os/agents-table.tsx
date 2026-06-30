import { TerminalWindow } from '@/components/ui/terminal-window'
import { Skeleton } from '@/components/dashboard/skeleton'
import type { OsAgentRow } from '@/lib/dashboard/os-types'

interface OsAgentsTableProps {
  data: OsAgentRow[] | null
}

const STATUS_TONE: Record<string, string> = {
  active: 'border-primary/40 bg-primary/10 text-primary',
  paused: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  retired: 'border-border bg-muted text-muted-foreground',
}

export function OsAgentsTable({ data }: OsAgentsTableProps) {
  return (
    <TerminalWindow title="os/agentes">
      <div className="p-4">
        {data === null ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <p className="font-mono text-sm text-muted-foreground">nenhum agente registrado.</p>
        ) : (
          <ul className="space-y-3 font-mono text-sm">
            {data.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="text-foreground">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.model ?? '—'}
                    {a.owner ? ` · ${a.owner}` : ''}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_TONE[a.status] ?? STATUS_TONE.retired}`}
                >
                  ● {a.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </TerminalWindow>
  )
}
