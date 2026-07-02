import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { validateNewLine, type NewLineInput } from "@/lib/workspace/editorial";

// POST /api/workspace/content/editorial-line — cria a linha editorial e
// enfileira o job gerar_semana (o worker roda a skill linha-editorial no
// repo-cérebro e cria as peças em Pauta). Gate: squad_content ligado.

export async function POST(request: Request) {
  let accountId: string;
  let userId: string;
  try {
    ({ accountId, userId } = await getCurrentAccount());
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as Partial<NewLineInput> | null;
  const input: NewLineInput = {
    start_date: String(body?.start_date ?? ""),
    end_date: String(body?.end_date ?? ""),
    carrossel: Number(body?.carrossel ?? 0),
    estatico: Number(body?.estatico ?? 0),
    video: Number(body?.video ?? 0),
    themes: String(body?.themes ?? "").slice(0, 2000),
  };
  const check = validateNewLine(input);
  if (!check.ok) {
    return NextResponse.json({ error: check.errors.join(" ") }, { status: 400 });
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

  // Uma linha por vez no forno: evita duas gerações concorrentes na mesma conta.
  const { data: gerando } = await db
    .from("content_editorial_lines")
    .select("id")
    .eq("account_id", accountId)
    .eq("status", "gerando")
    .maybeSingle();
  if (gerando) {
    return NextResponse.json(
      { error: "já existe uma linha editorial sendo montada — espera ela terminar" },
      { status: 409 },
    );
  }

  const mix = { carrossel: input.carrossel, estatico: input.estatico, video: input.video };
  const { data: line, error: lineErr } = await db
    .from("content_editorial_lines")
    .insert({
      account_id: accountId,
      start_date: input.start_date,
      end_date: input.end_date,
      mix,
      themes: input.themes || null,
      status: "gerando",
      created_by: userId,
    })
    .select("id")
    .single();
  if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 500 });

  const { error: jobErr } = await db.from("content_jobs").insert({
    account_id: accountId,
    kind: "gerar_semana",
    payload: {
      line_id: line.id,
      start_date: input.start_date,
      end_date: input.end_date,
      mix,
      themes: input.themes || null,
    },
    created_by: userId,
  });
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, lineId: line.id });
}
