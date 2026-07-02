import { describe, expect, it } from 'vitest'
import { mixLabel, periodDays, validateNewLine, type NewLineInput } from './editorial'

function input(over: Partial<NewLineInput>): NewLineInput {
  return {
    start_date: '2026-07-06',
    end_date: '2026-07-12',
    carrossel: 2,
    estatico: 2,
    video: 0,
    themes: '',
    ...over,
  }
}

describe('periodDays', () => {
  it('inclusivo nas duas pontas', () => {
    expect(periodDays('2026-07-06', '2026-07-12')).toBe(7)
    expect(periodDays('2026-07-06', '2026-07-06')).toBe(1)
  })
  it('datas inválidas ou invertidas', () => {
    expect(periodDays('', '2026-07-12')).toBe(0)
    expect(periodDays('2026-07-12', '2026-07-06')).toBeLessThan(1)
  })
})

describe('validateNewLine', () => {
  it('linha semanal saudável passa', () => {
    const v = validateNewLine(input({}))
    expect(v.ok).toBe(true)
    expect(v.total).toBe(4)
    expect(v.days).toBe(7)
  })

  it('máximo 1 conteúdo por dia', () => {
    const v = validateNewLine(input({ end_date: '2026-07-08', carrossel: 3, estatico: 1 }))
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toContain('1 conteúdo por dia')
  })

  it('período invertido reprova', () => {
    const v = validateNewLine(input({ end_date: '2026-07-01' }))
    expect(v.ok).toBe(false)
  })

  it('zero conteúdo reprova', () => {
    const v = validateNewLine(input({ carrossel: 0, estatico: 0 }))
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toContain('pelo menos 1')
  })

  it('vídeo ainda é em breve', () => {
    const v = validateNewLine(input({ video: 1 }))
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toContain('em breve')
  })
})

describe('mixLabel', () => {
  it('monta o rótulo com plurais', () => {
    expect(mixLabel({ carrossel: 2, estatico: 1 })).toBe('2 carrosséis · 1 estático')
    expect(mixLabel({})).toBe('sem formatos')
  })
})
