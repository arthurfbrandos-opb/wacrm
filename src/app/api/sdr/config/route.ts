import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/sdr/config — read/update the SDR agent (Pedro) system prompt.
 *
 * This is the prompt the C1 brain loop reads from `sdr_config.system_prompt`
 * and sends to the Pedro backend (`/v6/llm/reply`) as the system prompt
 * (the cadastro block + agenda protocol are appended at request time). So
 * editing it here directly tunes Pedro's live behaviour.
 *
 *   GET — returns the current prompt for the caller's account.
 *   PUT — replaces it. Admin/owner only (the prompt drives the agent that
 *         talks to every lead). `sdr_config` RLS is SELECT-only for members,
 *         so writes go through the service role behind this gate.
 *
 * The account is always derived from the authenticated session (never from
 * the request body), so a caller can only touch their own account's config.
 */

const PROMPT_MAX_CHARS = 24000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function supabaseAdmin() {
  if (!_admin) {
    _admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

interface Caller {
  accountId: string
  role: string | null
}

/** Resolve the caller's account + role from their profile, or null if unauthenticated. */
async function resolveCaller(): Promise<Caller | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!data?.account_id) return null
  return { accountId: data.account_id as string, role: (data.account_role as string) ?? null }
}

function isAdmin(role: string | null): boolean {
  return role === 'owner' || role === 'admin'
}

export async function GET() {
  const caller = await resolveCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin()
    .from('sdr_config')
    .select('system_prompt, updated_at')
    .eq('account_id', caller.accountId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    system_prompt: data?.system_prompt ?? '',
    updated_at: data?.updated_at ?? null,
    can_edit: isAdmin(caller.role),
  })
}

export async function PUT(request: Request) {
  const caller = await resolveCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(caller.role)) {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
  }

  let body: { system_prompt?: unknown }
  try {
    body = (await request.json()) as { system_prompt?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const prompt = body.system_prompt
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return NextResponse.json({ error: 'system_prompt must be a non-empty string' }, { status: 400 })
  }
  if (prompt.length > PROMPT_MAX_CHARS) {
    return NextResponse.json(
      { error: `system_prompt exceeds ${PROMPT_MAX_CHARS} characters` },
      { status: 400 },
    )
  }

  const { error } = await supabaseAdmin().from('sdr_config').upsert(
    {
      account_id: caller.accountId,
      system_prompt: prompt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
