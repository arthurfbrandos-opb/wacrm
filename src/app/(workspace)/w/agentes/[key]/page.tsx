"use client";

// Tela de USO de um agente individual (D3) — o template muda pela especialidade:
//   gerador  → formulário tema+tipo → job gerar_peca → acompanha → link da peça
//   publisher → orienta (ele age na peça aprovada, botão Agendar)
//   demais/em breve → estado honesto
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { TerminalWindow } from "@/components/ui/terminal-window";
import { createClient } from "@/lib/supabase/client";
import { SPECIALTY_LABEL } from "@/lib/workspace/catalog";

interface AgentRow {
  key: string;
  name: string;
  specialty: string | null;
  status: string;
}

interface JobRow {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  piece_id: string | null;
  error: string | null;
  created_at: string;
}

// Etapas reais da produção (mesma experiência falada da linha editorial —
// pedido Arthur 02/07: sem isso a tela parece travada e a pessoa clica de novo).
// Avanço estimado pelo tempo; a última etapa fecha quando o job termina.
const STEPS_PECA: { at: number; label: string }[] = [
  { at: 0, label: "lendo a fundação da sua marca (tom de voz · cliente ideal)" },
  { at: 25, label: "escrevendo a copy da peça" },
  { at: 150, label: "renderizando a arte com as suas fotos" },
  { at: 320, label: "finalizando e subindo pra sua aprovação" },
];
const STEPS_VIDEO: { at: number; label: string }[] = [
  { at: 0, label: "lendo a fundação da sua marca" },
  { at: 20, label: "escolhendo o ângulo do vídeo" },
  { at: 60, label: "escrevendo o roteiro cena a cena" },
  { at: 130, label: "preparando a legenda da publicação" },
];

function ProducaoSteps({ createdAt, video, pending }: { createdAt: string; video: boolean; pending: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const steps = video ? STEPS_VIDEO : STEPS_PECA;
  const elapsed = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  const currentIdx = pending ? 0 : steps.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0);

  return (
    <div className="flex flex-col gap-1.5">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2">
          {i < currentIdx ? (
            <span className="w-3 text-center font-mono text-[10px] text-primary">✓</span>
          ) : i === currentIdx ? (
            <span className="flex w-3 justify-center">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" />
            </span>
          ) : (
            <span className="w-3 text-center font-mono text-[10px] text-muted-foreground/40">·</span>
          )}
          <span
            className={
              i === currentIdx
                ? "font-mono text-xs text-foreground"
                : i < currentIdx
                  ? "font-mono text-xs text-muted-foreground"
                  : "font-mono text-xs text-muted-foreground/50"
            }
          >
            {s.label}
          </span>
        </div>
      ))}
      <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
        {pending
          ? "na fila — a squad pega em instantes"
          : `${elapsed}s — a tela atualiza sozinha quando ficar pronta`}
      </p>
    </div>
  );
}

// Tipo default da peça derivado do agente (o Gerador de Estático gera estático;
// o Roteirista de Vídeo gera roteiro de vídeo).
function tipoDoAgente(key: string): "carrossel" | "estatico" | "video" {
  if (key.includes("roteirista") || key.includes("video")) return "video";
  return key.includes("estatico") ? "estatico" : "carrossel";
}

const TIPO_LABEL = { carrossel: "carrossel", estatico: "estático", video: "vídeo" } as const;

