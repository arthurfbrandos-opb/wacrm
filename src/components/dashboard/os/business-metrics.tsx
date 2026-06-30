import { TrendingUp, Clock, Users, Sparkles } from 'lucide-react'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { formatBRL } from '@/lib/dashboard/os-queries'
import type { CommercialMetrics } from '@/lib/dashboard/os-types'

interface BusinessMetricsProps {
  commercial: CommercialMetrics | null
  overdueCount: number | null
  provaViva: number | null
}

export function BusinessMetrics({ commercial, overdueCount, provaViva }: BusinessMetricsProps) {
  if (!commercial || overdueCount === null || provaViva === null) {
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
      <MetricCard
        title="Receita potencial"
        value={formatBRL(commercial.receitaPotencial)}
        icon={TrendingUp}
        subtitle={`${commercial.propostasAbertas} propostas abertas`}
      />
      <MetricCard title="Follow-ups vencidos" value={`${overdueCount}`} icon={Clock} subtitle="precisam de atenção" />
      <MetricCard title="Clientes em implantação" value="—" icon={Users} subtitle="em breve · via Meus Clientes" />
      <MetricCard title="Prova viva" value={provaViva.toLocaleString('pt-BR')} icon={Sparkles} subtitle="ações de IA no mês" />
    </div>
  )
}
