// src/lib/workspace/catalog.ts
// Catálogo do Workspace Cliente — funções puras (testáveis) que montam menu,
// squads e estados de módulo a partir das linhas cruas de cc_modules/cc_account_modules.
// Regra de produto (D8): módulo OFF é visível-desligado ("no seu plano"), nunca escondido;
// módulo que não existe ainda é "em breve" — nunca fingir prontidão.

export type ModuleCatalogStatus = 'ga' | 'coming_soon'

/** Disponibilidade final de um módulo pra conta atual. */
export type ModuleAvailability = 'on' | 'off' | 'coming_soon'

export interface ModuleCatalogRow {
  key: string
  status: ModuleCatalogStatus
}

export interface AccountModuleRow {
  module_key: string
  enabled: boolean
}

/** Estado consolidado por módulo: catálogo global × habilitação da conta. */
export type ModuleStates = Record<string, { enabled: boolean; status: ModuleCatalogStatus }>

/** Pura: consolida catálogo global + linhas da conta num mapa por module_key. */
export function buildModuleStates(
  catalog: ModuleCatalogRow[],
  accountRows: AccountModuleRow[],
): ModuleStates {
  const byKey = new Map(accountRows.map((r) => [r.module_key, r.enabled]))
  const states: ModuleStates = {}
  for (const mod of catalog) {
    states[mod.key] = { enabled: byKey.get(mod.key) ?? false, status: mod.status }
  }
  return states
}

/** Pura: coming_soon do catálogo domina; senão on/off pela habilitação da conta. */
export function moduleAvailability(states: ModuleStates, key: string): ModuleAvailability {
  const s = states[key]
  if (!s) return 'off'
  if (s.status === 'coming_soon') return 'coming_soon'
  return s.enabled ? 'on' : 'off'
}

/** Conta é um workspace de cliente? (módulo-marcador `workspace` ligado) */
export function isWorkspaceAccount(states: ModuleStates): boolean {
  return moduleAvailability(states, 'workspace') === 'on'
}

export interface WorkspaceMenuItem {
  key: string
  label: string
  /** Presente só quando o item navega (state === 'on'). */
  href?: string
  state: ModuleAvailability
}

/**
 * Pura: o menu do workspace (mapa aprovado 01/07 · Marca adicionada 02/07).
 * Itens sempre-on: Visão geral · Agentes · Squads · Configurações.
 * Gated por módulo: Comercial/CRM · Automation Studio · Marca (segue squad_content —
 * é a fundação que alimenta a produção de conteúdo).
 */
export function buildWorkspaceMenu(states: ModuleStates): WorkspaceMenuItem[] {
  const crm = moduleAvailability(states, 'crm')
  const studio = moduleAvailability(states, 'automation_studio')
  const marca = moduleAvailability(states, 'squad_content')
  return [
    { key: 'overview', label: 'Visão geral', href: '/w', state: 'on' },
    { key: 'crm', label: 'Comercial / CRM', state: crm, ...(crm === 'on' ? { href: '/dashboard' } : {}) },
    { key: 'agentes', label: 'Agentes', href: '/w/agentes', state: 'on' },
    { key: 'squads', label: 'Squads', href: '/w/squads', state: 'on' },
    { key: 'marca', label: 'Marca', state: marca, ...(marca === 'on' ? { href: '/w/marca' } : {}) },
    { key: 'automation_studio', label: 'Automation Studio', state: studio, ...(studio === 'on' ? { href: '/w/automation-studio' } : {}) },
    { key: 'config', label: 'Configurações', href: '/w/config', state: 'on' },
  ]
}

export interface SquadCard {
  key: string
  name: string
  description: string
  state: ModuleAvailability
  /** Rota do ambiente da squad (sub-navegação) quando disponível. */
  href?: string
}

/** Pura: cards de squads a partir dos módulos squad_*. */
export function buildSquads(states: ModuleStates): SquadCard[] {
  const content = moduleAvailability(states, 'squad_content')
  const traffic = moduleAvailability(states, 'squad_paid_traffic')
  return [
    {
      key: 'squad_content',
      name: 'Squad Content',
      description: 'Produção e gestão de conteúdo pras redes sociais',
      state: content,
      ...(content === 'on' ? { href: '/w/content' } : {}),
    },
    {
      key: 'squad_paid_traffic',
      name: 'Squad Paid Traffic',
      description: 'Gestão de tráfego pago com IA',
      state: traffic,
      ...(traffic === 'on' ? { href: '/w/trafego' } : {}),
    },
  ]
}

/** Rótulo humano por especialidade de agente (template da tela de uso). */
export const SPECIALTY_LABEL: Record<string, string> = {
  gerador: 'Gerador',
  publisher: 'Publicador',
  chat: 'Especialista',
  analise: 'Analista',
}

/** Rótulo humano por status de agente no registry. */
export const AGENT_STATUS_LABEL: Record<string, string> = {
  active: 'ativo',
  paused: 'pausado',
  retired: 'desativado',
  coming_soon: 'em breve',
}
