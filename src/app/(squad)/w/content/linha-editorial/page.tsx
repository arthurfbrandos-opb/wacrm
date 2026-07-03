"use client";

// Linha editorial — passo 1 do ciclo de produção (Arthur 02/07): o cliente
// define período + mix + temas, a squad monta a pauta (job gerar_semana) e as
// peças nascem em "Pauta" ancoradas no calendário. Histórico fica salvo e o
// botão "Nova linha editorial" abre o próximo ciclo.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadEditorialLines } from "@/lib/workspace/queries";
import {
  mixLabel,
  validateNewLine,
  type EditorialLine,
  type NewLineInput,
} from "@/lib/workspace/editorial";
import {
  FUNIL_CHIP,
  KIND_LABEL,
  piecePropostaPendente,
  producaoEtapa,
  STATUS_LABEL,
  type ContentPiece,
} from "@/lib/workspace/content";
import { useContentPieces } from "@/hooks/use-content-pieces";
import { TerminalWindow } from "@/components/ui/terminal-window";

const DATE_FMT = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

function fmtPeriodo(line: EditorialLine): string {
  return `${DATE_FMT.format(new Date(`${line.start_date}T12:00:00`))} → ${DATE_FMT.format(new Date(`${line.end_date}T12:00:00`))}`;
}

const LINE_STATUS: Record<EditorialLine["status"], { label: string; cls: string }> = {
  gerando: { label: "montando…", cls: "border-amber-300/40 bg-amber-300/10 text-amber-300" },
  ativa: { label: "ativa", cls: "border-primary/40 bg-primary/10 text-primary" },
  falhou: { label: "falhou", cls: "border-red-400/40 bg-red-400/10 text-red-400" },
  encerrada: { label: "encerrada", cls: "border-border text-muted-foreground" },
};

function NovaLinhaForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<NewLineInput>({
    start_date: "",
    end_date: "",
    carrossel: 2,
    estatico: 2,
    video: 0,
    themes: "",
  });
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const check = validateNewLine(form);

  async function criar() {
    setTouched(true);
    if (!check.ok) return;
    setBusy(true);
    setApiError(null);
    try {
      const res = await fetch("/api/workspace/content/editorial-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `erro ${res.status}`);
      onCreated();
    } catch (e) {
      setApiError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none";
  const labelCls =
    "font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground";

  return (
    <TerminalWindow title="linha/nova">
      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Data de início</span>
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Data de fim</span>
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              className={inputCls}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Carrosséis</span>
            <input
              type="number"
              min={0}
              value={form.carrossel}
              onChange={(e) => setForm({ ...form, carrossel: Number(e.target.value) })}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Estáticos</span>
            <input
              type="number"
              min={0}
              value={form.estatico}
              onChange={(e) => setForm({ ...form, estatico: Number(e.target.value) })}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Vídeos</span>
            <input
              type="number"
              min={0}
              value={form.video}
              onChange={(e) => setForm({ ...form, video: Number(e.target.value) })}
              className={inputCls}
            />
          </label>
        </div>

        {form.video > 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 font-mono text-[11px] text-muted-foreground">
            ▸ vídeo: a squad entrega o <span className="text-foreground">roteiro pronto</span> — você
            grava no celular e sobe o vídeo no Google Drive antes de agendar a publicação.
          </p>
        ) : null}

        <label className="flex flex-col gap-1">
          <span className={labelCls}>Temas que você quer puxar (opcional)</span>
          <textarea
            rows={3}
            value={form.themes}
            onChange={(e) => setForm({ ...form, themes: e.target.value })}
            placeholder="ex.: bloqueio de conta · busca e apreensão de veículo · renegociação"
            className={`${inputCls} resize-none placeholder:text-muted-foreground/60`}
          />
        </label>

        {/* Anotação do limite — fica VERMELHA quando estoura 1/dia (pedido Arthur 02/07). */}
        <p
          className={
            check.days >= 1 && check.total > check.days
              ? "font-mono text-xs font-semibold text-red-400"
              : "font-mono text-xs text-muted-foreground"
          }
        >
          {check.days >= 1
            ? check.total > check.days
              ? `⚠ ${check.total} conteúdos em ${check.days} dia(s) — o máximo é 1 por dia (${check.days} no total).`
              : `${check.total} conteúdo(s) em ${check.days} dia(s) — máximo de 1 por dia.`
            : "escolhe o período pra eu calcular o limite (1 conteúdo por dia)."}
        </p>

        {touched && !check.ok ? (
          <ul className="flex flex-col gap-1">
            {check.errors.map((e) => (
              <li key={e} className="font-mono text-xs text-red-400">▸ {e}</li>
            ))}
          </ul>
        ) : null}
        {apiError ? <p className="font-mono text-xs text-red-400">{apiError}</p> : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={criar}
            disabled={busy}
            className="rounded-md border border-primary bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60"
          >
            {busy ? "enviando…" : "Montar linha editorial"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border bg-muted px-4 py-2 font-mono text-sm text-foreground"
          >
            Cancelar
          </button>
        </div>
      </div>
    </TerminalWindow>
  );
}

// Etapas reais do worker (ordem verdadeira do job gerar_semana). O avanço é
// estimado pelo tempo decorrido (~90-120s no total) — a squad não reporta
// progresso fino; a última etapa só fecha quando a linha vira "ativa".
const GERANDO_STEPS: { at: number; label: string }[] = [
  { at: 0, label: "lendo a fundação da sua marca (tom de voz · cliente ideal · base)" },
  { at: 15, label: "escolhendo os temas na base de conhecimento" },
  { at: 40, label: "montando a pauta e distribuindo pelos dias do período" },
  { at: 70, label: "conferindo o mix pedido e gravando as peças na Pauta" },
];

function GerandoSteps({ createdAt }: { createdAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  const currentIdx = GERANDO_STEPS.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card/40 px-3 py-2.5">
      {GERANDO_STEPS.map((s, i) => (
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
        {elapsed}s — a tela atualiza sozinha quando a pauta ficar pronta
      </p>
    </div>
  );
}

// Linha do histórico expandível — clica e gerencia as peças dela igual à atual
// (uma linha "encerrada" ainda pode ter peça no meio do ciclo).
function LinhaHistorico({
  line,
  pieces,
  onChanged,
}: {
  line: EditorialLine;
  pieces: ContentPiece[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const noTick = { open: false, n: 0 };
  return (
    <div className="rounded-lg border border-border bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span className="font-mono text-xs text-muted-foreground">
          {fmtPeriodo(line)} · {mixLabel(line.mix)}
          {pieces.length ? ` · ${pieces.length} conteúdo(s)` : ""}
        </span>
        <span className="flex items-center gap-2">
          <span
            className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${LINE_STATUS[line.status].cls}`}
          >
            {LINE_STATUS[line.status].label}
          </span>
          <span className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-foreground">
            {open ? "recolher ▴" : "expandir ▾"}
          </span>
        </span>
      </button>
      {open ? (
        <div className="border-t border-border/60 px-3 py-2.5">
          {pieces.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">▸ sem peças nesta linha.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {pieces
                .slice()
                .sort((a, b) =>
                  String(a.meta?.planned_date ?? "").localeCompare(String(b.meta?.planned_date ?? "")),
                )
                .map((p) => (
                  <PautaItem key={p.id} piece={p} allTick={noTick} onChanged={onChanged} />
                ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Barra de aprovação em bloco: a pauta nasce como PROPOSTA (fora do kanban e
// do calendário) — aqui o cliente aprova tudo de uma vez.
function PautaAprovarTudo({
  lineId,
  count,
  onChanged,
}: {
  lineId: string;
  count: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function aprovarTudo() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/content/editorial-line/${lineId}/aprovar`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `erro ${res.status}`);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/30 bg-amber-300/5 px-3 py-2">
      <p className="font-mono text-xs text-muted-foreground">
        ▸ {count} ideia{count === 1 ? "" : "s"} esperando sua aprovação — clica em cada uma pra
        ver o ângulo, ou aprova tudo:
      </p>
      {err ? <p className="font-mono text-xs text-red-400">{err}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={aprovarTudo}
        className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
      >
        {busy ? "aprovando…" : "✓ Aprovar pauta inteira"}
      </button>
    </div>
  );
}

// Um item da pauta na gestão visual da linha: clica → expande com o ângulo
// completo e as ações do estado (aprovar ideia · produzir · revisar · agendar).
function PautaItem({
  piece,
  onChanged,
  allTick,
}: {
  piece: ContentPiece;
  onChanged: () => void;
  /** "abrir/fechar todas" da linha — n>0 aplica o estado pedido. */
  allTick: { open: boolean; n: number };
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const proposta = piecePropostaPendente(piece);

  useEffect(() => {
    if (allTick.n > 0) setOpen(allTick.open);
  }, [allTick]);

  async function decidir(action: "aprovar" | "produzir") {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/content/pieces/${piece.id}/pauta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `erro ${res.status}`);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const etapa = producaoEtapa(piece);
  const chip = proposta
    ? { label: "ideia · aprovar", cls: "border-amber-300/40 bg-amber-300/10 text-amber-300" }
    : etapa
      ? {
          label: etapa === "copy" ? "produzindo copy…" : "produzindo imagem…",
          cls: "border-amber-300/40 bg-amber-300/10 text-amber-300",
        }
      : piece.status === "aprovacao"
        ? { label: "pra aprovar", cls: "border-[#A78BD8]/40 bg-[#A78BD8]/10 text-[#A78BD8]" }
        : { label: STATUS_LABEL[piece.status], cls: "border-border text-muted-foreground" };

  return (
    <li className="rounded-lg border border-border bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{piece.title}</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {piece.meta?.planned_date
              ? DATE_FMT.format(new Date(`${piece.meta.planned_date}T12:00:00`))
              : ""}{" "}
            · {KIND_LABEL[piece.kind]}
          </span>
        </span>
        {piece.meta?.funil && FUNIL_CHIP[piece.meta.funil] ? (
          <span
            className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${FUNIL_CHIP[piece.meta.funil].cls}`}
          >
            {FUNIL_CHIP[piece.meta.funil].label}
          </span>
        ) : null}
        {piece.status === "producao" ? (
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-300" />
        ) : null}
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${chip.cls}`}
        >
          {chip.label}
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-border/60 px-3 py-2.5">
          {piece.meta?.tema ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                ângulo ·{" "}
              </span>
              {piece.meta.tema}
            </p>
          ) : null}
          {err ? <p className="font-mono text-xs text-red-400">{err}</p> : null}

          {proposta ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => decidir("aprovar")}
                className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
              >
                ✓ Aprovar ideia
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => decidir("produzir")}
                className="rounded-md border border-primary bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                ▶ Aprovar e produzir
              </button>
            </div>
          ) : piece.status === "pauta" ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => decidir("produzir")}
                className="rounded-md border border-primary bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                ▶ Produzir agora
              </button>
              <Link
                href={`/w/content/pecas/${piece.id}?de=linha`}
                className="font-mono text-xs text-primary hover:underline"
              >
                abrir peça ▸
              </Link>
            </div>
          ) : piece.status === "producao" ? (
            <p className="font-mono text-xs text-muted-foreground">
              {etapa === "imagem"
                ? "▸ a squad está produzindo a imagem — volta pra sua aprovação já já."
                : "▸ a squad está escrevendo a copy — você aprova o texto antes da imagem."}
            </p>
          ) : piece.status === "aprovacao" ? (
            <Link
              href={`/w/content/pecas/${piece.id}?de=linha`}
              className="self-start rounded-md border border-primary bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {piece.meta?.fase === "conteudo" ? "revisar o conteúdo ▸" : "revisar e aprovar ▸"}
            </Link>
          ) : (
            <Link
              href={`/w/content/pecas/${piece.id}?de=linha`}
              className="font-mono text-xs text-primary hover:underline"
            >
              abrir peça ▸
            </Link>
          )}
        </div>
      ) : null}
    </li>
  );
}

export default function LinhaEditorialPage() {
  const [lines, setLines] = useState<EditorialLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  // Linha recolhível (resumo) + abrir/fechar todas as ideias de uma vez.
  const [lineOpen, setLineOpen] = useState(true);
  const [allTick, setAllTick] = useState<{ open: boolean; n: number }>({ open: false, n: 0 });
  const { pieces, reload: reloadPieces } = useContentPieces();

  const reload = useCallback(() => {
    const supabase = createClient();
    loadEditorialLines(supabase)
      .then(setLines)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Atualiza sozinho enquanto tem trabalho em andamento: linha "montando" OU
  // peça da linha em produção (a tela é a gestão visual do ciclo).
  const gerando = lines?.some((l) => l.status === "gerando") ?? false;
  const produzindo = pieces?.some((p) => p.status === "producao") ?? false;
  useEffect(() => {
    if (!gerando && !produzindo) return;
    const t = setInterval(() => {
      reload();
      reloadPieces();
    }, 5000);
    return () => clearInterval(t);
  }, [gerando, produzindo, reload, reloadPieces]);

  const atual = lines?.[0] ?? null;
  const historico = lines?.slice(1) ?? [];
  const pecasDaAtual =
    atual && pieces ? pieces.filter((p) => p.meta?.line_id === atual.id) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
            Squad Content · Linha editorial
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-foreground">
            Linha editorial
          </h1>
          <p className="mt-1 max-w-2xl font-mono text-sm text-muted-foreground">
            O ciclo começa aqui: você define o período e o mix, a squad monta a pauta e as
            peças entram na esteira pra produzir e aprovar.
          </p>
        </div>
        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            disabled={gerando}
            className="rounded-md border border-primary bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60"
            title={gerando ? "Espera a linha atual terminar de montar" : undefined}
          >
            + Nova linha editorial
          </button>
        ) : null}
      </div>

      {showForm ? (
        <NovaLinhaForm
          onCreated={() => {
            setShowForm(false);
            reload();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      {error ? (
        <p className="font-mono text-sm text-red-400">Falha ao carregar: {error}</p>
      ) : lines === null ? (
        <p className="font-mono text-sm text-muted-foreground">carregando…</p>
      ) : lines.length === 0 ? (
        <TerminalWindow title="linha/atual">
          <div className="p-4">
            <p className="font-mono text-sm text-muted-foreground">
              ▸ Nenhuma linha editorial ainda — clica em <span className="text-foreground">+ Nova linha editorial</span> pra
              montar a primeira.
            </p>
          </div>
        </TerminalWindow>
      ) : (
        <>
          {atual ? (
            <TerminalWindow title="linha/atual">
              <div className="flex flex-col gap-3 p-4">
                {/* Cabeçalho inteiro clicável — recolhida, clicar em cima expande. */}
                <button
                  type="button"
                  onClick={() => setLineOpen((v) => !v)}
                  aria-expanded={lineOpen}
                  className="-m-2 flex flex-wrap items-center justify-between gap-2 rounded-md p-2 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {fmtPeriodo(atual)} · {mixLabel(atual.mix)}
                  </span>
                  <span className="flex items-center gap-2">
                    {!lineOpen && pecasDaAtual.length > 0 ? (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {pecasDaAtual.length} conteúdo(s)
                        {pecasDaAtual.some((p) => piecePropostaPendente(p))
                          ? ` · ${pecasDaAtual.filter((p) => piecePropostaPendente(p)).length} esperando aprovação`
                          : ""}
                      </span>
                    ) : null}
                    <span
                      className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${LINE_STATUS[atual.status].cls}`}
                    >
                      {LINE_STATUS[atual.status].label}
                    </span>
                    <span className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-foreground">
                      {lineOpen ? "recolher ▴" : "expandir ▾"}
                    </span>
                  </span>
                </button>
                {lineOpen ? (
                  <>
                    {atual.themes ? (
                      <p className="font-mono text-xs text-muted-foreground">temas: {atual.themes}</p>
                    ) : null}
                    {atual.status === "gerando" ? <GerandoSteps createdAt={atual.created_at} /> : null}
                    {atual.status === "falhou" ? (
                      <p className="font-mono text-xs text-red-400">
                        A montagem falhou — tenta de novo em alguns minutos (a equipe já foi avisada).
                      </p>
                    ) : null}
                    {pecasDaAtual.length > 0 ? (
                      <>
                        {pecasDaAtual.some((p) => piecePropostaPendente(p)) ? (
                          <PautaAprovarTudo
                            lineId={atual.id}
                            count={pecasDaAtual.filter((p) => piecePropostaPendente(p)).length}
                            onChanged={() => {
                              reload();
                              reloadPieces();
                            }}
                          />
                        ) : null}
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => setAllTick((t) => ({ open: true, n: t.n + 1 }))}
                            className="font-mono text-[11px] text-muted-foreground hover:text-primary"
                          >
                            abrir todas ▾
                          </button>
                          <button
                            type="button"
                            onClick={() => setAllTick((t) => ({ open: false, n: t.n + 1 }))}
                            className="font-mono text-[11px] text-muted-foreground hover:text-primary"
                          >
                            fechar todas ▴
                          </button>
                        </div>
                        <ul className="flex flex-col gap-2">
                          {pecasDaAtual
                            .slice()
                            .sort((a, b) =>
                              String(a.meta?.planned_date ?? "").localeCompare(String(b.meta?.planned_date ?? "")),
                            )
                            .map((p) => (
                              <PautaItem
                                key={p.id}
                                piece={p}
                                allTick={allTick}
                                onChanged={() => {
                                  reload();
                                  reloadPieces();
                                }}
                              />
                            ))}
                        </ul>
                      </>
                    ) : atual.status === "ativa" ? (
                      <p className="font-mono text-xs text-muted-foreground">
                        ▸ pauta montada — as peças aparecem aqui e no calendário.
                      </p>
                    ) : null}
                    {pecasDaAtual.length > 0 ? (
                      <div className="flex flex-wrap gap-3 border-t border-border/60 pt-3">
                        <Link
                          href="/w/content/kanban"
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          acompanhar no kanban ▸
                        </Link>
                        <Link
                          href="/w/content/calendario"
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          ver no calendário ▸
                        </Link>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </TerminalWindow>
          ) : null}

          {historico.length > 0 ? (
            <TerminalWindow title="linha/historico">
              <div className="flex flex-col gap-2 p-4">
                {historico.map((l) => (
                  <LinhaHistorico
                    key={l.id}
                    line={l}
                    pieces={(pieces ?? []).filter((p) => p.meta?.line_id === l.id)}
                    onChanged={() => {
                      reload();
                      reloadPieces();
                    }}
                  />
                ))}
              </div>
            </TerminalWindow>
          ) : null}
        </>
      )}
    </div>
  );
}
