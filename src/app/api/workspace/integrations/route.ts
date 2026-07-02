import { NextResponse } from "next/server";
import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { encrypt } from "@/lib/whatsapp/encryption";

// Integrações do workspace. A credencial é cifrada em repouso (AES-256-GCM ·
// mesmo util das wa_connections) e NUNCA volta pro navegador — nem cifrada:
// o GET devolve só provider/status/config.

const PROVIDERS = new Set(["metricool", "google_drive"]);

export async function GET() {
  let accountId: string;
  try {
    ({ accountId } = await getCurrentAccount());
  } catch (err) {
    return toErrorResponse(err);
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("integration_connections")
    .select("provider, status, config, updated_at")
    .eq("account_id", accountId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connections: data ?? [] });
}

export async function POST(request: Request) {
  let accountId: string;
  try {
    // Configurar credencial = mexer em setting da conta → admin+.
    ({ accountId } = await requireRole("admin"));
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as
    | { provider?: string; token?: string; config?: Record<string, unknown>; disconnect?: boolean }
    | null;
  const provider = body?.provider;
  if (!provider || !PROVIDERS.has(provider)) {
    return NextResponse.json({ error: "provider inválido" }, { status: 400 });
  }

  const db = supabaseAdmin();

  if (body?.disconnect) {
    const { error } = await db
      .from("integration_connections")
      .update({ status: "disconnected", credentials_enc: null, updated_at: new Date().toISOString() })
      .eq("account_id", accountId)
      .eq("provider", provider);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: "disconnected" });
  }

  const token = body?.token?.trim();
  if (!token) return NextResponse.json({ error: "token obrigatório" }, { status: 400 });
  if (token.length > 4000) return NextResponse.json({ error: "token grande demais" }, { status: 400 });

  const { error } = await db.from("integration_connections").upsert(
    {
      account_id: accountId,
      provider,
      status: "connected",
      credentials_enc: encrypt(token),
      config: body?.config ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id,provider" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("os_audit").insert({
    account_id: accountId,
    agent: "workspace",
    action: `integration.${provider}.connected`,
    status: "success",
    detail: {},
  });

  return NextResponse.json({ ok: true, status: "connected" });
}
