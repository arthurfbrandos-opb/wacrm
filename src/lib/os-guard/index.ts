import type { SupabaseClient } from '@supabase/supabase-js'

export type { OsAuditRecord, OsEventRecord, OsAuditStatus } from './types'

/**
 * Kill switch — default-allow. Só um row explícito enabled=false bloqueia.
 * Row ausente OU erro → NÃO bloqueia (não derruba operação viva ao adicionar governança).
 */
export async function osIsBlocked(
  db: SupabaseClient,
  accountId: string,
  key: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('os_kill_switches')
    .select('enabled')
    .eq('account_id', accountId)
    .eq('key', key)
    .maybeSingle()
  if (error || !data) return false
  return (data as { enabled: boolean }).enabled === false
}
