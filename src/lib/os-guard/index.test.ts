import { describe, it, expect } from 'vitest'
import { osIsBlocked, osEmitAudit, osEmitEvent, osGuard } from './index'

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

function fakeInsertDb() {
  const inserts: { table: string; row: Record<string, unknown> }[] = []
  const db = {
    inserts,
    from(table: string) {
      return { async insert(row: Record<string, unknown>) { inserts.push({ table, row }); return { error: null } } }
    },
  }
  return db as any
}

describe('osEmitAudit', () => {
  it('insere em os_audit com os campos mapeados', async () => {
    const db = fakeInsertDb()
    await osEmitAudit(db, { accountId: 'acc', agent: 'ian', action: 'sdr_reply', status: 'success' })
    expect(db.inserts[0].table).toBe('os_audit')
    expect(db.inserts[0].row).toMatchObject({ account_id: 'acc', agent: 'ian', action: 'sdr_reply', status: 'success' })
  })
})

describe('osEmitEvent', () => {
  it('insere em os_events com os campos mapeados', async () => {
    const db = fakeInsertDb()
    await osEmitEvent(db, { accountId: 'acc', agent: 'ian', kind: 'sdr.reply_sent', summary: 'reply enviado' })
    expect(db.inserts[0].table).toBe('os_events')
    expect(db.inserts[0].row).toMatchObject({ account_id: 'acc', kind: 'sdr.reply_sent' })
  })
})

function fakeFullDb(opts: { switchRow?: { enabled: boolean } | null } = {}) {
  const inserts: { table: string; row: Record<string, unknown> }[] = []
  const db = {
    inserts,
    from(table: string) {
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() { return { data: opts.switchRow ?? null, error: null } },
        async insert(row: Record<string, unknown>) { inserts.push({ table, row }); return { error: null } },
      }
    },
  }
  return db as any
}

describe('osGuard', () => {
  const ctx = { accountId: 'acc', agent: 'ian', action: 'sdr_reply', switchKey: 'sdr_ai' }

  it('happy path: roda fn e audita success', async () => {
    const db = fakeFullDb()
    const out = await osGuard(db, ctx, async () => 42)
    expect(out).toEqual({ blocked: false, result: 42 })
    expect(db.inserts.find((i: any) => i.table === 'os_audit')?.row).toMatchObject({ status: 'success' })
  })

  it('bloqueado: não roda fn, audita blocked', async () => {
    const db = fakeFullDb({ switchRow: { enabled: false } })
    let ran = false
    const out = await osGuard(db, ctx, async () => { ran = true; return 1 })
    expect(out).toEqual({ blocked: true })
    expect(ran).toBe(false)
    expect(db.inserts.find((i: any) => i.table === 'os_audit')?.row).toMatchObject({ status: 'blocked' })
  })

  it('erro: audita failure e relança', async () => {
    const db = fakeFullDb()
    await expect(osGuard(db, ctx, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(db.inserts.find((i: any) => i.table === 'os_audit')?.row).toMatchObject({ status: 'failure' })
  })
})
