"use client"
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  loadOsOverview,
  loadOsActivity,
  loadOsAgents,
  loadCloserOpenDeals,
  loadOverdueFollowups,
  loadProvaVivaCount,
  buildCommercialMetrics,
  selectStaleDeals,
  buildPendingDecisions,
  buildGrowthHero,
} from '@/lib/dashboard/os-queries'
import type {
  OsOverview,
  OsEventRow,
  OsAgentRow,
  CommercialMetrics,
  PendingDecision,
  GrowthHero,
} from '@/lib/dashboard/os-types'
import { OsOverviewCards } from '@/components/dashboard/os/overview-cards'
import { OsActivityFeed } from '@/components/dashboard/os/activity-feed'
import { OsAgentsTable } from '@/components/dashboard/os/agents-table'
import { GrowthHeroBanner } from '@/components/dashboard/os/growth-hero'
import { BusinessMetrics } from '@/components/dashboard/os/business-metrics'
import { CentralDeAcoes } from '@/components/dashboard/os/central-de-acoes'

export default function OsCockpitPage() {
  const [overview, setOverview] = useState<OsOverview | null>(null)
  const [activity, setActivity] = useState<OsEventRow[] | null>(null)
  const [agents, setAgents] = useState<OsAgentRow[] | null>(null)
  const [commercial, setCommercial] = useState<CommercialMetrics | null>(null)
  const [overdueCount, setOverdueCount] = useState<number | null>(null)
  const [provaViva, setProvaViva] = useState<number | null>(null)
  const [decisions, setDecisions] = useState<PendingDecision[] | null>(null)
  const [hero, setHero] = useState<GrowthHero | null>(null)

  useEffect(() => {
    const db = createClient()
    void loadOsOverview(db).then(setOverview).catch((e) => console.error('[os] overview', e))
    void loadOsActivity(db).then(setActivity).catch((e) => console.error('[os] activity', e))
    void loadOsAgents(db).then(setAgents).catch((e) => console.error('[os] agents', e))

    void (async () => {
      const now = new Date()
      const [closerResult, overdueResult, provaResult] = await Promise.allSettled([
        loadCloserOpenDeals(db),
        loadOverdueFollowups(db),
        loadProvaVivaCount(db),
      ])

      if (provaResult.status === 'fulfilled') {
        setProvaViva(provaResult.value)
      } else {
        console.error('[os] prova viva', provaResult.reason)
      }

      let metrics: CommercialMetrics | null = null
      if (closerResult.status === 'fulfilled') {
        metrics = buildCommercialMetrics(closerResult.value)
        setCommercial(metrics)
      } else {
        console.error('[os] closer deals', closerResult.reason)
      }

      let overdueLen = 0
      if (overdueResult.status === 'fulfilled') {
        overdueLen = overdueResult.value.length
        setOverdueCount(overdueLen)
      } else {
        console.error('[os] overdue followups', overdueResult.reason)
      }

      const overdueOrEmpty = overdueResult.status === 'fulfilled' ? overdueResult.value : []
      const staleOrEmpty = closerResult.status === 'fulfilled'
        ? selectStaleDeals(closerResult.value, 7, now)
        : []
      const pend = buildPendingDecisions(overdueOrEmpty, staleOrEmpty, now)
      setDecisions(pend)

      setHero(
        buildGrowthHero({
          receitaPotencial: metrics?.receitaPotencial ?? 0,
          overdueCount: overdueLen,
          decisionsCount: pend.length,
        }),
      )
    })()
  }, [])

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="font-mono text-2xl font-bold text-foreground">
          <span className="text-primary">▸</span> cockpit
        </h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          Minha Empresa · a Negócio Simples como prova viva do próprio Growth OS.
        </p>
      </div>

      <GrowthHeroBanner data={hero} />
      <BusinessMetrics commercial={commercial} overdueCount={overdueCount} provaViva={provaViva} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CentralDeAcoes data={decisions} />
        <OsActivityFeed data={activity} />
      </div>

      <div className="space-y-4 border-t border-border pt-6">
        <h2 className="font-mono text-sm uppercase tracking-wide text-muted-foreground">Espinha &amp; Governança</h2>
        <OsOverviewCards data={overview} />
        <OsAgentsTable data={agents} />
      </div>
    </div>
  )
}
