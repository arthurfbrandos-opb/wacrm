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
}

// Tipo default da peça derivado do agente (o Gerador de Estático gera estático).
function tipoDoAgente(key: string): "carrossel" | "estatico" {
  return key.includes("estatico") ? "estatico" : "carrossel";
}

export default function UsarAgentePage() {
  const params = useParams<{ key: string }>();
  const [agent, setAgent] = useState<AgentRow | null | undefined>(undefined);
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
        .select("id, status, piece_id, error")
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
        <Link href="/w/agentes" className="hover:text-foreground">
          agentes
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
          ) : agent.specialty === "gerador" ? (
            <TerminalWindow title="agentes/gerador">
              <div className="flex flex-col gap-3 p-4">
              <label
                htmlFor="tema"
                className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                Tema da peça ({tipoDoAgente(agent.key) === "carrossel" ? "carrossel" : "estático"})
              </label>
              <textarea
                id="tema"
                value={tema}
                onChange={(e) => setTema(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Ex.: banco cobrou tarifa de cadastro no financiamento — o que o cliente pode fazer"
                className="resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || !tema.trim() || !!emProducao}
                onClick={gerar}
                className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 font-mono text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
              >
                {emProducao ? "Produzindo…" : "Gerar peça"}
              </button>

              {job ? (
                <div className="rounded-lg border border-border bg-card/40 p-3">
                  {emProducao ? (
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                      <p className="font-mono text-xs text-muted-foreground">
                        o agente está produzindo — pode levar alguns minutos…
                      </p>
                    </div>
                  ) : job.status === "done" ? (
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-xs text-primary">✓ Peça pronta — está em &ldquo;Pra aprovar&rdquo;.</p>
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
