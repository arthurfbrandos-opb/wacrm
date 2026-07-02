import { describe, expect, it } from 'vitest'
import { buildWorkspaceActions, nextScheduled } from './overview'
import { orderBrandSections, type BrandSection } from './brand'
import type { ContentPiece } from './content'

function piece(over: Partial<ContentPiece>): ContentPiece {
  return {
    id: 'p1',
    title: 'Peça',
    kind: 'carrossel',
    status: 'pauta',
    caption: null,
    preview_url: null,
    channel: 'instagram',
    scheduled_at: null,
    published_at: null,
    created_at: '2026-07-01T12:00:00Z',
    updated_at: '2026-07-01T12:00:00Z',
    ...over,
  }
}

const NOW = new Date('2026-07-02T12:00:00Z')

describe('nextScheduled', () => {
  it('devolve a agendada mais próxima daqui pra frente', () => {
    const next = nextScheduled(
      [
        piece({ id: 'a', scheduled_at: '2026-07-10T12:00:00Z' }),
        piece({ id: 'b', scheduled_at: '2026-07-05T12:00:00Z' }),
        piece({ id: 'passado', scheduled_at: '2026-06-30T12:00:00Z' }),
      ],
      NOW,
    )
    expect(next?.id).toBe('b')
  })

  it('null sem agendamentos futuros', () => {
    expect(nextScheduled([piece({ scheduled_at: '2026-06-01T12:00:00Z' })], NOW)).toBeNull()
    expect(nextScheduled([piece({})], NOW)).toBeNull()
  })
})

describe('buildWorkspaceActions', () => {
  it('só peças em aprovação viram ação, com rota do detalhe', () => {
    const actions = buildWorkspaceActions([
      piece({ id: 'x', status: 'aprovacao', title: 'Post SISBAJUD', kind: 'estatico' }),
      piece({ id: 'y', status: 'producao' }),
      piece({ id: 'z', status: 'publicada' }),
    ])
    expect(actions).toHaveLength(1)
    expect(actions[0].href).toBe('/w/content/pecas/x')
    expect(actions[0].subtitle).toContain('Estático')
  })
})

describe('orderBrandSections', () => {
  it('ordena por sort_order e desempata por título', () => {
    const rows: BrandSection[] = [
      { section_key: 'b', title: 'Zebra', content: '', sort_order: 2, updated_at: '' },
      { section_key: 'a', title: 'A', content: '', sort_order: 1, updated_at: '' },
      { section_key: 'c', title: 'Antes', content: '', sort_order: 2, updated_at: '' },
    ]
    const ordered = orderBrandSections(rows)
    expect(ordered.map((r) => r.section_key)).toEqual(['a', 'c', 'b'])
  })
})
