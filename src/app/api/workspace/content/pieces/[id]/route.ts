import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { pieceDeletable, type PieceStatus } from "@/lib/workspace/content";

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
