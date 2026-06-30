import { describe, it, expect } from 'vitest'
import { buildOsOverview, buildCommercialMetrics, formatBRL, selectStaleDeals, buildPendingDecisions, buildGrowthHero } from './os-queries'

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

const NOW = new Date(2026, 5, 30, 12, 0, 0) // 30/jun/2026 12:00 local

describe('selectStaleDeals', () => {
  it('mantém só deals sem update há >= staleDays', () => {
    const deals = [
      { id: 'a', title: 'A', value: 1000, updated_at: new Date(2026, 5, 20).toISOString() }, // ~10d
      { id: 'b', title: 'B', value: 2000, updated_at: new Date(2026, 5, 29).toISOString() }, // ~1d
    ]
    expect(selectStaleDeals(deals, 7, NOW).map((d) => d.id)).toEqual(['a'])
  })
})

describe('buildPendingDecisions', () => {
  it('mapeia follow-ups e deals parados, ordena por urgência', () => {
    const overdue = [
      { id: 'f1', type: 'first_touch', due_at: new Date(2026, 5, 27).toISOString(), contact_id: 'c1', conversation_id: 'conv1' }, // ~3d → red
      { id: 'f2', type: 'reminder_2h', due_at: new Date(2026, 5, 30, 6).toISOString(), contact_id: 'c2', conversation_id: 'conv2' }, // <1d → warn
    ]
    const stale = [{ id: 'd1', title: 'Closer XPTO', value: 12000, updated_at: new Date(2026, 5, 1).toISOString() }]
    const items = buildPendingDecisions(overdue, stale, NOW)
    expect(items.map((i) => i.urgency)).toEqual(['red', 'warn', 'normal'])
    expect(items[0].href).toBe('/inbox?c=conv1')
    expect(items[0].cta).toBe('Ver')
    expect(items.find((i) => i.kind === 'deal')?.href).toBe('/pipelines')
  })
  it('nada pendente → lista vazia', () => {
    expect(buildPendingDecisions([], [], NOW)).toEqual([])
  })
})

describe('buildGrowthHero', () => {
  it('formata receita e repassa contagens', () => {
    const h = buildGrowthHero({ receitaPotencial: 42000, overdueCount: 9, decisionsCount: 7 })
    expect(h.receitaPotencialFmt).toContain('42.000')
    expect(h.overdueCount).toBe(9)
    expect(h.decisionsCount).toBe(7)
  })
})
