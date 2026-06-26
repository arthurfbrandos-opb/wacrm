// src/lib/dashboard/ads-queries.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { daysAgoStart, localDayKey } from './date-utils'
import { resolveCreative, type AttributionBlob } from './ads-attribution'
import {
  computeFunnel,
  buildCreativeCostTable,
  computeLiveOps,
  pairFirstResponses,
  awaitingResponseContactIds,
} from './ads-metrics'
import type { AdsLiveOps, AdsFunnel, CreativeCostRow, CreativeLead, SpendByAd } from './ads-types'

type DB = SupabaseClient

const SDR_PIPELINE = 'Pré-Vendas (SDR)'
const CLOSER_PIPELINE = 'Closer'
const STAGE_AGENDAMENTO = 'Agendamento Realizado'
const STAGE_COMPARECIMENTO = 'Comparecimento Realizado'
const STAGE_VENDA = 'Venda Fechada'

interface StageRef { id: string; name: string; pipeline: string }

async function loadStageRefs(db: DB): Promise<StageRef[]> {
  const { data, error } = await db
    .from('pipeline_stages')
    .select('id, name, pipelines(name)')
  if (error) throw error
  return ((data ?? []) as unknown as Array<{ id: string; name: string; pipelines: { name: string }[] | { name: string } | null }>).map((s) => {
    const p = Array.isArray(s.pipelines) ? s.pipelines[0] : s.pipelines
    return { id: s.id, name: s.name, pipeline: p?.name ?? '' }
  })
}

function stageIdsFor(refs: StageRef[], pipeline: string, stageName?: string): string[] {
  return refs.filter((r) => r.pipeline === pipeline && (!stageName || r.name === stageName)).map((r) => r.id)
}

export async function loadAdsFunnel(db: DB, since: string, until: string): Promise<AdsFunnel> {
  const refs = await loadStageRefs(db)
  const sdrStageIds = stageIdsFor(refs, SDR_PIPELINE)
  const agendamentoIds = stageIdsFor(refs, SDR_PIPELINE, STAGE_AGENDAMENTO)
  const comparecimentoIds = stageIdsFor(refs, CLOSER_PIPELINE, STAGE_COMPARECIMENTO)
  const vendaIds = stageIdsFor(refs, CLOSER_PIPELINE, STAGE_VENDA)

  const [leadRows, apptRows, attendedRows, soldRows, inboundRows] = await Promise.all([
    guardedStageQuery(sdrStageIds, () => db.from('deals').select('contact_id, created_at').in('stage_id', sdrStageIds).gte('created_at', since).lt('created_at', until)),
    db.from('appointments').select('contact_id, created_at').gte('created_at', since).lt('created_at', until),
    guardedStageQuery(comparecimentoIds, () => db.from('deals').select('contact_id').in('stage_id', comparecimentoIds)),
    guardedStageQuery(vendaIds, () => db.from('deals').select('contact_id').in('stage_id', vendaIds)),
    db.from('messages').select('conversation_id, conversations(contact_id)').eq('sender_type', 'customer').gte('created_at', since).lt('created_at', until),
  ])

  const leadContactIds = (leadRows.data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)
  const bookedContactIds = [
    ...(apptRows.data ?? []).map((a: { contact_id: string }) => a.contact_id),
    ...(await dealContactIdsInStages(db, agendamentoIds)),
  ].filter(Boolean)
  const attendedContactIds = (attendedRows.data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)
  const soldContactIds = (soldRows.data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)
  const respondedContactIds = inboundContactIdsFromMessages(inboundRows.data ?? [])

  return computeFunnel({ leadContactIds, respondedContactIds, bookedContactIds, attendedContactIds, soldContactIds })
}

async function dealContactIdsInStages(db: DB, stageIds: string[]): Promise<string[]> {
  if (stageIds.length === 0) return []
  const { data } = await db.from('deals').select('contact_id').in('stage_id', stageIds)
  return (data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)
}

