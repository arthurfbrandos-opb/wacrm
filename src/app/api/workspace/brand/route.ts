import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";

// Fundação da marca (/w/marca). Leitura vai direto pelo client (RLS);
// escrita passa aqui: editar a fundação muda como o squad produz → agent+.
// A seção precisa existir (seed cria as oficiais) — não criamos seção nova
// via UI pra manter o conjunto alinhado com o que o worker injeta.

export async function PATCH(request: Request) {
  let accountId: string;
  let userId: string;
  try {
    ({ accountId, userId } = await requireRole("agent"));
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as
    | { section_key?: string; content?: string }
    | null;
  const sectionKey = body?.section_key?.trim();
  const content = body?.content;
  if (!sectionKey || typeof content !== "string") {
    return NextResponse.json({ error: "section_key e content são obrigatórios" }, { status: 400 });
  }
  if (content.length > 200_000) {
    return NextResponse.json({ error: "conteúdo grande demais" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("content_brand_profile")
    .update({ content, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("account_id", accountId)
    .eq("section_key", sectionKey)
    .select("section_key")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "seção não encontrada" }, { status: 404 });

  await db.from("os_audit").insert({
    account_id: accountId,
    agent: "workspace",
    action: "brand_profile.updated",
    status: "success",
    detail: { section_key: sectionKey, chars: content.length, by: userId },
  });

  return NextResponse.json({ ok: true });
}
