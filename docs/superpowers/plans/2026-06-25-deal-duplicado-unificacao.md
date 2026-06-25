# Deal duplicado — detecção + unificação · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detectar deals duplicados do funil FAP01 (mesmo contato, ≥2 deals abertos com snapshot), marcá-los com badge no kanban, e dar um botão "Unificar" que confronta os cadastros campo a campo e consolida em 1 deal.

**Architecture:** Cada deal guarda o snapshot do cadastro que o criou (`deals.fap01_snapshot`). "Duplicado" é computado no client (contato com ≥2 deals abertos com snapshot) — sem flag persistido, o badge se limpa sozinho no merge. A unificação é uma API route autenticada que monta o patch do contato a partir das escolhas e chama uma RPC plpgsql atômica (update contato + delete dos não-primários numa transação).

**Tech Stack:** Next.js 16 (App Router, client components), Supabase (Postgres + RLS + service-role admin client + RPC), TypeScript, vitest, Tailwind/shadcn UI.

## Global Constraints

- UI 100% PT-BR (labels em inglês só nos títulos do átomo `TerminalWindow`). Copy do Arthur.
- Migrations idempotentes (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`). DDL roda via `psql "$SUPABASE_NS_DB_URL"` (cofre orchestrator, Session pooler) — wacrm não roda DDL pelo app.
- Tenancy: toda leitura/escrita escopada por `account_id`. RPC `SECURITY DEFINER` = só `service_role`, anon/authenticated REVOKE.
- Snapshot/dedup só conta deals do funil (`fap01_snapshot IS NOT NULL`) — deal manual nunca vira falso-positivo.
- Contato segue deduplicado por telefone (comportamento atual mantido). UTM/atribuição = sempre o mais novo (já é o que está no contato).
- Deal primário (sobrevive ao merge) = o **mais antigo** (carrega o `first_touch`/régua).
- Campos do diff (cadastro "A"): `contact_name`, `contact_email`, `company_name`, `faturamento_range`, `nicho`, `processo_foco`, `urgencia`, `tem_socio`.

---

## File Structure

- **Create** `supabase/migrations/031_deals_fap01_snapshot.sql` — coluna jsonb.
- **Create** `supabase/migrations/032_unify_duplicate_deals.sql` — RPC atômica.
- **Modify** `src/app/api/webhooks/fap01/route.ts` — grava `fap01_snapshot` no insert do deal.
- **Modify** `src/types/index.ts` — `Deal.fap01_snapshot?: Fap01Data | null`.
- **Create** `src/lib/deals/duplicates.ts` — helper puro `duplicateContactIds(deals)` + `unifyFields` + `buildUnifyPatch`.
- **Create** `src/lib/deals/duplicates.test.ts` — testes dos helpers puros.
- **Modify** `src/app/(dashboard)/pipelines/page.tsx` — carrega o set de contatos duplicados (query account-wide) + passa `duplicateContactIds` ao board; `refreshDeals` após unificar.
- **Modify** `src/components/pipelines/pipeline-board.tsx` — repassa `duplicateContactIds` aos cards.
- **Modify** `src/components/pipelines/deal-card.tsx` — badge "duplicado".
- **Create** `src/app/api/deals/unify/route.ts` — POST autenticado: monta patch + chama RPC.
- **Create** `src/components/pipelines/unify-deals-dialog.tsx` — modal de diff/escolha.
- **Modify** `src/components/pipelines/deal-detail-dialog.tsx` — aviso + botão "Unificar" quando duplicado, abre o modal.

---

### Task 1: Migration — coluna `deals.fap01_snapshot`

**Files:**
- Create: `supabase/migrations/031_deals_fap01_snapshot.sql`

**Interfaces:**
- Produces: coluna `deals.fap01_snapshot jsonb` (nullable).

- [ ] **Step 1: Escrever a migration**

```sql
-- ============================================================
-- 031_deals_fap01_snapshot.sql — snapshot do cadastro que criou o deal.
--
-- O webhook FAP01 sobrescreve contacts.fap01_data com o cadastro mais novo;
-- guardando o payload por-deal a gente preserva cada versão (antigo vs novo)
-- pra tela de unificação de duplicados. Idempotente.
-- ============================================================
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS fap01_snapshot jsonb;
```

- [ ] **Step 2: Aplicar via cofre + verificar**

Run:
```bash
URL=$(grep -hoE "^SUPABASE_NS_DB_URL=.*" ~/Projects/orchestrator/.env | cut -d= -f2-)
psql "$URL" -v ON_ERROR_STOP=1 -f supabase/migrations/031_deals_fap01_snapshot.sql
psql "$URL" -tA -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='deals' AND column_name='fap01_snapshot';"
```
Expected: `ALTER TABLE` + `fap01_snapshot|jsonb`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/031_deals_fap01_snapshot.sql
git commit -m "feat(deals): fap01_snapshot column for duplicate unify"
```

---

### Task 2: Webhook grava `fap01_snapshot` no deal

**Files:**
- Modify: `src/app/api/webhooks/fap01/route.ts:192-204` (insert do deal)
- Modify: `src/types/index.ts` (tipo `Deal`)

**Interfaces:**
- Consumes: coluna `deals.fap01_snapshot` (Task 1).
- Produces: todo deal criado pelo webhook carrega `fap01_snapshot = lead`.

- [ ] **Step 1: Adicionar `fap01_snapshot` ao tipo `Deal`**

Em `src/types/index.ts`, na interface `Deal`, adicionar (perto dos outros campos opcionais):

```ts
  fap01_snapshot?: Fap01Data | null;
```
(`Fap01Data` já é exportado em `src/types`.)

- [ ] **Step 2: Gravar o snapshot no insert do deal**

Em `src/app/api/webhooks/fap01/route.ts`, no `.insert({...})` do deal (~linha 194), adicionar a chave:

```ts
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        pipeline_id: detUuid(`pl:${SDR_PIPELINE}`),
        stage_id: detUuid(`st:${SDR_PIPELINE}:${SDR_ENTRY_STAGE}`),
        contact_id: contactId,
        title: `${lead.contact_name || phone} · MQL`,
        value: 0,
        currency: accountCurrency,
        status: 'open',
        fap01_snapshot: lead,
      })
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: TYPECHECK CLEAN.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/fap01/route.ts src/types/index.ts
git commit -m "feat(fap01): stamp fap01_snapshot on each deal insert"
```

---

### Task 3: Helpers puros de duplicidade + merge

**Files:**
- Create: `src/lib/deals/duplicates.ts`
- Test: `src/lib/deals/duplicates.test.ts`

**Interfaces:**
- Consumes: `Deal`, `Fap01Data` de `@/types`.
- Produces:
  - `duplicateContactIds(deals: Pick<Deal,'contact_id'|'status'|'fap01_snapshot'>[]): Set<string>` — contatos com ≥2 deals abertos com snapshot.
  - `UNIFY_FIELDS: { key: keyof Fap01Snapshot; label: string }[]` — campos do diff, na ordem.
  - `diffSnapshots(oldSnap, newSnap): { key; label; oldValue; newValue; diverges }[]`.
  - `buildUnifyPatch(oldSnap, newSnap, choices: Record<string,'old'|'new'>): { name; email; company; fap01_data }` — patch final do contato.

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, it, expect } from "vitest";
import { duplicateContactIds, diffSnapshots, buildUnifyPatch } from "./duplicates";

