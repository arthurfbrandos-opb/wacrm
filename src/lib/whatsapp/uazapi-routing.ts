import { decrypt } from './encryption'

/**
 * Tenancy resolution for inbound UazAPI webhooks.
 *
 * Meta routes an inbound message to an account via `phone_number_id` →
 * `whatsapp_config`. UazAPI has no such mapping, so we use the webhook
 * token as the tenant key instead:
 *
 *   - Each `whatsapp_connections` row stores its own `webhook_token_enc`
 *     (the value the operator put in the instance's webhook `?token=`).
 *     A request whose `?token=` decrypts-matches a connection is both
 *     AUTHENTICATED and ROUTED to that connection's account.
 *   - Back-compat: when the request uses the global `UAZAPI_WEBHOOK_TOKEN`
 *     env (the smoke-test setup) and the account has exactly ONE active
 *     connection, route to it. Ambiguous (0 or >1 active) → no route.
 *
 * The owner user id (needed for NOT NULL audit columns on inserts) comes
 * from `accounts.owner_user_id`.
 *
 * Returns null when the token matches nothing — the caller then falls
 * back to the global-env auth check and, failing that, rejects.
 */
export interface UazapiRoute {
  accountId: string
  connectionId: string
  ownerUserId: string
}

interface ConnectionRow {
  id: string
  account_id: string
  webhook_token_enc: string | null
  is_active_for_crm: boolean
}

// Minimal shape of the supabase service-role client we depend on. Kept
// loose because the project has no generated Database types.
interface AdminClient {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => { maybeSingle: () => Promise<{ data: { owner_user_id?: string } | null }> }
    } & Promise<{ data: ConnectionRow[] | null }>
  }
}

export async function resolveUazapiRoute(
  admin: AdminClient,
  queryToken: string | null,
): Promise<UazapiRoute | null> {
  if (!queryToken) return null

  const { data: conns } = await admin
    .from('whatsapp_connections')
    .select('id, account_id, webhook_token_enc, is_active_for_crm')

  if (!conns || conns.length === 0) return null

  // 1. Per-connection webhook token (the real multi-tenant key).
  let match: ConnectionRow | undefined = conns.find((c) => {
    if (!c.webhook_token_enc) return false
    try {
      return decrypt(c.webhook_token_enc) === queryToken
    } catch {
      return false
    }
  })

  // 2. Global env token → single active connection (unambiguous only).
  if (!match && queryToken === process.env.UAZAPI_WEBHOOK_TOKEN) {
    const active = conns.filter((c) => c.is_active_for_crm)
    if (active.length === 1) match = active[0]
  }

  if (!match) return null

  const { data: account } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', match.account_id)
    .maybeSingle()

  if (!account?.owner_user_id) return null

  return {
    accountId: match.account_id,
    connectionId: match.id,
    ownerUserId: account.owner_user_id,
  }
}
