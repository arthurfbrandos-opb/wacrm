import { describe, it, expect } from 'vitest'
import { buildOsOverview, buildCommercialMetrics, formatBRL } from './os-queries'

describe('formatBRL', () => {
  it('formata em reais', () => {
    const s = formatBRL(42000)
    expect(s).toContain('R$')
    expect(s).toContain('42.000')
  })
})

describe('buildCommercialMetrics', () => {
  it('soma value (number|string) e conta propostas', () => {
    const m = buildCommercialMetrics([{ value: 5000 }, { value: '2000.5' }, { value: 0 }])
    expect(m.receitaPotencial).toBe(7000.5)
    expect(m.propostasAbertas).toBe(3)
  })
  it('lista vazia → zeros', () => {
    expect(buildCommercialMetrics([])).toEqual({ receitaPotencial: 0, propostasAbertas: 0 })
  })
  it('value inválido vira 0', () => {
    expect(buildCommercialMetrics([{ value: 'abc' }, { value: 1000 }]).receitaPotencial).toBe(1000)
  })
})

describe('buildOsOverview', () => {
  it('conta agentes ativos/total, eventos do dia e switches ligados/total', () => {
    const o = buildOsOverview({
      agentStatuses: [{ status: 'active' }, { status: 'active' }, { status: 'paused' }],
      eventsTodayCount: 3,
      switchEnabled: [{ enabled: true }, { enabled: false }],
    })
    expect(o).toEqual({ agentsActive: 2, agentsTotal: 3, eventsToday: 3, switchesOn: 1, switchesTotal: 2 })
  })

  it('espinha vazia → tudo 0', () => {
    const o = buildOsOverview({ agentStatuses: [], eventsTodayCount: 0, switchEnabled: [] })
    expect(o).toEqual({ agentsActive: 0, agentsTotal: 0, eventsToday: 0, switchesOn: 0, switchesTotal: 0 })
  })

  it('eventsTodayCount null (head count ausente) vira 0', () => {
    const o = buildOsOverview({ agentStatuses: [{ status: 'active' }], eventsTodayCount: null, switchEnabled: [] })
    expect(o.eventsToday).toBe(0)
    expect(o.agentsActive).toBe(1)
  })
})
