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
