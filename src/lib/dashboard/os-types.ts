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
