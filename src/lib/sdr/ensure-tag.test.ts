import { describe, it, expect, vi } from 'vitest'
import { ensureTag } from './ensure-tag'

function fakeAdmin(existing: { id: string } | null, insertId = 'tag-new') {
  const insert = vi.fn(() => ({
    select: () => ({ single: async () => ({ data: { id: insertId }, error: null }) }),
  }))
  const admin = {
    insert,
    from() {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: existing, error: null }),
        insert,
      }
      return b
    },
  }
  return admin
}

describe('ensureTag', () => {
  it('returns the existing tag id without inserting', async () => {
    const admin = fakeAdmin({ id: 'tag-1' })
    expect(await ensureTag(admin, 'acc-1', 'u1', 'fu1')).toBe('tag-1')
    expect(admin.insert).not.toHaveBeenCalled()
  })

  it('creates the tag when absent and returns the new id', async () => {
    const admin = fakeAdmin(null, 'tag-new')
    expect(await ensureTag(admin, 'acc-1', 'u1', 'fu1')).toBe('tag-new')
    expect(admin.insert).toHaveBeenCalled()
  })
})
