import { Skeleton } from '@/components/dashboard/skeleton'
import { TerminalWindow } from '@/components/ui/terminal-window'
import type { AdsFunnel } from '@/lib/dashboard/ads-types'

interface FunnelChartProps {
  data: AdsFunnel | null
}

/**
 * Funil de verdade: cada etapa é um trapézio que estreita rumo à conversão
 * (largura ∝ contagem), com a % de conversão entre etapas. Visual terminal
 * (verde primário, mono). Etapa zerada vira um fio fininho — honesto, não some.
 */
export function FunnelChart({ data }: FunnelChartProps) {
  if (!data) {
    return (
      <TerminalWindow title="ads/funil">
        <div className="space-y-2 px-5 py-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="mx-auto" style={{ width: `${100 - i * 16}%` }}>
              <Skeleton className="h-12 w-full" />
            </div>
          ))}
        </div>
      </TerminalWindow>
    )
  }

  const stages = data.stages
  const max = Math.max(...stages.map((s) => s.count), 1)
  // Largura % da etapa: fio de 2% quando 0 (continua o desenho), mín. 8% quando >0.
  const widthPct = (count: number) => (count === 0 ? 2 : Math.max(8, Math.round((count / max) * 100)))
  const empty = (stages[0]?.count ?? 0) === 0

  return (
    <TerminalWindow title="ads/funil">
      <div className="px-5 py-6">
        {stages.map((stage, i) => {
          const topW = widthPct(stage.count)
          const next = stages[i + 1]
          const botW = next ? widthPct(next.count) : topW
          const clip = `polygon(${(100 - topW) / 2}% 0, ${(100 + topW) / 2}% 0, ${(100 + botW) / 2}% 100%, ${(100 - botW) / 2}% 100%)`
          const intensity = 0.45 + i * 0.12 // afunila e satura rumo à conversão
          return (
            <div key={stage.key}>
              {i > 0 && (
                <div className="flex justify-center py-1">
                  <span className="font-mono text-[11px] text-amber-400/90 tabular-nums">
                    {stage.convFromPrevPct === null ? '—' : `↓ ${stage.convFromPrevPct}%`}
                  </span>
                </div>
              )}
              <div className="relative h-14">
                <div
                  className="absolute inset-0 bg-primary transition-all"
                  style={{ clipPath: clip, opacity: intensity }}
                />
                <div className="relative flex h-full items-center justify-center gap-3 px-4">
                  <span className="font-mono text-xs uppercase tracking-wide text-foreground/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
                    {stage.label}
                  </span>
                  <span className="font-mono text-lg font-bold tabular-nums text-foreground [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
                    {stage.count.toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
        {empty && (
          <p className="mt-3 text-center font-mono text-xs text-muted-foreground">
            sem leads no período ainda
          </p>
        )}
      </div>
    </TerminalWindow>
  )
}
