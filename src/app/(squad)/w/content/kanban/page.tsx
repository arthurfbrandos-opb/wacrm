"use client";

// Kanban da Squad Content — mesmo molde do funil do CRM (pipeline-board):
// colunas com borda colorida no topo, chip de contagem, snap no mobile e
// cards ricos (prévia + tipo + data) clicáveis pro detalhe. Arrastar card
// não existe: quem move a peça é o processo (produção/aprovação/publicação).
import Link from "next/link";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useContentPieces } from "@/hooks/use-content-pieces";
import { useWorkspaceModules } from "@/hooks/use-workspace-modules";
import { squadKanbanEnabled } from "@/lib/workspace/catalog";
import {
  FUNIL_CHIP,
  groupByStatus,
  KANBAN_COLUMNS,
  KIND_LABEL,
  pieceDeletable,
  piecePropostaPendente,
  producaoEtapa,
  type ContentPiece,
  type PieceStatus,
} from "@/lib/workspace/content";

const DATE_FMT = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

// Cor da etapa (paleta do Command Center: dim/warn/purple/green/blue/primary).
const STATUS_COLOR: Record<PieceStatus, string> = {
  pauta: "#6E766E",
  producao: "#F59E0B",
  aprovacao: "#A78BD8",
  aprovada: "#22C55E",
  agendada: "#60A5FA",
  publicada: "#4ADE80",
};

function PieceCard({ piece, onDeleted }: { piece: ContentPiece; onDeleted: () => void }) {
  const dateIso = piece.scheduled_at ?? piece.published_at;
  const dataCard = dateIso
    ? new Date(dateIso)
    : piece.meta?.planned_date
      ? new Date(`${piece.meta.planned_date}T12:00:00`)
      : null;
  const etapa = producaoEtapa(piece);
  const [deleting, setDeleting] = useState(false);

  async function excluir(e: React.MouseEvent) {
    // O card inteiro é um Link — a lixeira não pode navegar.
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Excluir a peça "${piece.title}"? Isso não tem volta.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workspace/content/pieces/${piece.id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `erro ${res.status}`);
      onDeleted();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <Link
      href={`/w/content/pecas/${piece.id}`}
      className={`group relative block rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-muted ${deleting ? "pointer-events-none opacity-50" : ""}`}
    >
      {pieceDeletable(piece.status) ? (
        <button
          type="button"
          onClick={excluir}
          aria-label={`Excluir peça ${piece.title}`}
          title="Excluir peça"
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card/90 text-muted-foreground transition-opacity hover:border-red-400/50 hover:text-red-400 focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {piece.preview_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={piece.preview_url}
          alt=""
          className="mb-2 h-24 w-full rounded-md border border-border object-cover object-top"
        />
      ) : null}
      <p className="line-clamp-2 text-sm font-medium text-foreground">{piece.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {/* Data da publicação em evidência (agendada > publicada > planejada). */}
        {dataCard ? (
          <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground">
            {DATE_FMT.format(dataCard)}
          </span>
        ) : null}
        <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
          {KIND_LABEL[piece.kind]}
        </span>
        {piece.meta?.funil && FUNIL_CHIP[piece.meta.funil] ? (
          <span
            className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${FUNIL_CHIP[piece.meta.funil].cls}`}
          >
            {FUNIL_CHIP[piece.meta.funil].label}
          </span>
        ) : null}
        {etapa ? (
          <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-300">
            {etapa}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export default function SquadContentKanbanPage() {
  const { pieces, error, reload } = useContentPieces();
  // Proposta da linha editorial só entra aqui depois que o cliente aprova a ideia.
  const grouped = pieces ? groupByStatus(pieces.filter((p) => !piecePropostaPendente(p))) : null;

  // "Gostinho": kanban fora do plano — mostra as etapas, não os cards.
  const { states, loading: modulesLoading } = useWorkspaceModules();
  const locked = !modulesLoading && states !== null && !squadKanbanEnabled(states);

  if (locked) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
            Squad Content · Kanban
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-foreground">
            Esteira de produção
          </h1>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-4 opacity-50" aria-hidden>
          {KANBAN_COLUMNS.map((col) => (
            <div
              key={col.status}
              className="flex min-w-[180px] flex-1 flex-col rounded-xl border border-border bg-card/60 p-4"
            >
              <div className="-mx-4 -mt-4 h-[3px] rounded-t-xl" style={{ backgroundColor: STATUS_COLOR[col.status] }} />
              <h3 className="pt-3 text-sm font-semibold text-foreground">{col.label}</h3>
              <div className="mt-3 rounded-lg border border-dashed border-border/60 px-2 py-8" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
          <p className="font-mono text-sm font-medium text-foreground">
            O Kanban completo não está no seu plano
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Suas peças continuam andando normalmente — você acompanha e aprova pela
            Visão geral e pela Linha editorial. Quer a esteira visual completa? Fale com a Negócio Simples.
          </p>
          <Link
            href="/w/content/linha-editorial"
            className="mt-4 inline-block rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 font-mono text-sm text-primary transition-colors hover:bg-primary/20"
          >
            ir pra linha editorial ▸
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
          Squad Content · Kanban
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-foreground">
          Esteira de produção
        </h1>
        <p className="mt-1 max-w-2xl font-mono text-sm text-muted-foreground">
          As peças andam sozinhas conforme a squad produz e você aprova.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Falha ao carregar: {error}</p>
      ) : grouped === null ? (
        <p className="font-mono text-sm text-muted-foreground">carregando…</p>
      ) : (
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none">
          {KANBAN_COLUMNS.map((col) => {
            const items = grouped.get(col.status) ?? [];
            return (
              <div
                key={col.status}
                className="flex w-[85vw] min-w-[240px] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[220px] lg:shrink lg:snap-none"
              >
                {/* Borda colorida de 3px no topo — mesma assinatura do funil do CRM */}
                <div
                  className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
                  style={{ backgroundColor: STATUS_COLOR[col.status] }}
                />
                <div className="flex items-center justify-between gap-2 pt-3">
                  <h3 className="truncate text-sm font-semibold text-foreground">{col.label}</h3>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <div className="mt-3 flex flex-1 flex-col gap-2">
                  {items.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/60 px-2 py-6 text-center font-mono text-[11px] text-muted-foreground/60">
                      sem peças aqui
                    </div>
                  ) : (
                    items.map((p) => <PieceCard key={p.id} piece={p} onDeleted={reload} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
