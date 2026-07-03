import { describe, it, expect } from 'vitest'
import { templateForTouch } from './touch-templates'

describe('templateForTouch', () => {
  it('reminder_24h → lembrete_24h (pt_BR) com o corpo aprovado', () => {
    const tpl = templateForTouch('reminder_24h')
    expect(tpl).toMatchObject({ name: 'lembrete_24h', lang: 'pt_BR' })
    // corpo = texto EXATO aprovado na Meta ({{1}}=nome, {{2}}=data/hora),
    // persistido no inbox no lugar do placeholder "[reminder_24h]".
    expect(tpl?.body).toContain('Lembrete rápido')
    expect(tpl?.body).toContain('{{2}}')
  })

  it('reminder_2h → lembrete_2h (pt_BR) com o corpo aprovado', () => {
    const tpl = templateForTouch('reminder_2h')
    expect(tpl).toMatchObject({ name: 'lembrete_2h', lang: 'pt_BR' })
    expect(tpl?.body).toContain('hoje às {{2}}')
  })

  it('first_touch → null (sem template aprovado, rede de segurança)', () => {
    expect(templateForTouch('first_touch')).toBe(null)
  })
})
