// src/lib/workspace/overview.ts
// Visão geral do workspace — funções puras que transformam as peças cruas
// nos blocos da tela (hero + ações pendentes). Zero I/O aqui.
import type { ContentPiece } from './content'
import { KIND_LABEL } from './content'

/** Pura: a próxima peça agendada daqui pra frente (ou null). */
export function nextScheduled(pieces: ContentPiece[], now: Date): ContentPiece | null {
  const upcoming = pieces
    .filter((p) => p.scheduled_at !== null && new Date(p.scheduled_at) >= now)
    .sort(
      (a, b) => new Date(a.scheduled_at as string).getTime() - new Date(b.scheduled_at as string).getTime(),
    )
  return upcoming[0] ?? null
}

export interface WorkspaceAction {
  id: string
  title: string
  subtitle: string
  href: string
  cta: string
  urgency: 'red' | 'warn' | 'normal'
}

/**
 * Pura: ações que esperam o cliente. Hoje = peças em "Pra aprovar"
 * (a decisão é dele); produção/agenda andam sozinhas e não entram.
 */
export function buildWorkspaceActions(pieces: ContentPiece[]): WorkspaceAction[] {
  return pieces
    .filter((p) => p.status === 'aprovacao')
    .map((p) => ({
      id: p.id,
      title: p.title,
      subtitle: `${KIND_LABEL[p.kind]} esperando sua aprovação`,
      href: `/w/content/pecas/${p.id}`,
      cta: 'Revisar',
      urgency: 'warn' as const,
    }))
}
