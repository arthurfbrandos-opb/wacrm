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
import { sendText, sendTemplate, resolveAccountProvider, setAccountPresence, accountHasMetaConfig } from './send'
import { FAP01_TEMPLATES, FAP01_TEMPLATE_LANG, renderAgendou, renderNaoAgendou } from './meta-templates'
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
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { ensureTag } from './ensure-tag'
import { pickFap01Provider } from './fap01-source'

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

async function persistAgentMessage(
  admin: Admin, conversationId: string, text: string, provider: 'meta' | 'uazapi', contentType: 'text' | 'template',
): Promise<void> {
  await admin.from('messages').insert({
    conversation_id: conversationId, sender_type: 'agent',
    content_type: contentType, content_text: text, status: 'sent', provider,
  })
  await admin.from('conversations').update({
    last_message_text: text, last_message_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', conversationId)
}

/**
 * 1º contato do FAP01. Respeita sdr_config.fap01_source com fallback automático
 * pro outro canal. Carimba contacts.provider/connection_id com o canal usado.
 */
async function sendFirstContact(
  admin: Admin, accountId: string,
  opts: { contactId: string; conversationId: string; phone: string; name: string; agendou: boolean; eventStartIso?: string },
): Promise<void> {
  // Origem principal + disponibilidade
  const { data: cfg } = await admin
    .from('sdr_config').select('fap01_source').eq('account_id', accountId).maybeSingle()
  const source = (cfg?.fap01_source ?? 'meta') as 'meta' | 'uazapi'

  const metaAvail = await accountHasMetaConfig(admin, accountId)
  const { data: uaz } = await admin
    .from('wa_connections').select('id').eq('account_id', accountId).eq('is_active_for_crm', true).maybeSingle()
  const uazAvail = !!uaz

  const chosen = pickFap01Provider(source, { meta: metaAvail, uaz: uazAvail })
  if (!chosen) throw new Error('FAP01: nenhum canal disponível') // fica pending, retry no próximo tick

  if (chosen !== source) {
    console.warn('[sdr] FAP01 fallback de canal', { accountId, source, chosen })
  }

  if (chosen === 'meta') {
    const firstName = (opts.name || '').trim().split(/\s+/)[0] || opts.name || ''
    const templateName = opts.agendou ? FAP01_TEMPLATES.agendou : FAP01_TEMPLATES.naoAgendou
    await sendTemplate(admin, accountId, {
      phone: opts.phone, templateName, languageCode: FAP01_TEMPLATE_LANG, bodyParams: [firstName],
    })
    const text = opts.agendou ? renderAgendou(firstName) : renderNaoAgendou(firstName)
    await persistAgentMessage(admin, opts.conversationId, text, 'meta', 'template')
    await stampContactChannel(admin, opts.contactId, 'meta', null)
    return
  }

  // UazAPI: bubbles; se falhar duro (ex: 463) e Meta disponível, cai pro Meta no mesmo tick.
  try {
    const bubbles = opts.agendou ? confirmBubbles(opts.name, opts.eventStartIso!) : chaseBubbles(opts.name)
    await sendAndPersist(admin, accountId, 'uazapi', opts.conversationId, opts.phone, bubbles)
    await stampContactChannel(admin, opts.contactId, 'uazapi', uaz!.id)
  } catch (err) {
    if (!metaAvail) throw err
    console.warn('[sdr] FAP01 UazAPI falhou, fallback Meta no mesmo tick', { accountId }, err)
    const firstName = (opts.name || '').trim().split(/\s+/)[0] || opts.name || ''
    const templateName = opts.agendou ? FAP01_TEMPLATES.agendou : FAP01_TEMPLATES.naoAgendou
    await sendTemplate(admin, accountId, {
      phone: opts.phone, templateName, languageCode: FAP01_TEMPLATE_LANG, bodyParams: [firstName],
    })
    await persistAgentMessage(admin, opts.conversationId,
      opts.agendou ? renderAgendou(firstName) : renderNaoAgendou(firstName), 'meta', 'template')
    await stampContactChannel(admin, opts.contactId, 'meta', null)
  }
}

/** Carimba o canal de fato usado no contato, p/ IA e humano seguirem depois. */
async function stampContactChannel(
  admin: Admin, contactId: string, provider: 'meta' | 'uazapi', connectionId: string | null,
): Promise<void> {
  await admin.from('contacts')
    .update({ provider, connection_id: connectionId, updated_at: new Date().toISOString() })
    .eq('id', contactId)
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
      await sendFirstContact(admin, accountId, { contactId: t.contact_id, conversationId: t.conversation_id, phone: t.phone, name, agendou: true, eventStartIso: ev.start_iso })
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

    await sendFirstContact(admin, accountId, { contactId: t.contact_id, conversationId: t.conversation_id, phone: t.phone, name, agendou: false })
    await moveDealToStage(admin, t.deal_id, 'primeiro_contato')
    // Engate FU1: marca o contato e dispara a régua (gatilho tag_added).
    // conversation_id no contexto se propaga pelos waits → toques no inbox.
    try {
      const { data: acct } = await admin
        .from('accounts')
        .select('owner_user_id')
        .eq('id', accountId)
        .maybeSingle()
      const userId = (acct as { owner_user_id?: string } | null)?.owner_user_id
      if (!userId) throw new Error('no owner_user_id for account')
      const fu1TagId = await ensureTag(admin, accountId, userId, 'fu1')
      await admin
        .from('contact_tags')
        .upsert({ contact_id: t.contact_id, tag_id: fu1TagId }, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true })
      runAutomationsForTrigger({
        accountId,
        triggerType: 'tag_added',
        contactId: t.contact_id,
        context: { tag_id: fu1TagId, conversation_id: t.conversation_id },
      }).catch((err) => console.error('[sdr] fu1 trigger failed:', err))
    } catch (err) {
      console.error('[sdr] fu1 engate failed:', err)
    }
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
