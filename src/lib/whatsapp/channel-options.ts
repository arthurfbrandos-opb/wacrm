/**
 * Builds the "Canal de origem" option list for a contact and resolves which
 * option is currently selected. Pure logic so it can be unit-tested without a
 * DB: the inbox contact panel feeds it the account's Meta config presence and
 * its UazAPI connections, and reads back a flat list to render.
 *
 * Channel identity:
 *   - Meta (official Cloud API) → a single synthetic option with id 'meta'.
 *   - Each UazAPI connection     → option id = the connection's row id.
 *
 * Selection maps to `contacts.provider` + `contacts.connection_id` (migration
 * 024): a meta contact → 'meta'; a uazapi contact → its pinned connection_id,
 * or the account's active connection when nothing is pinned (mirrors the send
 * route's fallback).
 */

export interface UazapiConnectionLike {
  id: string
  label: string
  base_url?: string
  is_active_for_crm?: boolean
}

export interface ChannelOption {
  /** 'meta' or the wa_connections row id. */
  id: string
  provider: 'meta' | 'uazapi'
  /** null for Meta; the connection id for UazAPI. */
  connectionId: string | null
  label: string
}

export function buildChannelOptions(args: {
  metaConfigured: boolean
  connections: UazapiConnectionLike[]
}): ChannelOption[] {
  const out: ChannelOption[] = []
  if (args.metaConfigured) {
    out.push({ id: 'meta', provider: 'meta', connectionId: null, label: 'API Oficial (Meta)' })
  }
  for (const c of args.connections) {
    out.push({ id: c.id, provider: 'uazapi', connectionId: c.id, label: c.label })
  }
  return out
}

export function currentChannelId(
  contact: { provider?: 'meta' | 'uazapi' | null; connection_id?: string | null },
  options: ChannelOption[],
  connections: UazapiConnectionLike[],
): string | null {
  if (options.length === 0) return null

  const provider = contact.provider ?? 'meta'

  if (provider === 'meta') {
    const meta = options.find((o) => o.provider === 'meta')
    if (meta) return meta.id
    // No Meta option (account is UazAPI-only): fall through to UazAPI resolution.
  }

  // UazAPI: honour the pinned connection if it still exists, else the account's
  // active connection, else the first UazAPI option.
  const uazOptions = options.filter((o) => o.provider === 'uazapi')
  if (uazOptions.length === 0) return options[0]?.id ?? null

  if (contact.connection_id && uazOptions.some((o) => o.id === contact.connection_id)) {
    return contact.connection_id
  }
  const active = connections.find((c) => c.is_active_for_crm)
  if (active && uazOptions.some((o) => o.id === active.id)) return active.id
  return uazOptions[0].id
}
