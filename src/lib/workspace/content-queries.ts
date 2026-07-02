// src/lib/workspace/content-queries.ts
// Loaders das peças da Squad Content. RLS escopa pela conta do usuário logado.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContentPiece } from './content'

type DB = SupabaseClient

const PIECE_COLUMNS =
  'id, title, kind, status, caption, preview_url, channel, scheduled_at, published_at, created_at, updated_at, meta'

/** Todas as peças da conta (kanban/calendário/dashboard leem daqui). */
export async function loadPieces(db: DB): Promise<ContentPiece[]> {
  const { data, error } = await db
    .from('content_pieces')
    .select(PIECE_COLUMNS)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ContentPiece[]
}

/** Uma peça pelo id (detalhe). Null quando não existe/não é da conta. */
export async function loadPiece(db: DB, id: string): Promise<ContentPiece | null> {
  const { data, error } = await db
    .from('content_pieces')
    .select(PIECE_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as ContentPiece) ?? null
}
