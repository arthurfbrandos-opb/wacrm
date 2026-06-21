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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
        setError(json.error ?? 'Failed to load connections');
        setConnections([]);
        return;
      }
      setConnections((json.connections ?? []).map(toPublicConnection));
    } catch (err) {
      console.error('load connections failed', err);
      setError('Could not reach the connections endpoint.');
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
        toast.error(json.error ?? 'Failed to create connection');
        return;
      }
      toast.success(
        json.connection?.status === 'connected'
          ? 'Connection created and reachable.'
          : 'Connection saved, but the probe could not reach it. Check the URL/token.',
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
        toast.error(json.error ?? 'Failed to toggle connection');
        return;
      }
      toast.success(
        conn.is_active_for_crm
          ? 'Connection deactivated. Inbound events will be ignored.'
          : 'Connection activated. Inbound events will be processed.',
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
        `Remove the connection "${conn.label}"? This deletes the stored token.`,
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
        toast.error(json.error ?? 'Failed to delete connection');
        return;
      }
      toast.success('Connection removed.');
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
        toast.error(json.error ?? 'Probe failed');
        return;
      }
      toast.success(
        `Status: ${json.connection?.status ?? 'unknown'}`,
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
        description="Connect one or more UazAPI instances to this workspace. Each connection stores its own endpoint and token; only one can be active for the CRM at a time."
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
              Webhook URL
            </AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Configure this URL in your UazAPI dashboard for the events
              <code className="mx-1 rounded bg-muted px-1 text-xs">
                messages.upsert
              </code>
              and
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
              The <code>UAZAPI_WEBHOOK_TOKEN</code> is set per deployment in
              Vercel env vars — share it with whoever configures the UazAPI
              dashboard.
            </p>
          </div>
        </div>
      </Alert>

      {error && (
        <Alert className="mb-4 border-red-600/40 bg-red-950/30">
          <XCircle className="size-4 text-red-400" />
          <AlertTitle className="text-red-200">Failed to load</AlertTitle>
          <AlertDescription className="text-red-100/80 text-sm">
            {error}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connections</CardTitle>
          <CardDescription>
            One row per UazAPI instance. The active one routes inbound events
            into the CRM.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                  <TableHead>Name</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Active for CRM</TableHead>
                  <TableHead className="w-[160px] text-right">Actions</TableHead>
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
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Power className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        No connections yet. Click <strong>Add connection</strong> to wire up
        your first UazAPI instance.
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
            title="Re-check status"
          >
            <RefreshCcw className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            disabled={busy}
            title="Remove"
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
        <CheckCircle2 className="mr-1 size-3" /> Connected
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge
        variant="outline"
        className="border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300"
      >
        <XCircle className="mr-1 size-3" /> Failed
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    >
      <Loader2 className="mr-1 size-3" /> Unknown
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
      toast.error('Name, endpoint and token are all required.');
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
          <Plus className="size-4" /> Add connection
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add UazAPI connection</DialogTitle>
          <DialogDescription>
            We&apos;ll probe the endpoint with your token and store it encrypted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="conn-name">Name</Label>
            <Input
              id="conn-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Loja Principal · UazAPI"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conn-url">Endpoint (base URL)</Label>
            <Input
              id="conn-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://uazapi.example.com"
              autoComplete="off"
              inputMode="url"
            />
            <p className="text-xs text-muted-foreground">
              No trailing slash. The probe will hit{' '}
              <code className="rounded bg-muted px-1">&lt;base_url&gt;</code>{' '}
              with your token.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conn-token">API token</Label>
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
                title={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored encrypted with <code>ENCRYPTION_KEY</code>; never returned
              to the client.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Saving…
              </>
            ) : (
              <>Save & probe</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
