"use client"
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadOsOverview, loadOsActivity, loadOsAgents } from '@/lib/dashboard/os-queries'
import type { OsOverview, OsEventRow, OsAgentRow } from '@/lib/dashboard/os-types'
import { OsOverviewCards } from '@/components/dashboard/os/overview-cards'
import { OsActivityFeed } from '@/components/dashboard/os/activity-feed'
import { OsAgentsTable } from '@/components/dashboard/os/agents-table'

export default function OsCockpitPage() {
  const [overview, setOverview] = useState<OsOverview | null>(null)
  const [activity, setActivity] = useState<OsEventRow[] | null>(null)
  const [agents, setAgents] = useState<OsAgentRow[] | null>(null)

  useEffect(() => {
    const db = createClient()
    void loadOsOverview(db).then(setOverview).catch((e) => console.error('[os] overview', e))
    void loadOsActivity(db).then(setActivity).catch((e) => console.error('[os] activity', e))
    void loadOsAgents(db).then(setAgents).catch((e) => console.error('[os] agents', e))
  }, [])

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="font-mono text-2xl font-bold text-foreground">
          <span className="text-primary">▸</span> os/cockpit
        </h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          Minha Empresa · a espinha do NS OS ao vivo (atividade, agentes, governança).
        </p>
      </div>
      <OsOverviewCards data={overview} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OsActivityFeed data={activity} />
        <OsAgentsTable data={agents} />
      </div>
    </div>
  )
}
