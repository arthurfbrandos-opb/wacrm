/** Resolve pipeline/stage ids by name at runtime (the "Follow-up" pipeline
 *  lives in the live DB, not in code). Service-role admin passed in. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export async function resolvePipelineId(
  admin: Admin,
  accountId: string,
  pipelineName: string,
): Promise<string | null> {
  const { data } = await admin
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', pipelineName)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export async function resolveStageId(
  admin: Admin,
  accountId: string,
  pipelineName: string,
  stageName: string,
): Promise<string | null> {
  const pipelineId = await resolvePipelineId(admin, accountId, pipelineName)
  if (!pipelineId) return null
  const { data } = await admin
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipelineId)
    .eq('name', stageName)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}
