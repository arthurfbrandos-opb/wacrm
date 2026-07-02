import { describe, expect, it } from 'vitest'
import {
  buildContentDashboard,
  buildMonthGrid,
  groupByStatus,
  KANBAN_COLUMNS,
  pieceCalendarDate,
  pieceDeletable,
  type ContentPiece,
} from './content'

function piece(over: Partial<ContentPiece>): ContentPiece {
  return {
    id: over.id ?? 'p1',
    title: over.title ?? 'Peça de teste',
    kind: over.kind ?? 'carrossel',
    status: over.status ?? 'pauta',
    caption: over.caption ?? null,
    preview_url: over.preview_url ?? null,
    channel: over.channel ?? null,
    scheduled_at: over.scheduled_at ?? null,
    published_at: over.published_at ?? null,
    created_at: over.created_at ?? '2026-07-01T12:00:00Z',
    updated_at: over.updated_at ?? '2026-07-01T12:00:00Z',
  }
}

describe('groupByStatus', () => {
  it('cria todas as colunas na ordem aprovada, mesmo vazias', () => {
    const grouped = groupByStatus([])
    expect([...grouped.keys()]).toEqual(KANBAN_COLUMNS.map((c) => c.status))
    expect(grouped.get('pauta')).toEqual([])
  })

  it('distribui peças nas colunas certas', () => {
    const grouped = groupByStatus([
      piece({ id: 'a', status: 'aprovacao' }),
      piece({ id: 'b', status: 'aprovacao' }),
      piece({ id: 'c', status: 'publicada' }),
    ])
    expect(grouped.get('aprovacao')!.map((p) => p.id)).toEqual(['a', 'b'])
    expect(grouped.get('publicada')!.length).toBe(1)
  })
})

describe('buildContentDashboard', () => {
  const now = new Date('2026-07-15T12:00:00')
  it('conta produção do mês, aprovação pendente, agendadas e publicadas', () => {
    const dash = buildContentDashboard(
      [
        piece({ id: 'mes', created_at: '2026-07-02T10:00:00Z' }),
        piece({ id: 'antigo', created_at: '2026-06-02T10:00:00Z' }),
        piece({ id: 'aprova', status: 'aprovacao', created_at: '2026-07-03T10:00:00Z' }),
        piece({ id: 'agendada', status: 'agendada', scheduled_at: '2026-07-20T10:00:00Z', created_at: '2026-06-20T10:00:00Z' }),
        piece({ id: 'agendada-passada', status: 'agendada', scheduled_at: '2026-07-01T10:00:00Z', created_at: '2026-06-20T10:00:00Z' }),
        piece({ id: 'pub', status: 'publicada', published_at: '2026-07-05T10:00:00Z', created_at: '2026-06-25T10:00:00Z' }),
      ],
      now,
    )
    expect(dash.producedThisMonth).toBe(2) // 'mes' + 'aprova'
    expect(dash.waitingApproval).toBe(1)
    expect(dash.scheduledUpcoming).toBe(1) // só a futura
    expect(dash.publishedThisMonth).toBe(1)
  })
})

describe('pieceCalendarDate', () => {
  it('agendamento vence publicação; sem datas = null', () => {
    expect(
      pieceCalendarDate(piece({ scheduled_at: '2026-07-20T10:00:00Z', published_at: '2026-07-01T10:00:00Z' }))!.getDate(),
    ).toBe(20)
    expect(pieceCalendarDate(piece({}))).toBeNull()
  })
})

describe('pieceDeletable', () => {
  it('publicada e agendada não saem; o resto pode', () => {
    expect(pieceDeletable('publicada')).toBe(false)
    expect(pieceDeletable('agendada')).toBe(false)
    expect(pieceDeletable('pauta')).toBe(true)
    expect(pieceDeletable('producao')).toBe(true)
    expect(pieceDeletable('aprovacao')).toBe(true)
    expect(pieceDeletable('aprovada')).toBe(true)
  })
})

describe('buildMonthGrid', () => {
  it('grade de 6 semanas × 7 dias começando na segunda', () => {
    // Julho/2026: dia 1 é quarta-feira → semana 1 começa em seg 29/06.
    const grid = buildMonthGrid(2026, 6, [])
    expect(grid.length).toBe(6)
    expect(grid[0].length).toBe(7)
    expect(grid[0][0].date.getDate()).toBe(29)
    expect(grid[0][0].inMonth).toBe(false)
    expect(grid[0][2].date.getDate()).toBe(1)
    expect(grid[0][2].inMonth).toBe(true)
  })

  it('ancora peça no dia do agendamento (fuso local)', () => {
    const grid = buildMonthGrid(2026, 6, [
      piece({ id: 'x', scheduled_at: '2026-07-10T12:00:00' }),
    ])
    const dia10 = grid.flat().find((d) => d.inMonth && d.date.getDate() === 10)!
    expect(dia10.pieces.map((p) => p.id)).toEqual(['x'])
  })
})