const snap = (o: Record<string, unknown>) => o as never;

describe("duplicateContactIds", () => {
  it("flags contacts with >=2 open snapshot deals", () => {
    const deals = [
      { contact_id: "c1", status: "open", fap01_snapshot: snap({ nicho: "a" }) },
      { contact_id: "c1", status: "open", fap01_snapshot: snap({ nicho: "b" }) },
      { contact_id: "c2", status: "open", fap01_snapshot: snap({ nicho: "x" }) },
    ];
    const set = duplicateContactIds(deals);
    expect(set.has("c1")).toBe(true);
    expect(set.has("c2")).toBe(false);
  });

  it("ignores manual deals (no snapshot) and non-open deals", () => {
    const deals = [
      { contact_id: "c1", status: "open", fap01_snapshot: snap({ nicho: "a" }) },
      { contact_id: "c1", status: "open", fap01_snapshot: null },
      { contact_id: "c3", status: "open", fap01_snapshot: snap({ nicho: "a" }) },
      { contact_id: "c3", status: "won", fap01_snapshot: snap({ nicho: "b" }) },
    ];
    const set = duplicateContactIds(deals);
    expect(set.has("c1")).toBe(false);
    expect(set.has("c3")).toBe(false);
  });
});

describe("diffSnapshots", () => {
  it("marks divergent fields", () => {
    const rows = diffSnapshots(
      snap({ nicho: "odonto", faturamento_range: "30-80k", contact_name: "A" }),
      snap({ nicho: "clínica", faturamento_range: "30-80k", contact_name: "A" }),
    );
    const nicho = rows.find((r) => r.key === "nicho")!;
    const fat = rows.find((r) => r.key === "faturamento_range")!;
    expect(nicho.diverges).toBe(true);
    expect(fat.diverges).toBe(false);
  });
});

