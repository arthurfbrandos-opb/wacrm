import { describe, it, expect } from 'vitest'
import {
  slotKey,
  slotLabel,
  agendarProtocol,
  cadastroBlock,
  buildContext,
  parseMarkers,
  splitBubbles,
} from './prompt'
import type { PedroSlot } from '@/lib/pkg/pedro/client'

const SLOTS: PedroSlot[] = [
  { start_iso: '2026-06-11T15:00:00-03:00', end_iso: '2026-06-11T15:30:00-03:00' },
  { start_iso: '2026-06-12T09:30:00-03:00', end_iso: '2026-06-12T10:00:00-03:00' },
]

describe('slot helpers', () => {
  it('slotKey truncates to minute', () => {
    expect(slotKey('2026-06-11T15:00:00-03:00')).toBe('2026-06-11T15:00')
  })
  it('slotLabel formats dd/mm às HHh', () => {
    expect(slotLabel('2026-06-11T15:00:00-03:00')).toBe('11/06 às 15h')
    expect(slotLabel('2026-06-12T09:30:00-03:00')).toBe('12/06 às 9h30')
  })
})

describe('agendarProtocol', () => {
  it('lists real slots and the marker contract when slots exist', () => {
    const p = agendarProtocol(SLOTS, new Date('2026-06-10T12:00:00-03:00'))
    expect(p).toContain('- 2026-06-11T15:00 (11/06 às 15h)')
    expect(p).toContain('[AGENDAR] AAAA-MM-DDTHH:mm')
  })
  it('forbids booking when the agenda is unavailable', () => {
    const p = agendarProtocol([], new Date('2026-06-10T12:00:00-03:00'))
    expect(p).toContain('INDISPONÍVEL')
    expect(p).not.toContain('[AGENDAR] AAAA')
  })
})

describe('cadastroBlock', () => {
  it('lists contact fields + the FAP01 note', () => {
    const b = cadastroBlock(
      { name: 'Diogo', company: 'Seller 360', email: 'd@x.com' },
      'Qualificação FAP01: Faturamento: 50k · Nicho: e-commerce',
    )
    expect(b).toContain('- Nome: Diogo')
    expect(b).toContain('- Empresa: Seller 360')
    expect(b).toContain('- Qualificação FAP01: Faturamento: 50k · Nicho: e-commerce')
  })
  it('is empty when there is nothing to show', () => {
    expect(cadastroBlock(null, null)).toBe('')
    expect(cadastroBlock({ name: '(sem nome)' }, null)).toBe('')
  })
})

describe('buildContext', () => {
  it('maps roles, merges consecutive, drops blanks', () => {
    const ctx = buildContext([
      { sender_type: 'customer', content_text: 'oi' },
      { sender_type: 'customer', content_text: 'tudo bem?' },
      { sender_type: 'agent', content_text: 'opa!' },
      { sender_type: 'agent', content_text: '   ' },
    ])
    expect(ctx).toEqual([
      { role: 'user', content: 'oi\ntudo bem?' },
      { role: 'assistant', content: 'opa!' },
    ])
  })
  it('prepends a synthetic user turn when history opens with the agent', () => {
    const ctx = buildContext([
      { sender_type: 'agent', content_text: 'Oi, aqui é o Pedro' },
      { sender_type: 'customer', content_text: 'oi' },
    ])
    expect(ctx[0]).toEqual({
      role: 'user',
      content: '[conversa iniciada pelo agente — histórico a seguir]',
    })
    expect(ctx[1].role).toBe('assistant')
  })
})

describe('parseMarkers', () => {
  it('strips [AGENDAR] and matches the slot from this turn', () => {
    const r = parseMarkers('Fechado!\n[AGENDAR] 2026-06-11T15:00', SLOTS)
    expect(r.cleanText).toBe('Fechado!')
    expect(r.agendarSlot?.start_iso).toBe('2026-06-11T15:00:00-03:00')
    expect(r.humano).toBe(false)
  })
  it('ignores an [AGENDAR] time not in the offered list (code gate)', () => {
    const r = parseMarkers('ok\n[AGENDAR] 2026-06-30T08:00', SLOTS)
    expect(r.agendarSlot).toBeNull()
    expect(r.cleanText).toBe('ok')
  })
  it('handles a date that wraps to the next line without capturing it', () => {
    const r = parseMarkers('confirmado\n[AGENDAR]\n2026-06-11T15:00', SLOTS)
    expect(r.cleanText).toBe('confirmado')
  })
  it('detects [HUMANO] and strips it', () => {
    const r = parseMarkers('vou te passar pro Arthur\n[HUMANO]', SLOTS)
    expect(r.humano).toBe(true)
    expect(r.cleanText).toBe('vou te passar pro Arthur')
    expect(r.agendarSlot).toBeNull()
  })
})

describe('splitBubbles', () => {
  it('splits on blank lines', () => {
    expect(splitBubbles('a\n\nb\n\nc')).toEqual(['a', 'b', 'c'])
  })
  it('splits a multi-sentence paragraph into one bubble per sentence', () => {
    expect(splitBubbles('Primeira frase aqui. Segunda frase aqui.')).toEqual([
      'Primeira frase aqui.',
      'Segunda frase aqui.',
    ])
  })
  it('keeps two questions as separate bubbles', () => {
    expect(
      splitBubbles('Pensa em automatizar prospecção ou follow-up? Ou tá explorando ainda?'),
    ).toEqual(['Pensa em automatizar prospecção ou follow-up?', 'Ou tá explorando ainda?'])
  })
  it('merges a tiny trailing fragment back into the previous bubble', () => {
    expect(splitBubbles('Beleza, saquei tudo certo. Né?')).toEqual([
      'Beleza, saquei tudo certo. Né?',
    ])
  })
  it('does not split decimals or times (period not followed by space)', () => {
    expect(splitBubbles('Custa R$3.8 e leva 30min no total.')).toEqual([
      'Custa R$3.8 e leva 30min no total.',
    ])
  })
  it('caps at 6 bubbles, folding the rest into the last', () => {
    const b = splitBubbles('1\n\n2\n\n3\n\n4\n\n5\n\n6\n\n7')
    expect(b).toHaveLength(6)
    expect(b[5]).toBe('6 7')
  })
  it('appends the meet link as its own final bubble', () => {
    const b = splitBubbles('confirmado', 'https://meet.google.com/abc')
    expect(b).toEqual(['confirmado', '🔗 Link da call (Google Meet): https://meet.google.com/abc'])
  })
  it('returns just the meet link when text is empty', () => {
    expect(splitBubbles('', 'https://meet.google.com/abc')).toEqual([
      '🔗 Link da call (Google Meet): https://meet.google.com/abc',
    ])
  })
})
