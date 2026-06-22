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
export async function sendUazapiText(opts: {
  baseUrl: string
  token: string
  number: string
  text: string
}): Promise<{ messageId: string | null }> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: opts.token },
    body: JSON.stringify({ number: opts.number, text: opts.text }),
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
    throw new Error(`UazAPI: ${msg}`)
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
