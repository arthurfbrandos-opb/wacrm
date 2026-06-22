import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/whatsapp/encryption'
import { probeUazApi } from '@/lib/whatsapp/connection-test'
import {
  toPublicConnection,
  type UpdateConnectionInput,
  type WhatsAppConnection,
} from '@/lib/whatsapp/connection-types'

// ============================================================
// /api/accounts/[id]/whatsapp/connections/[connId]
//
//   GET    — read a single connection (public shape).
//   PATCH  — partial update. Supports re-running the probe
//            (re-test), toggling `is_active_for_crm`, editing
//            label/base_url, and rotating the access/webhook
//            tokens. Sending `access_token: ''` clears it
//            intentionally (we treat empty string as "rotate
//            to empty"); a missing field means "leave alone".
//   DELETE — remove the connection. The DB has
//            `ON DELETE SET NULL` on contacts.connection_id,
//            so deleting a connection leaves contacts
//            untouched but disconnects their `provider`
//            mapping (still 'uazapi', just no instance).
//
// Why some writes go through service-role:
//   Same rationale as the collection route: the
//   partial-unique-index invariant "at most one active per
//   account" needs a single batched write that can atomically
//   clear the old active row and set the new one, which a
//   user-impersonated client can't do without racy timing.
// ============================================================

interface RouteContext {
  params: Promise<{ id: string; connId: string }>
}

// Service-role client. `any` matches the rest of the codebase
// (see src/app/api/whatsapp/config/route.ts).
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

async function requireAuth(): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }
  return { ok: true, userId: user.id }
}

function isRlsError(error: { code?: string } | null): boolean {
  if (!error) return false
  return error.code === '42501' || error.code === 'PGRST116'
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id: accountId, connId } = await ctx.params
  const auth = await requireAuth()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('wa_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('id', connId)
    .maybeSingle()

  if (error) {
    if (isRlsError(error)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('[connection GET] query failed:', error)
    return NextResponse.json({ error: 'Failed to fetch connection' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }
  return NextResponse.json({ connection: toPublicConnection(data as WhatsAppConnection) })
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id: accountId, connId } = await ctx.params
  const auth = await requireAuth()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: UpdateConnectionInput
  try {
    body = (await request.json()) as UpdateConnectionInput
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const supabase = await createClient()

  // Fetch the current row first — we need to know if the URL
  // changed (so we re-probe) and we need the existing values
  // for any field the caller didn't pass.
  const { data: existing, error: fetchError } = await supabase
    .from('wa_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('id', connId)
    .maybeSingle()

  if (fetchError) {
    if (isRlsError(fetchError)) {
      return NextResponse.json(
        { error: 'Forbidden: admin role required' },
        { status: 403 }
      )
    }
    console.error('[connection PATCH] fetch failed:', fetchError)
    return NextResponse.json({ error: 'Failed to load connection' }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  // Build the patch — only mutate what the caller sent.
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (typeof body.label === 'string') {
    const label = body.label.trim()
    if (!label) return NextResponse.json({ error: 'label cannot be empty' }, { status: 400 })
    updates.label = label
  }
  if (typeof body.base_url === 'string') {
    const base_url = body.base_url.trim().replace(/\/+$/, '')
    if (!base_url) return NextResponse.json({ error: 'base_url cannot be empty' }, { status: 400 })
    updates.base_url = base_url
  }
  if (typeof body.access_token === 'string' && body.access_token.length > 0) {
    try {
      updates.access_token_enc = encrypt(body.access_token)
    } catch (err) {
      console.error('[connection PATCH] encrypt access_token failed:', err)
      return NextResponse.json(
        { error: 'Encryption failed — verify ENCRYPTION_KEY is a 64-char hex string.' },
        { status: 500 }
      )
    }
  }
  if (body.webhook_token !== undefined) {
    if (body.webhook_token === null || body.webhook_token === '') {
      updates.webhook_token_enc = null
    } else {
      try {
        updates.webhook_token_enc = encrypt(body.webhook_token)
      } catch (err) {
        console.error('[connection PATCH] encrypt webhook_token failed:', err)
        return NextResponse.json(
          { error: 'Encryption failed — verify ENCRYPTION_KEY is a 64-char hex string.' },
          { status: 500 }
        )
      }
    }
  }
  if (typeof body.is_active_for_crm === 'boolean') {
    updates.is_active_for_crm = body.is_active_for_crm
  }

  // If base_url changed (or the caller explicitly passed a new
  // access_token), re-run the probe and refresh the status.
  // The probe runs against the POST-MERGE base_url — we look
  // it up from `updates` first, fall back to existing.
  const effectiveBaseUrl =
    typeof updates.base_url === 'string' ? updates.base_url : (existing as WhatsAppConnection).base_url

  const needsProbe =
    typeof updates.base_url === 'string' ||
    (typeof updates.access_token_enc === 'string' &&
      (existing as WhatsAppConnection).access_token_enc !== updates.access_token_enc)
  if (needsProbe) {
    const probe = await probeUazApi(effectiveBaseUrl)
    updates.status = probe.ok ? 'connected' : 'failed'
    updates.last_checked_at = new Date().toISOString()
    updates.last_error = probe.ok ? null : probe.error ?? 'Unknown probe error'
  }

  // If we're flipping `is_active_for_crm` to true, first clear
  // the flag on any other row in the same account (atomic via
  // service role).
  if (updates.is_active_for_crm === true) {
    const { error: clearError } = await admin()
      .from('wa_connections')
      .update({ is_active_for_crm: false, updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('is_active_for_crm', true)
      .neq('id', connId)
    if (clearError) {
      console.error('[connection PATCH] clear-active failed:', clearError)
      return NextResponse.json(
        { error: 'Failed to update existing active connection' },
        { status: 500 }
      )
    }
  }

  const { data: row, error: updateError } = await admin()
    .from('wa_connections')
    .update(updates)
    .eq('id', connId)
    .eq('account_id', accountId)
    .select('*')
    .single()

  if (updateError) {
    if (isRlsError(updateError)) {
      return NextResponse.json(
        { error: 'Forbidden: admin role required' },
        { status: 403 }
      )
    }
    if (updateError.code === '23505') {
      return NextResponse.json(
        { error: 'Another connection is already marked active for this account.' },
        { status: 409 }
      )
    }
    console.error('[connection PATCH] update failed:', updateError)
    return NextResponse.json({ error: 'Failed to update connection' }, { status: 500 })
  }

  return NextResponse.json({ connection: toPublicConnection(row as WhatsAppConnection) })
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id: accountId, connId } = await ctx.params
  const auth = await requireAuth()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const { error } = await supabase
    .from('wa_connections')
    .delete()
    .eq('id', connId)
    .eq('account_id', accountId)

  if (error) {
    if (isRlsError(error)) {
      return NextResponse.json(
        { error: 'Forbidden: admin role required' },
        { status: 403 }
      )
    }
    console.error('[connection DELETE] failed:', error)
    return NextResponse.json({ error: 'Failed to delete connection' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}