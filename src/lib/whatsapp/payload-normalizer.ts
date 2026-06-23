/**
 * UazAPI → Meta Cloud API payload normalizer.
 *
 * UazAPI sends webhook events in a different shape than Meta. We translate
 * to Meta's `WhatsAppWebhookEntry[]` shape so the rest of the pipeline
 * (`processWebhook` → `processMessage`) is provider-agnostic.
 *
 * Reference: UazAPI documentation (https://docs.uazapi.com) describes
 * the inbound message structure; Meta's Cloud API is the canonical
 * target shape this codebase already understands.
 *
 * Supported events (UazAPI):
 *   - messages.upsert              → new message
 *   - messages.update              → status update
 *   - connection.update            → ignore (handled at provider layer)
 *   - qrcode.updated               → ignore
 *   - typebot/calls/groups/contacts → ignore (out of scope Phase 1)
 */

interface UazAPIBaseMessage {
  id?: string
  messageid?: string
  messageId?: string
  phone?: string
  fromMe?: boolean
  from?: string
  // 1:1 chat JID, e.g. "5511976986356@s.whatsapp.net". On real uazapi
  // inbound there is no `from`/`phone` — the sender phone lives here.
  chatid?: string
  text?: { message?: string; body?: string } | string
  // Some uazapi builds carry the text under `content` (string on
  // free.uazapi, object on others) instead of `text`.
  content?: { text?: string } | string
  // 1:1 vs group chat flag (free.uazapi sends it on the message).
  isGroup?: boolean
  messageType?:
    | 'Conversation'
    | 'ExtendedText'
    | 'ImageMessage'
    | 'VideoMessage'
    | 'AudioMessage'
    | 'DocumentMessage'
    | 'StickerMessage'
    | 'LocationMessage'
    | 'ReactionMessage'
    | 'contactMessage'
    | 'vcard'
  messageTimestamp?: number
  timestamp?: number
  // On real uazapi this is the INSTANCE phone number (a string present on
  // every message), NOT an "is mine" boolean. Never use it to detect
  // outbound — that's what `fromMe` is for.
  owner?: boolean | string
  // Media payloads (base64 or url depending on uazapi config)
  mediaUrl?: string
  mimetype?: string
  fileName?: string
  caption?: string
  // Reactions
  reaction?: { message_id?: string; text?: string; emoji?: string }
  // Context (swipe-reply)
  contextInfo?: { quotedMessageId?: string; participant?: string; stanzaId?: string }
  // Sender
  pushName?: string
  senderName?: string
  senderPhoto?: string
  // Outbound message recipient (for status events)
  to?: string
  // Location payload
  location?: { latitude?: number; longitude?: number; name?: string; address?: string }
  // Status updates
  status?:
    | 'PENDING'
    | 'SENT'
    | 'DELIVERED'
    | 'READ'
    | 'PLAYED'
    | 'REPLIED'
    | 'FAILED'
    | 'ERROR'
  // Phone number id of the account receiving the message
  instanceId?: string
  instanceName?: string
  instanceOwner?: string
  webhookUrl?: string
}

export interface NormalizedResult {
  entry: Array<{
    id: string
    changes: Array<{
      value: {
        messaging_product: 'whatsapp'
        metadata: {
          display_phone_number: string
          phone_number_id: string
        }
        contacts?: Array<{ profile: { name: string }; wa_id: string }>
        messages?: Array<{
          id: string
          from: string
          timestamp: string
          type: string
          text?: { body: string }
          image?: { id: string; mime_type: string; caption?: string }
          video?: { id: string; mime_type: string; caption?: string }
          document?: { id: string; mime_type: string; filename?: string; caption?: string }
          audio?: { id: string; mime_type: string }
          sticker?: { id: string; mime_type: string }
          location?: { latitude: number; longitude: number; name?: string; address?: string }
          reaction?: { message_id: string; emoji: string }
          context?: { id: string }
        }>
        statuses?: Array<{
          id: string
          status: string
          timestamp: string
          recipient_id: string
        }>
      }
      field: string
    }>
  }>
  /**
   * Meta status ladder: pending|sent|delivered|read|replied|failed.
   * UazAPI sends SENT, DELIVERED, READ, PLAYED, etc. — we lowercase and
   * map to the closest Meta status.
   */
  statusMap: Record<string, string>
}

