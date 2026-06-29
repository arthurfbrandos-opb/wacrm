/**
 * Decisão de envio única (Fase 2 multi-canal). Todo ponto de envio
 * (humano, IA, toques) deriva canal + modo daqui — fonte única da verdade.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export type Provider = 'meta' | 'uazapi'
export type SendMode = 'text' | 'template_required'
export interface SendPlan {
  provider: Provider
  connectionId: string | null
  windowOpen: boolean
  mode: SendMode
}

const WINDOW_MS = 24 * 3600_000

/** Janela de 24h da Meta. UazAPI não tem janela (sempre aberta).
 *  Meta sem last_inbound conhecido = conservador (fechada). */
export function isWindowOpen(
  provider: Provider,
  lastInboundAt: string | null,
  nowMs: number,
): boolean {
  if (provider !== 'meta') return true
  if (!lastInboundAt) return false
  return nowMs - Date.parse(lastInboundAt) < WINDOW_MS
}

export function computeMode(provider: Provider, windowOpen: boolean): SendMode {
  return provider === 'meta' && !windowOpen ? 'template_required' : 'text'
}

async function accountHasMetaConfig(admin: Admin, accountId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('whatsapp_config').select('account_id').eq('account_id', accountId).limit(1).maybeSingle()
  if (error) throw new Error(`resolveSendPlan: whatsapp_config lookup failed: ${error.message}`)
  return !!data
}

async function activeUazConnectionId(admin: Admin, accountId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('wa_connections').select('id')
    .eq('account_id', accountId).eq('is_active_for_crm', true).maybeSingle()
  if (error) throw new Error(`resolveSendPlan: wa_connections lookup failed: ${error.message}`)
  return data?.id ?? null
}

/** Resolve canal a partir do contato (com fallback p/ canal ativo da conta),
 *  computa janela a partir de conversations.last_inbound_at, e deriva o modo. */
export async function resolveSendPlan(
  admin: Admin,
  accountId: string,
  contact: { provider?: Provider | null; connection_id?: string | null },
  conversation: { last_inbound_at?: string | null },
): Promise<SendPlan> {
  let provider: Provider
  let connectionId: string | null = null

  if (contact.provider === 'uazapi') {
    provider = 'uazapi'
    connectionId = contact.connection_id ?? (await activeUazConnectionId(admin, accountId))
  } else if (contact.provider === 'meta' && (await accountHasMetaConfig(admin, accountId))) {
    provider = 'meta'
  } else {
    // Sem provider explícito (ou Meta sem config): roteia pelo canal real da conta.
    const uazId = await activeUazConnectionId(admin, accountId)
    if (uazId) { provider = 'uazapi'; connectionId = uazId }
    else { provider = 'meta' }
  }

  const windowOpen = isWindowOpen(provider, conversation.last_inbound_at ?? null, Date.now())
  return { provider, connectionId, windowOpen, mode: computeMode(provider, windowOpen) }
}
