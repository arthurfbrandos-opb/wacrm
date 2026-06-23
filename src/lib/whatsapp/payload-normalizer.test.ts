import { describe, it, expect } from 'vitest'
import { normalizeUazAPIPayload } from '@/lib/whatsapp/payload-normalizer'

describe('normalizeUazAPIPayload', () => {
  it('returns null for non-object input', () => {
    expect(normalizeUazAPIPayload(null)).toBeNull()
    expect(normalizeUazAPIPayload('string')).toBeNull()
  })

  it('ignores events we do not process', () => {
    expect(
      normalizeUazAPIPayload({ event: 'connection.update', data: { id: 'x' } }),
    ).toBeNull()
    expect(
      normalizeUazAPIPayload({ event: 'qrcode.updated' }),
    ).toBeNull()
  })

  it('normalizes a text inbound message', () => {
    const payload = {
      event: 'messages.upsert',
      instance: 'ns-clinic-01',
      data: {
        id: 'wamid.HBgL55xx',
        from: '5511999998888',
        fromMe: false,
        messageType: 'ExtendedText',
        text: { message: 'oi, quero agendar' },
        messageTimestamp: 1718891234,
        pushName: 'Maria',
      },
    }
    const out = normalizeUazAPIPayload(payload)
    expect(out).not.toBeNull()
    expect(out!.entry).toHaveLength(1)
    const msg = out!.entry[0].changes[0].value.messages![0]
    expect(msg.type).toBe('text')
    expect(msg.text?.body).toBe('oi, quero agendar')
    expect(msg.from).toBe('5511999998888')
    expect(out!.entry[0].changes[0].value.metadata.phone_number_id).toBe('ns-clinic-01')
  })

  it('normalizes the real free.uazapi inbound shape (owner string, chatid, no from)', () => {
    const out = normalizeUazAPIPayload({
      event: 'messages',
      instance: 'rc8f1ca995b1087',
      data: {
        messageid: '3A07131BEA924E9DC56D',
        chatid: '5511976986356@s.whatsapp.net',
        sender: '34557491413112@lid',
        senderName: 'Arthur',
        owner: '5519958714237', // instance phone — NOT an outbound flag
        fromMe: false,
        messageType: 'Conversation',
        text: 'Opa, blz, pode',
        messageTimestamp: 1782217576,
      },
    })
    expect(out).not.toBeNull()
    const value = out!.entry[0].changes[0].value
    const msg = value.messages![0]
    expect(msg.type).toBe('text')
    expect(msg.text?.body).toBe('Opa, blz, pode')
    expect(msg.from).toBe('5511976986356')
    expect(value.contacts![0].wa_id).toBe('5511976986356')
    expect(value.contacts![0].profile.name).toBe('Arthur')
  })

  it('normalizes the real free.uazapi envelope (EventType, message, ms timestamp)', () => {
    const out = normalizeUazAPIPayload({
      BaseUrl: 'https://free.uazapi.com',
      EventType: 'messages',
      instanceName: 'rqcTNw',
      owner: '5519958714237',
      chat: { wa_isGroup: false, name: 'Arthur Ferreira' },
      message: {
        chatid: '5511976986356@s.whatsapp.net',
        content: 'Pode',
        text: 'Pode',
        fromMe: false,
        isGroup: false,
        id: '5519958714237:3A6D3C4144195EA9FB73',
        messageid: '3A6D3C4144195EA9FB73',
        messageType: 'Conversation',
        messageTimestamp: 1782220653000, // milliseconds
        owner: '5519958714237',
        sender: '34557491413112@lid',
        senderName: 'Arthur Souza Ferreira',
        type: 'text',
        wasSentByApi: false,
      },
    })
    expect(out).not.toBeNull()
    const value = out!.entry[0].changes[0].value
    const msg = value.messages![0]
    expect(msg.type).toBe('text')
    expect(msg.text?.body).toBe('Pode')
    expect(msg.from).toBe('5511976986356')
    // ms → s: the route multiplies by 1000, so a valid (non-overflow) Date.
    expect(new Date(parseInt(msg.timestamp) * 1000).getFullYear()).toBe(2026)
    expect(value.contacts![0].wa_id).toBe('5511976986356')
  })

  it('skips real-envelope group messages (@g.us)', () => {
    expect(
      normalizeUazAPIPayload({
        EventType: 'messages',
        owner: '5519958714237',
        message: {
          chatid: '120363409641407501@g.us',
          isGroup: true,
          content: 'oi grupo',
          messageType: 'Conversation',
          messageid: 'G1',
          fromMe: false,
        },
      }),
    ).toBeNull()
  })

  it('skips fromMe messages even when owner string is present', () => {
    expect(
      normalizeUazAPIPayload({
        event: 'messages',
        data: {
          messageid: 'out1',
          chatid: '5511976986356@s.whatsapp.net',
          owner: '5519958714237',
          fromMe: true,
          messageType: 'Conversation',
          text: 'resposta do pedro',
        },
      }),
    ).toBeNull()
  })

  it('skips fromMe messages (no re-insert of our own outbound)', () => {
    const out = normalizeUazAPIPayload({
      event: 'messages.upsert',
      data: { id: 'x', from: '5511', fromMe: true, text: 'oi' },
    })
    expect(out).toBeNull()
  })

  it('normalizes a status update', () => {
    const out = normalizeUazAPIPayload({
      event: 'messages.update',
      data: {
        id: 'wamid.outbound1',
        to: '5511999998888',
        status: 'READ',
        messageTimestamp: 1718891300,
      },
    })
    expect(out).not.toBeNull()
    const status = out!.entry[0].changes[0].value.statuses![0]
    expect(status.status).toBe('read')
    expect(status.id).toBe('wamid.outbound1')
    expect(status.recipient_id).toBe('5511999998888')
  })

  it('skips malformed messages without crashing the batch', () => {
    const out = normalizeUazAPIPayload({
      event: 'messages.upsert',
      data: [
        { id: 'a', from: '5511', text: { message: 'ok' } },
        // missing id → skipped
        { from: '5511' },
      ],
    })
    expect(out).not.toBeNull()
    expect(out!.entry[0].changes[0].value.messages).toHaveLength(1)
  })
})
