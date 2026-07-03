"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Card "Google Drive" das Configurações — o cliente conecta a PRÓPRIA conta
// (OAuth) e escolhe pelo Google Picker (seletor nativo do Drive):
//   · as FOTOS pras artes (seleção múltipla de ARQUIVOS — o escopo drive.file
//     só enxerga o que foi escolhido no Picker; pasta não dá leitura do que já
//     existia dentro, provado por efeito 02/07)
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
        // Fotos = ARQUIVOS de imagem (multiseleção), navegando pelas pastas do
        // Drive — abre já dentro da pasta de fotos se ele escolheu uma antes.
        // Conteúdos = PASTA.
        let view;
        if (kind === "fotos") {
          view = new g.picker.DocsView(g.picker.ViewId.DOCS)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(false)
            .setMimeTypes("image/png,image/jpeg,image/webp,application/vnd.google-apps.folder");
          const pastaAntiga = String(config["fotos_folder_id"] ?? "");
          if (pastaAntiga) view = view.setParent(pastaAntiga);
        } else {
          view = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(true)
            .setMimeTypes("application/vnd.google-apps.folder");
        }
        let builder = new g.picker.PickerBuilder()
          .setOAuthToken(tokenJson.access_token)
          .setDeveloperKey(PICKER_KEY)
          .setAppId(PROJECT_NUMBER)
          .addView(view)
          .setTitle(
            kind === "fotos"
              ? "Marque as FOTOS pras artes (navegue até a pasta · pode marcar várias)"
              : "Escolha a pasta de CONTEÚDOS",
          )
          .setCallback(async (data: any) => {
            if (data.action !== g.picker.Action.PICKED) {
              if (data.action === g.picker.Action.CANCEL) setPicking(null);
              return;
            }
            const docs = (data.docs ?? []).filter((d: any) => d?.id);
            if (!docs.length) return;
            const body =
              kind === "fotos"
                ? {
                    kind,
                    files: docs.map((d: any) => ({ id: d.id, name: d.name ?? "" })),
                  }
                : { kind, folder_id: docs[0].id, folder_name: docs[0].name ?? "" };
            const res = await fetch("/api/workspace/integrations/google/picker", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const json = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) setErr(json.error ?? `erro ${res.status}`);
            setPicking(null);
            onChanged();
          });
        if (kind === "fotos") {
          builder = builder.enableFeature(g.picker.Feature.MULTISELECT_ENABLED);
        }
        const picker = builder.build();
        picker.setVisible(true);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setPicking(null);
      }
    },
    [onChanged, config],
  );

  const fotosFiles = Array.isArray(config["fotos_files"])
    ? (config["fotos_files"] as { id?: string; name?: string }[])
    : [];
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
                {
                  kind: "fotos" as const,
                  rotulo: "Fotos pras artes",
                  valor: fotosFiles.length
                    ? `${fotosFiles.length} foto(s) escolhida(s)`
                    : "",
                  cta: fotosFiles.length ? "trocar" : "escolher fotos",
                },
                {
                  kind: "conteudos" as const,
                  rotulo: "Pasta de conteúdos",
                  valor: conteudosId ? `📁 ${conteudosNome || conteudosId}` : "",
                  cta: conteudosId ? "trocar" : "escolher pasta",
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
                    {p.valor || "— nenhuma escolhida —"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || picking !== null}
                  onClick={() => void escolher(p.kind)}
                  className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 font-mono text-xs text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                >
                  {picking === p.kind ? "abrindo…" : p.cta}
                </button>
              </div>
            ))}
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
