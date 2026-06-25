/** Find-or-create a tag by name for an account (tags has no UNIQUE on
 *  (account_id, name), so we SELECT then INSERT). Returns the tag id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export async function ensureTag(
  admin: Admin,
  accountId: string,
  userId: string,
  name: string,
): Promise<string> {
  const { data: existing } = await admin
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', name)
    .maybeSingle()
  if ((existing as { id: string } | null)?.id) return (existing as { id: string }).id

  const { data: created, error } = await admin
    .from('tags')
    .insert({ account_id: accountId, user_id: userId, name })
    .select('id')
    .single()
  if (error || !created) throw new Error(`ensureTag failed: ${error?.message ?? 'no row'}`)
  return (created as { id: string }).id
}
