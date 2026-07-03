"use client";

// Configurações / Integrações do workspace.
// Metricool: real (fatia ⑤) — token colado aqui vai cifrado pro cofre da conta e
// NUNCA volta pro navegador (nem cifrado). Google Drive: conta conectada via
// OAuth + pastas escolhidas no Picker (fatia ⑨).
import { useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";
import { TerminalWindow } from "@/components/ui/terminal-window";
import { GoogleDriveCard } from "@/components/workspace/google-drive-card";

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

  // Retorno do OAuth do Google (?google=ok|<erro>) — mostra o resultado e limpa a URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("google");
    if (!q) return;
    if (q === "ok") {
      setFeedback("Google Drive conectado — agora escolha as pastas.");
    } else {
      const motivo: Record<string, string> = {
        "sem-sessao": "sessão expirou no meio — entra de novo e reconecta",
        "estado-invalido": "a volta do Google não bateu com o início (tenta de novo)",
        "sem-refresh": "o Google não devolveu a autorização completa — desconecta o app na sua conta Google (myaccount.google.com → Segurança → Conexões de terceiros) e conecta de novo",
        "erro-banco": "falha ao salvar — tenta de novo",
        erro: "a troca com o Google falhou — tenta de novo (se repetir, me avisa)",
      };
      setError(`Conexão com o Google não fechou: ${motivo[q] ?? q}`);
    }
    window.history.replaceState({}, "", "/w/config");
  }, []);

  const metricool = connections?.find((c) => c.provider === "metricool");
  const metricoolOn = metricool?.status === "connected";
  const googleOauth = connections?.find((c) => c.provider === "google_oauth");
  const googleOn = googleOauth?.status === "connected";

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
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
          Configurações
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-foreground">Integrações</h1>
        <p className="mt-1 max-w-2xl font-mono text-sm text-muted-foreground">
          Suas contas conectadas ficam aqui. Credenciais são guardadas criptografadas e
          nunca aparecem no navegador.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">Falha: {error}</p> : null}
      {feedback ? <p className="text-sm text-primary">{feedback}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Metricool — real */}
        <TerminalWindow title="config/integracoes">
          <div className="p-4">
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
        </TerminalWindow>

        {/* Google Drive — conta conectada (OAuth) + pastas escolhidas no Picker */}
        <GoogleDriveCard
          connected={googleOn}
          config={(googleOauth?.config as Record<string, unknown>) ?? {}}
          busy={busy}
          onDisconnect={() =>
            save({ provider: "google_oauth", disconnect: true }, "Google Drive desconectado.")
          }
          onChanged={() => void refetch()}
        />
      </div>
    </div>
  );
}
