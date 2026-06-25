import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { buildUnifyPatch, type Fap01Snapshot } from "@/lib/deals/duplicates";

export async function POST(request: Request) {
  let accountId: string;
  try {
    ({ accountId } = await getCurrentAccount());
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as
    | { contactId?: string; choices?: Record<string, "old" | "new"> }
    | null;
  if (!body?.contactId) {
    return NextResponse.json({ error: "contactId required" }, { status: 400 });
  }
  const choices = body.choices ?? {};

  const db = supabaseAdmin();
  // Deals abertos do funil (com snapshot) desse contato, na conta, do mais antigo.
  const { data: rows, error } = await db
    .from("deals")
    .select("id, created_at, fap01_snapshot")
    .eq("account_id", accountId)
    .eq("contact_id", body.contactId)
    .eq("status", "open")
    .not("fap01_snapshot", "is", null)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const deals = (rows ?? []) as { id: string; created_at: string; fap01_snapshot: Fap01Snapshot }[];
  if (deals.length < 2) return NextResponse.json({ ok: true, deleted: 0 });

  const primary = deals[0]; // mais antigo = carrega o first_touch/régua
  const newest = deals[deals.length - 1]; // o mais novo = o que está no contato
  const deleteIds = deals.slice(1).map((d) => d.id);

  const patch = buildUnifyPatch(primary.fap01_snapshot, newest.fap01_snapshot, choices);

  const { data: deleted, error: rpcErr } = await db.rpc("unify_duplicate_deals", {
    p_account_id: accountId,
    p_contact_id: body.contactId,
    p_primary_deal_id: primary.id,
    p_delete_deal_ids: deleteIds,
    p_name: patch.name,
    p_email: patch.email,
    p_company: patch.company,
    p_fap01_data: patch.fap01_data,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: deleted ?? 0 });
}
