import { describe, it, expect, beforeAll } from 'vitest'
import { encrypt } from './encryption'
import { resolveUazapiRoute } from './uazapi-routing'

// Deterministic key so encrypt()/decrypt() round-trip inside the test.
beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64)
})

type Conn = {
  id: string
  account_id: string
  webhook_token_enc: string | null
  is_active_for_crm: boolean
}

// Minimal stub of the supabase service-role client. `whatsapp_connections`
// awaits the select directly; `accounts` chains .eq().maybeSingle().
function makeAdmin(conns: Conn[], owner: string | null) {
  return {
    from(table: string) {
      if (table === 'whatsapp_connections') {
        return { select: () => Promise.resolve({ data: conns }) }
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: owner ? { owner_user_id: owner } : null,
            }),
          }),
        }),
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('resolveUazapiRoute', () => {
  it('routes by a per-connection webhook token', async () => {
    const conns: Conn[] = [
      { id: 'conn-1', account_id: 'acc-1', webhook_token_enc: encrypt('tok-1'), is_active_for_crm: true },
      { id: 'conn-2', account_id: 'acc-2', webhook_token_enc: encrypt('tok-2'), is_active_for_crm: false },
    ]
    const route = await resolveUazapiRoute(makeAdmin(conns, 'owner-2'), 'tok-2')
    expect(route).toEqual({ accountId: 'acc-2', connectionId: 'conn-2', ownerUserId: 'owner-2' })
  })

  it('falls back to the single active connection for the global env token', async () => {
    process.env.UAZAPI_WEBHOOK_TOKEN = 'global-xyz'
    const conns: Conn[] = [
      { id: 'conn-1', account_id: 'acc-1', webhook_token_enc: null, is_active_for_crm: true },
      { id: 'conn-2', account_id: 'acc-2', webhook_token_enc: null, is_active_for_crm: false },
    ]
    const route = await resolveUazapiRoute(makeAdmin(conns, 'owner-1'), 'global-xyz')
    expect(route?.accountId).toBe('acc-1')
    expect(route?.connectionId).toBe('conn-1')
  })

  it('returns null for the global token when active connections are ambiguous', async () => {
    process.env.UAZAPI_WEBHOOK_TOKEN = 'global-xyz'
    const conns: Conn[] = [
      { id: 'conn-1', account_id: 'acc-1', webhook_token_enc: null, is_active_for_crm: true },
      { id: 'conn-2', account_id: 'acc-2', webhook_token_enc: null, is_active_for_crm: true },
    ]
    expect(await resolveUazapiRoute(makeAdmin(conns, 'owner-1'), 'global-xyz')).toBeNull()
  })

  it('returns null for an unknown token', async () => {
    const conns: Conn[] = [
      { id: 'conn-1', account_id: 'acc-1', webhook_token_enc: encrypt('tok-1'), is_active_for_crm: true },
    ]
    expect(await resolveUazapiRoute(makeAdmin(conns, 'owner-1'), 'nope')).toBeNull()
  })

  it('returns null for a missing token or no connections', async () => {
    expect(await resolveUazapiRoute(makeAdmin([], null), 'x')).toBeNull()
    expect(
      await resolveUazapiRoute(
        makeAdmin([{ id: 'c', account_id: 'a', webhook_token_enc: encrypt('t'), is_active_for_crm: true }], 'o'),
        null,
      ),
    ).toBeNull()
  })
})
