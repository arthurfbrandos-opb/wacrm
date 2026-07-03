import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { googleAuthUrl } from "@/lib/google/oauth";

// GET /api/workspace/integrations/google/authorize — inicia o "Conectar Google
// Drive": manda o cliente pro consent do Google. O state (nonce em cookie
// httpOnly) fecha o loop no callback contra CSRF.
export async function GET(request: Request) {
  try {
    await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return NextResponse.json({ error: "host ausente" }, { status: 400 });
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  const nonce = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(googleAuthUrl(origin, nonce));
  res.cookies.set("g_oauth_state", nonce, {
    httpOnly: true,
    secure: proto === "https",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
