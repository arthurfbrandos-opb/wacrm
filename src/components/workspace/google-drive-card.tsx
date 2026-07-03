"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Card "Google Drive" das Configurações — o cliente conecta a PRÓPRIA conta
// (OAuth) e escolhe as pastas pelo Google Picker (seletor nativo do Drive):
//   · pasta de FOTOS (fundos das artes — o worker sincroniza antes de cada arte)
//   · pasta de CONTEÚDOS (onde os aprovados são salvos em Ano/Mês/linha)
// O refresh token fica cifrado no servidor; aqui só circula um access token
// de curta duração (da conta do próprio cliente) pro Picker abrir.
import { useCallback, useState } from "react";
import { FolderOpen } from "lucide-react";
import { TerminalWindow } from "@/components/ui/terminal-window";

interface Props {
  connected: boolean;
  config: Record<string, unknown>;
  busy: boolean;
  onDisconnect: () => void;
  onChanged: () => void;
}

const PICKER_KEY = process.env.NEXT_PUBLIC_GOOGLE_PICKER_KEY ?? "";
const PROJECT_NUMBER = process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER ?? "";

let pickerReady: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  if (pickerReady) return pickerReady;
  pickerReady = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.onload = () => (window as any).gapi.load("picker", { callback: () => resolve() });
    s.onerror = () => reject(new Error("não consegui carregar o seletor do Google"));
    document.head.appendChild(s);
  });
  return pickerReady;
}

export function GoogleDriveCard({ connected, config, busy, onDisconnect, onChanged }: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState<"fotos" | "conteudos" | null>(null);

  const escolher = useCallback(
    async (kind: "fotos" | "conteudos") => {
      setErr(null);
      setPicking(kind);
      try {
        const tokenRes = await fetch("/api/workspace/integrations/google/picker", { method: "POST" });
        const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
          access_token?: string;
          error?: string;
        };
        if (!tokenRes.ok || !tokenJson.access_token) {
          throw new Error(tokenJson.error ?? `erro ${tokenRes.status}`);
        }
        await loadPicker();
        const g = (window as any).google;
        const view = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true)
          .setMimeTypes("application/vnd.google-apps.folder");
        const picker = new g.picker.PickerBuilder()
          .setOAuthToken(tokenJson.access_token)
          .setDeveloperKey(PICKER_KEY)
          .setAppId(PROJECT_NUMBER)
          .addView(view)
          .setTitle(kind === "fotos" ? "Escolha a pasta de FOTOS" : "Escolha a pasta de CONTEÚDOS")
          .setCallback(async (data: any) => {
            if (data.action !== g.picker.Action.PICKED) {
              if (data.action === g.picker.Action.CANCEL) setPicking(null);
              return;
            }
            const doc = data.docs?.[0];
            if (!doc?.id) return;
            const res = await fetch("/api/workspace/integrations/google/picker", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind, folder_id: doc.id, folder_name: doc.name ?? "" }),
            });
            const json = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) setErr(json.error ?? `erro ${res.status}`);
            setPicking(null);
            onChanged();
          })
          .build();
        picker.setVisible(true);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setPicking(null);
      }
    },
    [onChanged],
  );

  const fotosNome = String(config["fotos_folder_name"] ?? "");
  const fotosId = String(config["fotos_folder_id"] ?? "");
  const conteudosNome = String(config["conteudos_folder_name"] ?? "");
  const conteudosId = String(config["conteudos_folder_id"] ?? "");

  return (
    <TerminalWindow title="config/google_drive">
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={
                connected
                  ? "flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary"
                  : "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"
              }
            >
              <FolderOpen className="h-4 w-4" />
            </span>
            <div>
              <p className="font-mono text-sm font-medium text-foreground">Google Drive</p>
              <p className="text-xs text-muted-foreground">
                sua conta conectada: fotos pras artes + onde os conteúdos prontos são salvos
              </p>
            </div>
          </div>
          <span
            className={
              connected
                ? "rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary"
                : "rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
            }
          >
            {connected ? "conectado" : "desconectado"}
          </span>
        </div>

        {err ? <p className="mt-3 font-mono text-xs text-red-400">{err}</p> : null}

        {!connected ? (
          <a
            href="/api/workspace/integrations/google/authorize"
            className="mt-4 block w-full rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-center font-mono text-sm font-medium text-primary transition-colors hover:bg-primary/20"
          >
            Conectar Google Drive ▸
          </a>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {(
              [
                { kind: "fotos" as const, rotulo: "Pasta de fotos", nome: fotosNome, id: fotosId },
                {
                  kind: "conteudos" as const,
                  rotulo: "Pasta de conteúdos",
                  nome: conteudosNome,
                  id: conteudosId,
                },
              ]
            ).map((p) => (
              <div
                key={p.kind}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {p.rotulo}
                  </p>
                  <p className="truncate font-mono text-xs text-foreground">
                    {p.id ? `📁 ${p.nome || p.id}` : "— nenhuma escolhida —"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || picking !== null}
                  onClick={() => void escolher(p.kind)}
                  className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 font-mono text-xs text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                >
                  {picking === p.kind ? "abrindo…" : p.id ? "trocar" : "escolher pasta"}
                </button>
              </div>
            ))}
            <p className="rounded-lg border border-dashed border-border px-3 py-2 font-mono text-[11px] text-muted-foreground">
              ▸ salvar conteúdos aprovados na pasta:{" "}
              <span className="uppercase tracking-wider">em breve</span> — as fotos já valem na
              próxima arte.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={onDisconnect}
              className="rounded-lg border border-border px-3 py-2 font-mono text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Desconectar
            </button>
          </div>
        )}
      </div>
    </TerminalWindow>
  );
}
