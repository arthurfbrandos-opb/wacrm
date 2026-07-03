import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";

// POST /api/workspace/content/pieces/:id/decide — o cliente decide sobre a peça
// em "Pra aprovar": aprova (→ Aprovada) ou pede ajuste (→ Produzindo + job
// ajustar_peca pro worker refazer com a observação dele). Cada decisão vira
// linha no os_approvals (trilha) + os_events (prova viva).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let accountId: string;
  let userId: string;
  try {
    ({ accountId, userId } = await requireRole("agent"));
  } catch (err) {
    return toErrorResponse(err);
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { action?: "approve" | "request_changes"; note?: string }
    | null;
  const action = body?.action;
  const note = body?.note?.trim() || null;
  if (action !== "approve" && action !== "request_changes") {
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  }
  if (action === "request_changes" && !note) {
    return NextResponse.json({ error: "descreva o ajuste que você quer" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: piece, error: pieceErr } = await db
    .from("content_pieces")
    .select("id, title, status, kind, meta")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (pieceErr) return NextResponse.json({ error: pieceErr.message }, { status: 500 });
  if (!piece) return NextResponse.json({ error: "peça não encontrada" }, { status: 404 });
  if (piece.status !== "aprovacao") {
    return NextResponse.json(
      { error: `peça não está em aprovação (status atual: ${piece.status})` },
      { status: 409 },
    );
  }

  const approved = action === "approve";
  const meta = piece.meta as { slug?: string; fase?: string } | null;
  const faseConteudo = meta?.fase === "conteudo";
  // Dois portões (Arthur 02/07): aprovar o CONTEÚDO de carrossel/estático não
  // fecha a peça — dispara a ARTE e ela volta pra aprovação final. Vídeo fecha
  // no conteúdo (a "arte" é a gravação dele). Fase arte/legado = fecha.
  const artePendente = approved && faseConteudo && piece.kind !== "video";
  const newStatus = approved ? (artePendente ? "producao" : "aprovada") : "producao";

  // Ajuste na fase de conteúdo volta a ESCREVER copy — limpa a fase pra tela
  // mostrar "produzindo copy" (e não "imagem").
  const metaUpdate =
    !approved && faseConteudo
      ? { meta: { ...((piece.meta as Record<string, unknown> | null) ?? {}), fase: null } }
      : {};
  const { error: upErr } = await db
    .from("content_pieces")
    .update({ status: newStatus, updated_at: new Date().toISOString(), ...metaUpdate })
    .eq("id", id)
    .eq("account_id", accountId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  if (artePendente) {
    const { error: jobErr } = await db.from("content_jobs").insert({
      account_id: accountId,
      kind: "gerar_arte",
      payload: { piece_id: id, slug: meta?.slug ?? null, titulo: piece.title, tipo: piece.kind },
      created_by: userId,
    });
    if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }

  // Aprovação FINAL → salva os arquivos na pasta de conteúdos do Drive do
  // cliente (se ele conectou a conta e escolheu a pasta no Picker).
  if (approved && newStatus === "aprovada") {
    const { data: gconn } = await db
      .from("integration_connections")
      .select("status, config")
      .eq("account_id", accountId)
      .eq("provider", "google_oauth")
      .maybeSingle();
    const temPasta =
      gconn?.status === "connected" &&
      Boolean((gconn.config as { conteudos_folder_id?: string } | null)?.conteudos_folder_id);
    if (temPasta) {
      await db.from("content_jobs").insert({
        account_id: accountId,
        kind: "salvar_drive",
        payload: { piece_id: id },
        created_by: userId,
      });
    }
  }

  // Ajuste → refaz o CONTEÚDO (fase conteúdo) ou a peça toda (fase arte/legado).
  if (!approved) {
    const { error: jobErr } = await db.from("content_jobs").insert({
      account_id: accountId,
      kind: faseConteudo ? "produzir_pauta" : "ajustar_peca",
      payload: faseConteudo
        ? { piece_id: id, note, titulo: piece.title, tipo: piece.kind }
        : { piece_id: id, note, slug: meta?.slug ?? null, title: piece.title },
      created_by: userId,
    });
    if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }

  await db.from("os_approvals").insert({
    account_id: accountId,
    kind: "content_piece",
    ref_id: id,
    action: approved ? "approved" : "changes_requested",
    note,
    decided_by: userId,
  });
  await db.from("os_events").insert({
    account_id: accountId,
    agent: "squad-content",
    kind: approved ? "content.piece_approved" : "content.piece_changes_requested",
    summary: `${approved ? "Peça aprovada" : "Ajuste pedido"}: ${piece.title}`,
    ref: { piece_id: id },
  });

  return NextResponse.json({ ok: true, status: newStatus });
}
