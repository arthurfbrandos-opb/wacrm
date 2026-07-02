"use client";

// Configurações / Integrações do workspace.
// Metricool: real (fatia ⑤) — token colado aqui vai cifrado pro cofre da conta e
// NUNCA volta pro navegador (nem cifrado). Google Drive: fatia ⑥ (em breve).
import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Send } from "lucide-react";

interface Connection {
  provider: string;
  status: "connected" | "disconnected";
  config: Record<string, unknown>;
  updated_at: string;
}

export default function WorkspaceConfigPage() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/workspace/integrations");
      const data = (await res.json().catch(() => null)) as
        | { connections?: Connection[]; error?: string }
        | null;
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setConnections(data?.connections ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const metricool = connections?.find((c) => c.provider === "metricool");
  const metricoolOn = metricool?.status === "connected";
  const gdrive = connections?.find((c) => c.provider === "google_drive");
  const gdriveOn = gdrive?.status === "connected";
  const [folderUrl, setFolderUrl] = useState("");

  const save = async (payload: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch("/api/workspace/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setToken("");
      setFeedback(okMsg);
      await refetch();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Configurações
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold text-foreground">Integrações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Suas contas conectadas ficam aqui. Credenciais são guardadas criptografadas e
          nunca aparecem no navegador.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">Falha: {error}</p> : null}
      {feedback ? <p className="text-sm text-primary">{feedback}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Metricool — real */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Send className="h-4 w-4" />
              </span>
              <div>
                <p className="font-mono text-sm font-medium text-foreground">Metricool</p>
                <p className="text-xs text-muted-foreground">
                  agendamento e publicação nas suas redes
                </p>
              </div>
            </div>
            <span
              className={
                metricoolOn
                  ? "rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary"
                  : "rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
              }
            >
              {connections === null ? "…" : metricoolOn ? "conectado" : "desconectado"}
            </span>
          </div>

          {metricoolOn ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => save({ provider: "metricool", disconnect: true }, "Metricool desconectado.")}
              className="mt-4 w-full rounded-lg border border-border px-3 py-2 font-mono text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Desconectar
            </button>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Cole o token do Metricool"
                autoComplete="off"
                className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || !token.trim()}
                onClick={() => save({ provider: "metricool", token: token.trim() }, "Metricool conectado.")}
                className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 font-mono text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
              >
                Conectar
              </button>
            </div>
          )}
        </div>

        {/* Google Drive — pasta de imagens de fundo (compartilhada por link) */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={
                  gdriveOn
                    ? "flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary"
                    : "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"
                }
              >
                <FolderOpen className="h-4 w-4" />
              </span>
              <div>
                <p className="font-mono text-sm font-medium text-foreground">Google Drive</p>
                <p className="text-xs text-muted-foreground">
                  pasta de imagens de fundo dos seus conteúdos
                </p>
              </div>
            </div>
            <span
              className={
                gdriveOn
                  ? "rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary"
                  : "rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
              }
            >
              {connections === null ? "…" : gdriveOn ? "conectado" : "desconectado"}
            </span>
          </div>

          {gdriveOn ? (
            <div className="mt-4 flex flex-col gap-2">
              <p className="truncate rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
                {String((gdrive?.config as { folder_url?: string })?.folder_url ?? "")}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  save({ provider: "google_drive", disconnect: true }, "Pasta desconectada.")
                }
                className="rounded-lg border border-border px-3 py-2 font-mono text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                Desconectar
              </button>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              <input
                type="url"
                value={folderUrl}
                onChange={(e) => setFolderUrl(e.target.value)}
                placeholder="Cole o link da pasta (compartilhada: qualquer pessoa com o link)"
                className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || !folderUrl.trim()}
                onClick={() =>
                  save(
                    { provider: "google_drive", config: { folder_url: folderUrl.trim() } },
                    "Pasta conectada — o squad passa a usar suas imagens de fundo.",
                  )
                }
                className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 font-mono text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
              >
                Conectar pasta
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
