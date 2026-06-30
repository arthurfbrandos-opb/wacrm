// src/lib/dashboard/os-types.ts
// Tipos das telas do Cockpit OS (lê a espinha os_* — migration 034).

export interface OsEventRow {
  id: string
  agent: string | null
  kind: string
  summary: string | null
  created_at: string
}

export interface OsAgentRow {
  id: string
  key: string
  name: string
  model: string | null
  status: string
  owner: string | null
}

export interface OsOverview {
  agentsActive: number
  agentsTotal: number
  eventsToday: number
  switchesOn: number
  switchesTotal: number
}

/** Deal aberto do pipeline Closer (Receita potencial + propostas paradas). */
export interface CloserDeal {
  id: string
  title: string
  value: number | string
  updated_at: string
}

export interface CommercialMetrics {
  /** SUM(value) dos deals 'open' no Closer. */
  receitaPotencial: number
  /** Contagem desses deals abertos. */
  propostasAbertas: number
}

/** Follow-up vencido (sdr_touches pending + due_at no passado). */
export interface OverdueFollowup {
  id: string
  type: string
  due_at: string
  contact_id: string
  conversation_id: string
}

export type DecisionUrgency = 'red' | 'warn' | 'normal'

/** Item da Central de Ações (read-first: só leva ao lugar onde se age). */
export interface PendingDecision {
  id: string
  kind: 'followup' | 'deal'
  urgency: DecisionUrgency
  title: string
  subtitle: string
  href: string
  cta: string
}

/** Dados do hero narrativo do cockpit. */
export interface GrowthHero {
  receitaPotencialFmt: string
  overdueCount: number
  decisionsCount: number
}
