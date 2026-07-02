import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { pieceDeletable, type PieceStatus } from "@/lib/workspace/content";

// PATCH /api/workspace/content/pieces/:id — o cliente anexa o LINK do vídeo
// que ele gravou (peça kind=video): meta.video_url. É o gate da publicação —
// vídeo sem link não agenda (o post sairia sem mídia).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let accountId: string;
  try {
    ({ accountId } = await requireRole("agent"));
  } catch (err) {
    return toErrorResponse(err);
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { video_url?: string } | null;
  const videoUrl = body?.video_url?.trim();
  if (!videoUrl || !/^https:\/\/\S+$/i.test(videoUrl) || videoUrl.length > 500) {
    return NextResponse.json(
      { error: "cole um link válido (https://…) do vídeo gravado" },
      { status: 400 },
    );
  }

  const db = supabaseAdmin();
  const { data: piece, error: pieceErr } = await db
    .from("content_pieces")
    .select("id, title, kind, status, meta")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (pieceErr) return NextResponse.json({ error: pieceErr.message }, { status: 500 });
  if (!piece) return NextResponse.json({ error: "peça não encontrada" }, { status: 404 });
  if (piece.kind !== "video") {
    return NextResponse.json({ error: "só peça de vídeo recebe link de gravação" }, { status: 409 });
  }
  if (piece.status === "publicada") {
    return NextResponse.json({ error: "peça já publicada" }, { status: 409 });
  }

  const meta = { ...((piece.meta as Record<string, unknown> | null) ?? {}), video_url: videoUrl };
  const { error: upErr } = await db
    .from("content_pieces")
    .update({ meta, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("account_id", accountId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await db.from("os_events").insert({
    account_id: accountId,
    agent: "squad-content",
    kind: "content.video_attached",
    summary: `Vídeo gravado anexado: ${piece.title}`,
    ref: { piece_id: id },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/workspace/content/pieces/:id — o cliente exclui uma peça do
// kanban. Publicada nunca sai (histórico); agendada precisa ter o agendamento
// cancelado no Metricool antes (senão o post sai fantasma). FKs de jobs/chat
// são on delete set null — a trilha de conversa sobrevive.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let accountId: string;
  try {
    ({ accountId } = await requireRole("agent"));
  } catch (err) {
    return toErrorResponse(err);
  }

  const { id } = await params;
  const db = supabaseAdmin();

  const { data: piece, error: pieceErr } = await db
    .from("content_pieces")
    .select("id, title, status")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (pieceErr) return NextResponse.json({ error: pieceErr.message }, { status: 500 });
  if (!piece) return NextResponse.json({ error: "peça não encontrada" }, { status: 404 });
  if (!pieceDeletable(piece.status as PieceStatus)) {
    return NextResponse.json(
      {
        error:
          piece.status === "publicada"
            ? "peça já publicada não pode ser excluída"
            : "peça agendada não pode ser excluída — cancele o agendamento antes",
      },
      { status: 409 },
    );
  }

  const { error: delErr } = await db
    .from("content_pieces")
    .delete()
    .eq("id", id)
    .eq("account_id", accountId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await db.from("os_events").insert({
    account_id: accountId,
    agent: "squad-content",
    kind: "content.piece_deleted",
    summary: `Peça excluída: ${piece.title}`,
    ref: { piece_id: id, status: piece.status },
  });

  return NextResponse.json({ ok: true });
}