export default function UsarAgentePage() {
  const params = useParams<{ key: string }>();
  const [agent, setAgent] = useState<AgentRow | null | undefined>(undefined);
  // Veio da aba Agentes da squad? O "voltar" devolve pra lá (via window pra
  // não exigir Suspense do useSearchParams no prerender).
  const [deSquad, setDeSquad] = useState(false);
  useEffect(() => {
    setDeSquad(new URLSearchParams(window.location.search).get("de") === "squad");
  }, []);
  const [tema, setTema] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    supabase
      .from("os_agent_registry")
      .select("key, name, specialty, status")
      .eq("kind", "agent")
      .eq("key", params.key)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (!alive) return;
        if (err) setError(err.message);
        setAgent((data as AgentRow) ?? null);
      });
    return () => {
      alive = false;
    };
  }, [params.key]);

  // Poll do job disparado (até done/failed).
  useEffect(() => {
    if (!jobId) return;
    const supabase = createClient();
    const tick = async () => {
      const { data } = await supabase
        .from("content_jobs")
        .select("id, status, piece_id, error, created_at")
        .eq("id", jobId)
        .maybeSingle();
      if (data) {
        setJob(data as JobRow);
        if (data.status === "done" || data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }
    };
    void tick();
    pollRef.current = setInterval(tick, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId]);

  const gerar = async () => {
    if (!agent || busy || !tema.trim()) return;
    setBusy(true);
    setError(null);
    setJob(null);
    try {
      const res = await fetch("/api/workspace/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tema: tema.trim(), tipo: tipoDoAgente(agent.key) }),
      });
      const data = (await res.json().catch(() => null)) as
        | { jobId?: string; error?: string }
        | null;
      if (!res.ok || !data?.jobId) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setJobId(data.jobId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const emProducao = job && (job.status === "pending" || job.status === "running");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
        <Link
          href={deSquad ? "/w/content/agentes" : "/w/agentes"}
          className="hover:text-foreground"
        >
          {deSquad ? "← squad · agentes" : "← agentes"}
        </Link>{" "}
        / usar
      </p>

      {error ? <p className="text-sm text-destructive">Falha: {error}</p> : null}

      {agent === undefined ? (
        <p className="font-mono text-sm text-muted-foreground">carregando…</p>
      ) : agent === null ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="font-mono text-sm text-foreground">Agente não encontrado</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <Bot className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">{agent.name}</h1>
              <p className="font-mono text-sm text-muted-foreground">
                {SPECIALTY_LABEL[agent.specialty ?? ""] ?? "Especialista"}
              </p>
            </div>
          </div>

          {agent.status !== "active" ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
              <p className="font-mono text-sm text-foreground">Este agente ainda não está ativo</p>
              <p className="mt-1 text-xs text-muted-foreground">Ele aparece aqui assim que for ligado no seu plano.</p>
            </div>
          ) : agent.specialty === "gerador" || agent.specialty === "roteirista" ? (
            <TerminalWindow title={`agentes/${agent.specialty}`}>
              <div className="flex flex-col gap-3 p-4">
              <label
                htmlFor="tema"
                className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                {tipoDoAgente(agent.key) === "video"
                  ? "Tema do vídeo (você recebe o roteiro pronto pra gravar)"
                  : `Tema da peça (${TIPO_LABEL[tipoDoAgente(agent.key)]})`}
              </label>
              <textarea
                id="tema"
                value={tema}
                onChange={(e) => setTema(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={
                  tipoDoAgente(agent.key) === "video"
                    ? "Ex.: você sabia que uma ação de execução pode ser anulada do zero?"
                    : "Ex.: banco cobrou tarifa de cadastro no financiamento — o que o cliente pode fazer"
                }
                className="resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || !tema.trim() || !!emProducao}
                onClick={gerar}
                className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 font-mono text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
              >
                {emProducao
                  ? "Produzindo…"
                  : tipoDoAgente(agent.key) === "video"
                    ? "Montar roteiro"
                    : "Gerar peça"}
              </button>

              {job ? (
                <div className="rounded-lg border border-border bg-card/40 p-3">
                  {emProducao ? (
                    <ProducaoSteps
                      createdAt={job.created_at}
                      video={tipoDoAgente(agent.key) === "video"}
                      pending={job.status === "pending"}
                    />
                  ) : job.status === "done" ? (
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-xs text-primary">
                        ✓ {tipoDoAgente(agent.key) === "video" ? "Roteiro pronto" : "Peça pronta"} — está em &ldquo;Pra aprovar&rdquo;.
                      </p>
                      {job.piece_id ? (
                        <Link
                          href={`/w/content/pecas/${job.piece_id}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          ver peça ▸
                        </Link>
                      ) : null}
                    </div>
                  ) : (
                    <p className="font-mono text-xs text-destructive">
                      A produção falhou{job.error ? `: ${job.error}` : ""} — tente de novo.
                    </p>
                  )}
                </div>
              ) : null}
              </div>
            </TerminalWindow>
          ) : agent.specialty === "publisher" ? (
            <TerminalWindow title="agentes/publisher">
              <div className="p-4">
              <p className="font-mono text-sm text-foreground">O Publisher trabalha na peça</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Quando você <strong className="text-foreground">aprova</strong> uma peça, aparece o botão{" "}
                <strong className="text-foreground">Agendar via Metricool</strong> no detalhe dela — é ele
                que executa o agendamento e confirma aqui na ferramenta.
              </p>
              <Link
                href="/w/content/kanban"
                className="mt-4 inline-block rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 font-mono text-sm text-primary transition-colors hover:bg-primary/20"
              >
                Abrir o kanban ▸
              </Link>
              </div>
            </TerminalWindow>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
              <p className="font-mono text-sm text-foreground">Tela de uso em construção</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Enquanto isso, fale com o squad pelo chat — ele atende esse pedido por lá.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
