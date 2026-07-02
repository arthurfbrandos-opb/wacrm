import { describe, expect, it } from 'vitest'
import {
  buildModuleStates,
  buildSquads,
  buildWorkspaceMenu,
  isWorkspaceAccount,
  moduleAvailability,
} from './catalog'

const CATALOG = [
  { key: 'workspace', status: 'ga' as const },
  { key: 'crm', status: 'ga' as const },
  { key: 'squad_content', status: 'ga' as const },
  { key: 'squad_paid_traffic', status: 'coming_soon' as const },
  { key: 'automation_studio', status: 'coming_soon' as const },
]

// Conta tipo Rodolfo: workspace + squad_content ligados; CRM presente mas desligado.
const RODOLFO_ROWS = [
  { module_key: 'workspace', enabled: true },
  { module_key: 'squad_content', enabled: true },
  { module_key: 'crm', enabled: false },
]

describe('buildModuleStates + moduleAvailability', () => {
  it('liga o que a conta habilitou e desliga o resto', () => {
    const states = buildModuleStates(CATALOG, RODOLFO_ROWS)
    expect(moduleAvailability(states, 'squad_content')).toBe('on')
    expect(moduleAvailability(states, 'crm')).toBe('off')
  })

  it('módulo sem linha na conta = off (nunca on por omissão)', () => {
    const states = buildModuleStates(CATALOG, [])
    expect(moduleAvailability(states, 'squad_content')).toBe('off')
  })

  it('coming_soon do catálogo domina mesmo com enabled=true na conta', () => {
    const states = buildModuleStates(CATALOG, [
      { module_key: 'squad_paid_traffic', enabled: true },
    ])
    expect(moduleAvailability(states, 'squad_paid_traffic')).toBe('coming_soon')
  })

  it('módulo fora do catálogo = off', () => {
    const states = buildModuleStates(CATALOG, RODOLFO_ROWS)
    expect(moduleAvailability(states, 'inexistente')).toBe('off')
  })
})

describe('isWorkspaceAccount', () => {
  it('true pra conta com marcador workspace ligado (Rodolfo)', () => {
    expect(isWorkspaceAccount(buildModuleStates(CATALOG, RODOLFO_ROWS))).toBe(true)
  })
  it('false pra conta sem marcador (NS tenant zero no dia a dia)', () => {
    expect(isWorkspaceAccount(buildModuleStates(CATALOG, []))).toBe(false)
  })
})

describe('buildWorkspaceMenu', () => {
  it('itens fixos on + CRM off (visível-desligado) + Automation Studio em breve', () => {
    const menu = buildWorkspaceMenu(buildModuleStates(CATALOG, RODOLFO_ROWS))
    const byKey = Object.fromEntries(menu.map((m) => [m.key, m]))
    expect(byKey.overview.state).toBe('on')
    expect(byKey.overview.href).toBe('/w')
    expect(byKey.agentes.state).toBe('on')
    expect(byKey.squads.state).toBe('on')
    expect(byKey.config.state).toBe('on')
    expect(byKey.crm.state).toBe('off')
    expect(byKey.crm.href).toBeUndefined() // desligado não navega
    expect(byKey.automation_studio.state).toBe('coming_soon')
  })

  it('Marca segue squad_content: on navega, sem o módulo fica off', () => {
    const comSquad = buildWorkspaceMenu(buildModuleStates(CATALOG, RODOLFO_ROWS))
    const marca = comSquad.find((m) => m.key === 'marca')!
    expect(marca.state).toBe('on')
    expect(marca.href).toBe('/w/marca')

    const semSquad = buildWorkspaceMenu(buildModuleStates(CATALOG, []))
    const marcaOff = semSquad.find((m) => m.key === 'marca')!
    expect(marcaOff.state).toBe('off')
    expect(marcaOff.href).toBeUndefined()
  })

  it('CRM ligado navega pro CRM real', () => {
    const menu = buildWorkspaceMenu(
      buildModuleStates(CATALOG, [...RODOLFO_ROWS.filter((r) => r.module_key !== 'crm'), { module_key: 'crm', enabled: true }]),
    )
    const crm = menu.find((m) => m.key === 'crm')!
    expect(crm.state).toBe('on')
    expect(crm.href).toBe('/dashboard')
  })
})

describe('buildSquads', () => {
  it('Squad Content on com rota; Paid Traffic em breve sem rota', () => {
    const squads = buildSquads(buildModuleStates(CATALOG, RODOLFO_ROWS))
    const content = squads.find((s) => s.key === 'squad_content')!
    const traffic = squads.find((s) => s.key === 'squad_paid_traffic')!
    expect(content.state).toBe('on')
    expect(content.href).toBe('/w/content')
    expect(traffic.state).toBe('coming_soon')
    expect(traffic.href).toBeUndefined()
  })
})
