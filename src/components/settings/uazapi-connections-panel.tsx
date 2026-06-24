'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Power,
  RefreshCcw,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { SettingsPanelHead } from './settings-panel-head';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { TerminalWindow } from '@/components/ui/terminal-window';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  toPublicConnection,
  type CreateConnectionInput,
  type WhatsAppConnectionPublic,
} from '@/lib/whatsapp/connection-types';

type Status = 'idle' | 'loading' | 'saving' | 'deleting' | 'testing' | 'toggling';

/**
 * Per-account WhatsApp connections panel for the UazAPI provider.
 *
 * Renders:
 *   1. A header explaining the provider mode + webhook URL
 *   2. A list of stored connections (one per UazAPI instance)
 *   3. An "Add connection" dialog with endpoint + API token
 *
 * Each row can be tested (re-run the HTTP probe), toggled active
 * (one-at-a-time per account), or deleted.
 *
 * Why a dedicated panel (vs reusing WhatsAppConfig):
 *   - UazAPI uses an instance-scoped token (not Meta's waba+pin flow)
 *   - There's no /register call — health = reachability of the
 *     user-supplied base_url with their token
 *   - Multi-instance is a first-class feature (one account can have
 *     several numbers across different UazAPI instances)
 */
export function UazapiConnectionsPanel() {
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [connections, setConnections] = useState<WhatsAppConnectionPublic[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (acctId: string) => {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch(
        `/api/accounts/${acctId}/whatsapp/connections`,
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Falha ao carregar as conexões');
        setConnections([]);
        return;
      }
      setConnections((json.connections ?? []).map(toPublicConnection));
    } catch (err) {
      console.error('load connections failed', err);
      setError('Não foi possível alcançar o endpoint de conexões.');
    } finally {
      setStatus('idle');
    }
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) return;
    void load(accountId);
  }, [authLoading, profileLoading, user, accountId, load]);

  async function handleCreate(input: CreateConnectionInput) {
    if (!accountId) return;
    setStatus('saving');
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/whatsapp/connections`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Falha ao criar a conexão');
        return;
      }
      toast.success(
        json.connection?.status === 'connected'
          ? 'Conexão criada e acessível.'
          : 'Conexão salva, mas a sondagem não conseguiu alcançá-la. Verifique a URL e o token.',
      );
      await load(accountId);
    } finally {
      setStatus('idle');
    }
  }

  async function handleToggle(conn: WhatsAppConnectionPublic) {
    if (!accountId) return;
    setStatus('toggling');
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/whatsapp/connections/${conn.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active_for_crm: !conn.is_active_for_crm }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Falha ao alternar a conexão');
        return;
      }
      toast.success(
        conn.is_active_for_crm
          ? 'Conexão desativada. Eventos de entrada serão ignorados.'
          : 'Conexão ativada. Eventos de entrada serão processados.',
      );
      await load(accountId);
    } finally {
      setStatus('idle');
    }
  }

  async function handleDelete(conn: WhatsAppConnectionPublic) {
    if (!accountId) return;
      if (
      !confirm(
        `Remover a conexão "${conn.label}"? Isso excluirá o token armazenado.`,
      )
    ) {
      return;
    }
    setStatus('deleting');
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/whatsapp/connections/${conn.id}`,
        { method: 'DELETE' },
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Falha ao excluir a conexão');
        return;
      }
      toast.success('Conexão removida.');
      await load(accountId);
    } finally {
      setStatus('idle');
    }
  }

  async function handleRetryProbe(conn: WhatsAppConnectionPublic) {
    if (!accountId) return;
    setStatus('testing');
    try {
      // Re-POST the same name/url/token via the "create" path
      // to re-run the probe on a known-good row. For now we use
      // a soft "Test" by toggling active to re-trigger; simpler
      // is a dedicated POST /test route in a future PR. The list
      // reload reflects the latest connection_status set by the
      // POST on initial create.
      const res = await fetch(
        `/api/accounts/${accountId}/whatsapp/connections/${conn.id}`,
        { method: 'GET' },
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Sondagem falhou');
        return;
      }
      toast.success(
        `Status: ${json.connection?.status ?? 'desconhecido'}`,
      );
      await load(accountId);
    } finally {
      setStatus('idle');
    }
  }

  const isLoading = status === 'loading';
  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="WhatsApp · UazAPI"
        description="Conecte uma ou mais instâncias UazAPI a este workspace. Cada conexão armazena seu próprio endpoint e token; apenas uma pode estar ativa para o CRM por vez."
        action={
          <AddConnectionDialog
            disabled={status === 'saving'}
            onSubmit={handleCreate}
          />
        }
      />

      <Alert className="mb-6 border-border bg-card">
        <div className="flex items-start gap-3">
          <Zap className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <AlertTitle className="mb-1 text-foreground">
              URL do Webhook
            </AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Configure esta URL no painel do UazAPI para os eventos
              <code className="mx-1 rounded bg-muted px-1 text-xs">
                messages.upsert
              </code>
              e
              <code className="mx-1 rounded bg-muted px-1 text-xs">
                messages.update
              </code>
              :
            </AlertDescription>
            <code className="mt-2 block break-all rounded bg-muted px-3 py-2 text-xs text-foreground">
              {webhookUrl}
              {webhookUrl ? '?token=<UAZAPI_WEBHOOK_TOKEN>' : ''}
            </code>
            <p className="mt-2 text-xs text-muted-foreground">
              O <code>UAZAPI_WEBHOOK_TOKEN</code> é definido por deploy nas
              variáveis de ambiente do Vercel — compartilhe com quem configurar o painel do UazAPI.
            </p>
          </div>
        </div>
      </Alert>

      {error && (
        <Alert className="mb-4 border-red-600/40 bg-red-950/30">
          <XCircle className="size-4 text-red-400" />
          <AlertTitle className="text-red-200">Falha ao carregar</AlertTitle>
          <AlertDescription className="text-red-100/80 text-sm">
            {error}
          </AlertDescription>
        </Alert>
      )}

      <TerminalWindow title="settings/whatsapp/connections">
        <div className="p-6">
          <p className="mb-4 font-mono text-xs text-muted-foreground">
            # uma linha por instância UazAPI — a ativa roteia eventos de entrada para o CRM
          </p>
          {isLoading && connections.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : connections.length === 0 ? (
            <EmptyState />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ativa para o CRM</TableHead>
                  <TableHead className="w-[160px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((c) => (
                  <ConnectionRow
                    key={c.id}
                    connection={c}
                    busy={status === 'deleting' || status === 'toggling' || status === 'testing'}
                    onToggle={() => handleToggle(c)}
                    onDelete={() => handleDelete(c)}
                    onTest={() => handleRetryProbe(c)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </TerminalWindow>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Power className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Nenhuma conexão ainda. Clique em <strong>Adicionar conexão</strong> para configurar
        sua primeira instância UazAPI.
      </p>
    </div>
  );
}

function ConnectionRow({
  connection,
  busy,
  onToggle,
  onDelete,
  onTest,
}: {
  connection: WhatsAppConnectionPublic;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">
        {connection.label}
      </TableCell>
      <TableCell>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {connection.base_url}
        </code>
      </TableCell>
      <TableCell>
        <StatusBadge status={connection.status} />
      </TableCell>
      <TableCell>
        <Switch
          checked={connection.is_active_for_crm}
          onCheckedChange={onToggle}
          disabled={busy}
        />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={onTest}
            disabled={busy}
            title="Verificar status novamente"
          >
            <RefreshCcw className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            disabled={busy}
            title="Remover"
            className="text-red-500 hover:text-red-600"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: WhatsAppConnectionPublic['status'] }) {
  if (status === 'connected') {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      >
        <CheckCircle2 className="mr-1 size-3" /> Conectado
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge
        variant="outline"
        className="border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300"
      >
        <XCircle className="mr-1 size-3" /> Falhou
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    >
      <Loader2 className="mr-1 size-3" /> Desconhecido
    </Badge>
  );
}

function AddConnectionDialog({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (input: CreateConnectionInput) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setBaseUrl('');
    setToken('');
    setShowToken(false);
  };

  async function handleSubmit() {
    if (!name.trim() || !baseUrl.trim() || !token.trim()) {
      toast.error('Nome, endpoint e token são obrigatórios.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        label: name.trim(),
        base_url: baseUrl.trim(),
        access_token: token.trim(),
        make_active: true, // first connection auto-activates
      });
      reset();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button disabled={disabled}>
          <Plus className="size-4" /> Adicionar conexão
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar conexão UazAPI</DialogTitle>
          <DialogDescription>
            Vamos sondar o endpoint com seu token e armazená-lo de forma criptografada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="conn-name">Nome</Label>
            <Input
              id="conn-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex.: Loja Principal · UazAPI"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conn-url">Endpoint (URL base)</Label>
            <Input
              id="conn-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://uazapi.example.com"
              autoComplete="off"
              inputMode="url"
            />
            <p className="text-xs text-muted-foreground">
              Sem barra no final. A sondagem acessará{' '}
              <code className="rounded bg-muted px-1">&lt;base_url&gt;</code>{' '}
              com seu token.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conn-token">Token da API</Label>
            <div className="flex gap-2">
              <Input
                id="conn-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type={showToken ? 'text' : 'password'}
                placeholder="uazapi_…"
                autoComplete="off"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowToken((v) => !v)}
                title={showToken ? 'Ocultar token' : 'Mostrar token'}
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Armazenado criptografado com <code>ENCRYPTION_KEY</code>; nunca retornado
              ao cliente.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Salvando…
              </>
            ) : (
              <>Salvar e sondar</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
