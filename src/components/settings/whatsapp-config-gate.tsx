'use client';

import { useEffect, useState } from 'react';
import { Clock, Sparkles, Loader2 } from 'lucide-react';
import { WhatsAppConfig } from './whatsapp-config';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type ProviderInfo = {
  provider: 'meta' | 'uazapi' | string;
  uazapi_configured: boolean;
  meta_api_base: string | null;
};

/**
 * Phase 1 / Phase 2 split:
 * - WA_PROVIDER=meta (default) → render the existing <WhatsAppConfig /> form
 * - WA_PROVIDER=uazapi          → render a "Coming soon" placeholder that
 *   tells the user the UazAPI provider is selected but the dedicated UI
 *   hasn't shipped yet. We still surface what the webhook URL will be so
 *   the user can pre-configure it in their UazAPI dashboard.
 *
 * Note: this only swaps the Settings/WhatsApp panel. The /api/whatsapp/webhook
 * already understands WA_PROVIDER=uazapi (per feat/uazapi-adapter), so
 * inbound webhooks will start landing in `messages` as soon as the operator
 * flips the env var on Vercel.
 */
export function WhatsAppConfigGate() {
  const [info, setInfo] = useState<ProviderInfo | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/whatsapp/provider')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: ProviderInfo) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    // Fail open: if we can't read the provider, fall back to Meta UI so
    // the user isn't stuck. The endpoint itself never auths so this
    // should only fail on a deploy/config bug.
    return <WhatsAppConfig />;
  }

  if (!info) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (info.provider === 'uazapi') {
    return <UazapiComingSoon configured={info.uazapi_configured} />;
  }

  return <WhatsAppConfig />;
}

function UazapiComingSoon({ configured }: { configured: boolean }) {
  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  return (
    <section className="animate-in fade-in-50 duration-200">
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-start gap-4 py-10">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            >
              <Clock className="mr-1 size-3" />
              Em breve
            </Badge>
            <Badge variant="outline">Provider: UazAPI</Badge>
            {configured && (
              <Badge variant="outline" className="border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                Webhook token set
              </Badge>
            )}
          </div>

          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Painel UazAPI — em construção
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                O backend já aceita webhooks UazAPI (provider-aware). O que
                falta é a UI de configuração dedicada: status da conexão,
                instance name, scan QR, e pareamento de números. Está no
                roadmap da Phase 2.
              </p>
            </div>
          </div>

          {webhookUrl && (
            <div className="w-full rounded-md border bg-muted/40 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">
                Webhook URL (já funciona)
              </div>
              <code className="mt-1 block break-all text-xs text-muted-foreground">
                {webhookUrl}?token=&lt;UAZAPI_WEBHOOK_TOKEN&gt;
              </code>
              <p className="mt-2 text-xs text-muted-foreground">
                Cole essa URL + o token no painel da UazAPI e os eventos{' '}
                <code className="rounded bg-background px-1">messages.upsert</code>{' '}
                e{' '}
                <code className="rounded bg-background px-1">messages.update</code>{' '}
                já começam a cair na tabela{' '}
                <code className="rounded bg-background px-1">messages</code> do
                Supabase.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}