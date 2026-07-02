import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";

// POST /api/workspace/content/pieces/:id/schedule — agenda uma peça APROVADA.
// Exige a conexão Metricool do tenant; enfileira job agendar_publicacao (o
// Publisher executa via MCP no worker) — a peça só vira "Agendada" quando o
// worker confirma. Read-first honesto: aqui só entra fila + intenção.
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
  const body = (await request.json().catch(() => null)) as { when?: string } | null;
  const when = body?.when ? new Date(body.when) : null;
  if (!when || Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "data/hora inválida" }, { status: 400 });
  }
  if (when.getTime() < Date.now() + 5 * 60 * 1000) {
    return NextResponse.json({ error: "escolha um horário pelo menos 5 min no futuro" }, { status: 400 });
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
  if (piece.status !== "aprovada") {
    return NextResponse.json(
      { error: `só peça aprovada pode ser agendada (status atual: ${piece.status})` },
      { status: 409 },
    );
  }
  // Vídeo só agenda depois que ele gravou e colou o link (senão vai post sem mídia).
  const videoUrl = (piece.meta as { video_url?: string } | null)?.video_url ?? null;
  if (piece.kind === "video" && !videoUrl) {
    return NextResponse.json(
      { error: "grave o vídeo e cole o link dele na peça antes de agendar" },
      { status: 409 },
    );
  }

  const { data: conn, error: connErr } = await db
    .from("integration_connections")
    .select("status")
    .eq("account_id", accountId)
    .eq("provider", "metricool")
    .maybeSingle();
  if (connErr) return NextResponse.json({ error: connErr.message }, { status: 500 });
  if (conn?.status !== "connected") {
    return NextResponse.json(
      { error: "conecte o Metricool em Configurações antes de agendar" },
      { status: 409 },
    );
  }

  const { error: jobErr } = await db.from("content_jobs").insert({
    account_id: accountId,
    kind: "agendar_publicacao",
    payload: {
      piece_id: id,
      when: when.toISOString(),
      slug: (piece.meta as { slug?: string } | null)?.slug ?? null,
      title: piece.title,
      ...(videoUrl ? { video_url: videoUrl } : {}),
    },
    created_by: userId,
  });
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  // Intenção registrada na peça (status só muda quando o Publisher confirmar).
  const { error: upErr } = await db
    .from("content_pieces")
    .update({ scheduled_at: when.toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("account_id", accountId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
