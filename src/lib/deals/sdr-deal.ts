/**
 * Idempotent SDR deal creation for the FAP01 intake: a re-submitted form
 * must land on the contact's existing open deal in the SDR pipeline
 * (refreshing its snapshot) instead of minting a duplicate.
 */
import { isUniqueViolation } from '@/lib/contacts/dedupe'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export interface UpsertSdrDealOpts {
  accountId: string
  userId: string
  pipelineId: string
  stageId: string
  contactId: string
  title: string
  currency: string
  snapshot: unknown
}

async function findOpenDeal(admin: Admin, o: UpsertSdrDealOpts): Promise<string | null> {
  const { data } = await admin
    .from('deals')
    .select('id')
    .eq('account_id', o.accountId)
    .eq('contact_id', o.contactId)
    .eq('pipeline_id', o.pipelineId)
    .eq('status', 'open')
    // Oldest first: it's the deal carrying the régua (same rule as unify).
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

async function reuse(admin: Admin, o: UpsertSdrDealOpts, dealId: string, withNote: boolean) {
  await admin
    .from('deals')
    .update({ fap01_snapshot: o.snapshot, updated_at: new Date().toISOString() })
    .eq('id', dealId)
  if (withNote) {
    await admin.from('contact_notes').insert({
      contact_id: o.contactId,
      account_id: o.accountId,
      user_id: o.userId,
      note_text: 'Lead reenviou o formulário FAP01 — cadastro atualizado no deal existente (sem duplicar).',
    })
  }
  return { dealId, reused: true }
}

export async function upsertSdrDeal(
  admin: Admin,
  opts: UpsertSdrDealOpts,
): Promise<{ dealId: string | null; reused: boolean }> {
  const existing = await findOpenDeal(admin, opts)
  if (existing) return reuse(admin, opts, existing, true)

  const { data: created, error } = await admin
    .from('deals')
    .insert({
      account_id: opts.accountId,
      user_id: opts.userId,
      pipeline_id: opts.pipelineId,
      stage_id: opts.stageId,
      contact_id: opts.contactId,
      title: opts.title,
      value: 0,
      currency: opts.currency,
      status: 'open',
      fap01_snapshot: opts.snapshot,
    })
    .select('id')
    .single()

  if (error) {
    // Unique-index race: another lead_created POST inserted first — reuse it.
    if (isUniqueViolation(error)) {
      const winner = await findOpenDeal(admin, opts)
      if (winner) return reuse(admin, opts, winner, true)
    }
    console.error('[fap01] deal upsert failed:', error)
    return { dealId: null, reused: false }
  }
  return { dealId: (created as { id: string } | null)?.id ?? null, reused: false }
}
