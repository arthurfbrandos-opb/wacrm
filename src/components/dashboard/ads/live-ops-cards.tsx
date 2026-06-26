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

  const leadDelta = data.leadsToday.current - data.leadsToday.previous
  const leadDeltaLabel =
    leadDelta === 0
      ? 'mesmo que ontem'
      : leadDelta > 0
        ? `+${leadDelta} vs ontem`
        : `${leadDelta} vs ontem`

  const avgMin = data.avgFirstResponseMinToday
  const avgLabel =
    avgMin === null ? '—' : avgMin < 60 ? `${avgMin}min` : `${(avgMin / 60).toFixed(1)}h`

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <MetricCard
        title="Leads hoje"
        value={data.leadsToday.current.toLocaleString('pt-BR')}
        icon={TrendingUp}
        delta={{ sign: leadDelta, label: leadDeltaLabel }}
      />
      <MetricCard
        title="Responderam"
        value={`${data.responded.count}`}
        icon={MessageCircle}
        subtitle={`${data.responded.pct}% dos leads de hoje`}
      />
      <MetricCard
        title="Agendamentos hoje"
        value={data.bookingsToday.toLocaleString('pt-BR')}
        icon={CalendarCheck}
      />
      <MetricCard
        title="Sem resposta agora"
        value={data.awaitingResponseNow.toLocaleString('pt-BR')}
        icon={AlertCircle}
      />
      <MetricCard
        title="Tempo médio 1ª resposta"
        value={avgLabel}
        icon={Clock}
      />
    </div>
  )
}
