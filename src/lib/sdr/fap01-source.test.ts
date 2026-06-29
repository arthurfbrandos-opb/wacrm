import { describe, it, expect } from 'vitest'
import { pickFap01Provider } from './fap01-source'

describe('pickFap01Provider', () => {
  it('fonte disponível: usa ela', () => {
    expect(pickFap01Provider('uazapi', { meta: true, uaz: true })).toBe('uazapi')
    expect(pickFap01Provider('meta', { meta: true, uaz: true })).toBe('meta')
  })
  it('fonte indisponível: cai pro outro', () => {
    expect(pickFap01Provider('uazapi', { meta: true, uaz: false })).toBe('meta')
    expect(pickFap01Provider('meta', { meta: false, uaz: true })).toBe('uazapi')
  })
  it('nenhuma disponível: null', () => {
    expect(pickFap01Provider('meta', { meta: false, uaz: false })).toBe(null)
  })
})
