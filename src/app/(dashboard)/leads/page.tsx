'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SetupAgentesLead } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UserPlus, Loader2 } from 'lucide-react';
import { TerminalWindow } from '@/components/ui/terminal-window';

/**
 * Reads the `utm` jsonb blob and returns the campaign label if present.
 * The lead magnet form posts UTMs when the visitor arrived from an ad;
 * organic visitors have an empty object, so we fall back to "—".
 */
function campaign(utm: SetupAgentesLead['utm']): string {
  if (!utm || typeof utm !== 'object') return '—';
  const c =
    (utm as Record<string, unknown>).utm_campaign ??
    (utm as Record<string, unknown>).campaign;
  return typeof c === 'string' && c.length > 0 ? c : '—';
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<SetupAgentesLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchLeads() {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('setup_agentes_leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setLeads(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar leads');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLeads();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold text-foreground">
            <span className="text-primary">▸</span> leads
          </h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            # leads capturados pelo lead magnet (setup de agentes) ·{' '}
            {leads.length} {leads.length === 1 ? 'cadastro' : 'cadastros'}
          </p>
        </div>
      </div>

      {leads.length === 0 ? (
        <TerminalWindow title="leads/setup-agentes">
          <div className="flex h-64 flex-col items-center justify-center">
            <UserPlus className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Nenhum lead ainda
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Os cadastros do formulário de acesso aos agentes aparecem aqui.
            </p>
          </div>
        </TerminalWindow>
      ) : (
        <TerminalWindow title="leads/setup-agentes">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Nome</TableHead>
                  <TableHead className="text-muted-foreground">E-mail</TableHead>
                  <TableHead className="hidden text-muted-foreground sm:table-cell">
                    Origem
                  </TableHead>
                  <TableHead className="hidden text-muted-foreground lg:table-cell">
                    Campanha
                  </TableHead>
                  <TableHead className="hidden text-muted-foreground sm:table-cell">
                    Data
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow
                    key={lead.id}
                    className="border-border hover:bg-muted/50"
                  >
                    <TableCell className="font-medium text-foreground">
                      {lead.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <a
                        href={`mailto:${lead.email}`}
                        className="hover:text-primary hover:underline"
                      >
                        {lead.email}
                      </a>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {lead.source ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {campaign(lead.utm)}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground tabular-nums sm:table-cell">
                      {new Date(lead.created_at).toLocaleDateString('pt-BR')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TerminalWindow>
      )}
    </div>
  );
}
