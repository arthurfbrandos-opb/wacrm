import { describe, it, expect } from 'vitest'
import {
  substituteVariables,
  extractTokens,
  unknownTokens,
  isValidVariableName,
  BUILTIN_NAMES,
} from './variables'

describe('substituteVariables', () => {
  it('replaces known tokens with their values', () => {
    const out = substituteVariables(
      'Oi {{nome_cliente}}, da {{empresa}}!',
      { nome_cliente: 'Maria', empresa: 'Acme' },
    )
    expect(out).toBe('Oi Maria, da Acme!')
  })

  it('is case-insensitive on the token name and tolerates inner spaces', () => {
    expect(substituteVariables('{{ Nome_Cliente }}', { nome_cliente: 'Maria' })).toBe('Maria')
  })

  it('replaces every occurrence of the same token', () => {
    expect(substituteVariables('{{x}} e {{x}}', { x: 'a' })).toBe('a e a')
  })

  it('leaves unknown tokens LITERAL (never blanks them)', () => {
    expect(substituteVariables('Oi {{desconhecido}}', { nome_cliente: 'Maria' })).toBe(
      'Oi {{desconhecido}}',
    )
  })

  it('uses an empty value when the key is present but empty (e.g. fallback applied upstream)', () => {
    expect(substituteVariables('valor: {{v}}', { v: '' })).toBe('valor: ')
  })

  it('is a no-op when the prompt has no tokens (byte-identical)', () => {
    const p = 'Você é Pedro, pré-vendas da NS. Sem variáveis aqui.'
    expect(substituteVariables(p, { nome_cliente: 'Maria' })).toBe(p)
  })

  it('does not touch single braces', () => {
    expect(substituteVariables('{x} e {{x}}', { x: 'Y' })).toBe('{x} e Y')
  })
})

describe('extractTokens', () => {
  it('returns distinct lowercased token names', () => {
    expect(extractTokens('{{a}} {{A}} {{b}} texto {{c}}').sort()).toEqual(['a', 'b', 'c'])
  })
  it('returns empty for a prompt without tokens', () => {
    expect(extractTokens('sem tokens')).toEqual([])
  })
})

describe('unknownTokens', () => {
  it('flags tokens that are neither built-in nor custom', () => {
    const p = 'Oi {{nome_cliente}}, {{meu_campo}}, {{typo_aqui}}'
    expect(unknownTokens(p, ['meu_campo'])).toEqual(['typo_aqui'])
  })
  it('treats every built-in as known', () => {
    const p = BUILTIN_NAMES.map((n) => `{{${n}}}`).join(' ')
    expect(unknownTokens(p, [])).toEqual([])
  })
})

describe('isValidVariableName', () => {
  it('accepts lowercase, digits, underscore', () => {
    expect(isValidVariableName('nome_lead_2')).toBe(true)
  })
  it('rejects spaces, uppercase, braces, dashes', () => {
    expect(isValidVariableName('Nome')).toBe(false)
    expect(isValidVariableName('nome lead')).toBe(false)
    expect(isValidVariableName('nome-lead')).toBe(false)
    expect(isValidVariableName('{{nome}}')).toBe(false)
  })
})
