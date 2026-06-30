import { describe, it, expect } from 'vitest'
import { buildOsOverview } from './os-queries'

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
