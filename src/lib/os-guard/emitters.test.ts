import { describe, it, expect } from 'vitest'
import { emitSdrReplyEvent } from './emitters'

function fakeInsertDb() {
  const inserts: { table: string; row: Record<string, unknown> }[] = []
  const db = { inserts, from(table: string) { return { async insert(row: Record<string, unknown>) { inserts.push({ table, row }); return { error: null } } } } }
  return db as any
}

describe('emitSdrReplyEvent', () => {
  it('emite os_events kind=sdr.reply_sent com agent ian e ref do contato', async () => {
    const db = fakeInsertDb()
    await emitSdrReplyEvent(db, { accountId: 'acc', contactId: 'c1', conversationId: 'cv1' })
    expect(db.inserts[0].table).toBe('os_events')
    expect(db.inserts[0].row).toMatchObject({ account_id: 'acc', agent: 'ian', kind: 'sdr.reply_sent' })
    expect((db.inserts[0].row as any).ref).toMatchObject({ contact_id: 'c1', conversation_id: 'cv1' })
  })
})
