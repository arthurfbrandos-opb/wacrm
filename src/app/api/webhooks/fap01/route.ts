import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { findExistingContact } from '@/lib/contacts/dedupe'
import {
  ensureConversationOn,
  scheduleFirstTouchIfAbsent,
  expediteFirstTouch,
} from '@/lib/sdr/touches'

// Arthur's decision (2026-06-11): chase/confirm the lead 5 min after the form,
// leaving room to self-book on Calendly first.
const FIRST_TOUCH_DELAY_MS = 5 * 60_000

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * FAP01 lead intake — the qualification funnel posts a qualified lead
 * here. Ports the ns-crm endpoint to wacrm's real tables:
 *   - upsert a contact (dedup by phone),
 *   - drop it into the SDR pipeline as an MQL deal (unless the lead
 *     explicitly failed the low-tier gate),
 *   - attach the FAP01 qualification as a note.
 *
 * Auth: shared secret in `X-Webhook-Secret` (or `?secret=`), matching
 * FAP01_WEBHOOK_SECRET. The target tenant is FAP01_ACCOUNT_ID (the
 * funnel is single-account); the owner user comes from the account.
 *
 * Pipeline/stage ids are the deterministic md5→uuid values the
 * migration used, so new leads land in the same "Pré-Vendas (SDR)"
 * pipeline at "Primeiro Contato".
 */
interface Fap01Lead {
  contact_name?: string
  contact_email?: string
  contact_whatsapp?: string
  company_name?: string
  faturamento_range?: string
  tem_socio?: boolean
  nicho?: string
  processo_foco?: string
  urgencia?: number
  passed_lowtier_gate?: boolean
}

const SDR_PIPELINE = 'pipeline-pre-vendas-sdr'
const SDR_ENTRY_STAGE = 'primeiro-contato'

// Mirror Postgres `md5(text)::uuid`: 32 hex chars laid out as a uuid.
function detUuid(seed: string): string {
  const h = createHash('md5').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const provided = request.headers.get('x-webhook-secret') || url.searchParams.get('secret')
  const expected = process.env.FAP01_WEBHOOK_SECRET
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accountId = process.env.FAP01_ACCOUNT_ID
  if (!accountId) {
    console.error('[fap01] FAP01_ACCOUNT_ID not set')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  // The n8n funnel posts an envelope, not a bare lead:
  //   lead_created       → { event_type, source, lead: {...} }
  //   schedule_confirmed → { event_type, email, phone }  (Calendly beacon)
  let body: { event_type?: string; lead?: Fap01Lead; email?: string; phone?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // schedule_confirmed: the lead self-booked on Calendly → bring the pending
  // first_touch forward so Pedro confirms on the next tick (not after 5min).
  if (body.event_type === 'schedule_confirmed') {
    try {
      const expedited = await expediteFirstTouch(admin, accountId, {
        email: body.email ?? null,
        phone: body.phone ?? null,
      })
      return NextResponse.json({ ok: true, expedited })
    } catch (e) {
      console.error('[fap01] expedite failed:', e)
      return NextResponse.json({ error: 'expedite failed' }, { status: 500 })
    }
  }

  const lead = body.lead
  if (body.event_type !== 'lead_created' || !lead) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const phone = (lead.contact_whatsapp || '').replace(/\D/g, '')
  if (!phone) {
    return NextResponse.json({ error: 'contact_whatsapp is required' }, { status: 400 })
  }

  const { data: account } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle()
  const ownerUserId = (account as { owner_user_id?: string } | null)?.owner_user_id
  if (!ownerUserId) {
    console.error('[fap01] account not found:', accountId)
    return NextResponse.json({ error: 'Account not found' }, { status: 500 })
  }

  // Upsert contact (dedup by phone).
  let contactId: string
  const existing = await findExistingContact(admin, accountId, phone)
  if (existing) {
    contactId = existing.id
    // Always refresh the full FAP01 payload (cadastro + quiz + UTMs); only
    // backfill native fields that are still empty.
    const patch: Record<string, unknown> = { fap01_data: lead }
    if (!existing.name && lead.contact_name) patch.name = lead.contact_name
    if (!existing.email && lead.contact_email) patch.email = lead.contact_email
    if (!existing.company && lead.company_name) patch.company = lead.company_name
    patch.updated_at = new Date().toISOString()
    await admin.from('contacts').update(patch).eq('id', contactId)
  } else {
    const { data: created, error: cErr } = await admin
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        phone,
        name: lead.contact_name || null,
        email: lead.contact_email || null,
        company: lead.company_name || null,
        provider: 'meta',
        fap01_data: lead,
      })
      .select('id')
      .single()
    if (cErr || !created) {
      console.error('[fap01] contact insert failed:', cErr)
      return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 })
    }
    contactId = (created as { id: string }).id
  }

  // Qualification note.
  const qual = [
    lead.faturamento_range && `Faturamento: ${lead.faturamento_range}`,
    lead.nicho && `Nicho: ${lead.nicho}`,
    typeof lead.tem_socio === 'boolean' && `Sócio: ${lead.tem_socio ? 'sim' : 'não'}`,
    lead.processo_foco && `Processo: ${lead.processo_foco}`,
    typeof lead.urgencia === 'number' && `Urgência: ${lead.urgencia}`,
  ]
    .filter(Boolean)
    .join(' · ')
  if (qual) {
    await admin.from('contact_notes').insert({
      contact_id: contactId,
      account_id: accountId,
      user_id: ownerUserId,
      note_text: `Qualificação FAP01: ${qual}`,
    })
  }

  // SDR deal — skip only when the lead explicitly failed the low-tier gate.
  let dealId: string | null = null
  if (lead.passed_lowtier_gate !== false) {
    const { data: deal, error: dErr } = await admin
      .from('deals')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        pipeline_id: detUuid(`pl:${SDR_PIPELINE}`),
        stage_id: detUuid(`st:${SDR_PIPELINE}:${SDR_ENTRY_STAGE}`),
        contact_id: contactId,
        title: `${lead.contact_name || phone} · MQL`,
        value: 0,
        status: 'open',
      })
      .select('id')
      .single()
    if (dErr) {
      // Don't fail the whole lead over the deal — the contact is saved.
      console.error('[fap01] deal insert failed:', dErr)
    } else {
      dealId = (deal as { id: string } | null)?.id ?? null
    }
  }

  // Phase C2 — enqueue the outbound-first touch (Pedro reaches out). Only for
  // gated leads in the SDR pipeline (have a deal). Failure here doesn't fail
  // the lead: the contact/deal are saved and a re-post is idempotent.
  let touch = 'skipped-no-deal'
  if (dealId) {
    try {
      const conversationId = await ensureConversationOn(admin, {
        accountId,
        userId: ownerUserId,
        contactId,
      })
      await scheduleFirstTouchIfAbsent(admin, {
        accountId,
        contactId,
        dealId,
        conversationId,
        phone,
        email: (lead.contact_email || '').trim().toLowerCase(),
        dueAt: new Date(Date.now() + FIRST_TOUCH_DELAY_MS).toISOString(),
      })
      touch = 'scheduled'
    } catch (e) {
      console.error('[fap01] first_touch enqueue failed:', e)
      touch = 'enqueue-failed'
    }
  }

  return NextResponse.json({ ok: true, contact_id: contactId, deal_id: dealId, touch })
}