const STATUS_MAP: Record<string, string> = {
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  PLAYED: 'read', // audio playback — Meta has no separate status
  REPLIED: 'replied',
  FAILED: 'failed',
  ERROR: 'failed',
}

function textBody(m: UazAPIBaseMessage): string | undefined {
  if (typeof m.text === 'string' && m.text) return m.text
  if (m.text && typeof m.text === 'object') {
    const t = m.text.message || m.text.body
    if (t) return t
  }
  if (typeof m.content === 'string' && m.content) return m.content
  if (m.content && typeof m.content === 'object') return m.content.text || undefined
  return undefined
}

/**
 * Derive the contact phone from a uazapi chatid ("<digits>@s.whatsapp.net").
 * Real inbound has no `from`/`phone`, and `sender` may be a "@lid" alias —
 * so the canonical phone is the chatid's local part. Groups (@g.us) → null.
 */
function chatidToPhone(chatid?: string): string | undefined {
  if (!chatid || chatid.includes('@g.us')) return undefined
  const local = chatid.split('@')[0]
  return /^\d{8,}$/.test(local) ? local : undefined
}

function pickType(m: UazAPIBaseMessage): string {
  if (m.reaction || m.messageType === 'ReactionMessage') return 'reaction'
  if (m.location || m.messageType === 'LocationMessage') return 'location'
  switch (m.messageType) {
    case 'ImageMessage':
      return 'image'
    case 'VideoMessage':
      return 'video'
    case 'AudioMessage':
      return 'audio'
    case 'DocumentMessage':
      return 'document'
    case 'StickerMessage':
      return 'sticker'
    case 'Conversation':
    case 'ExtendedText':
    case undefined:
    case null:
    default:
      return 'text'
  }
}

function normalizeMessage(m: UazAPIBaseMessage) {
  const type = pickType(m)
  const phone = m.from || m.phone || chatidToPhone(m.chatid)
  if (!phone) throw new Error('UazAPI message missing from/phone')

  // The "id" UazAPI exposes is the *outbound* wamid for our own messages
  // and the *inbound* wamid for incoming ones. We send both to the same
  // field; the existing dedupe logic on `message_id` handles collisions.
  // Prefer the clean `messageid` ("3A6D…") over `id` ("<owner>:3A6D…").
  const id = m.messageid || m.id || m.messageId
  if (!id) throw new Error('UazAPI message missing id')

  // free.uazapi sends messageTimestamp in MILLISECONDS (13 digits); the
  // Meta-shaped downstream does `parseInt(ts) * 1000` expecting SECONDS, so
  // an unconverted ms value lands in year 58446 and the INSERT throws
  // "time zone displacement out of range". Normalize to seconds.
  let tsNum = Number(m.messageTimestamp ?? m.timestamp ?? 0)
  if (!Number.isFinite(tsNum) || tsNum <= 0) tsNum = Math.floor(Date.now() / 1000)
  if (tsNum > 1e12) tsNum = Math.floor(tsNum / 1000)
  const ts = String(tsNum)

  const out: Record<string, unknown> = {
    id,
    from: String(phone).replace(/\D/g, ''),
    timestamp: ts,
    type,
  }

  if (type === 'text') {
    const body = textBody(m)
    if (body !== undefined) out.text = { body }
  } else if (type === 'image') {
    out.image = { id, mime_type: m.mimetype || 'image/jpeg', caption: m.caption }
  } else if (type === 'video') {
    out.video = { id, mime_type: m.mimetype || 'video/mp4', caption: m.caption }
  } else if (type === 'document') {
    out.document = {
      id,
      mime_type: m.mimetype || 'application/octet-stream',
      filename: m.fileName,
      caption: m.caption,
    }
  } else if (type === 'audio') {
    out.audio = { id, mime_type: m.mimetype || 'audio/ogg' }
  } else if (type === 'sticker') {
    out.sticker = { id, mime_type: m.mimetype || 'image/webp' }
  } else if (type === 'location') {
    // UazAPI location fields vary; fall back to zeros if missing.
    out.location = { latitude: 0, longitude: 0 }
  } else if (type === 'reaction') {
    out.reaction = {
      message_id: m.reaction?.message_id || '',
      emoji: m.reaction?.text || m.reaction?.emoji || '',
    }
  }

  if (m.contextInfo?.quotedMessageId || m.contextInfo?.stanzaId) {
    out.context = { id: m.contextInfo.quotedMessageId || m.contextInfo.stanzaId }
  }

  return out
}

