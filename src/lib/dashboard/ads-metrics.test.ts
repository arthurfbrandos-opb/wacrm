import { describe, it, expect } from 'vitest'
import { computeFunnel, buildCreativeCostTable } from './ads-metrics'

describe('computeFunnel', () => {
  it('conta leads distintos e conversão entre etapas (subset dos leads)', () => {
    const f = computeFunnel({
      leadContactIds: ['a', 'b', 'c', 'd', 'a'], // 'a' duplicado → conta 1x
      respondedContactIds: ['a', 'b', 'x'], // 'x' não é lead → ignorado
      bookedContactIds: ['a', 'b'],
      attendedContactIds: ['a'],
      soldContactIds: [],
    })
    const by = Object.fromEntries(f.stages.map((s) => [s.key, s.count]))
    expect(by).toEqual({ leads: 4, responded: 2, booked: 2, attended: 1, sold: 0 })
    // responded/leads = 2/4 = 50%
    const responded = f.stages.find((s) => s.key === 'responded')!
    expect(responded.convFromPrevPct).toBe(50)
    expect(f.stages[0].convFromPrevPct).toBeNull()
  })

  it('zero leads → tudo 0, conversões null', () => {
    const f = computeFunnel({
      leadContactIds: [],
      respondedContactIds: [],
      bookedContactIds: [],
      attendedContactIds: [],
      soldContactIds: [],
    })
    expect(f.stages.every((s) => s.count === 0)).toBe(true)
    expect(f.stages.find((s) => s.key === 'responded')!.convFromPrevPct).toBeNull()
  })
})

describe('buildCreativeCostTable', () => {
  const leads = [
    { contactId: 'a', creative: 'criativo-A', campaign: 'NS-frio' },
    { contactId: 'b', creative: 'criativo-A', campaign: 'NS-frio' },
    { contactId: 'c', creative: 'Sem atribuição', campaign: null },
  ]
  const spend = [
    { adName: 'criativo-A', campaignName: 'NS-frio', spend: 100 },
    { adName: 'criativo-fantasma', campaignName: 'NS-frio', spend: 50 }, // gastou, 0 leads
  ]

  it('junta gasto por ad_name=creative e calcula CPL + custo/agendamento', () => {
    const rows = buildCreativeCostTable({
      leads,
      bookedContactIds: new Set(['a']),
      attendedContactIds: new Set<string>(),
      spend,
    })
    const a = rows.find((r) => r.creative === 'criativo-A')!
    expect(a.leads).toBe(2)
    expect(a.spend).toBe(100)
    expect(a.cpl).toBe(50) // 100/2
    expect(a.booked).toBe(1)
    expect(a.costPerBooking).toBe(100) // 100/1
  })

  it('criativo com leads mas sem gasto casado → cpl null', () => {
    const rows = buildCreativeCostTable({ leads, bookedContactIds: new Set(), attendedContactIds: new Set(), spend: [] })
    const a = rows.find((r) => r.creative === 'criativo-A')!
    expect(a.spend).toBe(0)
    expect(a.cpl).toBeNull()
  })

  it('gasto sem lead casado vira linha visível com 0 leads (flagra má-config)', () => {
    const rows = buildCreativeCostTable({ leads, bookedContactIds: new Set(), attendedContactIds: new Set(), spend })
    const fantasma = rows.find((r) => r.creative === 'criativo-fantasma')!
    expect(fantasma.leads).toBe(0)
    expect(fantasma.spend).toBe(50)
    expect(fantasma.cpl).toBeNull()
  })

  it('linha Sem atribuição aparece (lead sem utm_content)', () => {
    const rows = buildCreativeCostTable({ leads, bookedContactIds: new Set(), attendedContactIds: new Set(), spend })
    expect(rows.some((r) => r.creative === 'Sem atribuição' && r.leads === 1)).toBe(true)
  })
})
