export type OsAuditStatus = 'success' | 'blocked' | 'failure'

export interface OsAuditRecord {
  accountId: string
  correlationId?: string | null
  agent?: string | null
  action: string
  status: OsAuditStatus
  detail?: Record<string, unknown>
}

export interface OsEventRecord {
  accountId: string
  agent?: string | null
  kind: string
  summary?: string | null
  ref?: Record<string, unknown>
}
