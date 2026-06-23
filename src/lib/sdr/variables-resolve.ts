/**
 * Server-side resolution of prompt variables for one lead. Builds the value
 * map that {@link substituteVariables} consumes. Only queries what the prompt
 * actually uses (token-gated), so a prompt with no `{{tokens}}` costs nothing
 * and the reply is unchanged.
 */
import { formatCurrency } from '@/lib/currency'
import { extractTokens, type CustomVariable } from './variables'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export interface VarContact {
  id: string
  name: string | null
  company: string | null
  email: string | null
  phone: string
}

function todaySP(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date())
}

/**
 * Resolve the value map for the tokens present in `prompt`. Returns {} when the
 * prompt has no tokens (caller then skips substitution entirely).
 */
export async function resolvePromptValues(
  admin: Admin,
  accountId: string,
  prompt: string,
  customVars: CustomVariable[],
  contact: VarContact,
): Promise<Record<string, string>> {
  const tokens = new Set(extractTokens(prompt))
  if (tokens.size === 0) return {}

  const values: Record<string, string> = {}

  if (tokens.has('nome_cliente')) values.nome_cliente = contact.name ?? ''
  if (tokens.has('empresa')) values.empresa = contact.company ?? ''
  if (tokens.has('email')) values.email = contact.email ?? ''
  if (tokens.has('telefone')) values.telefone = contact.phone ?? ''
  if (tokens.has('data_atual')) values.data_atual = todaySP()

  if (tokens.has('valor_negocio')) {
    const { data: deal } = await admin
      .from('deals')
      .select('value, currency')
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    values.valor_negocio = deal
      ? formatCurrency(Number(deal.value) || 0, deal.currency ?? undefined)
      : ''
  }

  if (tokens.has('nome_agente')) {
    const { data: acc } = await admin
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .maybeSingle()
    let agente = ''
    if (acc?.owner_user_id) {
      const { data: prof } = await admin
        .from('profiles')
        .select('full_name')
        .eq('user_id', acc.owner_user_id)
        .maybeSingle()
      agente = prof?.full_name ?? ''
    }
    values.nome_agente = agente
  }

  // Custom variables: one query for the fields actually referenced.
  const usedCustom = customVars.filter((v) => tokens.has(v.name.toLowerCase()))
  if (usedCustom.length > 0) {
    const ids = [...new Set(usedCustom.map((v) => v.custom_field_id))]
    const { data: rows } = await admin
      .from('contact_custom_values')
      .select('custom_field_id, value')
      .eq('contact_id', contact.id)
      .in('custom_field_id', ids)
    const byField = new Map<string, string>(
      ((rows ?? []) as { custom_field_id: string; value: string }[]).map((r) => [
        r.custom_field_id,
        r.value,
      ]),
    )
    for (const v of usedCustom) {
      const raw = byField.get(v.custom_field_id)
      values[v.name.toLowerCase()] = raw && raw.trim() ? raw : v.fallback
    }
  }

  return values
}
