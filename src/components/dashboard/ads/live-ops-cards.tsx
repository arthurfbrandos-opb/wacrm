import {
  TrendingUp,
  MessageCircle,
  CalendarCheck,
  Clock,
  AlertCircle,
} from 'lucide-react'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import type { AdsLiveOps } from '@/lib/dashboard/ads-types'

interface LiveOpsCardsProps {
  data: AdsLiveOps | null
}

export function LiveOpsCards({ data }: LiveOpsCardsProps) {
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }

  const avgMin = data.avgFirstResponseMin
  const avgLabel =
    avgMin === null ? '—' : avgMin < 60 ? `${avgMin}min` : `${(avgMin / 60).toFixed(1)}h`

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <MetricCard
        title="Leads"
        value={data.leads.toLocaleString('pt-BR')}
        icon={TrendingUp}
      />
      <MetricCard
        title="Responderam"
        value={`${data.responded.count}`}
        icon={MessageCircle}
        subtitle={`${data.responded.pct}% dos leads no período`}
      />
      <MetricCard
        title="Agendamentos"
        value={data.bookings.toLocaleString('pt-BR')}
        icon={CalendarCheck}
      />
      <MetricCard
        title="Sem resposta agora"
        value={data.awaitingResponseNow.toLocaleString('pt-BR')}
        icon={AlertCircle}
        subtitle="fila viva — independe do período"
      />
      <MetricCard
        title="Tempo médio 1ª resposta"
        value={avgLabel}
        icon={Clock}
      />
    </div>
  )
}
