import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'm1' })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'tpl-1' })),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => `dec(${s})` }))
vi.mock('@/lib/whatsapp/uazapi-send', () => ({
  sendUazapiText: vi.fn(), sendUazapiComposing: vi.fn(), setUazapiPresence: vi.fn(),
}))

import { sendTemplate, resolveReplyProvider } from './send'
import * as metaApi from '@/lib/whatsapp/meta-api'

function adminWithMeta() {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({
        data: { phone_number_id: 'PNID', access_token: 'enc_tok' },
      }) }) }),
    }),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('sendTemplate', () => {
  it('envia template Meta com phone_number_id, token decifrado e params do body', async () => {
    vi.mocked(metaApi.sendTemplateMessage).mockResolvedValueOnce({ messageId: 'tpl-1' })
    const r = await sendTemplate(adminWithMeta(), 'acc-1', {
      phone: '5531999999999',
      templateName: 'fap01_1contato_nao_agendou',
      languageCode: 'pt_BR',
      bodyParams: ['João'],
    })
    expect(r.messageId).toBe('tpl-1')
    expect(metaApi.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'PNID',
        accessToken: 'dec(enc_tok)',
        templateName: 'fap01_1contato_nao_agendou',
        language: 'pt_BR',
        params: ['João'],
      }),
    )
  })
})

// Mock admin that simulates the exact Supabase query chains used by:
//   resolveAccountProvider: .from('wa_connections').select().eq(accountId).eq('is_active_for_crm').maybeSingle()
//   accountHasMetaConfig:   .from('whatsapp_config').select().eq(accountId).limit(1).maybeSingle()
function adminProvider(opts: { activeUaz?: boolean; metaConfig?: boolean }) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          // Second .eq() — used by resolveAccountProvider (wa_connections chain)
          eq: () => ({
            maybeSingle: async () => {
              if (table === 'wa_connections') return { data: opts.activeUaz ? { id: 'c1' } : null }
              return { data: null }
            },
          }),
          // .limit() — used by accountHasMetaConfig (whatsapp_config chain)
          limit: () => ({
            maybeSingle: async () => {
              if (table === 'whatsapp_config') return { data: opts.metaConfig ? { account_id: 'a' } : null }
              return { data: null }
            },
          }),
        }),
      }),
    }),
  }
}

describe('resolveReplyProvider', () => {
  it('lead meta + conta tem Meta → meta (mesmo com UazAPI ativo)', async () => {
    const admin = adminProvider({ activeUaz: true, metaConfig: true })
    const result = await resolveReplyProvider(admin, 'acc-1', { provider: 'meta' })
    expect(result).toBe('meta')
  })

  it('lead meta + conta SEM Meta → fallback para canal ativo da conta (uazapi)', async () => {
    const admin = adminProvider({ activeUaz: true, metaConfig: false })
    const result = await resolveReplyProvider(admin, 'acc-1', { provider: 'meta' })
    expect(result).toBe('uazapi')
  })

  it('lead uazapi → uazapi (sem consultar banco)', async () => {
    const admin = adminProvider({ activeUaz: false, metaConfig: false })
    const result = await resolveReplyProvider(admin, 'acc-1', { provider: 'uazapi' })
    expect(result).toBe('uazapi')
  })

  it('contato sem provider → fallback para canal ativo da conta', async () => {
    const admin = adminProvider({ activeUaz: true, metaConfig: false })
    const result = await resolveReplyProvider(admin, 'acc-1', { provider: null })
    expect(result).toBe('uazapi')
  })
})
