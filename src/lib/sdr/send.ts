/**
 * Server-side outbound text for the SDR loop. The user-facing send route
 * (`/api/whatsapp/send`) runs under a user session; the brain loop runs from
 * the webhook with no session, so it sends via the service-role admin client.
 * Routes to the contact's channel: UazAPI instance or Meta Cloud API.
 */
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendUazapiText } from '@/lib/whatsapp/uazapi-send'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

/**
 * Send one text to `phone` on the given provider for this account.
 * Returns the provider message id (or null). Throws on hard send failure
 * so the caller can log + bail.
 */
export async function sendText(
  admin: Admin,
  accountId: string,
  opts: { provider: 'uazapi' | 'meta'; phone: string; connectionId?: string | null },
  text: string,
): Promise<{ messageId: string | null }> {
  const number = sanitizePhoneForMeta(opts.phone)

  if (opts.provider === 'uazapi') {
    // The connection bound to the contact, else the account's active one.
    let q = admin.from('whatsapp_connections').select('*').eq('account_id', accountId)
    q = opts.connectionId ? q.eq('id', opts.connectionId) : q.eq('is_active_for_crm', true)
    const { data: conn } = await q.maybeSingle()
    if (!conn) throw new Error('no active UazAPI connection for account')
    return sendUazapiText({
      baseUrl: conn.base_url,
      token: decrypt(conn.access_token_enc),
      number,
      text,
    })
  }

  const { data: config } = await admin
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (!config) throw new Error('no whatsapp_config for account')
  const result = await sendTextMessage({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    to: number,
    text,
  })
  return { messageId: result.messageId }
}

/**
 * Pick the account's outbound provider when there's no contact to key off
 * (e.g. notifying Arthur). Prefers an active UazAPI connection, else Meta.
 */
export async function resolveAccountProvider(
  admin: Admin,
  accountId: string,
): Promise<'uazapi' | 'meta'> {
  const { data: active } = await admin
    .from('whatsapp_connections')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_active_for_crm', true)
    .maybeSingle()
  return active ? 'uazapi' : 'meta'
}