describe("buildUnifyPatch", () => {
  it("applies choices: 'old' reverts the field, 'new' keeps current", () => {
    const oldS = snap({ contact_name: "Antigo", contact_email: "a@x.com", company_name: "AC", nicho: "odonto" });
    const newS = snap({ contact_name: "Novo", contact_email: "n@x.com", company_name: "NC", nicho: "clínica" });
    const patch = buildUnifyPatch(oldS, newS, { contact_name: "old", nicho: "new" });
    expect(patch.name).toBe("Antigo");
    expect(patch.fap01_data.nicho).toBe("clínica");
    // unchosen fields default to new
    expect(patch.email).toBe("n@x.com");
    expect(patch.company).toBe("NC");
    // fap01_data base = new snapshot (UTM/attribution = latest)
    expect(patch.fap01_data.contact_name).toBe("Antigo");
  });
});
```

- [ ] **Step 2: Rodar (falha)**

Run: `npx vitest run src/lib/deals/duplicates.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implementar**

```ts
import type { Deal, Fap01Data } from "@/types";

export type Fap01Snapshot = Fap01Data;

// `key` é string (não `keyof Fap01Snapshot`): o tipo Fap01Data não declara
// todas as chaves do payload (contact_name/contact_email/company_name vêm do
// lead), e o acesso é por indexação string em runtime.
export const UNIFY_FIELDS: { key: string; label: string }[] = [
  { key: "contact_name", label: "Nome" },
  { key: "contact_email", label: "Email" },
  { key: "company_name", label: "Empresa" },
  { key: "faturamento_range", label: "Faturamento" },
  { key: "nicho", label: "Nicho" },
  { key: "processo_foco", label: "Processo foco" },
  { key: "urgencia", label: "Urgência" },
  { key: "tem_socio", label: "Sócio" },
];

type DealLite = Pick<Deal, "contact_id" | "status" | "fap01_snapshot">;

/** Contatos com ≥2 deals ABERTOS que vieram do funil (têm snapshot). */
export function duplicateContactIds(deals: DealLite[]): Set<string> {
  const counts = new Map<string, number>();
  for (const d of deals) {
    if (d.status !== "open" || !d.fap01_snapshot || !d.contact_id) continue;
    counts.set(d.contact_id, (counts.get(d.contact_id) ?? 0) + 1);
  }
  const set = new Set<string>();
  for (const [id, n] of counts) if (n >= 2) set.add(id);
  return set;
}

const asText = (v: unknown): string =>
  v == null ? "" : typeof v === "boolean" ? (v ? "Sim" : "Não") : String(v);

export interface DiffRow {
  key: string;
  label: string;
  oldValue: string;
  newValue: string;
  diverges: boolean;
}

export function diffSnapshots(
  oldSnap: Fap01Snapshot,
  newSnap: Fap01Snapshot,
): DiffRow[] {
  return UNIFY_FIELDS.map(({ key, label }) => {
    const oldValue = asText((oldSnap as Record<string, unknown>)[key]);
    const newValue = asText((newSnap as Record<string, unknown>)[key]);
    return { key, label, oldValue, newValue, diverges: oldValue !== newValue };
  });
}

export interface UnifyPatch {
  name: string | null;
  email: string | null;
  company: string | null;
  fap01_data: Fap01Snapshot;
}

/** Patch final do contato. Base = snapshot NOVO (UTM/atribuição = mais novo);
 *  campos escolhidos como 'old' são sobrescritos pelo valor antigo. */
export function buildUnifyPatch(
  oldSnap: Fap01Snapshot,
  newSnap: Fap01Snapshot,
  choices: Record<string, "old" | "new">,
): UnifyPatch {
  const merged: Record<string, unknown> = { ...(newSnap as object) };
  for (const { key } of UNIFY_FIELDS) {
    if (choices[key as string] === "old") {
      merged[key as string] = (oldSnap as Record<string, unknown>)[key];
    }
  }
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  return {
    name: str(merged.contact_name),
    email: str(merged.contact_email),
    company: str(merged.company_name),
    fap01_data: merged as Fap01Snapshot,
  };
}
```

