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
}))
vi.mock('./touches', () => ({
  listDueTouches: vi.fn(),
  resolveTouch: vi.fn(async () => {}),
  scheduleReminder: vi.fn(async () => {}),
  conversationHasMessages: vi.fn(async () => false),
  moveDealToStage: vi.fn(async () => {}),
  accountHasChannel: vi.fn(async () => true),
}))

// Imported after env is set so BUBBLE_DELAY_MS=0 (no real waits between bubbles).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processDueTouches: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let touches: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let send: any

beforeAll(async () => {
  process.env.BUBBLE_DELAY_MS = '0'
  ;({ processDueTouches } = await import('./touches-processor'))
  touches = await import('./touches')
  send = await import('./send')
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
function makeAdmin(opts: { aiStatus?: string; name?: string; metaConfig?: boolean } = {}) {
  const inserts: Array<{ table: string; row: unknown }> = []
  const admin = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'conversations') return { data: { ai_status: opts.aiStatus ?? 'on' } }
            if (table === 'contacts') return { data: { name: opts.name ?? 'João Silva' } }
            if (table === 'accounts') return { data: { owner_user_id: 'u1' } }
            return { data: null }
          },
          limit: () => ({
            maybeSingle: async () => {
              if (table === 'whatsapp_config') return { data: opts.metaConfig ? { account_id: 'acc-1' } : null }
              return { data: null }
            },
          }),
        }),
      }),
      insert: async (row: unknown) => {
        inserts.push({ table, row })
        return { error: null }
      },
      update: () => ({ eq: async () => ({ error: null }) }),
      upsert: async () => ({ error: null }),
    }),
    inserts,
  }
  return admin
}

beforeEach(() => {
  vi.clearAllMocks()
  touches.conversationHasMessages.mockResolvedValue(false)
  touches.accountHasChannel.mockResolvedValue(true)
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

  it('first_touch sem evento + conta Meta → template não_agendou (não usa bubbles)', async () => {
    touches.listDueTouches.mockResolvedValue([makeTouch()])
    calendarFind.mockResolvedValue({ events: [] })
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
})
