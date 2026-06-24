/**
 * The SDR inbound brain loop — Pedro answering live inside wacrm.
 *
 * Called from the WhatsApp webhook after an inbound customer message is
 * persisted, only when the conversation's ai_status is 'on'. Ports the
 * ns-crm evolution route's brain loop onto wacrm's tables. Any failure is
 * swallowed (logged) so the webhook still acks the provider — a thrown
 * error would invite retry storms.
 */
import { pedroFromEnv, type PedroSlot } from '@/lib/pkg/pedro/client'
import {
  agendarProtocol,
  buildContext,
  cadastroBlock,
  parseMarkers,
  slotLabel,
  splitBubbles,
} from './prompt'
import { sendText, resolveAccountProvider, setAccountPresence } from './send'
import { notifyArthur } from './notify'
import { SDR_PIPELINE_ID } from './ids'
import { substituteVariables, type CustomVariable } from './variables'
import { resolvePromptValues } from './variables-resolve'
import { moveDealFollowupToEmConversa } from './regua-exit'

const BUBBLE_DELAY_MS = Number(process.env.BUBBLE_DELAY_MS ?? 1500)
const BRAIN_DEBOUNCE_MS = Number(process.env.BRAIN_DEBOUNCE_MS ?? 2500)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export interface SdrContact {
  id: string
  name: string | null
  company: string | null
  email: string | null
  phone: string
  provider: 'uazapi' | 'meta' | null
  connection_id: string | null
}

/**
 * Whether a freshly-created conversation should start on autopilot: only when
 * the contact has an open deal in the SDR pipeline (i.e. a FAP01 lead). Keeps
 * Pedro off the human Meta inbox. Returns 'on' | 'off' for the insert.
 */
export async function initialAiStatus(
  admin: Admin,
  accountId: string,
  contactId: string,
): Promise<'on' | 'off'> {
  const { data } = await admin
    .from('deals')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('pipeline_id', SDR_PIPELINE_ID)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle()
  return data ? 'on' : 'off'
}

