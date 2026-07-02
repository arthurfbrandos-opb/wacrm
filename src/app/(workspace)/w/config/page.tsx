"use client";

// Configurações / Integrações do workspace. As conexões reais ligam nas fatias
// ⑤ (Metricool) e ⑥ (Google Drive + pasta de imagens de fundo) — visível-desligado até lá.
import { FolderOpen, Send } from "lucide-react";

const INTEGRATIONS = [
  {
    key: "metricool",
    name: "Metricool",
    hint: "agendamento e publicação nas suas redes",
    icon: Send,
  },
  {
    key: "gdrive",
    name: "Google Drive",
    hint: "pasta de imagens de fundo dos seus conteúdos",
    icon: FolderOpen,
  },
];

export default function WorkspaceConfigPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Configurações
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold text-foreground">
          Integrações
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Suas contas conectadas ficam aqui. Credenciais são guardadas criptografadas e
          nunca aparecem no navegador.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {INTEGRATIONS.map((i) => (
          <div key={i.key} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                  <i.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-mono text-sm font-medium text-foreground">{i.name}</p>
                  <p className="text-xs text-muted-foreground">{i.hint}</p>
                </div>
              </div>
              <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                em breve
              </span>
            </div>
            <button
              type="button"
              disabled
              className="mt-4 w-full cursor-not-allowed rounded-lg border border-border px-3 py-2 font-mono text-sm text-muted-foreground opacity-60"
            >
              Conectar · em breve
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
