// src/lib/workspace/content.ts
// Squad Content — funções puras (testáveis) do módulo: colunas do kanban,
// números do dashboard e grade do calendário. Zero I/O aqui.

export type PieceKind = 'carrossel' | 'estatico' | 'video'
export type PieceStatus =
  | 'pauta'
  | 'producao'
  | 'aprovacao'
  | 'aprovada'
  | 'agendada'
  | 'publicada'

export interface ContentPiece {
  id: string
  title: string
  kind: PieceKind
  status: PieceStatus
  caption: string | null
  preview_url: string | null
  channel: string | null
  scheduled_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

/** Ordem e rótulo das colunas do kanban (mapa aprovado 01/07). */
export const KANBAN_COLUMNS: { status: PieceStatus; label: string }[] = [
  { status: 'pauta', label: 'Pauta' },
  { status: 'producao', label: 'Produzindo' },
  { status: 'aprovacao', label: 'Pra aprovar' },
  { status: 'aprovada', label: 'Aprovada' },
  { status: 'agendada', label: 'Agendada' },
  { status: 'publicada', label: 'Publicada' },
]

export const KIND_LABEL: Record<PieceKind, string> = {
  carrossel: 'Carrossel',
  estatico: 'Estático',
  video: 'Vídeo',
}

export const STATUS_LABEL: Record<PieceStatus, string> = Object.fromEntries(
  KANBAN_COLUMNS.map((c) => [c.status, c.label]),
) as Record<PieceStatus, string>

/** Pura: agrupa as peças por coluna do kanban, preservando a ordem das colunas. */
export function groupByStatus(pieces: ContentPiece[]): Map<PieceStatus, ContentPiece[]> {
  const grouped = new Map<PieceStatus, ContentPiece[]>(
    KANBAN_COLUMNS.map((c) => [c.status, [] as ContentPiece[]]),
  )
  for (const p of pieces) {
    grouped.get(p.status)?.push(p)
  }
  return grouped
}

export interface ContentDashboard {
  /** Peças criadas dentro do mês corrente (produção do mês). */
  producedThisMonth: number
  /** Esperando o cliente: coluna "Pra aprovar". */
  waitingApproval: number
  /** Agendadas daqui pra frente (scheduled_at >= agora). */
  scheduledUpcoming: number
  /** Publicadas no mês corrente. */
  publishedThisMonth: number
}

/** Pura: números da Visão geral do módulo a partir das peças cruas. */
export function buildContentDashboard(pieces: ContentPiece[], now: Date): ContentDashboard {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const inMonth = (iso: string | null) => {
    if (!iso) return false
    const d = new Date(iso)
    return d >= monthStart && d <= now
  }
  return {
    producedThisMonth: pieces.filter((p) => inMonth(p.created_at)).length,
    waitingApproval: pieces.filter((p) => p.status === 'aprovacao').length,
    scheduledUpcoming: pieces.filter(
      (p) => p.scheduled_at !== null && new Date(p.scheduled_at) >= now,
    ).length,
    publishedThisMonth: pieces.filter((p) => p.status === 'publicada' && inMonth(p.published_at))
      .length,
  }
}

/** Data-âncora de uma peça no calendário: agendamento > publicação > nada. */
export function pieceCalendarDate(piece: ContentPiece): Date | null {
  const iso = piece.scheduled_at ?? piece.published_at
  return iso ? new Date(iso) : null
}

export interface CalendarDay {
  date: Date
  inMonth: boolean
  pieces: ContentPiece[]
}

/**
 * Pura: grade mensal (semanas × dias, semana começa na segunda) com as peças
 * ancoradas no dia. `year`/`month` no fuso local; `month` é 0-based (Date).
 */
export function buildMonthGrid(
  year: number,
  month: number,
  pieces: ContentPiece[],
): CalendarDay[][] {
  const first = new Date(year, month, 1)
  // getDay(): dom=0 … sáb=6 → índice segunda-primeiro (seg=0 … dom=6)
  const mondayIndex = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - mondayIndex)

  const byDayKey = new Map<string, ContentPiece[]>()
  for (const p of pieces) {
    const d = pieceCalendarDate(p)
    if (!d) continue
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const list = byDayKey.get(key) ?? []
    list.push(p)
    byDayKey.set(key, list)
  }

  const weeks: CalendarDay[][] = []
  const cursor = new Date(start)
  // Sempre 6 semanas — grade estável, sem pulo de layout entre meses.
  for (let w = 0; w < 6; w++) {
    const week: CalendarDay[] = []
    for (let d = 0; d < 7; d++) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`
      week.push({
        date: new Date(cursor),
        inMonth: cursor.getMonth() === month,
        pieces: byDayKey.get(key) ?? [],
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}
