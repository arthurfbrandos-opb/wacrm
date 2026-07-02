"use client";

// Detalhe da peça — preview + legenda (com copiar) + status/datas.
// Aprovar / Pedir ajuste ligam na fatia ⑤ (os_approvals) — visíveis-desligados.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadPiece } from "@/lib/workspace/content-queries";
import {
  KIND_LABEL,
  STATUS_LABEL,
  type ContentPiece,
} from "@/lib/workspace/content";

const DATETIME_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function ContentPieceDetailPage() {
  const params = useParams<{ id: string }>();
  const [piece, setPiece] = useState<ContentPiece | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    loadPiece(supabase, params.id)
      .then((p) => {
        if (alive) setPiece(p);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [params.id]);

  const copyCaption = () => {
    if (!piece?.caption) return;
    void navigator.clipboard?.writeText(piece.caption);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <Link href="/w/content/kanban" className="hover:text-foreground">
          kanban
        </Link>{" "}
        / peça
      </p>

      {error ? (
        <p className="text-sm text-destructive">Falha ao carregar: {error}</p>
      ) : piece === undefined ? (
        <p className="text-sm text-muted-foreground">carregando…</p>
      ) : piece === null ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="font-mono text-sm text-foreground">Peça não encontrada</p>
        </div>
      ) : (
        <>
          <div>
            <h1 className="font-mono text-2xl font-semibold text-foreground">{piece.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                {KIND_LABEL[piece.kind]}
              </span>
              <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary">
                {STATUS_LABEL[piece.status]}
              </span>
              {piece.channel ? (
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                  {piece.channel}
                </span>
              ) : null}
              {piece.scheduled_at ? (
                <span className="font-mono text-xs text-muted-foreground">
                  agendada · {DATETIME_FMT.format(new Date(piece.scheduled_at))}
                </span>
              ) : null}
              {piece.published_at ? (
                <span className="font-mono text-xs text-muted-foreground">
                  publicada · {DATETIME_FMT.format(new Date(piece.published_at))}
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="font-mono text-sm font-medium text-foreground">Prévia</p>
            {piece.preview_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={piece.preview_url}
                alt={`Prévia — ${piece.title}`}
                className="mt-3 w-full max-w-md rounded-lg border border-border"
              />
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                A arte aparece aqui quando a produção terminar.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-sm font-medium text-foreground">Legenda</p>
              {piece.caption ? (
                <button
                  type="button"
                  onClick={copyCaption}
                  className="rounded-lg border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {copied ? "✓ copiada" : "copiar"}
                </button>
              ) : null}
            </div>
            {piece.caption ? (
              <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{piece.caption}</p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Sem legenda ainda.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled
              title="Liga na ativação da aprovação (em breve)"
              className="cursor-not-allowed rounded-lg border border-border px-4 py-2 font-mono text-sm text-muted-foreground opacity-60"
            >
              ✓ Aprovar · em breve
            </button>
            <button
              type="button"
              disabled
              title="Liga na ativação da aprovação (em breve)"
              className="cursor-not-allowed rounded-lg border border-border px-4 py-2 font-mono text-sm text-muted-foreground opacity-60"
            >
              ✎ Pedir ajuste · em breve
            </button>
          </div>
        </>
      )}
    </div>
  );
}
