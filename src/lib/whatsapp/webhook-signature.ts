import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   `META_APP_SECRET` is **required**. If it's missing we fail closed —
 *   every request is rejected until the operator configures the
 *   secret. A previous version fell open with a warning log, which is
 *   unsafe for a public template: anyone who forgets the env var would
 *   be running a fully spoofable webhook.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret) {
    console.error(
      '[webhook] META_APP_SECRET is not set — rejecting request. ' +
        'Configure the env var (Meta → App Settings → Basic → App Secret) ' +
        'to enable signature verification.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * Per-request webhook auth. Meta POSTs carry an `x-hub-signature-256`
 * header; UazAPI POSTs carry a `?token=` query param. We pick the
 * provider from what's present on THIS request, so both channels can
 * hit the same endpoint at once (no global WA_PROVIDER gate).
 */
export function verifyWebhookAuth(
  rawBody: string,
  signatureHeader: string | null,
  queryToken: string | null,
): { ok: boolean; provider?: 'meta' | 'uazapi'; reason?: string } {
  if (signatureHeader) {
    return verifyMetaWebhookSignature(rawBody, signatureHeader)
      ? { ok: true, provider: 'meta' }
      : { ok: false, reason: 'meta_hmac_failed' }
  }
  if (queryToken) {
    const expected = process.env.UAZAPI_WEBHOOK_TOKEN
    if (!expected) return { ok: false, reason: 'uazapi_token_not_configured' }
    return queryToken === expected
      ? { ok: true, provider: 'uazapi' }
      : { ok: false, reason: 'uazapi_token_mismatch' }
  }
  return { ok: false, reason: 'no_credentials' }
}
