import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// ── Mocks (hoisted) ─────────────────────────────────────────────────────────
const calendarFind = vi.fn()
vi.mock('@/lib/pkg/pedro/client', () => ({
  pedroFromEnv: () => ({ calendarFind }),
}))
vi.mock('./send', () => ({
  sendText: vi.fn(async () => ({ messageId: 'm1' })),
  sendTemplate: vi.fn(async () => ({ messageId: 'tpl-1' })),
  resolveAccountProvider: vi.fn(async () => 'uazapi'),
  setAccountPresence: vi.fn(async () => {}),
  accountHasMetaConfig: vi.fn(async () => false),
}))
vi.mock('./touches', () => ({
  listDueTouches: vi.fn(),
  resolveTouch: vi.fn(async () => {}),
  scheduleReminder: vi.fn(async () => {}),
  conversationHasMessages: vi.fn(async () => false),
  moveDealToStage: vi.fn(async () => {}),
  accountHasChannel: vi.fn(async () => true),
}))
// Reminders roteiam pela origem atual via resolveSendPlan. Default = janela aberta
// (UazAPI) → bubbles de texto livre, que é o comportamento dos testes existentes.
vi.mock('./send-plan', () => ({
  resolveSendPlan: vi.fn(async () => ({
    provider: 'uazapi',
    connectionId: 'uaz-conn-1',
    windowOpen: true,
    mode: 'text',
  })),
}))
// Engate das réguas (fu1/fu-agendou): mocka a tag e o gatilho pra
// asserção direta — sem tocar o engine real.
const ensureTagMock = vi.fn(async (..._a: unknown[]) => 'tag-regua-id')
vi.mock('./ensure-tag', () => ({
  ensureTag: (...a: unknown[]) => ensureTagMock(...a),
}))
const runAutomationsMock = vi.fn(async (..._a: unknown[]) => {})
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: (...a: unknown[]) => runAutomationsMock(...a),
}))

// Imported after env is set so BUBBLE_DELAY_MS=0 (no real waits between bubbles).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processDueTouches: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let touches: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let send: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sendPlan: any

beforeAll(async () => {
  process.env.BUBBLE_DELAY_MS = '0'
  ;({ processDueTouches } = await import('./touches-processor'))
  touches = await import('./touches')
  send = await import('./send')
  sendPlan = await import('./send-plan')
})

const ACCOUNT = 'acc-1'

function makeTouch(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    account_id: ACCOUNT,
    type: 'first_touch',
    status: 'pending',
    contact_id: 'c1',
    deal_id: 'd1',
    conversation_id: 'conv1',
    phone: '5531999999999',
    email: 'lead@example.com',
    due_at: '2026-06-22T12:00:00-03:00',
    event_start_iso: null,
    meet_link: null,
    ...over,
  }
}

// Minimal chainable Supabase admin double for the processor's inline queries.
// Supports multi-eq chaining: select().eq().eq().maybeSingle() and select().eq().limit().maybeSingle()
function makeAdmin(opts: { aiStatus?: string; name?: string; metaConfig?: boolean; uazConnectionId?: string | null; noSdrConfig?: boolean } = {}) {
  const inserts: Array<{ table: string; row: unknown }> = []
  // Records contacts.update calls: { payload, contactId }
  const contactUpdates: Array<{ payload: unknown; contactId: unknown }> = []

  const uazId = opts.uazConnectionId !== undefined ? opts.uazConnectionId : 'uaz-conn-1'

  function makeChainable(table: string) {
    const chain: Record<string, unknown> = {}
    chain.maybeSingle = async () => {
      if (table === 'conversations') return { data: { ai_status: opts.aiStatus ?? 'on' } }
      if (table === 'contacts') return { data: { name: opts.name ?? 'João Silva' } }
      if (table === 'accounts') return { data: { owner_user_id: 'u1' } }
      if (table === 'sdr_config') return opts.noSdrConfig ? { data: null } : { data: { fap01_source: 'meta' } }
      if (table === 'wa_connections') return { data: uazId ? { id: uazId } : null }
      return { data: null }
    }
    chain.eq = () => chain
    chain.limit = () => ({
      maybeSingle: async () => {
        if (table === 'whatsapp_config') return { data: opts.metaConfig ? { account_id: 'acc-1' } : null }
        return { data: null }
      },
    })
    return chain
  }

  const admin = {
    from: (table: string) => ({
      select: () => makeChainable(table),
      insert: async (row: unknown) => {
        inserts.push({ table, row })
        return { error: null }
      },
      update: (payload: unknown) => {
        if (table === 'contacts') {
          // Return a chainable that records the eq('id', contactId) argument
          return {
            eq: async (col: unknown, val: unknown) => {
              contactUpdates.push({ payload, contactId: val })
              return { error: null }
            },
          }
        }
        return { eq: async () => ({ error: null }) }
      },
      upsert: async () => ({ error: null }),
    }),
    inserts,
    contactUpdates,
  }
  return admin
}

