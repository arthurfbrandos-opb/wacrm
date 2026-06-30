import { describe, it, expect } from 'vitest'
import { templateForTouch } from './touch-templates'

describe('templateForTouch', () => {
  it('reminder_24h → lembrete_24h (pt_BR)', () => {
    expect(templateForTouch('reminder_24h')).toEqual({ name: 'lembrete_24h', lang: 'pt_BR' })
  })

  it('reminder_2h → lembrete_2h (pt_BR)', () => {
    expect(templateForTouch('reminder_2h')).toEqual({ name: 'lembrete_2h', lang: 'pt_BR' })
  })

  it('first_touch → null (sem template aprovado, rede de segurança)', () => {
    expect(templateForTouch('first_touch')).toBe(null)
  })
})