export async function runSdrReply(args: {
  admin: Admin
  accountId: string
  conversationId: string
  contact: SdrContact
  inboundMessageId: string | null
}): Promise<void> {
  const { admin, accountId, conversationId, contact } = args

  try {
    // Gate (re-checked under the loop — the conversation may have flipped to
    // 'human'/'off' between the webhook's read and here).
    const { data: conv } = await admin
      .from('conversations')
      .select('ai_status')
      .eq('id', conversationId)
      .maybeSingle()
    if (conv?.ai_status !== 'on') return

    // Debounce rapid bubbles: wait, then bail if a newer inbound arrived — the
    // invocation for that last message answers, seeing the full burst.
    if (BRAIN_DEBOUNCE_MS > 0) {
      await new Promise((r) => setTimeout(r, BRAIN_DEBOUNCE_MS))
      const { data: latest } = await admin
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latest?.id && args.inboundMessageId && latest.id !== args.inboundMessageId) return
    }

    // If the lead is replying mid-régua (deal was in Follow-up pipeline), move
    // it back to Pré-Vendas (SDR) / Em Conversa. Fire-and-forget; never blocks.
    moveDealFollowupToEmConversa(admin, accountId, contact.id).catch((err) =>
      console.error('[sdr] follow-up exit move failed:', err),
    )

    // System prompt (standalone, per account).
    const { data: cfg } = await admin
      .from('sdr_config')
      .select('system_prompt, variables')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!cfg?.system_prompt) {
      console.error('[sdr] no sdr_config.system_prompt for account', accountId)
      return
    }

    // Substitute {{variables}} for this lead. No-op (and no extra queries) when
    // the prompt has no tokens → the prompt is byte-identical to as authored.
    const varValues = await resolvePromptValues(
      admin,
      accountId,
      cfg.system_prompt,
      (cfg.variables ?? []) as CustomVariable[],
      contact,
    )
    const basePrompt =
      Object.keys(varValues).length > 0
        ? substituteVariables(cfg.system_prompt, varValues)
        : cfg.system_prompt

    // Conversation context (last 20, chronological).
    const { data: rawDesc } = await admin
      .from('messages')
      .select('sender_type, content_text, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(20)
    const context = buildContext(((rawDesc ?? []) as { sender_type: string; content_text: string | null }[]).reverse())
    if (context.length === 0) return

    // Real slots + FAP01 qualification note → full system prompt.
    const pedro = pedroFromEnv()
    let slots: PedroSlot[] | null = null
    try {
      slots = (await pedro.calendarSlots()).slots
    } catch (e) {
      console.error('[sdr] calendar slots fetch failed — degrading protocol', e)
    }

    const { data: note } = await admin
      .from('contact_notes')
      .select('note_text')
      .eq('contact_id', contact.id)
      .ilike('note_text', 'Qualificação FAP01%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const fullSystem =
      basePrompt +
      cadastroBlock(
        { name: contact.name, company: contact.company, email: contact.email },
        note?.note_text ?? null,
      ) +
      agendarProtocol(slots)

    // Call the brain.
    const { text } = await pedro.reply(fullSystem, context)
    const { cleanText, agendarSlot, humano } = parseMarkers(text, slots)

    const outText = cleanText

    // [HUMANO] — hand off: lock the AI and ping Arthur.
    if (humano) {
      try {
        await admin.from('conversations').update({ ai_status: 'human' }).eq('id', conversationId)
      } catch (e) {
        console.error('[sdr] setAiStatus human failed', e)
      }
      await notifyArthur(
        admin,
        accountId,
        `🙋 Ian passou ${contact.name ?? `+${contact.phone}`} pra você (precisa de humano · +${contact.phone}).`,
      )
    }

    // [AGENDAR] — book the diagnosis (slot already gated against this turn's list).
    let meetLink = ''
    if (agendarSlot) {
      const { data: deal } = await admin
        .from('deals')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const dealId = (deal as { id: string } | null)?.id ?? null

      let bookNote = 'Google falhou — criar evento manual.'
      try {
        const booked = await pedro.calendarBook({
          start_iso: agendarSlot.start_iso,
          end_iso: agendarSlot.end_iso,
          phone: contact.phone,
          lead_name: contact.name,
        })
        if (booked.synthetic) {
          console.error('[sdr] calendar book degraded to synthetic', booked.event_id)
        } else {
          meetLink = booked.meet_link
          bookNote = `Google event ${booked.event_id} · ${booked.meet_link}`
        }
      } catch (e) {
        console.error('[sdr] calendar book failed', e)
      }

      await admin.from('appointments').insert({
        account_id: accountId,
        deal_id: dealId,
        contact_id: contact.id,
        scheduled_at: agendarSlot.start_iso,
        notes: `Agendado pelo SDR (IA) via WhatsApp. ${bookNote}`,
      })
      await notifyArthur(
        admin,
        accountId,
        `📅 ${contact.name ?? `+${contact.phone}`} agendou o diagnóstico: ${slotLabel(agendarSlot.start_iso)} (+${contact.phone}).`,
      )
    }

    // Send + persist (split into bubbles; Meet link as its own final bubble).
    const bubbles = splitBubbles(outText, meetLink)
    if (bubbles.length === 0) {
      console.error('[sdr] agent reply was marker-only', conversationId)
      return
    }

    // Send via the account's ACTIVE connection (not the contact's stored
    // provider): a FAP01-migrated lead is stamped provider='meta' but the
    // account may only have a UazAPI channel. Mirrors the C2 touch path.
    const provider = await resolveAccountProvider(admin, accountId)
    // Appear "online" only while actually responding (human-like): mark
    // available before the bubbles, back to unavailable after.
    if (provider === 'uazapi') await setAccountPresence(admin, accountId, true)
    try {
      for (let i = 0; i < bubbles.length; i++) {
        await sendText(
          admin,
          accountId,
          { provider, phone: contact.phone, connectionId: contact.connection_id },
          bubbles[i],
        )
        if (i < bubbles.length - 1) await new Promise((r) => setTimeout(r, BUBBLE_DELAY_MS))
      }
    } finally {
      if (provider === 'uazapi') await setAccountPresence(admin, accountId, false)
    }

    const fullText = bubbles.join('\n\n')
    await admin.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'text',
      content_text: fullText,
      status: 'sent',
      provider,
    })
    await admin
      .from('conversations')
      .update({
        last_message_text: fullText,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
  } catch (e) {
    console.error('[sdr] brain loop failed', { conversationId, phone: contact.phone }, e)
  }
}
