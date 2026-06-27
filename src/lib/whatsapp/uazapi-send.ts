/**
 * Outbound text send through a UazAPI instance.
 *
 * Endpoint (uazapiGO): POST {baseUrl}/send/text
 *   headers: { token: <instance token>, Content-Type: application/json }
 *   body:    { number: "<E.164 digits>", text: "<message>" }
 *
 * Returns the provider message id when present (best-effort across the
 * shapes uazapiGO uses). Throws with a human-readable message on failure
 * (disconnected session, bad token, etc.) so the caller can surface it.
 */
/** A failed UazAPI send, carrying the HTTP status + raw body for classification. */
export class UazapiSendError extends Error {
  status: number
  body: string
  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'UazapiSendError'
    this.status = status
    this.body = body
  }
}

/**
 * True when a send failed because WhatsApp blocked OPENING a new conversation
 * from a non-warmed number ("reachout-timelock", app code 463). Follow-ups in an
 * already-open chat are fine; only first-contact/cold opens hit this. Detected
 * by the authoritative HTTP status 463 OR the specific keywords "reachout"/
 * "timelock". We deliberately do NOT match a bare "463" in the body text —
 * provider error envelopes carry request/trace ids that can contain 463 as a
 * delimited token, which would false-positive on unrelated send failures and
 * wrongly hand a healthy conversation off to a human.
 */
export function isReachoutBlock(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if ((err as UazapiSendError).status === 463) return true
  const hay = `${err.message} ${(err as UazapiSendError).body ?? ''}`.toLowerCase()
  return /reachout|timelock/.test(hay)
}

export async function sendUazapiText(opts: {
  baseUrl: string
  token: string
  number: string
  text: string
  /** ms to show the "digitando…" (composing) presence before the text
   *  lands, so Ian reads like a human typing. Omitted → no delay. */
  delayMs?: number
}): Promise<{ messageId: string | null }> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const body: Record<string, unknown> = { number: opts.number, text: opts.text }
  if (opts.delayMs && opts.delayMs > 0) body.delay = Math.round(opts.delayMs)
  const res = await fetch(`${base}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: opts.token },
    body: JSON.stringify(body),
  })

  const raw = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    /* non-JSON body — fall through to the status-based error */
  }

  if (!res.ok || data.error) {
    const msg =
      (typeof data.message === 'string' && data.message) ||
      (typeof data.error === 'string' && data.error) ||
      raw ||
      `HTTP ${res.status}`
    // Carry the HTTP status + raw body so callers can classify the failure
    // (e.g. the WhatsApp "reachout-timelock" 463 — a non-warmed number barred
    // from OPENING new conversations) instead of just pattern-matching a string.
    throw new UazapiSendError(`UazAPI: ${msg}`, res.status, raw)
  }

  const message = data.message as { id?: string; key?: { id?: string } } | undefined
  const key = data.key as { id?: string } | undefined
  const messageId =
    (typeof data.id === 'string' && data.id) ||
    message?.id ||
    message?.key?.id ||
    key?.id ||
    (typeof data.messageid === 'string' && data.messageid) ||
    null

  return { messageId }
}

/**
 * Best-effort: set the instance's GLOBAL presence (online/offline) so the lead
 * sees "online" in the chat header. On this uazapiGO build this is a separate
 * endpoint (`/instance/presence`) — the `/send/text` delay does NOT broadcast
 * it. Presence is cosmetic, so failures are swallowed (logged), never thrown.
 */
export async function setUazapiPresence(opts: {
  baseUrl: string
  token: string
  available: boolean
}): Promise<void> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  try {
    await fetch(`${base}/instance/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: opts.token },
      body: JSON.stringify({ presence: opts.available ? 'available' : 'unavailable' }),
    })
  } catch (e) {
    console.error('[uazapi] setPresence failed (ignored)', e)
  }
}

/**
 * Best-effort: show "digitando…" (composing) to `number` for `delayMs`. On this
 * uazapiGO build the typing indicator comes from `/message/presence`, NOT the
 * `/send/text` delay. Cosmetic → failures swallowed.
 */
export async function sendUazapiComposing(opts: {
  baseUrl: string
  token: string
  number: string
  delayMs: number
}): Promise<void> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  try {
    await fetch(`${base}/message/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: opts.token },
      body: JSON.stringify({ number: opts.number, presence: 'composing', delay: Math.round(opts.delayMs) }),
    })
  } catch (e) {
    console.error('[uazapi] composing failed (ignored)', e)
  }
}
