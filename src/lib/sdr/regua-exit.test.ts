import { describe, it, expect, vi } from 'vitest'
import { moveDealFollowupToEmConversa } from './regua-exit'

// Admin falso parametrizável por tabela+operação.
function fakeAdmin(opts: {
  followupPipelineId?: string
  emConversaStageId?: string
  sdrPipelineId?: string
  deal?: { id: string; pipeline_id: string } | null
  onUpdate?: (filters: [string, unknown][]) => void
}) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = []
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => (filters.push([k, v]), b),
        order: () => b,
        limit: () => b,
        maybeSingle: async () => {
          if (table === 'pipelines') {
            // resolve by name: the name filter is the 2nd eq
            const name = filters.find(([k]) => k === 'name')?.[1]
            if (name === 'Follow-up') return { data: opts.followupPipelineId ? { id: opts.followupPipelineId } : null, error: null }
            if (name === 'Pré-Vendas (SDR)') return { data: opts.sdrPipelineId ? { id: opts.sdrPipelineId } : null, error: null }
            return { data: null, error: null }
          }
          if (table === 'pipeline_stages') return { data: opts.emConversaStageId ? { id: opts.emConversaStageId } : null, error: null }
          if (table === 'deals') return { data: opts.deal ?? null, error: null }
          return { data: null, error: null }
        },
        update: () => ({ eq: (k: string, v: unknown) => { filters.push([k, v]); opts.onUpdate?.(filters); return { eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) } } }),
      }
      return b
    },
  }
}

describe('moveDealFollowupToEmConversa', () => {
  it('moves the deal when it is in the Follow-up pipeline', async () => {
    let updated = false
    const admin = fakeAdmin({
      followupPipelineId: 'pl-fu', sdrPipelineId: 'pl-sdr', emConversaStageId: 'st-emconv',
      deal: { id: 'd1', pipeline_id: 'pl-fu' },
      onUpdate: () => { updated = true },
    })
    expect(await moveDealFollowupToEmConversa(admin, 'acc-1', 'c1')).toBe(true)
    expect(updated).toBe(true)
  })

  it('does nothing when the deal is not in the Follow-up pipeline', async () => {
    const admin = fakeAdmin({
      followupPipelineId: 'pl-fu', sdrPipelineId: 'pl-sdr', emConversaStageId: 'st-emconv',
      deal: { id: 'd1', pipeline_id: 'pl-other' },
    })
    expect(await moveDealFollowupToEmConversa(admin, 'acc-1', 'c1')).toBe(false)
  })

  it('returns false when there is no open deal', async () => {
    const admin = fakeAdmin({ followupPipelineId: 'pl-fu', deal: null })
    expect(await moveDealFollowupToEmConversa(admin, 'acc-1', 'c1')).toBe(false)
  })
})
