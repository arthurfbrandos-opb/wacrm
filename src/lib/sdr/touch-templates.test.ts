import { describe, it, expect } from 'vitest'
import { templateForTouch } from './touch-templates'

describe('templateForTouch', () => {
  it('reminders ainda não têm template aprovado → null (rede de segurança)', () => {
    expect(templateForTouch('reminder_24h')).toBe(null)
    expect(templateForTouch('reminder_2h')).toBe(null)
  })
})
