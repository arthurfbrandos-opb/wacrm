import { describe, it, expect, vi, beforeEach } from "vitest";

const account = { accountId: "acct-1" };
vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: vi.fn(async () => account),
  toErrorResponse: () => new Response("err", { status: 401 }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = vi.fn(async (..._args: any[]) => ({ data: 1, error: null }));
const dealsRows = [
  { id: "d-old", created_at: "2026-06-24T01:00:00Z", fap01_snapshot: { contact_name: "Antigo", nicho: "odonto" } },
  { id: "d-new", created_at: "2026-06-24T01:00:12Z", fap01_snapshot: { contact_name: "Novo", nicho: "clínica" } },
];
// Self-chaining mock: select/eq/not retornam o próprio chain; order resolve.
// Robusto independente de quantos .eq() a route encadeia.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chain: any = {
  select: () => chain,
  eq: () => chain,
  not: () => chain,
  order: () => Promise.resolve({ data: dealsRows, error: null }),
};
vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: () => ({ from: () => chain, rpc: (...a: unknown[]) => rpc(...a) }),
}));

import { POST } from "./route";

beforeEach(() => rpc.mockClear());

describe("POST /api/deals/unify", () => {
  it("keeps oldest as primary, deletes the rest, applies choices via RPC", async () => {
    const req = new Request("http://x/api/deals/unify", {
      method: "POST",
      body: JSON.stringify({ contactId: "c1", choices: { nicho: "old" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = (rpc.mock.calls[0] as unknown) as [string, Record<string, unknown>];
    expect(fn).toBe("unify_duplicate_deals");
    expect(args.p_primary_deal_id).toBe("d-old");
    expect(args.p_delete_deal_ids).toEqual(["d-new"]);
    expect(args.p_name).toBe("Novo");                  // name not chosen → new
    expect((args.p_fap01_data as Record<string, unknown>).nicho).toBe("odonto"); // chosen old
  });

  it("no-ops when fewer than 2 snapshot deals", async () => {
    dealsRows.length = 1;
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ contactId: "c1", choices: {} }) });
    const res = await POST(req);
    const body = await res.json();
    expect(body.deleted).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    dealsRows.length = 2; // restore
  });
});
