// src/lib/workspace/queries.ts
// Loaders do Workspace Cliente. RLS escopa tudo pela conta do usuário logado
// (mesmo padrão do os-queries): cc_account_modules e os_agent_registry só devolvem
// linhas da conta; cc_modules é catálogo global (leitura autenticada).
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildModuleStates, type ModuleStates } from './catalog'

type DB = SupabaseClient

/** Estados de módulo da conta atual (catálogo global × habilitação da conta). */
export async function loadModuleStates(db: DB): Promise<ModuleStates> {
  const [catalog, account] = await Promise.all([
    db.from('cc_modules').select('key, status'),
    db.from('cc_account_modules').select('module_key, enabled, config'),
  ])
  if (catalog.error) throw catalog.error
  if (account.error) throw account.error
  return buildModuleStates(
    (catalog.data ?? []) as { key: string; status: 'ga' | 'coming_soon' }[],
    (account.data ?? []) as {
      module_key: string
      enabled: boolean
      config: Record<string, unknown> | null
    }[],
  )
}

export interface WorkspaceAgentRow {
  key: string
  name: string
  specialty: string | null
  status: string
  squad_key: string | null
}

/** Agentes individuais da conta (kind='agent') — a tela Agentes. */
export async function loadWorkspaceAgents(db: DB): Promise<WorkspaceAgentRow[]> {
  const { data, error } = await db
    .from('os_agent_registry')
    .select('key, name, specialty, status, squad_key')
    .eq('kind', 'agent')
    .neq('status', 'retired')
    .order('name')
  if (error) throw error
  return (data ?? []) as WorkspaceAgentRow[]
}

/** Seções da fundação da marca (RLS escopa pela conta) — a tela Marca. */
export async function loadBrandSections(db: DB) {
  const { data, error } = await db
    .from('content_brand_profile')
    .select('section_key, title, content, sort_order, updated_at')
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as import('./brand').BrandSection[]
}
