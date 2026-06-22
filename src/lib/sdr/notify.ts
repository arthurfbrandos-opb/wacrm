/** Heads-up to Arthur on WhatsApp (gated conversation, handoff, booking). */
import { sendText, resolveAccountProvider } from './send'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

/**
 * Best-effort — a notify failure must never break the brain loop. No-op when
 * ARTHUR_WHATSAPP isn't set. Sends through the account's outbound channel
 * (active UazAPI connection, else Meta).
 */
export async function notifyArthur(admin: Admin, accountId: string, text: string): Promise<void> {
  const number = process.env.ARTHUR_WHATSAPP
  if (!number) return
  try {
    const provider = await resolveAccountProvider(admin, accountId)
    await sendText(admin, accountId, { provider, phone: number }, text)
  } catch (e) {
    console.error('[sdr] notifyArthur failed', e)
  }
}
