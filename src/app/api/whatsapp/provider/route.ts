import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reports the active WhatsApp provider for this deployment.
 * Phase 1 demo: `WA_PROVIDER` env var drives the answer.
 *
 * - `meta`    → default, the existing `WhatsAppConfig` UI takes over
 * - `uazapi`  → UI shows a "Coming soon" banner until the UazAPI config
 *               component is built (Phase 2).
 *
 * No auth required: the value is a deployment constant, not per-tenant.
 */
export async function GET() {
  const provider = (process.env.WA_PROVIDER ?? 'meta').toLowerCase();
  const isUazapi = provider === 'uazapi';

  return NextResponse.json(
    {
      provider,
      uazapi_configured: isUazapi && Boolean(process.env.UAZAPI_WEBHOOK_TOKEN),
      meta_api_base: process.env.META_API_BASE ?? null,
    },
    {
      headers: {
        // Cache per-process so we don't read envs on every poll.
        'Cache-Control': 'public, max-age=60',
      },
    }
  );
}