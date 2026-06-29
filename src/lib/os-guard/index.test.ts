import { describe, it, expect } from 'vitest'
import { osIsBlocked } from './index'

function fakeDb(opts: { switchRow?: { enabled: boolean } | null; switchError?: boolean } = {}) {
  return {
    from() {
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() {
          return { data: opts.switchRow ?? null, error: opts.switchError ? new Error('boom') : null }
        },
      }
    },
  } as any
}

describe('osIsBlocked', () => {
  it('bloqueia quando existe switch explicitamente desligado', async () => {
    expect(await osIsBlocked(fakeDb({ switchRow: { enabled: false } }), 'acc', 'sdr_ai')).toBe(true)
  })
  it('libera quando o switch está ligado', async () => {
    expect(await osIsBlocked(fakeDb({ switchRow: { enabled: true } }), 'acc', 'sdr_ai')).toBe(false)
  })
  it('libera quando não existe switch (default-allow)', async () => {
    expect(await osIsBlocked(fakeDb({ switchRow: null }), 'acc', 'sdr_ai')).toBe(false)
  })
  it('libera quando a leitura falha (não derruba operação viva)', async () => {
    expect(await osIsBlocked(fakeDb({ switchError: true }), 'acc', 'sdr_ai')).toBe(false)
  })
})
