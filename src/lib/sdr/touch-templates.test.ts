import { describe, it, expect } from 'vitest'
import { templateForTouch } from './touch-templates'

describe('templateForTouch', () => {
  it('reminders ainda não têm template aprovado → null (rede de segurança)', () => {
    expect(templateForTouch('reminder_24h')).toBe(null)
    expect(templateForTouch('reminder_2h')).toBe(null)
  })

  it('first_touch tem template aprovado → objeto com name e lang', () => {
    const tpl = templateForTouch('first_touch')
    expect(tpl).not.toBe(null)
    expect(tpl).toHaveProperty('name')
    expect(tpl).toHaveProperty('lang')
  })
})
