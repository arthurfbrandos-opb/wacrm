import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireRole } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { encrypt } from "@/lib/whatsapp/encryption";
import { exchangeCode } from "@/lib/google/oauth";

// GET /api/workspace/integrations/google/callback — volta do consent do Google.
// Troca o code por tokens (server-side) e guarda o refresh token CIFRADO no
// cofre da conta (provider google_oauth). Redireciona pra Configurações.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const volta = (q: string) => NextResponse.redirect(`${origin}/w/config?google=${q}`);

  let accountId: string;
  try {
    ({ accountId } = await requireRole("admin"));
  } catch {
    return volta("sem-sessao");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const nonce = jar.get("g_oauth_state")?.value;
  if (!code || !state || !nonce || state !== nonce) return volta("estado-invalido");

  try {
    const tokens = await exchangeCode(origin, code);
    if (!tokens.refresh_token) return volta("sem-refresh");

    const db = supabaseAdmin();
    const { error } = await db.from("integration_connections").upsert(
      {
        account_id: accountId,
        provider: "google_oauth",
        status: "connected",
        credentials_enc: encrypt(tokens.refresh_token),
        config: {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id,provider" },
    );
    if (error) return volta("erro-banco");

    await db.from("os_audit").insert({
      account_id: accountId,
      agent: "workspace",
      action: "integration.google_oauth.connected",
      status: "success",
      detail: {},
    });
    return volta("ok");
  } catch {
    return volta("erro");
  }
}
