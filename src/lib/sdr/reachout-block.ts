/**
 * Surface a WhatsApp "reachout-timelock" (463) block in the CRM. Fired when a
 * cold/first-contact send is barred because the number isn't warmed enough to
 * OPEN a new conversation. Makes the failure LOUD instead of dying in the logs:
 * a contact note (visible in the contact panel), a handoff to human (the
 * conversation surfaces in the inbox needing attention), and a WhatsApp ping to
 * Arthur so the first contact can be done manually / via Meta official.
 *
 * Best-effort end to end — this runs inside an error path; a failure here must
 * never re-throw and mask the original send error.
 */
import { notifyArthur } from './notify'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export async function handleReachoutBlock(
  admin: Admin,
  opts: {
    accountId: string
    contactId: string
    phone: string
    name?: string | null
    conversationId?: string | null
  },
): Promise<void> {
  const who = opts.name?.trim() || `+${opts.phone}`

  // Contact note (needs the account owner as user_id — RLS/owner pattern).
  try {
    const { data: account } = await admin
      .from('accounts')
      .select('owner_user_id')
      .eq('id', opts.accountId)
      .maybeSingle()
    const ownerUserId = (account as { owner_user_id?: string } | null)?.owner_user_id
    if (ownerUserId) {
      await admin.from('contact_notes').insert({
        contact_id: opts.contactId,
        account_id: opts.accountId,
        user_id: ownerUserId,
        note_text:
          '⚠️ WhatsApp bloqueou abrir conversa nova com este lead (erro 463 · reachout-timelock — número ainda não aquecido). ' +
          'O 1º contato precisa ser feito manualmente ou pelo WhatsApp oficial (Meta). Os follow-ups em conversa já aberta seguem normais.',
      })
    }
  } catch (e) {
    console.error('[sdr] reachout-block note failed (ignored)', e)
  }

  // Hand off to a human so the conversation surfaces in the inbox.
  if (opts.conversationId) {
    try {
      await admin.from('conversations').update({ ai_status: 'human' }).eq('id', opts.conversationId)
    } catch (e) {
      console.error('[sdr] reachout-block human flip failed (ignored)', e)
    }
  }

  // Ping Arthur (best-effort; notifyArthur already swallows its own errors).
  await notifyArthur(
    admin,
    opts.accountId,
    `🚫 Não consegui abrir conversa com ${who} — WhatsApp bloqueou (463 · número não aquecido). ` +
      `Faça o 1º contato na mão ou pelo WhatsApp oficial.`,
  )
}