beforeEach(() => {
  vi.clearAllMocks()
  touches.conversationHasMessages.mockResolvedValue(false)
  touches.accountHasChannel.mockResolvedValue(true)
  send.accountHasMetaConfig.mockResolvedValue(false)
  // Restore default: janela aberta (UazAPI) → bubbles de texto livre.
  sendPlan?.resolveSendPlan?.mockResolvedValue({
    provider: 'uazapi', connectionId: 'uaz-conn-1', windowOpen: true, mode: 'text',
  })
})

describe('processDueTouches', () => {
  it('skips the whole tick when the account has no sendable channel', async () => {
    touches.accountHasChannel.mockResolvedValue(false)
    touches.listDueTouches.mockResolvedValue([makeTouch()])
    const admin = makeAdmin()

    const res = await processDueTouches(admin, ACCOUNT)

    expect(res.results[0].skipped).toBe('no-channel')
    expect(touches.listDueTouches).not.toHaveBeenCalled()
    expect(send.sendText).not.toHaveBeenCalled()
  })

  it('skips a touch when the conversation is not on autopilot (ai_off)', async () => {
    touches.listDueTouches.mockResolvedValue([makeTouch()])
    const admin = makeAdmin({ aiStatus: 'off' })

    const res = await processDueTouches(admin, ACCOUNT)

    expect(touches.resolveTouch).toHaveBeenCalledWith(admin, 't1', 'skipped', 'ai_off')
    expect(send.sendText).not.toHaveBeenCalled()
    expect(res.results[0].resolution).toBe('ai_off')
  })

  it('first_touch with a booked event → confirm + appointment + two reminders', async () => {
    touches.listDueTouches.mockResolvedValue([makeTouch()])
    calendarFind.mockResolvedValue({
      events: [
        {
          start_iso: '2099-01-01T10:00:00-03:00',
          end_iso: '2099-01-01T10:30:00-03:00',
          summary: 'Diagnóstico',
          meet_link: 'https://meet.example/abc',
        },
      ],
    })
    const admin = makeAdmin()

    const res = await processDueTouches(admin, ACCOUNT)

    // 3 confirm bubbles sent via the active provider.
    expect(send.sendText).toHaveBeenCalledTimes(3)
    expect(touches.moveDealToStage).toHaveBeenCalledWith(admin, 'd1', 'agendamento_realizado')
    expect(touches.scheduleReminder).toHaveBeenCalledTimes(2)
    expect(touches.resolveTouch).toHaveBeenCalledWith(admin, 't1', 'done', 'confirm')
    expect(admin.inserts.some((i) => i.table === 'appointments')).toBe(true)
    expect(res.results[0].resolution).toBe('confirm')
  })

  it('first_touch with no event → chase + move to primeiro_contato', async () => {
    touches.listDueTouches.mockResolvedValue([makeTouch()])
    calendarFind.mockResolvedValue({ events: [] })
    const admin = makeAdmin()

    const res = await processDueTouches(admin, ACCOUNT)

    expect(send.sendText).toHaveBeenCalledTimes(2) // 2 chase bubbles
    expect(touches.moveDealToStage).toHaveBeenCalledWith(admin, 'd1', 'primeiro_contato')
    expect(touches.scheduleReminder).not.toHaveBeenCalled()
    expect(touches.resolveTouch).toHaveBeenCalledWith(admin, 't1', 'done', 'chase')
    expect(res.results[0].resolution).toBe('chase')
  })

  it('first_touch but the lead already replied → skip (already_talking)', async () => {
    touches.listDueTouches.mockResolvedValue([makeTouch()])
    touches.conversationHasMessages.mockResolvedValue(true)
    const admin = makeAdmin()

    await processDueTouches(admin, ACCOUNT)

    expect(send.sendText).not.toHaveBeenCalled()
    expect(touches.resolveTouch).toHaveBeenCalledWith(admin, 't1', 'skipped', 'already_talking')
  })

  it('reminder whose event vanished → skip (event_gone)', async () => {
    touches.listDueTouches.mockResolvedValue([
      makeTouch({ type: 'reminder_24h', event_start_iso: '2099-01-01T10:00:00-03:00' }),
    ])
    calendarFind.mockResolvedValue({ events: [] }) // event canceled/rescheduled
    const admin = makeAdmin()

    await processDueTouches(admin, ACCOUNT)

    expect(send.sendText).not.toHaveBeenCalled()
    expect(touches.resolveTouch).toHaveBeenCalledWith(admin, 't1', 'skipped', 'event_gone')
  })

  it('reminder_2h whose event still exists → send, resolving before the send', async () => {
    touches.listDueTouches.mockResolvedValue([
      makeTouch({
        type: 'reminder_2h',
        event_start_iso: '2099-01-01T10:00:00-03:00',
        meet_link: 'https://meet.example/abc',
      }),
    ])
    calendarFind.mockResolvedValue({
      events: [
        {
          start_iso: '2099-01-01T10:00:00-03:00',
          end_iso: '2099-01-01T10:30:00-03:00',
          summary: 'Diagnóstico',
          meet_link: 'https://meet.example/abc',
        },
      ],
    })
    const admin = makeAdmin()

    await processDueTouches(admin, ACCOUNT)

    expect(touches.resolveTouch).toHaveBeenCalledWith(admin, 't1', 'done', 'sent')
    expect(send.sendText).toHaveBeenCalledTimes(2) // greeting + meet link bubble
  })

  it('reminder_24h fora da janela Meta → template lembrete_24h com {{2}}="DD/MM às Hh"', async () => {
    touches.listDueTouches.mockResolvedValue([
      makeTouch({ type: 'reminder_24h', event_start_iso: '2099-01-01T10:00:00-03:00' }),
    ])
    calendarFind.mockResolvedValue({ events: [{ start_iso: '2099-01-01T10:00:00-03:00' }] })
    sendPlan.resolveSendPlan.mockResolvedValue({ provider: 'meta', mode: 'template_required', windowOpen: false })
    const admin = makeAdmin({ name: 'João Silva' })

    await processDueTouches(admin, ACCOUNT)

    expect(send.sendTemplate).toHaveBeenCalledWith(admin, ACCOUNT, expect.objectContaining({
      templateName: 'lembrete_24h', languageCode: 'pt_BR', bodyParams: ['João', '01/01 às 10h'],
    }))
    expect(send.sendText).not.toHaveBeenCalled()
    expect(touches.resolveTouch).toHaveBeenCalledWith(admin, 't1', 'done', 'sent_template')
  })

  it('reminder fora da janela persiste o TEXTO renderizado no inbox (não o placeholder [tipo])', async () => {
    touches.listDueTouches.mockResolvedValue([
      makeTouch({ type: 'reminder_24h', event_start_iso: '2099-01-01T10:00:00-03:00' }),
    ])
    calendarFind.mockResolvedValue({ events: [{ start_iso: '2099-01-01T10:00:00-03:00' }] })
    sendPlan.resolveSendPlan.mockResolvedValue({ provider: 'meta', mode: 'template_required', windowOpen: false })
    const admin = makeAdmin({ name: 'João Silva' })

    await processDueTouches(admin, ACCOUNT)

    const msg = admin.inserts.find((i: { table: string }) => i.table === 'messages') as
      | { row: { content_text: string } }
      | undefined
    expect(msg).toBeTruthy()
    expect(msg!.row.content_text).toContain('Lembrete rápido')
    expect(msg!.row.content_text).toContain('amanhã, 01/01 às 10h')
    expect(msg!.row.content_text).not.toContain('[reminder_24h]')
  })

  it('first_touch agendou (confirm) engata a régua fu-agendou (tag + gatilho)', async () => {
    touches.listDueTouches.mockResolvedValue([makeTouch()])
    calendarFind.mockResolvedValue({
      events: [
        {
          start_iso: '2099-01-01T10:00:00-03:00',
          end_iso: '2099-01-01T10:30:00-03:00',
          summary: 'Diagnóstico',
          meet_link: 'https://meet.example/abc',
        },
      ],
    })
    const admin = makeAdmin()

    await processDueTouches(admin, ACCOUNT)

    expect(ensureTagMock).toHaveBeenCalledWith(admin, ACCOUNT, 'u1', 'fu-agendou')
    expect(runAutomationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT,
        triggerType: 'tag_added',
        contactId: 'c1',
        context: expect.objectContaining({ tag_id: 'tag-regua-id', conversation_id: 'conv1' }),
      }),
    )
  })

  it('reminder_2h fora da janela Meta → template lembrete_2h com {{2}}="Hh"', async () => {
    touches.listDueTouches.mockResolvedValue([
      makeTouch({ type: 'reminder_2h', event_start_iso: '2099-01-01T10:00:00-03:00' }),
    ])
    calendarFind.mockResolvedValue({ events: [{ start_iso: '2099-01-01T10:00:00-03:00' }] })
    sendPlan.resolveSendPlan.mockResolvedValue({ provider: 'meta', mode: 'template_required', windowOpen: false })
    const admin = makeAdmin({ name: 'João Silva' })

    await processDueTouches(admin, ACCOUNT)

    expect(send.sendTemplate).toHaveBeenCalledWith(admin, ACCOUNT, expect.objectContaining({
      templateName: 'lembrete_2h', languageCode: 'pt_BR', bodyParams: ['João', '10h'],
    }))
    expect(send.sendText).not.toHaveBeenCalled()
  })

  it('first_touch sem evento + conta Meta → template não_agendou (não usa bubbles)', async () => {
    touches.listDueTouches.mockResolvedValue([makeTouch()])
    calendarFind.mockResolvedValue({ events: [] })
    send.accountHasMetaConfig.mockResolvedValue(true)
    const admin = makeAdmin({ metaConfig: true, name: 'João Silva' })
    await processDueTouches(admin, ACCOUNT)
    expect(send.sendTemplate).toHaveBeenCalledWith(admin, ACCOUNT, expect.objectContaining({
      templateName: 'fap01_1contato_nao_agendou', languageCode: 'pt_BR', bodyParams: ['João'],
    }))
    expect(send.sendText).not.toHaveBeenCalled()
    expect(touches.moveDealToStage).toHaveBeenCalledWith(admin, 'd1', 'primeiro_contato')
    expect(admin.inserts.some((i) => i.table === 'messages' && (i.row as any).provider === 'meta')).toBe(true)
  })

  it('first_touch com evento + conta Meta → template agendou + appointment + reminders', async () => {
    touches.listDueTouches.mockResolvedValue([makeTouch()])
    calendarFind.mockResolvedValue({ events: [{ start_iso: '2099-01-01T10:00:00-03:00', meet_link: 'https://meet/x' }] })
    send.accountHasMetaConfig.mockResolvedValue(true)
    const admin = makeAdmin({ metaConfig: true })
    await processDueTouches(admin, ACCOUNT)
    expect(send.sendTemplate).toHaveBeenCalledWith(admin, ACCOUNT, expect.objectContaining({ templateName: 'fap01_1contato_agendou' }))
    expect(touches.moveDealToStage).toHaveBeenCalledWith(admin, 'd1', 'agendamento_realizado')
    expect(touches.scheduleReminder).toHaveBeenCalledTimes(2)
  })

  it('first_touch sem conta Meta → fallback bubbles (UazAPI), sem template', async () => {
    touches.listDueTouches.mockResolvedValue([makeTouch()])
    calendarFind.mockResolvedValue({ events: [] })
    const admin = makeAdmin({ metaConfig: false })
    await processDueTouches(admin, ACCOUNT)
    expect(send.sendTemplate).not.toHaveBeenCalled()
    expect(send.sendText).toHaveBeenCalled()
  })

  // Fix 2: stampContactChannel must fire with the touch's contact_id
  it('first_touch via Meta stamps contacts with correct contactId and provider', async () => {
    const touch = makeTouch({ contact_id: 'contact-xyz' })
    touches.listDueTouches.mockResolvedValue([touch])
    calendarFind.mockResolvedValue({ events: [] })
    send.accountHasMetaConfig.mockResolvedValue(true)
    const admin = makeAdmin({ metaConfig: true, name: 'Ana Lima' })

    await processDueTouches(admin, ACCOUNT)

    // Must have stamped the contacts table
    expect(admin.contactUpdates.length).toBeGreaterThan(0)
    const stamp = admin.contactUpdates[0]
    // The eq('id', contactId) arg must match the touch's contact_id
    expect(stamp.contactId).toBe('contact-xyz')
    expect((stamp.payload as Record<string, unknown>).provider).toBe('meta')
  })

  // Fix 4: when sdr_config row is absent, source defaults to 'meta'
  it('first_touch with no sdr_config row → defaults to meta channel', async () => {
    touches.listDueTouches.mockResolvedValue([makeTouch()])
    calendarFind.mockResolvedValue({ events: [] })
    send.accountHasMetaConfig.mockResolvedValue(true)
    const admin = makeAdmin({ metaConfig: true, noSdrConfig: true })

    await processDueTouches(admin, ACCOUNT)

    // Should have sent via Meta template (source defaulted to 'meta')
    expect(send.sendTemplate).toHaveBeenCalledWith(admin, ACCOUNT, expect.objectContaining({
      templateName: 'fap01_1contato_nao_agendou',
    }))
    expect(send.sendText).not.toHaveBeenCalled()
  })
})
