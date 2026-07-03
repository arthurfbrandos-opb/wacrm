"use client";

// Vitrine do Automation Studio (Arthur 03/07): "em breve" visitável — mostra
// o formato gatilho → agente → ação pra gerar desejo, com selo honesto.
import { ArrowRight, Bot, Workflow, Zap } from "lucide-react";
import { TerminalWindow } from "@/components/ui/terminal-window";

const FLUXOS_EXEMPLO = [
  {
    gatilho: "Lead novo chega no WhatsApp",
    agente: "Agente qualifica e responde",
    acao: "Reunião marcada na sua agenda",
  },
  {
    gatilho: "Cliente some por 7 dias",
    agente: "Agente escreve o follow-up",
    acao: "Mensagem certa na hora certa",
  },
  {
    gatilho: "Documento chega por e-mail",
    agente: "Agente lê e resume",
    acao: "Resumo pronto no seu painel",
  },
];

export default function AutomationStudioTeaserPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
          Automation Studio
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">
            Automações sob medida
          </h1>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            em breve
          </span>
        </div>
        <p className="mt-1 max-w-2xl font-mono text-sm text-muted-foreground">
          O formato é simples: um gatilho no seu dia a dia, um agente que trabalha, uma
          ação pronta — sem você encostar. É a próxima camada do seu Command Center.
        </p>
      </div>

      <TerminalWindow title="studio/fluxos_de_exemplo">
        <div className="flex flex-col gap-3 p-4 opacity-70" aria-hidden>
          {FLUXOS_EXEMPLO.map((f) => (
            <div
              key={f.gatilho}
              className="flex flex-col items-stretch gap-2 rounded-lg border border-border bg-card/40 p-3 sm:flex-row sm:items-center"
            >
              <div className="flex flex-1 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#60A5FA]/30 bg-[#60A5FA]/10 text-[#60A5FA]">
                  <Zap className="h-4 w-4" />
                </span>
                <span className="font-mono text-xs text-foreground">{f.gatilho}</span>
              </div>
              <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
              <div className="flex flex-1 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </span>
                <span className="font-mono text-xs text-foreground">{f.agente}</span>
              </div>
              <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
              <div className="flex flex-1 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#4ADE80]/30 bg-[#4ADE80]/10 text-[#4ADE80]">
                  <Workflow className="h-4 w-4" />
                </span>
                <span className="font-mono text-xs text-foreground">{f.acao}</span>
              </div>
            </div>
          ))}
        </div>
      </TerminalWindow>

      <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
        <p className="font-mono text-sm font-medium text-foreground">Em construção pra você</p>
        <p className="mt-2 text-xs text-muted-foreground">
          O Automation Studio chega em breve no seu Command Center. Tem uma rotina que você
          quer automatizar primeiro? Fala com a Negócio Simples — ela entra na fila.
        </p>
      </div>
    </div>
  );
}
