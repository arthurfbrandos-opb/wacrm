/**
 * SDR follow-up queue repository (Phase C2). Server-only — every call
 * runs under the service-role admin client (RLS bypassed). Ported from
 * ns-crm's crm_kv blob repo onto wacrm's real `sdr_touches` table, so
 * each op is a single row write instead of a read-modify-write array.
 */
import { SDR_STAGE_PRIMEIRO_CONTATO, SDR_STAGE_AGENDAMENTO_REALIZADO } from './ids'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export type SdrTouchType = 'first_touch' | 'reminder_24h' | 'reminder_2h'
export type SdrTouchStatus = 'pending' | 'done' | 'skipped'

export interface SdrTouchRow {
  id: string
  account_id: string
  type: SdrTouchType
  status: SdrTouchStatus
  contact_id: string
  deal_id: string | null
  conversation_id: string
  phone: string
  email: string
  due_at: string
  event_start_iso: string | null
  meet_link: string | null
  resolution: string | null
}

const TOUCH_COLS =
  'id, account_id, type, status, contact_id, deal_id, conversation_id, phone, email, due_at, event_start_iso, meet_link'

/** Pending touches whose due_at has passed, oldest first. */
export async function listDueTouches(
  admin: Admin,
  accountId: string,
  nowIso: string,
): Promise<SdrTouchRow[]> {
  const { data, error } = await admin
    .from('sdr_touches')
    .select(TOUCH_COLS)
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .lte('due_at', nowIso)
    .order('due_at', { ascending: true })
  if (error) throw new Error(`sdr/listDueTouches: ${error.message}`)
  return (data ?? []) as SdrTouchRow[]
}

/**
 * Enqueue a first_touch unless one is already pending for this contact.
 * Idempotency is enforced by the partial unique index
 * (idx_sdr_touches_one_pending_first); a duplicate insert raises 23505,
 * which we swallow. Cold→warm FAP01 re-posts therefore don't double-send.
 */
export async function scheduleFirstTouchIfAbsent(
  admin: Admin,
  input: {
    accountId: string
    contactId: string
    dealId: string | null
    conversationId: string
    phone: string
    email: string
    dueAt: string
  },
): Promise<void> {
  const { error } = await admin.from('sdr_touches').insert({
    account_id: input.accountId,
    type: 'first_touch',
    status: 'pending',
    contact_id: input.contactId,
    deal_id: input.dealId,
    conversation_id: input.conversationId,
    phone: input.phone,
    email: input.email,
    due_at: input.dueAt,
  })
  // 23505 = unique_violation → a pending first_touch already exists. Benign.
  if (error && error.code !== '23505') {
    throw new Error(`sdr/scheduleFirstTouchIfAbsent: ${error.message}`)
  }
}

export async function scheduleReminder(
  admin: Admin,
  input: {
    accountId: string
    type: 'reminder_24h' | 'reminder_2h'
    contactId: string
    dealId: string | null
    conversationId: string
    phone: string
    email: string
    dueAt: string
    eventStartIso: string
    meetLink: string
  },
): Promise<void> {
  const { error } = await admin.from('sdr_touches').insert({
    account_id: input.accountId,
    type: input.type,
    status: 'pending',
    contact_id: input.contactId,
    deal_id: input.dealId,
    conversation_id: input.conversationId,
    phone: input.phone,
    email: input.email,
    due_at: input.dueAt,
    event_start_iso: input.eventStartIso,
    meet_link: input.meetLink,
  })
  if (error) throw new Error(`sdr/scheduleReminder: ${error.message}`)
}

/**
 * Bring a pending first_touch forward to "now" when the lead self-books on
 * Calendly (the schedule_confirmed beacon) — the confirmation goes out on the
 * next tick instead of waiting the 5min. Matches by email or digits-only
 * phone. No-op (returns false) if there's no pending first_touch; benign if it
 * has already come due (the cron handles it either way).
 */
