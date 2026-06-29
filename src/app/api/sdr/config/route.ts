import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { isValidVariableName, BUILTIN_NAMES, type CustomVariable } from '@/lib/sdr/variables'

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

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('sdr_config')
    .select('system_prompt, updated_at, variables, fap01_source')
    .eq('account_id', caller.accountId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Custom fields available to map variables onto.
  const { data: fields } = await admin
    .from('custom_fields')
    .select('id, field_name')
    .eq('account_id', caller.accountId)
    .order('field_name', { ascending: true })

  return NextResponse.json({
    system_prompt: data?.system_prompt ?? '',
    updated_at: data?.updated_at ?? null,
    variables: (data?.variables ?? []) as CustomVariable[],
    custom_fields: (fields ?? []) as { id: string; field_name: string }[],
    can_edit: isAdmin(caller.role),
    fap01_source: (data?.fap01_source ?? 'meta') as 'meta' | 'uazapi',
  })
}

/** Validate + normalise the custom-variable array against the account's fields. */
function validateVariables(
  raw: unknown,
  accountFieldIds: Set<string>,
): { ok: true; variables: CustomVariable[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'variables must be an array' }
  const seen = new Set<string>()
  const out: CustomVariable[] = []
  for (const v of raw) {
    const name = String((v as CustomVariable)?.name ?? '').toLowerCase().trim()
    if (!isValidVariableName(name)) {
      return { ok: false, error: `nome de variável inválido: "${name}" (use a-z, 0-9, _)` }
    }
    if (BUILTIN_NAMES.includes(name)) {
      return { ok: false, error: `"${name}" é uma variável embutida — escolha outro nome` }
    }
    if (seen.has(name)) return { ok: false, error: `variável duplicada: "${name}"` }
    seen.add(name)
    const fieldId = String((v as CustomVariable)?.custom_field_id ?? '')
    if (!accountFieldIds.has(fieldId)) {
      return { ok: false, error: `campo customizado não encontrado para "${name}"` }
    }
    out.push({ name, custom_field_id: fieldId, fallback: String((v as CustomVariable)?.fallback ?? '') })
  }
  return { ok: true, variables: out }
}

export async function PUT(request: Request) {
  const caller = await resolveCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(caller.role)) {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
  }

  let body: { system_prompt?: unknown; variables?: unknown; fap01_source?: unknown }
  try {
    body = (await request.json()) as { system_prompt?: unknown; variables?: unknown; fap01_source?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }

  if (body.system_prompt !== undefined) {
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
    patch.system_prompt = prompt
  }

  if (body.variables !== undefined) {
    const { data: fields } = await admin
      .from('custom_fields')
      .select('id')
      .eq('account_id', caller.accountId)
    const fieldIds = new Set(((fields ?? []) as { id: string }[]).map((f) => f.id))
    const v = validateVariables(body.variables, fieldIds)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    patch.variables = v.variables
  }

  if (body.fap01_source !== undefined) {
    if (body.fap01_source !== 'meta' && body.fap01_source !== 'uazapi') {
      return NextResponse.json({ error: "fap01_source deve ser 'meta' ou 'uazapi'" }, { status: 400 })
    }
    patch.fap01_source = body.fap01_source
  }

  if (patch.system_prompt === undefined && patch.variables === undefined && patch.fap01_source === undefined) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  // The account's sdr_config row is seeded; UPDATE preserves the field not sent
  // (so saving variables alone never wipes the prompt, and vice-versa).
  const { error } = await admin
    .from('sdr_config')
    .update(patch)
    .eq('account_id', caller.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
