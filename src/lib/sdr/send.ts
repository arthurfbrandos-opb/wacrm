/**
 * Server-side outbound text for the SDR loop. The user-facing send route
 * (`/api/whatsapp/send`) runs under a user session; the brain loop runs from
 * the webhook with no session, so it sends via the service-role admin client.
 * Routes to the contact's channel: UazAPI instance or Meta Cloud API.
 */
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendUazapiText, sendUazapiComposing, setUazapiPresence } from '@/lib/whatsapp/uazapi-send'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
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
    let q = admin.from('wa_connections').select('*').eq('account_id', accountId)
    q = opts.connectionId ? q.eq('id', opts.connectionId) : q.eq('is_active_for_crm', true)
    const { data: conn } = await q.maybeSingle()
    if (!conn) throw new Error('no active UazAPI connection for account')
    const baseUrl = conn.base_url
    const token = decrypt(conn.access_token_enc)
    // "Digitando…" — on this uazapiGO build the typing indicator comes from
    // /message/presence (the /send/text delay does NOT show it). Emit composing
    // for a beat proportional to the text (≈35ms/char, floor 900ms, cap 4s),
    // wait it out so the lead sees typing, then send.
    const typingMs = Math.min(Math.max(text.length * 35, 900), 4000)
    await sendUazapiComposing({ baseUrl, token, number, delayMs: typingMs })
    await new Promise((r) => setTimeout(r, typingMs))
    return sendUazapiText({ baseUrl, token, number, text })
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
    .from('wa_connections')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_active_for_crm', true)
    .maybeSingle()
  return active ? 'uazapi' : 'meta'
}

/** True when the account has a Meta whatsapp_config row. */
export async function accountHasMetaConfig(admin: Admin, accountId: string): Promise<boolean> {
  const { data } = await admin
    .from('whatsapp_config').select('account_id').eq('account_id', accountId).limit(1).maybeSingle()
  return !!data
}

/**
 * Channel for an SDR REPLY (the lead has already written, so we know where).
 * Reply on the channel the lead is actually on (contact.provider) — honoring
 * 'meta' only when a Meta config exists (a FAP01 lead is stamped 'meta' even
 * on Meta-less accounts). Falls back to the account's active channel when the
 * contact has no stored provider.
 */
export async function resolveReplyProvider(
  admin: Admin,
  accountId: string,
  contact: { provider: 'uazapi' | 'meta' | null },
): Promise<'uazapi' | 'meta'> {
  if (contact.provider === 'uazapi') return 'uazapi'
  if (contact.provider === 'meta' && (await accountHasMetaConfig(admin, accountId))) return 'meta'
  return resolveAccountProvider(admin, accountId)
}

/**
 * Send a pre-approved Meta template (required outside the 24h window /
 * for first contact). Uses the account's whatsapp_config. Body variables
 * go in bodyParams (the {{1}}, {{2}}… of the template).
 */
export async function sendTemplate(
  admin: Admin,
  accountId: string,
  opts: { phone: string; templateName: string; languageCode: string; bodyParams: string[] },
): Promise<{ messageId: string | null }> {
  const number = sanitizePhoneForMeta(opts.phone)
  const { data: config } = await admin
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (!config) throw new Error('no whatsapp_config for account')
  const result = await sendTemplateMessage({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    to: number,
    templateName: opts.templateName,
    language: opts.languageCode,
    params: opts.bodyParams,
  })
  return { messageId: result.messageId }
}

/**
 * Set the account's active UazAPI instance online/offline (best-effort). Lets
 * the SDR appear "online" only while it's actually responding (set true before
 * the bubbles, false after). No-op when there's no active UazAPI connection
 * (e.g. Meta-only account) — Meta has no presence concept here.
 */
export async function setAccountPresence(
  admin: Admin,
  accountId: string,
  available: boolean,
): Promise<void> {
  const { data: conn } = await admin
    .from('wa_connections')
    .select('base_url, access_token_enc')
    .eq('account_id', accountId)
    .eq('is_active_for_crm', true)
    .maybeSingle()
  if (!conn) return
  await setUazapiPresence({ baseUrl: conn.base_url, token: decrypt(conn.access_token_enc), available })
}
