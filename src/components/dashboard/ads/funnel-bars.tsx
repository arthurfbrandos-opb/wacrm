import { Skeleton } from '@/components/dashboard/skeleton'
import { TerminalWindow } from '@/components/ui/terminal-window'
import type { AdsFunnel } from '@/lib/dashboard/ads-types'

interface FunnelBarsProps {
  data: AdsFunnel | null
}

export function FunnelBars({ data }: FunnelBarsProps) {
  if (!data) {
    return (
      <TerminalWindow title="ads/funil">
        <div className="space-y-3 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </TerminalWindow>
    )
  }

  const maxCount = Math.max(...data.stages.map((s) => s.count), 1)

  return (
    <TerminalWindow title="ads/funil">
      <div className="space-y-3 p-5">
        {data.stages.map((stage) => {
          const widthPct = Math.round((stage.count / maxCount) * 100)
          return (
            <div key={stage.key}>
              <div className="mb-1 flex items-center justify-between font-mono text-xs text-muted-foreground">
                <span>{stage.label}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  {stage.convFromPrevPct !== null && (
                    <span className="text-amber-400">↓ {stage.convFromPrevPct}%</span>
                  )}
                  <span className="text-foreground">{stage.count.toLocaleString('pt-BR')}</span>
                </span>
              </div>
              <div className="h-6 w-full overflow-hidden rounded-md bg-muted">
                <div
                  className="h-full rounded-md bg-primary/60 transition-all"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </TerminalWindow>
  )
}
