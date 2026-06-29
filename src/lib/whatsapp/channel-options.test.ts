import { describe, it, expect } from 'vitest'
import { buildChannelOptions, currentChannelId, channelBadgeLabel } from './channel-options'

const conns = [
  { id: 'c1', label: 'Comercial', base_url: 'https://free.uazapi.com', is_active_for_crm: true },
  { id: 'c2', label: 'Suporte', base_url: 'https://free.uazapi.com', is_active_for_crm: false },
]

describe('channelBadgeLabel', () => {
  it('meta = Oficial', () => {
    expect(channelBadgeLabel({ provider: 'meta', connection_id: null }, [])).toBe('Oficial')
  })
  it('uazapi usa label da conexão', () => {
    expect(channelBadgeLabel(
      { provider: 'uazapi', connection_id: 'c1' },
      [{ id: 'c1', label: 'Ian', is_active_for_crm: true }],
    )).toBe('Ian')
  })
  it('uazapi sem label conhecido = Não Oficial', () => {
    expect(channelBadgeLabel({ provider: 'uazapi', connection_id: 'x' }, [])).toBe('Não Oficial')
  })
})

describe('buildChannelOptions', () => {
  it('lists Meta first (when configured) then each UazAPI connection', () => {
    const opts = buildChannelOptions({ metaConfigured: true, connections: conns })
    expect(opts.map((o) => o.id)).toEqual(['meta', 'c1', 'c2'])
    expect(opts[0]).toMatchObject({ provider: 'meta', connectionId: null })
    expect(opts[1]).toMatchObject({ provider: 'uazapi', connectionId: 'c1', label: 'Comercial' })
  })

  it('omits Meta when not configured', () => {
    const opts = buildChannelOptions({ metaConfigured: false, connections: conns })
    expect(opts.map((o) => o.id)).toEqual(['c1', 'c2'])
  })

  it('returns only Meta when there are no UazAPI connections', () => {
    const opts = buildChannelOptions({ metaConfigured: true, connections: [] })
    expect(opts.map((o) => o.id)).toEqual(['meta'])
  })

  it('returns an empty list when nothing is configured', () => {
    expect(buildChannelOptions({ metaConfigured: false, connections: [] })).toEqual([])
  })
})

describe('currentChannelId', () => {
  const opts = buildChannelOptions({ metaConfigured: true, connections: conns })

  it('maps a meta contact to the meta option', () => {
    expect(currentChannelId({ provider: 'meta', connection_id: null }, opts, conns)).toBe('meta')
  })

  it('maps a uazapi contact with a pinned connection to that connection', () => {
    expect(currentChannelId({ provider: 'uazapi', connection_id: 'c2' }, opts, conns)).toBe('c2')
  })

  it('falls back to the account active connection when uazapi has no pin', () => {
    expect(currentChannelId({ provider: 'uazapi', connection_id: null }, opts, conns)).toBe('c1')
  })

  it('treats a missing provider as meta when meta exists', () => {
    expect(currentChannelId({}, opts, conns)).toBe('meta')
  })

  it('falls back to the first uazapi option when meta is absent and provider is unset', () => {
    const uazOnly = buildChannelOptions({ metaConfigured: false, connections: conns })
    expect(currentChannelId({}, uazOnly, conns)).toBe('c1')
  })

  it('returns null when there are no options at all', () => {
    expect(currentChannelId({ provider: 'meta' }, [], [])).toBeNull()
  })

  it('ignores a pinned connection that no longer exists, using the active one', () => {
    expect(currentChannelId({ provider: 'uazapi', connection_id: 'gone' }, opts, conns)).toBe('c1')
  })
})
