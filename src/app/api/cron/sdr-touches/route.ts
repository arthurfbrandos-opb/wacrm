import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { processDueTouches } from '@/lib/sdr/touches-processor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Clock tick for the SDR follow-up queue (Phase C2). Meant to be hit on
 * a ~1min schedule (n8n Schedule Trigger or a VPS cron curl). Drains due
 * touches for the FAP01 account: first_touch confirm/chase + 24h/2h
 * reminders.
 *
 * Auth: shared secret in `x-cron-secret` (or `?secret=`) matching
 * SDR_CRON_SECRET. Single-account: the tenant is FAP01_ACCOUNT_ID.
 */
export async function POST(request: Request) {
  const expected = process.env.SDR_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const url = new URL(request.url)
  const supplied = request.headers.get('x-cron-secret') || url.searchParams.get('secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accountId = process.env.FAP01_ACCOUNT_ID
  if (!accountId) {
    console.error('[sdr-cron] FAP01_ACCOUNT_ID not set')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  const admin = supabaseAdmin()
  const data = await processDueTouches(admin, accountId)
  return NextResponse.json({ ok: true, ...data })
}
