/**
 * SDR follow-up queue processor (Phase C2). Drains due touches for one
 * account: first_touch (confirm a booked diagnosis, else chase to book)
 * and 24h / 2h reminders. Hit by the cron route on a ~1min tick.
 *
 * Ported from ns-crm src/lib/domains/sdr/processor.ts. Differences:
 *   - account-scoped (wacrm is multi-tenant);
 *   - sends via the account's ACTIVE connection (resolveAccountProvider),
 *     not the contact's stored provider — the lead hasn't written on any
 *     channel yet, so there's nothing to key off;
 *   - real `sdr_touches` table instead of a crm_kv blob.
 */
import { pedroFromEnv } from '@/lib/pkg/pedro/client'
import { sendText, resolveAccountProvider, setAccountPresence } from './send'
import {
  listDueTouches,
  resolveTouch,
  scheduleReminder,
  conversationHasMessages,
  moveDealToStage,
  accountHasChannel,
  type SdrTouchRow,
} from './touches'
import { chaseBubbles, confirmBubbles, reminder24hBubbles, reminder2hBubbles } from './templates'

const BUBBLE_DELAY_MS = Number(process.env.BUBBLE_DELAY_MS ?? 1500)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

// Single-instance deploy (Docker standalone) ⇒ a module flag is enough to
// stop overlapping cron ticks from double-sending.
let running = false

/** Send each bubble on the account's active channel, then persist one
 *  agent message + bump the conversation. Mirrors the C1 brain loop. */
async function sendAndPersist(
  admin: Admin,
  accountId: string,
  provider: 'uazapi' | 'meta',
  conversationId: string,
  phone: string,
  bubbles: string[],
): Promise<void> {
  // Online only while responding (human-like).
  if (provider === 'uazapi') await setAccountPresence(admin, accountId, true)
  try {
    for (let i = 0; i < bubbles.length; i++) {
      await sendText(admin, accountId, { provider, phone }, bubbles[i])
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
}

export async function processDueTouches(
  admin: Admin,
  accountId: string,
): Promise<{ processed: number; results: Array<Record<string, string>> }> {
  if (running) return { processed: 0, results: [{ skipped: 'tick-overlap' }] }
  running = true
  try {
    // No sendable channel yet (e.g. FAP01 repointed but no number connected) →
    // leave touches pending instead of hammering calendarFind + failing the send
    // every tick. They flush on the first tick after a number is connected.
    if (!(await accountHasChannel(admin, accountId))) {
      return { processed: 0, results: [{ skipped: 'no-channel' }] }
    }
    const due = await listDueTouches(admin, accountId, new Date().toISOString())
    const results: Array<Record<string, string>> = []
    for (const t of due) {
      try {
        const r = await processOne(admin, accountId, t)
        if (r) results.push({ id: t.id, type: t.type, resolution: r })
      } catch (e) {
        // Stays pending — natural retry on the next tick.
        console.error('[sdr] touch failed (will retry)', { id: t.id, type: t.type }, e)
      }
    }
    return { processed: results.length, results }
  } finally {
    running = false
  }
}

async function processOne(admin: Admin, accountId: string, t: SdrTouchRow): Promise<string | null> {
  // Gate: only autopilot conversations get touched.
  const { data: conv } = await admin
    .from('conversations')
    .select('ai_status')
    .eq('id', t.conversation_id)
    .maybeSingle()
  if (conv?.ai_status !== 'on') {
    await resolveTouch(admin, t.id, 'skipped', 'ai_off')
    return 'ai_off'
  }

  const { data: contact } = await admin
    .from('contacts')
    .select('name')
    .eq('id', t.contact_id)
    .maybeSingle()
  const name = (contact as { name?: string } | null)?.name ?? ''

  const provider = await resolveAccountProvider(admin, accountId)
  const pedro = pedroFromEnv()

  if (t.type === 'first_touch') {
    if (await conversationHasMessages(admin, t.conversation_id)) {
      await resolveTouch(admin, t.id, 'skipped', 'already_talking')
      return 'already_talking'
    }
    // /v6/calendar/find: events orderBy=startTime asc ⇒ [0] = nearest.
    const { events } = await pedro.calendarFind(t.email) // throws ⇒ pending/retry
    const ev = events[0] ?? null

    if (ev) {
      const bubbles = confirmBubbles(name, ev.start_iso)
      await sendAndPersist(admin, accountId, provider, t.conversation_id, t.phone, bubbles)
      // A write failure below re-runs as already_talking next tick (losing the
      // appointment/stage/reminders) — accepted for now; the monitor covers it.
      await moveDealToStage(admin, t.deal_id, 'agendamento_realizado')
      await admin.from('appointments').insert({
        account_id: accountId,
        deal_id: t.deal_id,
        contact_id: t.contact_id,
        scheduled_at: ev.start_iso,
        notes: `Agendado pelo lead no Calendly. ${ev.meet_link ? `Meet ${ev.meet_link}` : 'Sem link de Meet no evento.'}`,
      })
      const start = new Date(ev.start_iso).getTime()
      const reminders: Array<{ type: 'reminder_24h' | 'reminder_2h'; at: number }> = [
        { type: 'reminder_24h', at: start - 24 * 3600_000 },
        { type: 'reminder_2h', at: start - 2 * 3600_000 },
      ]
      for (const r of reminders) {
        if (r.at <= Date.now()) continue // window already passed ⇒ don't create
        await scheduleReminder(admin, {
          accountId,
          type: r.type,
          contactId: t.contact_id,
          dealId: t.deal_id,
          conversationId: t.conversation_id,
          phone: t.phone,
          email: t.email,
          dueAt: new Date(r.at).toISOString(),
          eventStartIso: ev.start_iso,
          meetLink: ev.meet_link ?? '',
        })
      }
      await resolveTouch(admin, t.id, 'done', 'confirm')
      return 'confirm'
    }

    const bubbles = chaseBubbles(name)
    await sendAndPersist(admin, accountId, provider, t.conversation_id, t.phone, bubbles)
    await moveDealToStage(admin, t.deal_id, 'primeiro_contato')
    await resolveTouch(admin, t.id, 'done', 'chase')
    return 'chase'
  }

  // Reminders: re-check the event still exists (cancel/reschedule ⇒ silence).
  const { events } = await pedro.calendarFind(t.email)
  const stillThere = events.some((e) => e.start_iso === t.event_start_iso)
  if (!stillThere) {
    await resolveTouch(admin, t.id, 'skipped', 'event_gone')
    return 'event_gone'
  }
  const bubbles =
    t.type === 'reminder_24h'
      ? reminder24hBubbles(name, t.event_start_iso!)
      : reminder2hBubbles(name, t.event_start_iso!, t.meet_link ?? '')
  // Resolve BEFORE sending: a write failure after the send would re-spam the
  // lead every tick. A lost reminder is benign (Calendly emails its own).
  await resolveTouch(admin, t.id, 'done', 'sent')
  await sendAndPersist(admin, accountId, provider, t.conversation_id, t.phone, bubbles)
  return 'sent'
}
