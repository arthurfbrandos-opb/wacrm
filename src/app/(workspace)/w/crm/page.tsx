"use client";

// Vitrine do Comercial/CRM (Arthur 03/07): módulo fora do plano continua
// visitável — esqueleto do funil + o que ele faz, com selo honesto. Gera
// desejo sem fingir que está ativo (regra: WIP/estado sempre explícito).
import { Bot, GitBranch, MessageSquare, TrendingUp } from "lucide-react";
import { TerminalWindow } from "@/components/ui/terminal-window";

const COLUNAS = [
  { label: "Novo lead", cor: "#60A5FA" },
  { label: "Em conversa", cor: "#F59E0B" },
  { label: "Qualificado", cor: "#A78BD8" },
  { label: "Proposta", cor: "#4ADE80" },
  { label: "Fechado", cor: "#22C55E" },
];

const CAPACIDADES = [
  {
    icon: MessageSquare,
    titulo: "Conversas de WhatsApp na ferramenta",
    texto: "cada lead vira um card com a conversa inteira do lado — nada se perde no celular.",
  },
  {
    icon: Bot,
    titulo: "Agente SDR respondendo leads",
    texto: "o primeiro atendimento sai na hora, a qualquer hora — o agente qualifica e você fecha.",
  },
  {
    icon: GitBranch,
    titulo: "Funil visual",
    texto: "os negócios andam por etapas que você define — dá pra ver onde cada venda está parada.",
  },
  {
    icon: TrendingUp,
    titulo: "Régua de follow-up automática",
    texto: "lead que esfriou recebe os toques certos sem ninguém precisar lembrar.",
  },
];

export default function CrmTeaserPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
          Comercial / CRM
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">
            Seu funil de vendas com agentes
          </h1>
          <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-300">
            não incluso no seu plano
          </span>
        </div>
        <p className="mt-1 max-w-2xl font-mono text-sm text-muted-foreground">
          É assim que fica quando o módulo comercial liga: leads entrando, agente SDR
          respondendo e o funil andando — tudo dentro do mesmo Command Center.
        </p>
      </div>

      {/* Esqueleto do funil — só demonstração, sem dado real. */}
      <div className="flex gap-3 overflow-x-auto pb-2 opacity-50" aria-hidden>
        {COLUNAS.map((col) => (
          <div
            key={col.label}
            className="flex min-w-[170px] flex-1 flex-col rounded-xl border border-border bg-card/60 p-4"
          >
            <div className="-mx-4 -mt-4 h-[3px] rounded-t-xl" style={{ backgroundColor: col.cor }} />
            <h3 className="pt-3 text-sm font-semibold text-foreground">{col.label}</h3>
            <div className="mt-3 flex flex-col gap-2">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="h-2.5 w-3/4 rounded bg-muted" />
                <div className="mt-2 h-2 w-1/2 rounded bg-muted/70" />
              </div>
              <div className="rounded-lg border border-dashed border-border/60 px-2 py-6" />
            </div>
          </div>
        ))}
      </div>

      <TerminalWindow title="crm/o_que_ele_faz">
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          {CAPACIDADES.map((c) => (
            <div key={c.titulo} className="flex items-start gap-3 rounded-lg border border-border bg-card/40 p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <c.icon className="h-4 w-4" />
              </span>
              <div>
                <p className="font-mono text-sm font-medium text-foreground">{c.titulo}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{c.texto}</p>
              </div>
            </div>
          ))}
        </div>
      </TerminalWindow>

      <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
        <p className="font-mono text-sm font-medium text-foreground">
          Quer os agentes vendendo por você?
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          O módulo Comercial / CRM entra no seu plano quando você quiser — fale com a
          Negócio Simples e a gente liga essa tela com os seus leads de verdade.
        </p>
      </div>
    </div>
  );
}
