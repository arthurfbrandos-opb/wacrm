import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/whatsapp/encryption'
import { probeUazApi } from '@/lib/whatsapp/connection-test'
import {
  toPublicConnection,
  type CreateConnectionInput,
  type WhatsAppConnection,
  type WhatsAppConnectionPublic,
} from '@/lib/whatsapp/connection-types'

// ============================================================
// /api/accounts/[id]/whatsapp/connections
//
//   GET  — list every UazAPI connection in the account.
//   POST — create a new connection, run a connectivity probe,
//          and persist the result. Optionally mark it CRM-active
//          (the partial-unique index enforces the
//          "at most one active per account" invariant).
//
// Why the path is nested under `/accounts/[id]/...`:
//   The connection is a setting OF the account (admin role on
//   the account), not of the current user. Echoing the
//   account_id in the URL makes the relationship explicit and
//   matches the existing `/api/account/...` convention.
//
// Why service-role for INSERT/UPDATE on the probe status:
//   The server-side probe is run as the calling user, but the
//   final status update (status='connected'/'failed', latency,
//   last_error) happens after the user-impersonated transaction
//   commits the insert. We use the admin client for that
//   second write to avoid an RLS recursion in the same tx.
// ============================================================

interface RouteContext {
  params: Promise<{ id: string }>
}

// Service-role client. `any` matches the rest of the codebase
// (see src/app/api/whatsapp/config/route.ts) — without Database
// types, the generic infers `never` for tables the Postgrest
// codegen hasn't seen yet, which then blocks `.insert()` /
// `.update()` from accepting row objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function admin() {
  if (!_admin) {
    _admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _admin
}

/**
 * Confirms the calling user is authenticated and the URL's
 * account_id is reachable. The actual role check is enforced
 * by RLS policies on `whatsapp_connections` (024 migration):
 *   - SELECT  → any account member
 *   - INSERT/UPDATE/DELETE → 'admin' role
 * So a non-admin will get a 403 from the underlying query, which
 * we translate to a clean 403 here. We don't need a separate
 * role-checking RPC.
 */
async function requireAuth(): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }
  return { ok: true, userId: user.id }
}

/**
 * Map an RLS rejection to a clean 403. The PostgREST client
 * surfaces RLS denials as queries that return `error` with a
 * `42501` (insufficient_privilege) code OR as empty data with
 * a "row not found" error (PGRST116). Both mean "you cannot
 * see/touch this resource", which is what the client needs.
 */
function isRlsError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42501' || error.code === 'PGRST116'
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id: accountId } = await ctx.params

  const auth = await requireAuth()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('whatsapp_connections')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })

  if (error) {
    if (isRlsError(error)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('[connections GET] query failed:', error)
    return NextResponse.json({ error: 'Failed to list connections' }, { status: 500 })
  }

  const publicRows: WhatsAppConnectionPublic[] = (data ?? []).map((r) =>
    toPublicConnection(r as WhatsAppConnection)
  )
  return NextResponse.json({ connections: publicRows })
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id: accountId } = await ctx.params

  const auth = await requireAuth()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Parse + validate body.
  let body: CreateConnectionInput
  try {
    body = (await request.json()) as CreateConnectionInput
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const label = (body.label ?? '').trim()
  const base_url = (body.base_url ?? '').trim().replace(/\/+$/, '') // strip trailing slashes
  const access_token = (body.access_token ?? '').trim()
  const webhook_token = body.webhook_token ? body.webhook_token.trim() : null

  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 })
  if (!base_url) return NextResponse.json({ error: 'base_url is required' }, { status: 400 })
  if (!access_token) return NextResponse.json({ error: 'access_token is required' }, { status: 400 })

  // Run the probe BEFORE persisting. We capture the verdict but
  // still save the row even if the probe fails — the operator
  // can fix DNS / firewall and re-test via PATCH.
  const probe = await probeUazApi(base_url)
  const status: 'connected' | 'failed' = probe.ok ? 'connected' : 'failed'

  // Encrypt tokens. Failure here means ENCRYPTION_KEY is unset
  // or malformed; we surface that to the operator verbatim.
  let access_token_enc: string
  let webhook_token_enc: string | null
  try {
    access_token_enc = encrypt(access_token)
    webhook_token_enc = webhook_token ? encrypt(webhook_token) : null
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown encryption error'
    console.error('[connections POST] encrypt failed:', message)
    return NextResponse.json(
      { error: 'Encryption failed — verify ENCRYPTION_KEY is a 64-char hex string.' },
      { status: 500 }
    )
  }

  // Insert. `is_active_for_crm` is true iff the caller asked AND
  // there's no other active connection (we trust the partial
  // unique index to do the actual enforcement; if there's a
  // conflict the catch block returns a clean 409).
  const wantsActive = !!body.make_active

  // Deactivate any currently active row in the same account
  // BEFORE we insert the new one, so the partial unique index
  // never trips within the request.
  if (wantsActive) {
    // We use the service-role client here because the user's
    // session CAN update their own rows but cannot bypass the
    // partial unique index even momentarily — two updates from
    // the same session would race. With service role we get a
    // single atomic batch.
    const { error: clearError } = await admin()
      .from('whatsapp_connections')
      .update({ is_active_for_crm: false, updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('is_active_for_crm', true)
    if (clearError) {
      console.error('[connections POST] clear-active failed:', clearError)
      return NextResponse.json(
        { error: 'Failed to update existing active connection' },
        { status: 500 }
      )
    }
  }

  const { data: row, error: insertError } = await admin()
    .from('whatsapp_connections')
    .insert({
      account_id: accountId,
      provider: 'uazapi',
      label,
      base_url,
      access_token_enc,
      webhook_token_enc,
      status,
      last_checked_at: new Date().toISOString(),
      last_error: probe.ok ? null : probe.error ?? 'Unknown probe error',
      is_active_for_crm: wantsActive,
    })
    .select('*')
    .single()

  if (insertError) {
    if (isRlsError(insertError)) {
      return NextResponse.json(
        { error: 'Forbidden: admin role required to add a connection' },
        { status: 403 }
      )
    }
    console.error('[connections POST] insert failed:', insertError)
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'Another connection is already marked active for this account.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: 'Failed to create connection' }, { status: 500 })
  }

  return NextResponse.json(
    {
      connection: toPublicConnection(row as WhatsAppConnection),
      probe: { ok: probe.ok, latency_ms: probe.latency_ms, error: probe.error ?? null },
    },
    { status: 201 }
  )
}