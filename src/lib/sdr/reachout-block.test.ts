import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./notify', () => ({ notifyArthur: vi.fn(async () => {}) }))

import { handleReachoutBlock } from './reachout-block'
import { notifyArthur as notifyArthurImport } from './notify'
const notifyArthur = vi.mocked(notifyArthurImport)

const ACCOUNT = 'acc-1'
const CONTACT = 'c-1'
const OWNER = 'owner-1'

// Parametrizable fake Supabase admin: records inserts/updates, answers the
// accounts owner lookup.
function fakeAdmin(opts: { owner?: string | null } = { owner: OWNER }) {
  const inserts: Record<string, unknown[]> = {}
  const updates: { table: string; values: Record<string, unknown>; filters: [string, unknown][] }[] = []
  const admin = {
    inserts,
    updates,
    from(table: string) {
      const filters: [string, unknown][] = []
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => (filters.push([k, v]), b),
        maybeSingle: async () => {
          if (table === 'accounts') {
            return { data: opts.owner ? { owner_user_id: opts.owner } : null, error: null }
          }
          return { data: null, error: null }
        },
        insert: async (values: Record<string, unknown>) => {
          ;(inserts[table] ??= []).push(values)
          return { data: null, error: null }
        },
        update: (values: Record<string, unknown>) => ({
          eq: (k: string, v: unknown) => {
            updates.push({ table, values, filters: [[k, v]] })
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
      return b
    },
  }
  return admin
}

const BASE = { accountId: ACCOUNT, contactId: CONTACT, phone: '5511999999999', name: 'Fulano' }

describe('handleReachoutBlock', () => {
  beforeEach(() => notifyArthur.mockClear())

  it('writes a contact note (463) under the account owner, flips the conversation to human, and pings Arthur', async () => {
    const admin = fakeAdmin()
    await handleReachoutBlock(admin, { ...BASE, conversationId: 'conv-1' })

    const note = admin.inserts['contact_notes']?.[0] as Record<string, unknown>
    expect(note).toBeTruthy()
    expect(note.contact_id).toBe(CONTACT)
    expect(note.account_id).toBe(ACCOUNT)
    expect(note.user_id).toBe(OWNER)
    expect(String(note.note_text)).toContain('463')

    const flip = admin.updates.find((u) => u.table === 'conversations')
    expect(flip?.values.ai_status).toBe('human')
    expect(flip?.filters).toContainEqual(['id', 'conv-1'])

    expect(notifyArthur).toHaveBeenCalledTimes(1)
  })

  it('still notes + pings when there is no conversation to flip', async () => {
    const admin = fakeAdmin()
    await handleReachoutBlock(admin, { ...BASE, conversationId: null })

    expect(admin.inserts['contact_notes']?.length).toBe(1)
    expect(admin.updates.find((u) => u.table === 'conversations')).toBeUndefined()
    expect(notifyArthur).toHaveBeenCalledTimes(1)
  })

  it('skips the note (no throw) when the account has no owner, but still pings Arthur', async () => {
    const admin = fakeAdmin({ owner: null })
    await expect(handleReachoutBlock(admin, { ...BASE, conversationId: 'conv-1' })).resolves.toBeUndefined()

    expect(admin.inserts['contact_notes']).toBeUndefined()
    expect(notifyArthur).toHaveBeenCalledTimes(1)
  })
})
