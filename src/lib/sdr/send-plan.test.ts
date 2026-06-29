import { describe, it, expect } from 'vitest'
import { isWindowOpen, computeMode } from './send-plan'

const NOW = Date.parse('2026-06-29T12:00:00Z')

describe('isWindowOpen', () => {
  it('UazAPI sempre aberta (sem conceito de janela)', () => {
    expect(isWindowOpen('uazapi', null, NOW)).toBe(true)
  })
  it('Meta: NULL last_inbound = fechada (conservador)', () => {
    expect(isWindowOpen('meta', null, NOW)).toBe(false)
  })
  it('Meta: inbound < 24h = aberta', () => {
    const t = new Date(NOW - 23 * 3600_000).toISOString()
    expect(isWindowOpen('meta', t, NOW)).toBe(true)
  })
  it('Meta: inbound > 24h = fechada', () => {
    const t = new Date(NOW - 25 * 3600_000).toISOString()
    expect(isWindowOpen('meta', t, NOW)).toBe(false)
  })
})

describe('computeMode', () => {
  it('Meta + fechada = template_required', () => {
    expect(computeMode('meta', false)).toBe('template_required')
  })
  it('Meta + aberta = text', () => {
    expect(computeMode('meta', true)).toBe('text')
  })
  it('UazAPI sempre text', () => {
    expect(computeMode('uazapi', false)).toBe('text')
  })
})
