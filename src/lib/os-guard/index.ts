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

export interface OsGuardCtx {
  accountId: string
  agent?: string | null
  action: string
  switchKey?: string
  correlationId?: string | null
}

export async function osGuard<T>(
  db: SupabaseClient,
  ctx: OsGuardCtx,
  fn: () => Promise<T>,
): Promise<{ blocked: true } | { blocked: false; result: T }> {
  const base = { accountId: ctx.accountId, agent: ctx.agent, action: ctx.action, correlationId: ctx.correlationId }
  if (ctx.switchKey && (await osIsBlocked(db, ctx.accountId, ctx.switchKey))) {
    await osEmitAudit(db, { ...base, status: 'blocked' })
    return { blocked: true }
  }
  try {
    const result = await fn()
    await osEmitAudit(db, { ...base, status: 'success' })
    return { blocked: false, result }
  } catch (err) {
    await osEmitAudit(db, { ...base, status: 'failure', detail: { error: err instanceof Error ? err.message : String(err) } })
    throw err
  }
}
