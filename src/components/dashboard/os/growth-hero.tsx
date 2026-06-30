import type { GrowthHero } from '@/lib/dashboard/os-types'

export function GrowthHeroBanner({ data }: { data: GrowthHero | null }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-6">
      <p className="font-mono text-lg font-semibold leading-snug text-foreground sm:text-2xl">
        {data ? (
          <>
            Hoje: <span className="text-primary">{data.receitaPotencialFmt}</span> em propostas abertas ·{' '}
            <span className="text-primary">{data.overdueCount}</span> follow-ups vencidos ·{' '}
            <span className="text-primary">{data.decisionsCount}</span> decisões esperando você.
          </>
        ) : (
          'carregando…'
        )}
      </p>
      <p className="mt-2 font-mono text-sm text-muted-foreground">
        Não mostra IA pensando — mostra estado, risco, próxima ação, evidência, aprovação e resultado.
      </p>
    </div>
  )
}
