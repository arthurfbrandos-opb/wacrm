// src/lib/dashboard/os-queries.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { startOfLocalDay } from './date-utils'
import type { OsEventRow, OsAgentRow, OsOverview } from './os-types'

type DB = SupabaseClient

/** Pure: monta os números da Visão Geral a partir das linhas cruas das os_*. */
export function buildOsOverview(input: {
  agentStatuses: { status: string }[]
  eventsTodayCount: number | null
  switchEnabled: { enabled: boolean }[]
}): OsOverview {
  return {
    agentsActive: input.agentStatuses.filter((a) => a.status === 'active').length,
    agentsTotal: input.agentStatuses.length,
    eventsToday: input.eventsTodayCount ?? 0,
    switchesOn: input.switchEnabled.filter((s) => s.enabled).length,
    switchesTotal: input.switchEnabled.length,
  }
}

/** Feed de atividade (os_events) — mais recente primeiro. RLS escopa por conta. */
export async function loadOsActivity(db: DB, limit = 20): Promise<OsEventRow[]> {
  const { data, error } = await db
    .from('os_events')
    .select('id, agent, kind, summary, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as OsEventRow[]
}

/** Registro de agentes (os_agent_registry). RLS escopa por conta. */
export async function loadOsAgents(db: DB): Promise<OsAgentRow[]> {
  const { data, error } = await db
    .from('os_agent_registry')
    .select('id, key, name, model, status, owner')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as OsAgentRow[]
}

/** Números da Visão Geral. RLS escopa por conta. */
export async function loadOsOverview(db: DB): Promise<OsOverview> {
  const todayStart = startOfLocalDay().toISOString()
  const [agents, eventsToday, switches] = await Promise.all([
    db.from('os_agent_registry').select('status'),
    db.from('os_events').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('os_kill_switches').select('enabled'),
  ])
  if (agents.error) throw agents.error
  if (eventsToday.error) throw eventsToday.error
  if (switches.error) throw switches.error
  return buildOsOverview({
    agentStatuses: (agents.data ?? []) as { status: string }[],
    eventsTodayCount: eventsToday.count ?? 0,
    switchEnabled: (switches.data ?? []) as { enabled: boolean }[],
  })
}