export async function expediteFirstTouch(
  admin: Admin,
  accountId: string,
  match: { email?: string | null; phone?: string | null },
): Promise<boolean> {
  const phone = (match.phone ?? '').replace(/\D/g, '')
  const email = (match.email ?? '').trim().toLowerCase()
  if (!phone && !email) return false

  const { data, error } = await admin
    .from('sdr_touches')
    .select('id, due_at, email, phone')
    .eq('account_id', accountId)
    .eq('type', 'first_touch')
    .eq('status', 'pending')
  if (error) throw new Error(`sdr/expediteFirstTouch: ${error.message}`)

  const rows = (data ?? []) as { id: string; due_at: string; email: string; phone: string }[]
  const t = rows.find(
    (r) =>
      (email && (r.email ?? '').toLowerCase() === email) ||
      (phone && (r.phone ?? '').replace(/\D/g, '') === phone),
  )
  if (!t) return false
  if (new Date(t.due_at).getTime() <= Date.now()) return true // already due — cron has it

  const { error: uErr } = await admin
    .from('sdr_touches')
    .update({ due_at: new Date().toISOString() })
    .eq('id', t.id)
  if (uErr) throw new Error(`sdr/expediteFirstTouch/update: ${uErr.message}`)
  return true
}

export async function resolveTouch(
  admin: Admin,
  id: string,
  status: 'done' | 'skipped',
  resolution: string,
): Promise<void> {
  const { error } = await admin
    .from('sdr_touches')
    .update({ status, resolution })
    .eq('id', id)
  if (error) throw new Error(`sdr/resolveTouch: ${error.message}`)
}

/**
 * Ensure an autopilot conversation exists for this contact (outbound-first:
 * Pedro reaches out before the lead writes). Conversations are keyed by
 * (account_id, contact_id) in wacrm — no connection binding. A human who
 * already took over (ai_status='human') is respected.
 */
export async function ensureConversationOn(
  admin: Admin,
  input: { accountId: string; userId: string; contactId: string },
): Promise<string> {
  const { data: existing, error: sErr } = await admin
    .from('conversations')
    .select('id, ai_status')
    .eq('account_id', input.accountId)
    .eq('contact_id', input.contactId)
    .maybeSingle()
  if (sErr) throw new Error(`sdr/ensureConversationOn/select: ${sErr.message}`)

  if (existing) {
    if (existing.ai_status !== 'human' && existing.ai_status !== 'on') {
      const { error } = await admin
        .from('conversations')
        .update({ ai_status: 'on' })
        .eq('id', existing.id)
      if (error) throw new Error(`sdr/ensureConversationOn/update: ${error.message}`)
    }
    return existing.id
  }

  const { data: inserted, error: iErr } = await admin
    .from('conversations')
    .insert({
      account_id: input.accountId,
      user_id: input.userId,
      contact_id: input.contactId,
      ai_status: 'on',
    })
    .select('id')
    .single()
  if (iErr) throw new Error(`sdr/ensureConversationOn/insert: ${iErr.message}`)
  return (inserted as { id: string }).id
}

export async function conversationHasMessages(
  admin: Admin,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .limit(1)
  if (error) throw new Error(`sdr/conversationHasMessages: ${error.message}`)
  return (data ?? []).length > 0
}

const STAGE_ID: Record<'primeiro_contato' | 'agendamento_realizado', string> = {
  primeiro_contato: SDR_STAGE_PRIMEIRO_CONTATO,
  agendamento_realizado: SDR_STAGE_AGENDAMENTO_REALIZADO,
}

export async function moveDealToStage(
  admin: Admin,
  dealId: string | null,
  stage: 'primeiro_contato' | 'agendamento_realizado',
): Promise<void> {
  if (!dealId) return
  const { error } = await admin
    .from('deals')
    .update({ stage_id: STAGE_ID[stage] })
    .eq('id', dealId)
  if (error) throw new Error(`sdr/moveDealToStage: ${error.message}`)
}
