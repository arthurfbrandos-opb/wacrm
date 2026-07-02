"use client";

// Detalhe da peça — preview + legenda (copiar) + decisão do cliente:
// em "Pra aprovar": Aprovar / Pedir ajuste (fatia ⑤ · os_approvals + job de ajuste)
// em "Aprovada": Agendar via Metricool (Publisher confirma → vira Agendada)
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { TerminalWindow } from "@/components/ui/terminal-window";
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
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [askingChanges, setAskingChanges] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [when, setWhen] = useState("");
  const [videoLink, setVideoLink] = useState("");
  const [editingLink, setEditingLink] = useState(false);

  const refetch = useCallback(() => {
    const supabase = createClient();
    loadPiece(supabase, params.id)
      .then(setPiece)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [params.id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const copyCaption = () => {
    if (!piece?.caption) return;
    void navigator.clipboard?.writeText(piece.caption);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const [roteiroCopied, setRoteiroCopied] = useState(false);
  const copyRoteiro = () => {
    if (!piece?.meta?.roteiro) return;
    void navigator.clipboard?.writeText(piece.meta.roteiro);
    setRoteiroCopied(true);
    setTimeout(() => setRoteiroCopied(false), 1800);
  };

  const call = async (path: string, body: unknown, okMsg: string, method = "POST") => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setFeedback(okMsg);
      setAskingChanges(false);
      setChangeNote("");
      refetch();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const decide = (action: "approve" | "request_changes") =>
    call(
      `/api/workspace/content/pieces/${params.id}/decide`,
      { action, note: action === "request_changes" ? changeNote.trim() : undefined },
      action === "approve"
        ? piece?.kind === "video"
          ? "Roteiro aprovado — agora é gravar o vídeo."
          : "Peça aprovada — pronta pra agendar."
        : "Ajuste enviado pro squad — a peça volta pra Produzindo.",
    );

  const salvarVideo = () =>
    call(
      `/api/workspace/content/pieces/${params.id}`,
      { video_url: videoLink.trim() },
      "Link do vídeo salvo — agora dá pra agendar.",
      "PATCH",
    );

  const schedule = () =>
    call(
      `/api/workspace/content/pieces/${params.id}/schedule`,
      { when: new Date(when).toISOString() },
      "Agendamento enviado — o Publisher confirma em instantes.",
    );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
        <Link href="/w/content/kanban" className="hover:text-foreground">
          kanban
        </Link>{" "}
        / peça
      </p>

      {error ? <p className="text-sm text-destructive">Falha: {error}</p> : null}
      {feedback ? <p className="text-sm text-primary">{feedback}</p> : null}

      {piece === undefined ? (
        <p className="font-mono text-sm text-muted-foreground">carregando…</p>
      ) : piece === null ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="font-mono text-sm text-foreground">Peça não encontrada</p>
        </div>
      ) : (
        <>
          <div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">{piece.title}</h1>
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
                  agenda · {DATETIME_FMT.format(new Date(piece.scheduled_at))}
                </span>
              ) : null}
              {piece.published_at ? (
                <span className="font-mono text-xs text-muted-foreground">
                  publicada · {DATETIME_FMT.format(new Date(piece.published_at))}
                </span>
              ) : null}
            </div>
          </div>

          {piece.kind === "video" ? (
            // Vídeo: a entrega é o ROTEIRO (ele grava no celular) — não tem arte.
            <TerminalWindow title="pecas/roteiro">
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-sm font-medium text-foreground">
                    Roteiro pra gravar
                  </p>
                  {piece.meta?.roteiro ? (
                    <button
                      type="button"
                      onClick={copyRoteiro}
                      className="rounded-lg border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {roteiroCopied ? "✓ copiado" : "copiar"}
                    </button>
                  ) : null}
                </div>
                {piece.meta?.roteiro ? (
                  <pre className="mt-3 max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-card/40 p-3 font-mono text-xs leading-relaxed text-foreground">
                    {piece.meta.roteiro}
                  </pre>
                ) : (
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    ▸ O roteiro aparece aqui quando a produção terminar.
                  </p>
                )}
              </div>
            </TerminalWindow>
          ) : (
            <TerminalWindow title="pecas/preview">
              <div className="p-4">
                <p className="font-mono text-sm font-medium text-foreground">Prévia</p>
                {piece.preview_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={piece.preview_url}
                    alt={`Prévia — ${piece.title}`}
                    className="mt-3 w-full max-w-md rounded-lg border border-border"
                  />
                ) : (
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    ▸ A arte aparece aqui quando a produção terminar.
                  </p>
                )}
              </div>
            </TerminalWindow>
          )}

          <TerminalWindow title="pecas/legenda">
            <div className="p-4">
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
                <p className="mt-2 font-mono text-xs text-muted-foreground">▸ Sem legenda ainda.</p>
              )}
            </div>
          </TerminalWindow>

          {piece.status === "aprovacao" ? (
            <TerminalWindow title="pecas/decisao">
              <div className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide("approve")}
                    className="rounded-md border border-primary bg-primary px-3 py-2 font-mono text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    ✓ Aprovar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setAskingChanges((v) => !v)}
                    className="rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm text-foreground transition-colors hover:bg-muted/70 disabled:opacity-50"
                  >
                    ✎ Pedir ajuste
                  </button>
                </div>
                {askingChanges ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/40 p-3">
                    <textarea
                      value={changeNote}
                      onChange={(e) => setChangeNote(e.target.value)}
                      rows={3}
                      maxLength={1000}
                      placeholder="O que ajustar? Ex.: troca o gancho do slide 1, tá genérico demais…"
                      className="resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy || !changeNote.trim()}
                      onClick={() => decide("request_changes")}
                      className="self-end rounded-md border border-primary bg-primary px-3 py-2 font-mono text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      Enviar ajuste pro squad
                    </button>
                  </div>
                ) : null}
              </div>
            </TerminalWindow>
          ) : null}

          {/* Vídeo aprovado: primeiro a GRAVAÇÃO (roteiro → celular → link), só então agenda. */}
          {piece.status === "aprovada" && piece.kind === "video" && (!piece.meta?.video_url || editingLink) ? (
            <TerminalWindow title="pecas/gravacao">
              <div className="flex flex-col gap-3 p-4">
                <p className="font-mono text-sm font-medium text-foreground">
                  Roteiro aprovado — agora é gravar 🎬
                </p>
                <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
                  <li>Copie o roteiro acima (botão &ldquo;copiar&rdquo;) e grave o vídeo no celular.</li>
                  <li>Suba o vídeo no seu Google Drive (ou onde preferir) e copie o link.</li>
                  <li>Cole o link aqui — aí sim libera o agendamento da publicação.</li>
                </ol>
                <div className="flex flex-wrap items-end gap-2">
                  <input
                    type="url"
                    value={videoLink}
                    onChange={(e) => setVideoLink(e.target.value)}
                    maxLength={500}
                    placeholder="https://drive.google.com/…"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy || !/^https:\/\/\S+$/i.test(videoLink.trim())}
                    onClick={() => {
                      setEditingLink(false);
                      void salvarVideo();
                    }}
                    className="rounded-md border border-primary bg-primary px-3 py-2 font-mono text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    Salvar link do vídeo
                  </button>
                </div>
              </div>
            </TerminalWindow>
          ) : null}

          {piece.status === "aprovada" && (piece.kind !== "video" || (piece.meta?.video_url && !editingLink)) ? (
            <TerminalWindow title="pecas/agendamento">
              <div className="flex flex-col gap-3 p-4">
                {piece.kind === "video" && piece.meta?.video_url ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2">
                    <span className="font-mono text-xs text-primary">✓ vídeo gravado</span>
                    <a
                      href={piece.meta.video_url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {piece.meta.video_url}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setVideoLink(piece.meta?.video_url ?? "");
                        setEditingLink(true);
                      }}
                      className="font-mono text-[11px] text-muted-foreground hover:text-primary"
                    >
                      trocar link
                    </button>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="agendar-quando"
                      className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      Publicar em
                    </label>
                    <input
                      id="agendar-quando"
                      type="datetime-local"
                      value={when}
                      onChange={(e) => setWhen(e.target.value)}
                      className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy || !when}
                    onClick={schedule}
                    className="rounded-md border border-primary bg-primary px-3 py-2 font-mono text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    Agendar via Metricool
                  </button>
                </div>
              </div>
            </TerminalWindow>
          ) : null}
        </>
      )}
    </div>
  );
}
