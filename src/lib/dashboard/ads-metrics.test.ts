import { describe, it, expect } from 'vitest'
import { computeFunnel } from './ads-metrics'

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
