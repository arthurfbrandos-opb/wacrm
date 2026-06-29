import type { SupabaseClient } from '@supabase/supabase-js'
import type { OsAuditRecord, OsEventRecord } from './types'

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

export async function osEmitAudit(db: SupabaseClient, rec: OsAuditRecord): Promise<void> {
  await db.from('os_audit').insert({
    account_id: rec.accountId,
    correlation_id: rec.correlationId ?? null,
    agent: rec.agent ?? null,
    action: rec.action,
    status: rec.status,
    detail: rec.detail ?? {},
  })
}

export async function osEmitEvent(db: SupabaseClient, rec: OsEventRecord): Promise<void> {
  await db.from('os_events').insert({
    account_id: rec.accountId,
    agent: rec.agent ?? null,
    kind: rec.kind,
    summary: rec.summary ?? null,
    ref: rec.ref ?? {},
  })
}
