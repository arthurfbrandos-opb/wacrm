// src/lib/dashboard/os-queries.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { startOfLocalDay, startOfLocalMonth } from './date-utils'
import type { OsEventRow, OsAgentRow, OsOverview, CloserDeal, CommercialMetrics, OverdueFollowup, PendingDecision, DecisionUrgency, GrowthHero } from './os-types'

type DB = SupabaseClient

const CLOSER_PIPELINE = 'Closer'

/** Reais sem centavos, pt-BR. */
export function formatBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

/** Pura: receita potencial = soma dos values; propostas abertas = contagem. */
export function buildCommercialMetrics(openCloserDeals: { value: number | string }[]): CommercialMetrics {
  const receitaPotencial = openCloserDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0)
  return { receitaPotencial, propostasAbertas: openCloserDeals.length }
}

/** Deals 'open' no pipeline Closer (RLS escopa por dono). Vazio se não há Closer. */
export async function loadCloserOpenDeals(db: DB): Promise<CloserDeal[]> {
  const { data: pipelines, error: pErr } = await db.from('pipelines').select('id').eq('name', CLOSER_PIPELINE)
  if (pErr) throw pErr
  const closerIds = (pipelines ?? []).map((p: { id: string }) => p.id)
  if (closerIds.length === 0) return []
  const { data, error } = await db
    .from('deals')
    .select('id, title, value, updated_at')
    .eq('status', 'open')
    .in('pipeline_id', closerIds)
    .order('updated_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as CloserDeal[]
}

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

const TOUCH_LABEL: Record<string, string> = {
  first_touch: '1º contato',
  reminder_24h: 'lembrete 24h',
  reminder_2h: 'lembrete 2h',
}

const MS_DAY = 24 * 60 * 60 * 1000

/** Pura: deals abertos sem movimento há MAIS de staleDays dias. */
export function selectStaleDeals(deals: CloserDeal[], staleDays: number, now: Date): CloserDeal[] {
  const cutoff = now.getTime() - staleDays * MS_DAY
  return deals.filter((d) => new Date(d.updated_at).getTime() < cutoff)
}

/** Pura: monta a fila da Central de Ações (read-first), ordenada por urgência. */
export function buildPendingDecisions(overdue: OverdueFollowup[], stale: CloserDeal[], now: Date): PendingDecision[] {
  const followups: PendingDecision[] = overdue.map((f) => {
    const days = Math.floor((now.getTime() - new Date(f.due_at).getTime()) / MS_DAY)
    return {
      id: `followup:${f.id}`,
      kind: 'followup',
      urgency: days >= 2 ? 'red' : 'warn',
      title: `Follow-up vencido · ${TOUCH_LABEL[f.type] ?? f.type}`,
      subtitle: days <= 0 ? 'venceu hoje' : `vencido há ${days} dia${days === 1 ? '' : 's'}`,
      href: `/inbox?c=${f.conversation_id}`,
      cta: 'Ver',
    }
  })
  const deals: PendingDecision[] = stale.map((d) => ({
    id: `deal:${d.id}`,
    kind: 'deal',
    urgency: 'normal' as DecisionUrgency,
    title: d.title,
    subtitle: `Proposta parada · ${formatBRL(Number(d.value) || 0)} · sem movimento`,
    href: '/pipelines',
    cta: 'Abrir',
  }))
  const rank: Record<DecisionUrgency, number> = { red: 0, warn: 1, normal: 2 }
  return [...followups, ...deals].sort((a, b) => rank[a.urgency] - rank[b.urgency])
}

/** Follow-ups vencidos: sdr_touches pending + due_at no passado (RLS por conta). */
export async function loadOverdueFollowups(db: DB, limit = 50): Promise<OverdueFollowup[]> {
  const nowIso = new Date().toISOString()
  const { data, error } = await db
    .from('sdr_touches')
    .select('id, type, due_at, contact_id, conversation_id')
    .eq('status', 'pending')
    .lt('due_at', nowIso)
    .order('due_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as OverdueFollowup[]
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

/** Pura: monta o hero a partir dos números já calculados. */
export function buildGrowthHero(input: { receitaPotencial: number; overdueCount: number; decisionsCount: number }): GrowthHero {
  return {
    receitaPotencialFmt: formatBRL(input.receitaPotencial),
    overdueCount: input.overdueCount,
    decisionsCount: input.decisionsCount,
  }
}

/** Prova viva = nº de os_events no mês corrente (RLS por conta). */
export async function loadProvaVivaCount(db: DB): Promise<number> {
  const monthStart = startOfLocalMonth().toISOString()
  const { count, error } = await db
    .from('os_events')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', monthStart)
  if (error) throw error
  return count ?? 0
}