/**
 * Normalize a UazAPI webhook payload into the Meta shape.
 *
 * UazAPI sends a top-level event with a `event` discriminator and
 * `instance`/`data` (or `message`) fields. The shape varies a lot
 * across uazapi versions — we accept both `data` and `message` keys
 * for compatibility.
 */
export function normalizeUazAPIPayload(input: unknown): NormalizedResult | null {
  if (!input || typeof input !== 'object') return null
  const evt = input as Record<string, unknown>
  // free.uazapi uses `EventType` ("messages"); other builds use `event`.
  // On ReadReceipt/messages_update payloads `event` is itself an object, so
  // prefer the string `EventType` first.
  const event = String(evt.EventType || evt.event || '').toLowerCase()

  // Ignore events we don't process (qrcode, connection, typebot, etc.)
  if (
    event === 'connection.update' ||
    event === 'qrcode.updated' ||
    event === 'typebot.start' ||
    event === 'typebot.end' ||
    event === 'call' ||
    event === 'group.participants.update' ||
    event === 'contacts.upsert' ||
    event === 'contacts.update'
  ) {
    return null
  }

  const instanceId =
    (evt.instance as string | undefined) ||
    (evt.instanceName as string | undefined) ||
    ((evt.data as Record<string, unknown> | undefined)?.instanceId as string | undefined) ||
    'uazapi'

  const data = (evt.data || evt.message) as UazAPIBaseMessage | UazAPIBaseMessage[] | undefined
  if (!data) return null

  const messages: UazAPIBaseMessage[] = Array.isArray(data) ? data : [data]
  const outboundStatuses: Array<{ id: string; status: string; timestamp: string; recipient_id: string }> = []
  const inboundMessages: Array<Record<string, unknown>> = []
  const contacts: Array<{ profile: { name: string }; wa_id: string }> = []

  for (const m of messages) {
    // Status events for *outbound* messages
    if (event === 'messages.update' || m.status) {
      const id = m.id || m.messageid || m.messageId
      const rawStatus = m.status
      if (id && rawStatus) {
        outboundStatuses.push({
          id,
          status: STATUS_MAP[String(rawStatus).toUpperCase()] || String(rawStatus).toLowerCase(),
          timestamp: String(m.messageTimestamp || m.timestamp || Math.floor(Date.now() / 1000)),
          recipient_id: (m.to || m.phone || '').toString().replace(/\D/g, ''),
        })
      }
      continue
    }

    // Skip group messages — the SDR inbox is 1:1 only (avoids treating
    // "<id>@g.us" chats as a contact phone).
    if (m.isGroup === true) continue

    // Skip our own outbound messages — we don't want them re-inserted.
    // Only `fromMe` flags that; `owner` is the instance phone (a string on
    // every message) and must NOT be treated as an outbound marker.
    if (m.fromMe === true) continue

    try {
      inboundMessages.push(normalizeMessage(m))
      contacts.push({
        profile: { name: m.pushName || m.senderName || '' },
        wa_id: String(m.from || m.phone || chatidToPhone(m.chatid) || '').replace(/\D/g, ''),
      })
    } catch (err) {
      console.warn('[uazapi-normalizer] skipped malformed message:', (err as Error).message)
    }
  }

  const value: NormalizedResult['entry'][number]['changes'][number]['value'] = {
    messaging_product: 'whatsapp',
    metadata: {
      display_phone_number: '',
      phone_number_id: instanceId,
    },
  }
  if (inboundMessages.length > 0) {
    value.messages = inboundMessages as NormalizedResult['entry'][number]['changes'][number]['value']['messages']
    value.contacts = contacts
  }
  if (outboundStatuses.length > 0) {
    value.statuses = outboundStatuses
  }

  // Don't emit empty entries — caller can no-op
  if (inboundMessages.length === 0 && outboundStatuses.length === 0) return null

  return {
    entry: [{ id: instanceId, changes: [{ value, field: 'messages' }] }],
    statusMap: STATUS_MAP,
  }
}
