import { Bot, Activity, DollarSign, Power } from 'lucide-react'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import type { OsOverview } from '@/lib/dashboard/os-types'

interface OsOverviewCardsProps {
  data: OsOverview | null
}

export function OsOverviewCards({ data }: OsOverviewCardsProps) {
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard title="Agentes ativos" value={`${data.agentsActive}`} icon={Bot} subtitle={`${data.agentsTotal} no registro`} />
      <MetricCard title="Eventos hoje" value={data.eventsToday.toLocaleString('pt-BR')} icon={Activity} />
      <MetricCard title="Custo hoje" value="—" icon={DollarSign} subtitle="em breve · via LiteLLM" />
      <MetricCard title="Kill switches" value={`${data.switchesOn}/${data.switchesTotal}`} icon={Power} subtitle="ligados / total" />
    </div>
  )
}
