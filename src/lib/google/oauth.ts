// src/lib/google/oauth.ts
// Google OAuth (Drive) — o cliente conecta a PRÓPRIA conta no Command Center e
// escolhe as pastas pelo Google Picker. Escopo drive.file (não-sensível): o app
// só acessa o que o cliente escolher no picker + o que criar dentro delas.
// Client secret NUNCA sai do servidor; refresh token vai cifrado pro cofre da
// conta (integration_connections.credentials_enc, provider google_oauth).

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} ausente no ambiente`)
  return v
}

export function googleRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/workspace/integrations/google/callback`
}

/** URL de autorização (access_type=offline + prompt=consent → refresh token). */
export function googleAuthUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
    redirect_uri: googleRedirectUri(origin),
    response_type: 'code',
    scope: GOOGLE_DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

export interface GoogleTokens {
  access_token: string
  refresh_token?: string
  expires_in: number
}

/** Troca o code do callback por tokens (server-side — usa o client secret). */
export async function exchangeCode(origin: string, code: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      redirect_uri: googleRedirectUri(origin),
      grant_type: 'authorization_code',
      code,
    }),
  })
  const json = (await res.json().catch(() => null)) as GoogleTokens | null
  if (!res.ok || !json?.access_token) {
    throw new Error(`troca de code falhou (HTTP ${res.status})`)
  }
  return json
}

/** Access token novo a partir do refresh token guardado. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  const json = (await res.json().catch(() => null)) as { access_token?: string } | null
  if (!res.ok || !json?.access_token) {
    throw new Error(`refresh do token falhou (HTTP ${res.status}) — reconecte o Google Drive`)
  }
  return json.access_token
}
