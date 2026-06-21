// ============================================================
// whatsapp_connections — TypeScript DTOs.
//
// Shape mirrors the `whatsapp_connections` table from
// supabase/migrations/024_whatsapp_connections.sql. Two views:
//   * `WhatsAppConnection` — DB row as stored. Encrypted tokens
//     are opaque ciphertext strings; the server-side route is
//     responsible for decrypting before any external HTTP call.
//   * `WhatsAppConnectionPublic` — what the UI gets back. Strips
//     the ciphertext and exposes only `has_access_token` /
//     `has_webhook_token` booleans. The plaintext never leaves
//     the server.
// ============================================================

export type WhatsAppConnectionProvider = 'meta' | 'uazapi'

export type WhatsAppConnectionStatus = 'pending' | 'connected' | 'failed'

/**
 * Raw DB row. Encrypted fields are NEVER returned to clients.
 * Use {@link toPublicConnection} when responding to API consumers.
 */
export interface WhatsAppConnection {
  id: string
  account_id: string
  provider: WhatsAppConnectionProvider
  label: string
  base_url: string
  access_token_enc: string
  webhook_token_enc: string | null
  status: WhatsAppConnectionStatus
  last_checked_at: string | null
  last_error: string | null
  is_active_for_crm: boolean
  created_at: string
  updated_at: string
}

/**
 * Wire format returned by the API. Hides ciphertext, exposes
 * a token-present boolean so the UI can show "••••••" placeholders
 * and a "edit" affordance without ever holding the plaintext.
 */
export interface WhatsAppConnectionPublic {
  id: string
  account_id: string
  provider: WhatsAppConnectionProvider
  label: string
  base_url: string
  has_access_token: boolean
  has_webhook_token: boolean
  status: WhatsAppConnectionStatus
  last_checked_at: string | null
  last_error: string | null
  is_active_for_crm: boolean
  created_at: string
  updated_at: string
}

/**
 * POST /api/accounts/[id]/whatsapp/connections body.
 *
 * `access_token` is REQUIRED on create. `webhook_token` is
 * OPTIONAL — leave blank to skip per-connection webhook auth
 * (useful for local UazAPI dev where the public webhook is
 * unreachable). `make_active` is only honoured when the new
 * connection becomes the unique CRM-active row.
 */
export interface CreateConnectionInput {
  label: string
  base_url: string
  access_token: string
  webhook_token?: string | null
  make_active?: boolean
}

/**
 * PATCH /api/accounts/[id]/whatsapp/connections/[connId] body.
 * All fields optional — only those present are updated.
 *
 * Note: setting `is_active_for_crm: true` automatically clears
 * the flag on any other connection in the same account (the
 * partial-unique-index invariant is upheld server-side, not by
 * the client).
 */
export interface UpdateConnectionInput {
  label?: string
  base_url?: string
  access_token?: string
  webhook_token?: string | null
  is_active_for_crm?: boolean
}

/**
 * Normalise a raw DB row to its public wire shape. Pure function —
 * no I/O, easy to unit-test next to the API route.
 */
export function toPublicConnection(row: WhatsAppConnection): WhatsAppConnectionPublic {
  return {
    id: row.id,
    account_id: row.account_id,
    provider: row.provider,
    label: row.label,
    base_url: row.base_url,
    has_access_token: !!row.access_token_enc,
    has_webhook_token: !!row.webhook_token_enc,
    status: row.status,
    last_checked_at: row.last_checked_at,
    last_error: row.last_error,
    is_active_for_crm: row.is_active_for_crm,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}