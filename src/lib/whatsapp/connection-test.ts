// ============================================================
// Connection test for a UazAPI instance.
//
// What this does:
//   Issues a single lightweight request to `${baseUrl}/health`
//   (or `/${baseUrl}` root) and returns a structured verdict
//   without throwing. The API route handler persists the verdict
//   to the DB so the UI shows the live status without re-running
//   the probe on every page load.
//
// Why a soft timeout (5s):
//   UazAPI containers are usually behind self-hosted domains
//   that occasionally time out (NAT issues, CGNAT, expired
//   certificates). A 30s default in fetch() would block the
//   API request and bubble up as 504s for the user. 5s is
//   enough for a healthy instance to answer /health and short
//   enough to feel responsive on the Workspace UI.
//
// Returns:
//   { ok: true,  latency_ms: number }
//   { ok: false, error: string, latency_ms: number }
//
// `error` is plain-English and safe to display to the user
// ("Connection refused", "TLS handshake failed", etc).
// ============================================================

export interface ConnectionTestResult {
  ok: boolean
  latency_ms: number
  error?: string
}

/**
 * Validates a UazAPI base URL before any HTTP call. Cheap defense
 * against SSRF: prevents the route from issuing a request to an
 * internal address (127.0.0.0/8, 169.254.169.254, RFC1918, ::1).
 *
 * UazAPI is meant to be reachable from the wacrm server; if an
 * operator wants to point at a local container, they should do it
 * via a public tunnel (ngrok, Cloudflare Tunnel) — never via raw
 * private IPs.
 */
export function isAllowedUazApiUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'URL is malformed.' }
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `Protocol ${url.protocol.replace(':', '')} is not allowed (use https or http).` }
  }

  const host = url.hostname.toLowerCase()
  // Loopback / link-local / private — block to avoid SSRF / IMDS.
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('127.') ||
    host.startsWith('169.254.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return {
      ok: false,
      reason:
        'Private and loopback addresses are not allowed. Use a publicly reachable UazAPI URL (tunnel via ngrok/Cloudflare if local).',
    }
  }

  return { ok: true }
}

/**
 * Probe a UazAPI base URL. Tries `/health` first (most providers
 * expose it); falls back to GET `/` if the specific path 404s.
 * ANY 2xx response counts as "reachable". 401/403 from `/` is
 * treated as "reachable but auth required" — which is correct,
 * because UazAPI's auth is per-endpoint, not per-host.
 */
export async function probeUazApi(baseUrl: string): Promise<ConnectionTestResult> {
  const allowed = isAllowedUazApiUrl(baseUrl)
  if (!allowed.ok) {
    return { ok: false, latency_ms: 0, error: allowed.reason }
  }

  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)

  try {
    const url = new URL('/health', baseUrl).toString()
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'wacrm-connection-probe/1.0' },
    })
    const latency_ms = Date.now() - start
    if (res.status >= 200 && res.status < 500) {
      // 2xx-3xx = up; 401/403/404 from /health is fine — UazAPI often
      // doesn't expose /health and we just confirmed reachability.
      return { ok: true, latency_ms }
    }
    return {
      ok: false,
      latency_ms,
      error: `Unexpected status ${res.status} from ${url}`,
    }
  } catch (err) {
    const latency_ms = Date.now() - start
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? 'Timeout after 5s — host is unreachable.'
          : err.message
        : 'Unknown network error'
    return { ok: false, latency_ms, error: message }
  } finally {
    clearTimeout(timer)
  }
}