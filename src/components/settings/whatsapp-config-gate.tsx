'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, Smartphone } from 'lucide-react';
import { WhatsAppConfig } from './whatsapp-config';
import { UazapiConnectionsPanel } from './uazapi-connections-panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * WhatsApp settings — two coexisting channels, side by side:
 *
 *   - "Oficial (API Meta)"   → <WhatsAppConfig />: the WhatsApp Cloud API
 *     (official Business API; needs a Meta app + a verified number).
 *   - "Não Oficial (UazAPI)" → <UazapiConnectionsPanel />: connect a plain
 *     WhatsApp number through a UazAPI instance (endpoint + token), with no
 *     Meta approval.
 *
 * Both can be configured at the same time. Each inbound/outbound message is
 * stamped with its origin provider, and a contact can be transferred between
 * the two (handled in the contact detail UI). This panel only CONFIGURES
 * both channels; the webhook normalizer still keys off WA_PROVIDER per deploy.
 */
export function WhatsAppConfigGate() {
  const [tab, setTab] = useState<string>('oficial');

  // Land on whichever channel this deploy currently routes through, so the
  // most relevant config is in front of the user first. Best-effort only.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/whatsapp/provider')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.provider === 'uazapi') setTab('nao-oficial');
      })
      .catch(() => {
        /* default tab is fine */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">WhatsApp</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecte pela API oficial da Meta ou por um número não oficial via
          UazAPI — você pode manter os dois ativos ao mesmo tempo. Cada conversa
          fica marcada pela origem, e dá pra transferir um contato de um canal
          pro outro.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="oficial">
            <ShieldCheck />
            WhatsApp Oficial (API Meta)
          </TabsTrigger>
          <TabsTrigger value="nao-oficial">
            <Smartphone />
            WhatsApp Não Oficial (UazAPI)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="oficial" className="pt-4">
          <WhatsAppConfig />
        </TabsContent>
        <TabsContent value="nao-oficial" className="pt-4">
          <UazapiConnectionsPanel />
        </TabsContent>
      </Tabs>
    </section>
  );
}