- [ ] **Step 4: Rodar (passa)**

Run: `npx vitest run src/lib/deals/duplicates.test.ts`
Expected: PASS (3 describes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/deals/duplicates.ts src/lib/deals/duplicates.test.ts
git commit -m "feat(deals): pure helpers for duplicate detection + unify patch"
```

---

### Task 4: Badge "duplicado" no card + wiring no board/page

**Files:**
- Modify: `src/components/pipelines/deal-card.tsx`
- Modify: `src/components/pipelines/pipeline-board.tsx`
- Modify: `src/app/(dashboard)/pipelines/page.tsx`

**Interfaces:**
- Consumes: `duplicateContactIds` (Task 3).
- Produces: cards de contatos duplicados mostram badge; `DealCard` ganha prop `isDuplicate?: boolean`; `PipelineBoard` ganha prop `duplicateContactIds: Set<string>`.

- [ ] **Step 1: Badge no `deal-card.tsx`**

No import de ícones, adicionar `Copy`:
```ts
import { Calendar, Check, X, Copy } from "lucide-react";
```
Na interface `DealCardProps`, adicionar:
```ts
  isDuplicate?: boolean;
```
No header, ao lado dos badges won/lost, adicionar:
```tsx
        {isDuplicate && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
            <Copy className="h-3 w-3" />
            duplicado
          </span>
        )}
