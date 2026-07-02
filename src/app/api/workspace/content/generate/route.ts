import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";

// POST /api/workspace/content/generate — geração DIRETA (tela "Usar agente").
// Mesmo motor do chat, outra porta: {tema, tipo} → job gerar_peca na fila.
export async function POST(request: Request) {
  let accountId: string;
  let userId: string;
  try {
    ({ accountId, userId } = await requireRole("agent"));
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as
    | { tema?: string; tipo?: string }
    | null;
  const tema = body?.tema?.trim();
  const tipo = body?.tipo;
  if (!tema) return NextResponse.json({ error: "descreva o tema da peça" }, { status: 400 });
  if (tema.length > 500) return NextResponse.json({ error: "tema grande demais (máx 500)" }, { status: 400 });
  if (tipo !== "carrossel" && tipo !== "estatico" && tipo !== "video") {
    return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: mod, error: modErr } = await db
    .from("cc_account_modules")
    .select("enabled")
    .eq("account_id", accountId)
    .eq("module_key", "squad_content")
    .maybeSingle();
  if (modErr) return NextResponse.json({ error: modErr.message }, { status: 500 });
  if (!mod?.enabled) {
    return NextResponse.json({ error: "módulo squad_content não está ativo" }, { status: 403 });
  }

  const { data: job, error: jobErr } = await db
    .from("content_jobs")
    .insert({
      account_id: accountId,
      kind: "gerar_peca",
      payload: { tema, tipo },
      created_by: userId,
    })
    .select("id")
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, jobId: job.id });
}
