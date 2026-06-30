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
      try {
        const now = new Date()
        const [closerDeals, overdue, prova] = await Promise.all([
          loadCloserOpenDeals(db),
          loadOverdueFollowups(db),
          loadProvaVivaCount(db),
        ])
        const metrics = buildCommercialMetrics(closerDeals)
        const stale = selectStaleDeals(closerDeals, 7, now)
        const pend = buildPendingDecisions(overdue, stale, now)
        setCommercial(metrics)
        setOverdueCount(overdue.length)
        setProvaViva(prova)
        setDecisions(pend)
        setHero(
          buildGrowthHero({
            receitaPotencial: metrics.receitaPotencial,
            overdueCount: overdue.length,
            decisionsCount: pend.length,
          }),
        )
      } catch (e) {
        console.error('[os] cockpit business', e)
      }
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
