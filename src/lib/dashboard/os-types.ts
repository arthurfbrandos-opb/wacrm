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
