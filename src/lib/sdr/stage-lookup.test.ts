import { describe, it, expect } from 'vitest'
import { resolvePipelineId, resolveStageId } from './stage-lookup'

// Admin falso: from(table) encadeável; maybeSingle devolve o canned data por tabela.
function fakeAdmin(data: Record<string, unknown>) {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: (data as Record<string, unknown>)[table] ?? null, error: null }),
      }
      return b
    },
  }
}

describe('stage-lookup', () => {
  it('resolves a pipeline id by name', async () => {
    const admin = fakeAdmin({ pipelines: { id: 'pl-fu' } })
    expect(await resolvePipelineId(admin, 'acc-1', 'Follow-up')).toBe('pl-fu')
  })

  it('returns null when the pipeline is missing', async () => {
    const admin = fakeAdmin({})
    expect(await resolvePipelineId(admin, 'acc-1', 'Nope')).toBeNull()
  })

  it('resolves a stage id by pipeline + stage name', async () => {
    const admin = fakeAdmin({ pipelines: { id: 'pl-fu' }, pipeline_stages: { id: 'st-fu1' } })
    expect(await resolveStageId(admin, 'acc-1', 'Follow-up', 'Follow-up 1')).toBe('st-fu1')
  })

  it('returns null when the stage pipeline is missing', async () => {
    const admin = fakeAdmin({})
    expect(await resolveStageId(admin, 'acc-1', 'Follow-up', 'Follow-up 1')).toBeNull()
  })
})