/** Returns { data: [] } immediately when stageIds is empty, avoiding `.in('stage_id', [])`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function guardedStageQuery(
  stageIds: string[],
  run: () => PromiseLike<{ data: any[] | null }>,
): Promise<{ data: any[] | null }> {
  if (stageIds.length === 0) return { data: [] }
  return run()
}

function inboundContactIdsFromMessages(
  rows: unknown[],
): string[] {
  const out: string[] = []
  for (const r of rows as Array<{ conversations: { contact_id: string }[] | { contact_id: string } | null }>) {
    const conv = Array.isArray(r.conversations) ? r.conversations[0] : r.conversations
    if (conv?.contact_id) out.push(conv.contact_id)
  }
  return out
}

export async function loadCreativeCostTable(
  db: DB,
  since: string,
  until: string,
): Promise<{ rows: CreativeCostRow[]; spendSyncedAt: string | null }> {
  // ad_spend.date é um date — calculo o primeiro e o ÚLTIMO dia incluídos.
  // until é exclusivo (timestamp): "agora" → último dia = hoje; range custom → último dia = data fim.
  const sinceDate = localDayKey(new Date(since))
  const untilDate = localDayKey(new Date(new Date(until).getTime() - 1))
  const refs = await loadStageRefs(db)
  const sdrStageIds = stageIdsFor(refs, SDR_PIPELINE)
  const agendamentoIds = stageIdsFor(refs, SDR_PIPELINE, STAGE_AGENDAMENTO)
  const comparecimentoIds = stageIdsFor(refs, CLOSER_PIPELINE, STAGE_COMPARECIMENTO)

  const [leadRows, apptRows, attendedRows, spendRows] = await Promise.all([
    guardedStageQuery(sdrStageIds, () => db.from('deals').select('contact_id, contacts(fap01_data)').in('stage_id', sdrStageIds).gte('created_at', since).lt('created_at', until)),
    db.from('appointments').select('contact_id, created_at').gte('created_at', since).lt('created_at', until),
    guardedStageQuery(comparecimentoIds, () => db.from('deals').select('contact_id').in('stage_id', comparecimentoIds)),
    db.from('ad_spend').select('ad_name, campaign_name, spend, synced_at').gte('date', sinceDate).lte('date', untilDate),
  ])

  // 1 lead por contato distinto, com criativo resolvido do fap01_data.
  const seen = new Set<string>()
  const leads: CreativeLead[] = []
  for (const d of (leadRows.data ?? []) as unknown as Array<{ contact_id: string; contacts: { fap01_data: AttributionBlob | null }[] | { fap01_data: AttributionBlob | null } | null }>) {
    if (!d.contact_id || seen.has(d.contact_id)) continue
    seen.add(d.contact_id)
    const c = Array.isArray(d.contacts) ? d.contacts[0] : d.contacts
    const { creative, campaign } = resolveCreative(c?.fap01_data ?? null)
    leads.push({ contactId: d.contact_id, creative, campaign })
  }

  const bookedContactIds = new Set<string>([
    ...(apptRows.data ?? []).map((a: { contact_id: string }) => a.contact_id),
    ...(await dealContactIdsInStages(db, agendamentoIds)),
  ])
  const attendedContactIds = new Set<string>((attendedRows.data ?? []).map((d: { contact_id: string }) => d.contact_id))

  const spendRowsData = (spendRows.data ?? []) as Array<{ ad_name: string | null; campaign_name: string | null; spend: number; synced_at: string }>
  const spend: SpendByAd[] = spendRowsData
    .filter((s) => s.ad_name)
    .map((s) => ({ adName: s.ad_name as string, campaignName: s.campaign_name, spend: Number(s.spend) || 0 }))
  const spendSyncedAt = spendRowsData.reduce<string | null>((latest, s) => (!latest || s.synced_at > latest ? s.synced_at : latest), null)

  const rows = buildCreativeCostTable({ leads, bookedContactIds, attendedContactIds, spend })
  return { rows, spendSyncedAt }
}

export async function loadAdsLiveOps(db: DB, since: string, until: string): Promise<AdsLiveOps> {
  const refs = await loadStageRefs(db)
  const sdrStageIds = stageIdsFor(refs, SDR_PIPELINE)
  // "Sem resposta agora" = estado ATUAL (fila viva), não segue o período. Olha 30d de
  // mensagens pra decidir quem já respondeu — cobre qualquer lead aberto recente sem subcontar no dia 2+.
  const awaitingWindowStart = daysAgoStart(29).toISOString()

  const [leadRows, apptCount, inboundRows, msgsRange, openDeals, awaitingMsgs] = await Promise.all([
    guardedStageQuery(sdrStageIds, () => db.from('deals').select('contact_id').in('stage_id', sdrStageIds).gte('created_at', since).lt('created_at', until)),
    db.from('appointments').select('id', { count: 'exact', head: true }).gte('created_at', since).lt('created_at', until),
    db.from('messages').select('conversation_id, conversations(contact_id)').eq('sender_type', 'customer').gte('created_at', since).lt('created_at', until),
    db.from('messages').select('conversation_id, sender_type, created_at, conversations(contact_id)').gte('created_at', since).lt('created_at', until).order('conversation_id', { ascending: true }).order('created_at', { ascending: true }),
    guardedStageQuery(sdrStageIds, () => db.from('deals').select('contact_id').in('stage_id', sdrStageIds).eq('status', 'open')),
    db.from('messages').select('sender_type, conversations(contact_id)').gte('created_at', awaitingWindowStart),
  ])

  const leadContactIds = (leadRows.data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)
  const respondedContactIds = inboundContactIdsFromMessages(inboundRows.data ?? [])
  const openLeadContactIds = (openDeals.data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)

  const firstResponseMinutes = pairFirstResponses(
    ((msgsRange.data ?? []) as unknown as Array<{ conversation_id: string; sender_type: string; created_at: string }>).map(
      (m) => ({ conversationId: m.conversation_id, senderType: m.sender_type, createdAt: m.created_at }),
    ),
  )

  // Fila viva agora: leads SDR abertos com outbound nosso e zero inbound (janela 30d).
  const awaitingRows = (awaitingMsgs.data ?? []) as unknown as Array<{ sender_type: string; conversations: { contact_id: string }[] | { contact_id: string } | null }>
  const inboundContactIds = new Set<string>()
  const outboundContactIds = new Set<string>()
  for (const m of awaitingRows) {
    const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
    if (!conv?.contact_id) continue
    if (m.sender_type === 'customer') inboundContactIds.add(conv.contact_id)
    else outboundContactIds.add(conv.contact_id)
  }
  const awaitingNow = awaitingResponseContactIds({ openLeadContactIds, inboundContactIds, outboundContactIds }).length

  return computeLiveOps({
    leadContactIds,
    respondedContactIds,
    bookingsCount: apptCount.count ?? 0,
    firstResponseMinutes,
    awaitingNowCount: awaitingNow,
  })
}
