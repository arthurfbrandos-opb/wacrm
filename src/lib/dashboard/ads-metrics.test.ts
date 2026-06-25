import { describe, it, expect } from 'vitest'
import { computeFunnel, buildCreativeCostTable, pairFirstResponses, awaitingResponseContactIds, computeLiveOps } from './ads-metrics'

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

describe('pairFirstResponses', () => {
  it('pareia 1ª inbound com a 1ª outbound seguinte, por conversa', () => {
    const rows = [
      { conversationId: 'c1', senderType: 'customer', createdAt: '2026-06-29T12:00:00Z' },
      { conversationId: 'c1', senderType: 'customer', createdAt: '2026-06-29T12:01:00Z' }, // 2ª inbound ignorada
      { conversationId: 'c1', senderType: 'agent', createdAt: '2026-06-29T12:10:00Z' }, // +10min
      { conversationId: 'c2', senderType: 'agent', createdAt: '2026-06-29T09:00:00Z' }, // outbound sem inbound antes → ignora
    ]
    expect(pairFirstResponses(rows)).toEqual([10])
  })
})

describe('awaitingResponseContactIds', () => {
  it('lead com outbound e sem inbound = aguardando', () => {
    const r = awaitingResponseContactIds({
      openLeadContactIds: ['a', 'b', 'c'],
      inboundContactIds: new Set(['b']),
      outboundContactIds: new Set(['a', 'b']),
    })
    expect(r).toEqual(['a']) // a: outbound sim, inbound não. b: respondeu. c: nem abordado ainda.
  })
})

describe('computeLiveOps', () => {
  it('monta o bloco com leads hoje×ontem, % respondeu e média de 1ª resposta', () => {
    const lo = computeLiveOps({
      leadsTodayContactIds: ['a', 'b', 'c', 'd'],
      leadsYesterdayContactIds: ['x', 'y'],
      respondedTodayContactIds: ['a', 'b'],
      bookingsTodayCount: 1,
      awaitingNowCount: 2,
      firstResponseMinutesToday: [10, 20],
    })
    expect(lo.leadsToday).toEqual({ current: 4, previous: 2 })
    expect(lo.responded).toEqual({ count: 2, pct: 50 })
    expect(lo.bookingsToday).toBe(1)
    expect(lo.awaitingResponseNow).toBe(2)
    expect(lo.avgFirstResponseMinToday).toBe(15)
  })

  it('zero leads → pct 0 e média null', () => {
    const lo = computeLiveOps({
      leadsTodayContactIds: [],
      leadsYesterdayContactIds: [],
      respondedTodayContactIds: [],
      bookingsTodayCount: 0,
      awaitingNowCount: 0,
      firstResponseMinutesToday: [],
    })
    expect(lo.responded).toEqual({ count: 0, pct: 0 })
    expect(lo.avgFirstResponseMinToday).toBeNull()
  })
})
