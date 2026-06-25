import { resolvePipelineId, resolveStageId } from './stage-lookup'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

/** When a lead replies mid-régua, move their open deal out of the "Follow-up"
 *  pipeline back into "Pré-Vendas (SDR)" / "Em Conversa". No-op if the deal
 *  isn't in Follow-up. Best-effort: never throws. */
export async function moveDealFollowupToEmConversa(
  admin: Admin,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  try {
    const followupPipelineId = await resolvePipelineId(admin, accountId, 'Follow-up')
    if (!followupPipelineId) return false

    const { data: deal } = await admin
      .from('deals')
      .select('id, pipeline_id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const d = deal as { id: string; pipeline_id: string } | null
    if (!d || d.pipeline_id !== followupPipelineId) return false

    const sdrPipelineId = await resolvePipelineId(admin, accountId, 'Pré-Vendas (SDR)')
    const emConversaStageId = await resolveStageId(admin, accountId, 'Pré-Vendas (SDR)', 'Em Conversa')
    if (!sdrPipelineId || !emConversaStageId) return false

    await admin
      .from('deals')
      .update({ pipeline_id: sdrPipelineId, stage_id: emConversaStageId, updated_at: new Date().toISOString() })
      .eq('id', d.id)
      .eq('account_id', accountId)
    return true
  } catch (err) {
    console.error('[sdr] moveDealFollowupToEmConversa failed:', err)
    return false
  }
}
