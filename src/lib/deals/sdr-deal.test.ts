import { describe, expect, it } from 'vitest'
import { upsertSdrDeal, type UpsertSdrDealOpts } from './sdr-deal'

/**
 * Recording stub for the small slice of the Supabase client upsertSdrDeal
 * uses. `openDeal` is what the open-deal lookup resolves to; `insertResult`
 * is what a deals INSERT resolves to (lets tests simulate the 23505 race).
 */
function stubAdmin(cfg: {
  openDeals?: Array<{ id: string }>
  insertResult?: { data: { id: string } | null; error: { code?: string; message?: string } | null }
}) {
  const calls = {
    dealInserts: [] as Record<string, unknown>[],
    dealUpdates: [] as { patch: Record<string, unknown>; filters: [string, unknown][] }[],
    noteInserts: [] as Record<string, unknown>[],
    dealSelects: 0,
  }
  // Successive lookups can differ (e.g. nothing before the race, the winner
  // after it) — shift() walks that sequence.
  const lookups = [...(cfg.openDeals ? [cfg.openDeals] : [[]])]
  const admin = {
    from(table: string) {
      if (table === 'deals') {
        return {
          select: () => ({
            eq: function eq() { return this },
            order: function order() { return this },
            limit: function limit() { return this },
            maybeSingle: () => {
              calls.dealSelects++
              const rows = lookups.length > 1 ? lookups.shift()! : lookups[0]
              return Promise.resolve({ data: rows[0] ?? null, error: null })
            },
          }),
          insert: (payload: Record<string, unknown>) => {
            calls.dealInserts.push(payload)
            return {
              select: () => ({
                single: () =>
                  Promise.resolve(
                    cfg.insertResult ?? { data: { id: 'new-deal' }, error: null },
                  ),
              }),
            }
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (col: string, val: unknown) => {
              calls.dealUpdates.push({ patch, filters: [[col, val]] })
              return Promise.resolve({ data: null, error: null })
            },
          }),
        }
      }
      if (table === 'contact_notes') {
        return {
          insert: (payload: Record<string, unknown>) => {
            calls.noteInserts.push(payload)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    __calls: calls,
    __queueLookup(rows: Array<{ id: string }>) {
      lookups.push(rows)
    },
  }
  return admin
}

const OPTS: UpsertSdrDealOpts = {
  accountId: 'acct-1',
  userId: 'u1',
  pipelineId: 'pl-sdr',
  stageId: 'st-entry',
  contactId: 'c1',
  title: 'João · MQL',
  currency: 'BRL',
  snapshot: { contact_name: 'João', faturamento_range: '30-80k' },
}

describe('upsertSdrDeal', () => {
  it('creates a deal when the contact has no open deal in the pipeline', async () => {
    const admin = stubAdmin({ openDeals: [] })
    const res = await upsertSdrDeal(admin, OPTS)
    expect(res).toEqual({ dealId: 'new-deal', reused: false })
    expect(admin.__calls.dealInserts).toHaveLength(1)
    expect(admin.__calls.dealInserts[0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'c1',
      pipeline_id: 'pl-sdr',
      stage_id: 'st-entry',
      status: 'open',
      fap01_snapshot: OPTS.snapshot,
    })
    expect(admin.__calls.noteInserts).toHaveLength(0)
  })

  it('reuses the existing open deal: refreshes the snapshot and leaves a note, no insert', async () => {
    const admin = stubAdmin({ openDeals: [{ id: 'd-old' }] })
    const res = await upsertSdrDeal(admin, OPTS)
    expect(res).toEqual({ dealId: 'd-old', reused: true })
    expect(admin.__calls.dealInserts).toHaveLength(0)
    expect(admin.__calls.dealUpdates).toHaveLength(1)
    expect(admin.__calls.dealUpdates[0].patch).toMatchObject({ fap01_snapshot: OPTS.snapshot })
    expect(admin.__calls.dealUpdates[0].filters).toContainEqual(['id', 'd-old'])
    expect(admin.__calls.noteInserts).toHaveLength(1)
    expect(String(admin.__calls.noteInserts[0].note_text)).toMatch(/reenviou/i)
  })

  it('falls back to reuse when the insert loses the unique-index race (23505)', async () => {
    const admin = stubAdmin({
      openDeals: [],
      insertResult: { data: null, error: { code: '23505', message: 'duplicate key' } },
    })
    admin.__queueLookup([{ id: 'd-winner' }])
    const res = await upsertSdrDeal(admin, OPTS)
    expect(res).toEqual({ dealId: 'd-winner', reused: true })
    expect(admin.__calls.dealUpdates).toHaveLength(1)
    expect(admin.__calls.dealUpdates[0].filters).toContainEqual(['id', 'd-winner'])
  })

  it('returns null dealId on a non-unique insert error (lead must not fail)', async () => {
    const admin = stubAdmin({
      openDeals: [],
      insertResult: { data: null, error: { code: '42501', message: 'permission denied' } },
    })
    const res = await upsertSdrDeal(admin, OPTS)
    expect(res).toEqual({ dealId: null, reused: false })
  })
})
