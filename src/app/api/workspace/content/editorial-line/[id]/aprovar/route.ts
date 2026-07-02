import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";

// POST /api/workspace/content/editorial-line/:id/aprovar — aprova a pauta
// INTEIRA da linha: toda proposta pendente vira Pauta (entra no kanban e no
// calendário). Produção continua item a item.
export async function POST(
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

  const { data: line, error: lineErr } = await db
    .from("content_editorial_lines")
    .select("id")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 500 });
  if (!line) return NextResponse.json({ error: "linha não encontrada" }, { status: 404 });

  const { data: pieces, error: listErr } = await db
    .from("content_pieces")
    .select("id, meta")
    .eq("account_id", accountId)
    .eq("status", "pauta")
    .eq("meta->>line_id", id)
    .eq("meta->>pauta", "proposta");
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });

  // Merge por linha (meta é jsonb inteiro no update — poucas linhas, loop ok).
  for (const p of pieces ?? []) {
    const meta = { ...((p.meta as Record<string, unknown> | null) ?? {}), pauta: "aprovada" };
    const { error: upErr } = await db
      .from("content_pieces")
      .update({ meta, updated_at: new Date().toISOString() })
      .eq("id", p.id)
      .eq("account_id", accountId);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  await db.from("os_events").insert({
    account_id: accountId,
    agent: "squad-content",
    kind: "content.pauta_bulk_approved",
    summary: `Pauta da linha aprovada (${(pieces ?? []).length} ideia(s))`,
    ref: { line_id: id },
  });

  return NextResponse.json({ ok: true, aprovadas: (pieces ?? []).length });
}
