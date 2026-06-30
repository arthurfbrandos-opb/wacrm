import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'm1' })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'tpl-1' })),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => `dec(${s})` }))
vi.mock('@/lib/whatsapp/uazapi-send', () => ({
  sendUazapiText: vi.fn(), sendUazapiComposing: vi.fn(), setUazapiPresence: vi.fn(),
}))

import { sendTemplate } from './send'
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

