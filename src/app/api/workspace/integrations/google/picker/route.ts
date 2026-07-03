import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { refreshAccessToken } from "@/lib/google/oauth";

// POST — access token de curta duração pro Google Picker abrir NO navegador do
// cliente (é o token da conta DELE; o refresh cifrado nunca sai do servidor).
export async function POST() {
  let accountId: string;
  try {
    ({ accountId } = await requireRole("admin"));
  } catch (err) {
    return toErrorResponse(err);
  }

  const db = supabaseAdmin();
  const { data: conn, error } = await db
    .from("integration_connections")
    .select("status, credentials_enc")
    .eq("account_id", accountId)
    .eq("provider", "google_oauth")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (conn?.status !== "connected" || !conn.credentials_enc) {
    return NextResponse.json({ error: "conecte o Google Drive primeiro" }, { status: 409 });
  }

  try {
    const accessToken = await refreshAccessToken(decrypt(conn.credentials_enc));
    return NextResponse.json({ access_token: accessToken });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

// PATCH — grava a escolha do Picker: conteúdos = pasta ({kind, folder_id,
// folder_name}); fotos = ARQUIVOS ({kind: "fotos", files: [{id, name}]}) — o
// escopo drive.file só dá leitura ao que foi escolhido item a item.
export async function PATCH(request: Request) {
  let accountId: string;
  try {
    ({ accountId } = await requireRole("admin"));
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as
    | {
        kind?: string;
        folder_id?: string;
        folder_name?: string;
        files?: { id?: string; name?: string }[];
      }
    | null;
  const kind = body?.kind;
  const folderId = body?.folder_id?.trim();
  const folderName = body?.folder_name?.trim() ?? "";
  const fotosFiles =
    kind === "fotos" && Array.isArray(body?.files)
      ? body.files
          .filter((f) => typeof f?.id === "string" && f.id.length > 0 && f.id.length <= 200)
          .slice(0, 50)
          .map((f) => ({ id: f.id!.trim(), name: String(f.name ?? "").slice(0, 200) }))
      : null;
  const escolhaFotos = kind === "fotos" && fotosFiles !== null && fotosFiles.length > 0;
  const escolhaPasta =
    kind === "conteudos" && Boolean(folderId) && (folderId as string).length <= 200;
  if (!escolhaFotos && !escolhaPasta) {
    return NextResponse.json({ error: "escolha inválida" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: conn, error } = await db
    .from("integration_connections")
    .select("status, config")
    .eq("account_id", accountId)
    .eq("provider", "google_oauth")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (conn?.status !== "connected") {
    return NextResponse.json({ error: "conecte o Google Drive primeiro" }, { status: 409 });
  }

  const config = escolhaFotos
    ? {
        ...((conn.config as Record<string, unknown> | null) ?? {}),
        fotos_files: fotosFiles,
      }
    : {
        ...((conn.config as Record<string, unknown> | null) ?? {}),
        [`${kind}_folder_id`]: folderId,
        [`${kind}_folder_name`]: folderName.slice(0, 200),
      };
  const { error: upErr } = await db
    .from("integration_connections")
    .update({ config, updated_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("provider", "google_oauth");
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await db.from("os_audit").insert({
    account_id: accountId,
    agent: "workspace",
    action: escolhaFotos
      ? "integration.google_oauth.fotos_files"
      : `integration.google_oauth.folder_${kind}`,
    status: "success",
    detail: escolhaFotos
      ? { files: fotosFiles.length }
      : { folder_name: folderName.slice(0, 200) },
  });

  return NextResponse.json({ ok: true });
}
