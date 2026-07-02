import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";

// POST /api/workspace/content/pieces/:id/pauta — decisão sobre uma IDEIA da
// linha editorial: "aprovar" (a peça entra no kanban/calendário como Pauta) ou
// "produzir" (aprova + já manda a squad escrever o CONTEÚDO — a arte só vem
// depois que o cliente aprovar o texto).
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
    | { action?: "aprovar" | "produzir" }
    | null;
  const action = body?.action;
  if (action !== "aprovar" && action !== "produzir") {
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
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
  if (piece.status !== "pauta") {
    return NextResponse.json(
      { error: `essa peça já saiu da pauta (status atual: ${piece.status})` },
      { status: 409 },
    );
  }

  const meta = { ...((piece.meta as Record<string, unknown> | null) ?? {}), pauta: "aprovada" };
  const producing = action === "produzir";

  const { error: upErr } = await db
    .from("content_pieces")
    .update({
      meta,
      ...(producing ? { status: "producao" } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("account_id", accountId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  if (producing) {
    const { error: jobErr } = await db.from("content_jobs").insert({
      account_id: accountId,
      kind: "produzir_pauta",
      payload: { piece_id: id, titulo: piece.title, tipo: piece.kind },
      created_by: userId,
    });
    if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }

  await db.from("os_events").insert({
    account_id: accountId,
    agent: "squad-content",
    kind: producing ? "content.pauta_production_started" : "content.pauta_approved",
    summary: `${producing ? "Pauta aprovada + produção iniciada" : "Ideia da pauta aprovada"}: ${piece.title}`,
    ref: { piece_id: id },
  });

  return NextResponse.json({ ok: true, status: producing ? "producao" : "pauta" });
}
