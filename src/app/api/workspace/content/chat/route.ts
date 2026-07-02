import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";

// POST /api/workspace/content/chat — o cliente fala com a Squad Content.
// Grava a mensagem dele + enfileira um job de produção (o worker do VPS drena).
// Gate: módulo squad_content precisa estar ligado pra conta (cc_account_modules).
export async function POST(request: Request) {
  let accountId: string;
  let userId: string;
  try {
    ({ accountId, userId } = await getCurrentAccount());
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as { message?: string } | null;
  const message = body?.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: "message too long (max 2000)" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Gate de módulo (C9): sem squad_content ligado, a conta não fala com o squad.
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
      kind: "chat",
      payload: { message },
      created_by: userId,
    })
    .select("id")
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  const { error: msgErr } = await db.from("content_chat_messages").insert({
    account_id: accountId,
    author: "cliente",
    body: message,
    job_id: job.id,
  });
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, jobId: job.id });
}