```
E desestruturar `isDuplicate` nos props: `export function DealCard({ deal, stage, onEdit, isOverlay, isDuplicate }: DealCardProps) {`.

- [ ] **Step 2: Repassar no `pipeline-board.tsx`**

Adicionar `duplicateContactIds: Set<string>` aos props do board e, onde renderiza `<DealCard ... />`, passar:
```tsx
isDuplicate={!!deal.contact_id && duplicateContactIds.has(deal.contact_id)}
```
(Se o board renderiza o card em mais de um lugar — coluna + overlay de drag — passar em ambos.)

- [ ] **Step 3: Carregar o set account-wide na `page.tsx`**

Adicionar estado e loader (a detecção é account-wide, não por-pipeline):
```tsx
const [dupContactIds, setDupContactIds] = useState<Set<string>>(new Set());

const loadDuplicates = useCallback(async () => {
  const { data } = await supabase
    .from("deals")
    .select("contact_id, status, fap01_snapshot")
    .eq("status", "open")
    .not("fap01_snapshot", "is", null);
  return duplicateContactIds((data ?? []) as never);
}, [supabase]);
```
Importar `import { duplicateContactIds } from "@/lib/deals/duplicates";`. Chamar `loadDuplicates()` junto do load de deals (no effect que reage a `selectedPipelineId`, e em `refreshDeals`) e `setDupContactIds(...)`. Passar `duplicateContactIds={dupContactIds}` ao `<PipelineBoard .../>`.

- [ ] **Step 4: Typecheck + verificação visual**

Run: `npx tsc --noEmit` → CLEAN.
Verificação visual (QA user temp + chrome-devtools, ver memória `learning_wacrm_verificacao_visual_qa_user`): o card do contato `a9f33906` (2 deals) mostra o badge "duplicado".

- [ ] **Step 5: Commit**

```bash
git add src/components/pipelines/deal-card.tsx src/components/pipelines/pipeline-board.tsx "src/app/(dashboard)/pipelines/page.tsx"
git commit -m "feat(pipelines): 'duplicado' badge on cards of contacts with >1 funnel deal"
```

---

### Task 5: RPC atômica `unify_duplicate_deals`

**Files:**
- Create: `supabase/migrations/032_unify_duplicate_deals.sql`

**Interfaces:**
- Produces: `unify_duplicate_deals(p_account_id uuid, p_contact_id uuid, p_primary_deal_id uuid, p_delete_deal_ids uuid[], p_name text, p_email text, p_company text, p_fap01_data jsonb) RETURNS int` (nº de deals apagados). Atômica (plpgsql).

- [ ] **Step 1: Escrever a migration**

```sql
-- ============================================================
-- 032_unify_duplicate_deals.sql — merge atômico de deals duplicados.
--
-- Aplica o cadastro escolhido no contato e apaga os deals não-primários,
-- numa transação só. Tudo escopado por account_id; só service_role chama.
-- ============================================================
CREATE OR REPLACE FUNCTION unify_duplicate_deals(
  p_account_id uuid,
  p_contact_id uuid,
  p_primary_deal_id uuid,
  p_delete_deal_ids uuid[],
  p_name text,
  p_email text,
  p_company text,
  p_fap01_data jsonb
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  -- O primário tem que existir, ser do contato e da conta, e estar aberto.
  IF NOT EXISTS (
    SELECT 1 FROM deals
    WHERE id = p_primary_deal_id AND account_id = p_account_id
      AND contact_id = p_contact_id AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'primary deal inválido';
  END IF;

  UPDATE contacts
  SET name = p_name, email = p_email, company = p_company,
      fap01_data = p_fap01_data, updated_at = now()
  WHERE id = p_contact_id AND account_id = p_account_id;

  -- Só apaga deals abertos, da conta, do contato, e que NÃO são o primário.
  DELETE FROM deals
  WHERE id = ANY(p_delete_deal_ids)
    AND account_id = p_account_id
    AND contact_id = p_contact_id
    AND status = 'open'
    AND id <> p_primary_deal_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION unify_duplicate_deals(uuid,uuid,uuid,uuid[],text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION unify_duplicate_deals(uuid,uuid,uuid,uuid[],text,text,text,jsonb) FROM anon;
REVOKE ALL ON FUNCTION unify_duplicate_deals(uuid,uuid,uuid,uuid[],text,text,text,jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION unify_duplicate_deals(uuid,uuid,uuid,uuid[],text,text,text,jsonb) TO service_role;
```

- [ ] **Step 2: Aplicar via cofre + smoke**

Run:
```bash
URL=$(grep -hoE "^SUPABASE_NS_DB_URL=.*" ~/Projects/orchestrator/.env | cut -d= -f2-)
psql "$URL" -v ON_ERROR_STOP=1 -f supabase/migrations/032_unify_duplicate_deals.sql
psql "$URL" -tA -c "SELECT proname FROM pg_proc WHERE proname='unify_duplicate_deals';"
```
Expected: `CREATE FUNCTION` + `unify_duplicate_deals`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/032_unify_duplicate_deals.sql
git commit -m "feat(deals): atomic unify_duplicate_deals RPC"
```

---

### Task 6: API route `/api/deals/unify`

**Files:**
- Create: `src/app/api/deals/unify/route.ts`

**Interfaces:**
- Consumes: `getCurrentAccount` (`@/lib/auth/account`), `supabaseAdmin` (`@/lib/automations/admin-client`), `buildUnifyPatch` (Task 3), RPC `unify_duplicate_deals` (Task 5).
- Produces: `POST /api/deals/unify` body `{ contactId: string; choices: Record<string,'old'|'new'> }` → `{ ok: true; deleted: number }`.

- [ ] **Step 1: Escrever o teste**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const account = { accountId: "acct-1" };
vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: vi.fn(async () => account),
  toErrorResponse: () => new Response("err", { status: 401 }),
}));

const rpc = vi.fn(async () => ({ data: 1, error: null }));
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
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
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
```

- [ ] **Step 2: Rodar (falha)**

Run: `npx vitest run src/app/api/deals/unify/route.test.ts`
Expected: FAIL (module not found). (Salvar o teste como `src/app/api/deals/unify/route.test.ts`.)

- [ ] **Step 3: Implementar a route**

```ts
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
```
Nota: o "antigo" no diff = `primary` (mais antigo); o "novo" = `newest`. Bate com o modal (Task 7).

- [ ] **Step 4: Rodar (passa)**

Run: `npx vitest run src/app/api/deals/unify/route.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/deals/unify/route.ts src/app/api/deals/unify/route.test.ts
git commit -m "feat(deals): /api/deals/unify route (auth + patch + atomic RPC)"
```

---

### Task 7: Modal de unificação + botão no detail dialog

**Files:**
- Create: `src/components/pipelines/unify-deals-dialog.tsx`
- Modify: `src/components/pipelines/deal-detail-dialog.tsx`

**Interfaces:**
- Consumes: `/api/deals/unify` (Task 6), `diffSnapshots` + `UNIFY_FIELDS` (Task 3), browser supabase client.
- Produces: `UnifyDealsDialog` props `{ open; onOpenChange; contactId; onUnified: () => void }`.

- [ ] **Step 1: Criar `unify-deals-dialog.tsx`**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { diffSnapshots, type DiffRow, type Fap01Snapshot } from "@/lib/deals/duplicates";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
  onUnified: () => void;
}

export function UnifyDealsDialog({ open, onOpenChange, contactId, onUnified }: Props) {
  const supabase = createClient();
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [choices, setChoices] = useState<Record<string, "old" | "new">>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("deals")
      .select("id, created_at, fap01_snapshot")
      .eq("contact_id", contactId)
      .eq("status", "open")
      .not("fap01_snapshot", "is", null)
      .order("created_at", { ascending: true });
    const deals = (data ?? []) as { fap01_snapshot: Fap01Snapshot }[];
    setCount(deals.length);
    if (deals.length >= 2) {
      const oldS = deals[0].fap01_snapshot;
      const newS = deals[deals.length - 1].fap01_snapshot;
      setRows(diffSnapshots(oldS, newS));
    } else {
      setRows([]);
    }
    setChoices({});
    setLoading(false);
  }, [supabase, contactId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function handleUnify() {
    setSaving(true);
    const res = await fetch("/api/deals/unify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactId, choices }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error("Falha ao unificar");
      return;
    }
    toast.success("Leads unificados");
    onOpenChange(false);
    onUnified();
  }

  const diverging = rows.filter((r) => r.diverges);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Unificar lead duplicado</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-sm text-muted-foreground">Carregando…</p>
        ) : count < 2 ? (
          <p className="py-6 text-sm text-muted-foreground">Não há mais duplicados pra unificar.</p>
        ) : (
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Mantemos o cadastro mais antigo como base do negócio. Onde houver divergência,
              escolha qual valor fica. UTMs/origem ficam sempre com o mais recente.
            </p>
            {diverging.length === 0 ? (
              <p className="text-sm text-foreground">Os dois cadastros são iguais — unificar só remove o duplicado.</p>
            ) : (
              <div className="space-y-3">
                {diverging.map((r) => {
                  const choice = choices[r.key as string] ?? "new";
                  return (
                    <div key={r.key as string} className="rounded-lg border border-border p-3">
                      <p className="mb-2 text-sm font-semibold text-foreground">{r.label}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {(["old", "new"] as const).map((side) => (
                          <button
                            key={side}
                            type="button"
                            onClick={() => setChoices((c) => ({ ...c, [r.key as string]: side }))}
                            className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                              choice === side
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            <span className="block text-[10px] uppercase text-muted-foreground">
                              {side === "old" ? "Antigo" : "Novo"}
                            </span>
                            {(side === "old" ? r.oldValue : r.newValue) || "—"}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border text-muted-foreground hover:bg-muted">
            Cancelar
          </Button>
          <Button onClick={handleUnify} disabled={saving || count < 2} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? "Unificando…" : "Unificar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Botão "Unificar" no `deal-detail-dialog.tsx`**

No `deal-detail-dialog.tsx`:
1. Importar `import { UnifyDealsDialog } from "./unify-deals-dialog";` e `useState`.
2. Receber/derivar `isDuplicate` — passar uma prop nova `isDuplicate?: boolean` no componente (a `page.tsx` passa `dupContactIds.has(editingDeal?.contact_id)` ao `<DealDetailDialog/>`).
3. Estado: `const [unifyOpen, setUnifyOpen] = useState(false);`.
4. Quando `isDuplicate` e há `deal?.contact_id`, renderizar um aviso + botão no topo do conteúdo:
```tsx
{isDuplicate && deal?.contact_id && (
  <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
    <span className="text-xs text-amber-300">Esse contato tem mais de um cadastro no funil.</span>
    <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10" onClick={() => setUnifyOpen(true)}>
      Unificar
    </Button>
  </div>
)}
```
5. No fim do JSX do dialog, montar o modal:
```tsx
{deal?.contact_id && (
  <UnifyDealsDialog
    open={unifyOpen}
    onOpenChange={setUnifyOpen}
    contactId={deal.contact_id}
    onUnified={() => { onOpenChange(false); onSaved(); }}
  />
)}
```
6. Em `page.tsx`, no `<DealDetailDialog ... />`, passar:
```tsx
isDuplicate={!!editingDeal?.contact_id && dupContactIds.has(editingDeal.contact_id)}
```
e adicionar `isDuplicate?: boolean` aos props do `DealDetailDialog`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: TYPECHECK CLEAN.

- [ ] **Step 4: Commit**

```bash
git add src/components/pipelines/unify-deals-dialog.tsx src/components/pipelines/deal-detail-dialog.tsx "src/app/(dashboard)/pipelines/page.tsx"
git commit -m "feat(pipelines): unify-duplicate-lead dialog + trigger in deal detail"
```

---

### Task 8: Verificação e2e (deploy + tela)

**Files:** nenhum (verificação).

- [ ] **Step 1: Suite + typecheck completos**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo PASS / CLEAN.

- [ ] **Step 2: Deploy VPS**

```bash
cd ~/Projects/wacrm
rsync -az --exclude node_modules --exclude .next --exclude .git ./ srv1571722.hstgr.cloud:/opt/wacrm/
ssh srv1571722.hstgr.cloud 'cd /opt/wacrm && docker compose build wacrm && docker compose up -d wacrm'
```

- [ ] **Step 3: Verificação visual (contato real duplicado)**

Usar o contato `a9f33906` (Arthur, 2 deals) — via QA user temp + chrome-devtools (memória `learning_wacrm_verificacao_visual_qa_user`):
1. Funil → card mostra badge "duplicado".
2. Abrir card → aviso + botão "Unificar".
3. Modal mostra o diff (provável "sem divergência" pq foi o mesmo cadastro 2×) → Unificar.
4. Confirmar: sobra 1 deal, badge some, contato intacto, régua/toques seguem (consultar `automation_pending_executions` do contato — o pending do +24h/+48h continua).
5. Deletar o QA user no fim.

- [ ] **Step 4: Commit (se houver ajuste)** — senão, encerrado.

---

## Notes
- **>2 duplicados:** a route apaga todos os não-primários (`deals.slice(1)`); o diff compara o mais antigo vs o mais novo (os do meio são absorvidos mantendo o primário). Comportamento documentado no aviso do modal.
- **Régua intacta:** o `first_touch` (sdr_touches) e os `automation_pending_executions` são amarrados ao contato e ao deal mais antigo (primário) — que sobrevive. Verificar no e2e que o pending do próximo toque continua.
- **Sem mudança no contato-merge** do webhook: dedup por telefone segue igual.
