# Camada 6 · Dashboard — Fatia 1 (lançamento) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/dashboard/anuncios` no wacrm com operação ao vivo + funil do lançamento (CRM puro) + custo por resultado por criativo (gasto do Meta via n8n → `ad_spend`), pra ter visibilidade no dia 1 de mídia (segunda 29/06).

**Architecture:** Mesmo padrão do dashboard atual — loaders client-side que buscam linhas (RLS escopa por conta/usuário automaticamente) e agregam em JS. A lógica de agregação fica em **funções puras testáveis** (`ads-attribution.ts` + `ads-metrics.ts`); os loaders (`ads-queries.ts`) só buscam e chamam as puras. O gasto do Meta entra por um workflow n8n (`WF-NS-AD-SPEND-SYNC`) que faz upsert na tabela nova `ad_spend`; o wacrm só lê.

**Tech Stack:** Next.js (app router, grupo `(dashboard)`), Supabase JS (browser client, RLS), vitest (node env, pure-function unit tests), Recharts (já usado no dashboard), n8n (Meta Marketing API).

**Spec:** `wacrm/docs/superpowers/specs/2026-06-25-camada6-dashboard-fatia1-lancamento-design.md` (filho do §9 de `negocio-simples/.../2026-06-25-maquina-aquisicao-design.md`).

## Global Constraints

- **Output / labels de UI em PT-BR** (regra NS). `title=` do `TerminalWindow` pode ficar em inglês (padrão do IDV).
- **Timezone SP (UTC-3)** em todo bucket de dia — usar os helpers de `src/lib/dashboard/date-utils.ts` (`startOfLocalDay`, `daysAgoStart`, `localDayKey`), nunca `new Date()` cru pra chave de dia.
- **Inbound = `messages.sender_type = 'customer'`** · outbound = `'agent'` ou `'bot'` (verificado no banco).
- **Lead = contato distinto** (a dedup faz 1 contato ter vários deals) — contar `contact_id` distinto, nunca `deal.id`.
- **Atribuição não inventa:** `last_touch.utm.utm_content` → `first_touch.utm.utm_content` → senão `"Sem atribuição"`. (Não há `utm_content` flat — só campaign/medium/source são promovidos.)
- **Honestidade > esconder:** gasto sem lead casado = linha visível com 0 leads; lead sem `utm_content` = linha "Sem atribuição". Nada some.
- **Segredo do Meta nunca no env do wacrm** — token `ads_read` mora no n8n/cofre.
- **Nomenclatura n8n:** prefixo `WF-NS-*`.
- **Workflow git:** wacrm deploya por `rsync + docker build`, não git. Commits são scoped (`git add <paths>` + `git commit -- <paths>`), nunca `-A`. Branch atual `main`.

**Estágios reais (verificados no banco 25/06) — usar exatamente estes nomes:**
- Pipeline **`Pré-Vendas (SDR)`**: `Reentrada`, `Funil de Aplicação`, `Funil de Social Selling`, `Primeiro Contato`, `Em Conversa`, `Agendamento Realizado`, `Lead Vencido`.
- Pipeline **`Closer`**: `Comparecimento Realizado`, …, `Venda Fechada`, `Venda Perdida`, `No-show / Desqualificado`.

---

### Task 1: Migration `033_ad_spend.sql`

**Files:**
- Create: `supabase/migrations/033_ad_spend.sql`

**Interfaces:**
- Produces: tabela `ad_spend` com colunas `account_id, date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, spend, impressions, link_clicks, synced_at`; unique `(account_id, date, ad_id)`; RLS de leitura por membro da conta.

- [ ] **Step 1: Escrever a migration**

```sql
-- 033_ad_spend.sql
-- Gasto de mídia por anúncio por dia, populado pelo n8n WF-NS-AD-SPEND-SYNC.
-- O wacrm só lê (browser, RLS). O n8n escreve via service_role (bypassa RLS).
create table if not exists public.ad_spend (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  date date not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text not null,
  ad_name text,
  spend numeric not null default 0,
  impressions integer not null default 0,
  link_clicks integer not null default 0,
  synced_at timestamptz not null default now(),
  unique (account_id, date, ad_id)
);

create index if not exists ad_spend_account_date_idx on public.ad_spend (account_id, date);
create index if not exists ad_spend_ad_name_idx on public.ad_spend (account_id, ad_name);

alter table public.ad_spend enable row level security;

-- Leitura: membros da conta (mesma função usada no resto do schema).
create policy "ad_spend read for account members"
  on public.ad_spend for select
  using (public.is_account_member(account_id));
```

- [ ] **Step 2: Aplicar via cofre (psql, não REST)**

Migration/DDL no banco NS roda por `psql "$SUPABASE_NS_DB_URL"` (cofre orchestrator), não pelo wacrm (que só faz REST). Ver memória `reference_ddl_banco_ns_cofre`.

Run:
```bash
cd ~/Projects/orchestrator && source .env && \
psql "$SUPABASE_NS_DB_URL" -f ~/Projects/wacrm/supabase/migrations/033_ad_spend.sql
```
Expected: `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE` / `CREATE POLICY` sem erro.

- [ ] **Step 3: Verificar tabela + RLS**

Run:
```bash
cd ~/Projects/orchestrator && source .env && \
psql "$SUPABASE_NS_DB_URL" -P pager=off -c "\d+ public.ad_spend" \
-c "select polname from pg_policies where tablename='ad_spend';"
```
Expected: colunas conforme a migration + 1 policy de select.

- [ ] **Step 4: Commit**

```bash
cd ~/Projects/wacrm && git add supabase/migrations/033_ad_spend.sql && \
git commit -m "feat(ads): migration 033 ad_spend (gasto por anúncio/dia, RLS leitura)" -- supabase/migrations/033_ad_spend.sql
```

---

### Task 2: Tipos + resolução de criativo (`ads-types.ts`, `ads-attribution.ts`)

**Files:**
- Create: `src/lib/dashboard/ads-types.ts`
- Create: `src/lib/dashboard/ads-attribution.ts`
- Test: `src/lib/dashboard/ads-attribution.test.ts`

**Interfaces:**
- Produces:
  - `ads-types.ts`: `CreativeAttribution`, `AdsLiveOps`, `FunnelStage`, `AdsFunnel`, `CreativeCostRow`, `SpendByAd`, `CreativeLead`.
  - `ads-attribution.ts`: `UNATTRIBUTED: string`, `AttributionBlob` (interface), `resolveCreative(fap01: AttributionBlob | null | undefined): CreativeAttribution`.

- [ ] **Step 1: Escrever os tipos**

```typescript
// src/lib/dashboard/ads-types.ts

/** Criativo (utm_content) + campanha (utm_campaign) resolvidos de um lead. */
export interface CreativeAttribution {
  creative: string // utm_content, ou "Sem atribuição"
  campaign: string | null // utm_campaign
}

/** Bloco 1 · operação ao vivo (hoje). */
export interface AdsLiveOps {
  leadsToday: { current: number; previous: number } // previous = ontem
  responded: { count: number; pct: number } // % dos leads de hoje que responderam
  bookingsToday: number
  awaitingResponseNow: number
  avgFirstResponseMinToday: number | null
}

/** Bloco 2 · funil. */
export interface FunnelStage {
  key: 'leads' | 'responded' | 'booked' | 'attended' | 'sold'
  label: string
  count: number
  convFromPrevPct: number | null // null no 1º estágio
}
export interface AdsFunnel {
  stages: FunnelStage[]
}

/** Bloco 3 · custo por resultado por criativo. */
export interface CreativeLead {
  contactId: string
  creative: string
  campaign: string | null
}
export interface SpendByAd {
  adName: string
  campaignName: string | null
  spend: number
}
export interface CreativeCostRow {
  creative: string
  campaign: string | null
  spend: number
  leads: number
  cpl: number | null // null se leads=0
  booked: number
  costPerBooking: number | null
  attended: number
  costPerAttended: number | null
}
```

- [ ] **Step 2: Escrever o teste de `resolveCreative` (falhando)**

```typescript
// src/lib/dashboard/ads-attribution.test.ts
import { describe, it, expect } from 'vitest'
import { resolveCreative, UNATTRIBUTED } from './ads-attribution'

describe('resolveCreative', () => {
  it('usa last_touch.utm_content quando presente', () => {
    const r = resolveCreative({
      attribution: {
        last_touch: { utm: { utm_content: 'criativo-A', utm_campaign: 'NS-frio' } },
        first_touch: { utm: { utm_content: 'criativo-Z', utm_campaign: 'velho' } },
      },
    })
    expect(r).toEqual({ creative: 'criativo-A', campaign: 'NS-frio' })
  })

  it('cai pro first_touch quando last_touch não tem content', () => {
    const r = resolveCreative({
      attribution: { first_touch: { utm: { utm_content: 'criativo-B', utm_campaign: 'NS-quente' } } },
    })
    expect(r).toEqual({ creative: 'criativo-B', campaign: 'NS-quente' })
  })

  it('campanha cai pro source_utm_campaign flat se não houver no attribution', () => {
    const r = resolveCreative({
      attribution: { last_touch: { utm: { utm_content: 'criativo-C' } } },
      source_utm_campaign: 'flat-camp',
    })
    expect(r).toEqual({ creative: 'criativo-C', campaign: 'flat-camp' })
  })

  it('sem utm_content em lugar nenhum → Sem atribuição, campanha null', () => {
    expect(resolveCreative({ attribution: {} })).toEqual({ creative: UNATTRIBUTED, campaign: null })
    expect(resolveCreative(null)).toEqual({ creative: UNATTRIBUTED, campaign: null })
    expect(resolveCreative(undefined)).toEqual({ creative: UNATTRIBUTED, campaign: null })
  })
})
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `cd ~/Projects/wacrm && npx vitest run src/lib/dashboard/ads-attribution.test.ts`
Expected: FAIL — `resolveCreative` não existe.

- [ ] **Step 4: Implementar `resolveCreative`**

```typescript
// src/lib/dashboard/ads-attribution.ts
import type { CreativeAttribution } from './ads-types'

export const UNATTRIBUTED = 'Sem atribuição'

/** Subconjunto de contacts.fap01_data que importa pra atribuição. */
export interface AttributionBlob {
  attribution?: {
    last_touch?: { utm?: { utm_content?: string; utm_campaign?: string } }
    first_touch?: { utm?: { utm_content?: string; utm_campaign?: string } }
  }
  source_utm_campaign?: string
}

export function resolveCreative(
  fap01: AttributionBlob | null | undefined,
): CreativeAttribution {
  const lt = fap01?.attribution?.last_touch?.utm
  const ft = fap01?.attribution?.first_touch?.utm
  const creative = lt?.utm_content || ft?.utm_content || UNATTRIBUTED
  const campaign = lt?.utm_campaign || ft?.utm_campaign || fap01?.source_utm_campaign || null
  return { creative, campaign }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd ~/Projects/wacrm && npx vitest run src/lib/dashboard/ads-attribution.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/wacrm && git add src/lib/dashboard/ads-types.ts src/lib/dashboard/ads-attribution.ts src/lib/dashboard/ads-attribution.test.ts && \
git commit -m "feat(ads): tipos do painel de anúncios + resolveCreative (atribuição por utm_content)" -- src/lib/dashboard/ads-types.ts src/lib/dashboard/ads-attribution.ts src/lib/dashboard/ads-attribution.test.ts
```

---

### Task 3: Funil (`computeFunnel`)

**Files:**
- Create: `src/lib/dashboard/ads-metrics.ts`
- Test: `src/lib/dashboard/ads-metrics.test.ts`

**Interfaces:**
- Consumes: `AdsFunnel`, `FunnelStage` de `ads-types.ts`.
- Produces: `computeFunnel(args: { leadContactIds: string[]; respondedContactIds: Iterable<string>; bookedContactIds: Iterable<string>; attendedContactIds: Iterable<string>; soldContactIds: Iterable<string> }): AdsFunnel`.

- [ ] **Step 1: Escrever o teste (falhando)**

```typescript
// src/lib/dashboard/ads-metrics.test.ts
import { describe, it, expect } from 'vitest'
import { computeFunnel } from './ads-metrics'

describe('computeFunnel', () => {
  it('conta leads distintos e conversão entre etapas (subset dos leads)', () => {
    const f = computeFunnel({
      leadContactIds: ['a', 'b', 'c', 'd', 'a'], // 'a' duplicado → conta 1x
      respondedContactIds: ['a', 'b', 'x'], // 'x' não é lead → ignorado
      bookedContactIds: ['a', 'b'],
      attendedContactIds: ['a'],
      soldContactIds: [],
    })
    const by = Object.fromEntries(f.stages.map((s) => [s.key, s.count]))
    expect(by).toEqual({ leads: 4, responded: 2, booked: 2, attended: 1, sold: 0 })
    // responded/leads = 2/4 = 50%
    const responded = f.stages.find((s) => s.key === 'responded')!
    expect(responded.convFromPrevPct).toBe(50)
    expect(f.stages[0].convFromPrevPct).toBeNull()
  })

  it('zero leads → tudo 0, conversões null', () => {
    const f = computeFunnel({
      leadContactIds: [],
      respondedContactIds: [],
      bookedContactIds: [],
      attendedContactIds: [],
      soldContactIds: [],
    })
    expect(f.stages.every((s) => s.count === 0)).toBe(true)
    expect(f.stages.find((s) => s.key === 'responded')!.convFromPrevPct).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ~/Projects/wacrm && npx vitest run src/lib/dashboard/ads-metrics.test.ts`
Expected: FAIL — `computeFunnel` não existe.

- [ ] **Step 3: Implementar `computeFunnel`**

```typescript
// src/lib/dashboard/ads-metrics.ts
import type { AdsFunnel, FunnelStage } from './ads-types'

const FUNNEL_LABELS: Record<FunnelStage['key'], string> = {
  leads: 'Leads',
  responded: 'Responderam',
  booked: 'Agendaram',
  attended: 'Compareceram',
  sold: 'Venderam',
}

export function computeFunnel(args: {
  leadContactIds: string[]
  respondedContactIds: Iterable<string>
  bookedContactIds: Iterable<string>
  attendedContactIds: Iterable<string>
  soldContactIds: Iterable<string>
}): AdsFunnel {
  const leads = new Set(args.leadContactIds)
  // Cada etapa = leads que alcançaram aquele estado (subset dos leads).
  const inLeads = (ids: Iterable<string>) => {
    let n = 0
    const seen = new Set<string>()
    for (const id of ids) {
      if (leads.has(id) && !seen.has(id)) {
        seen.add(id)
        n++
      }
    }
    return n
  }

  const counts: Record<FunnelStage['key'], number> = {
    leads: leads.size,
    responded: inLeads(args.respondedContactIds),
    booked: inLeads(args.bookedContactIds),
    attended: inLeads(args.attendedContactIds),
    sold: inLeads(args.soldContactIds),
  }

  const order: FunnelStage['key'][] = ['leads', 'responded', 'booked', 'attended', 'sold']
  const stages: FunnelStage[] = order.map((key, i) => {
    const prev = i === 0 ? null : counts[order[i - 1]]
    const convFromPrevPct =
      prev === null || prev === 0 ? (i === 0 ? null : 0) : Math.round((counts[key] / prev) * 100)
    return { key, label: FUNNEL_LABELS[key], count: counts[key], convFromPrevPct: i === 0 ? null : convFromPrevPct }
  })

  return { stages }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd ~/Projects/wacrm && npx vitest run src/lib/dashboard/ads-metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/wacrm && git add src/lib/dashboard/ads-metrics.ts src/lib/dashboard/ads-metrics.test.ts && \
git commit -m "feat(ads): computeFunnel (leads distintos + conversão por etapa)" -- src/lib/dashboard/ads-metrics.ts src/lib/dashboard/ads-metrics.test.ts
```

---

### Task 4: Tabela de custo por criativo (`buildCreativeCostTable`)

**Files:**
- Modify: `src/lib/dashboard/ads-metrics.ts` (adiciona função)
- Modify: `src/lib/dashboard/ads-metrics.test.ts` (adiciona testes)

**Interfaces:**
- Consumes: `CreativeLead`, `SpendByAd`, `CreativeCostRow` de `ads-types.ts`.
- Produces: `buildCreativeCostTable(args: { leads: CreativeLead[]; bookedContactIds: Set<string>; attendedContactIds: Set<string>; spend: SpendByAd[] }): CreativeCostRow[]`.

- [ ] **Step 1: Escrever os testes (falhando)**

```typescript
// adicionar em src/lib/dashboard/ads-metrics.test.ts
import { buildCreativeCostTable } from './ads-metrics'

describe('buildCreativeCostTable', () => {
  const leads = [
    { contactId: 'a', creative: 'criativo-A', campaign: 'NS-frio' },
    { contactId: 'b', creative: 'criativo-A', campaign: 'NS-frio' },
    { contactId: 'c', creative: 'Sem atribuição', campaign: null },
  ]
  const spend = [
    { adName: 'criativo-A', campaignName: 'NS-frio', spend: 100 },
    { adName: 'criativo-fantasma', campaignName: 'NS-frio', spend: 50 }, // gastou, 0 leads
  ]

  it('junta gasto por ad_name=creative e calcula CPL + custo/agendamento', () => {
    const rows = buildCreativeCostTable({
      leads,
      bookedContactIds: new Set(['a']),
      attendedContactIds: new Set<string>(),
      spend,
    })
    const a = rows.find((r) => r.creative === 'criativo-A')!
    expect(a.leads).toBe(2)
    expect(a.spend).toBe(100)
    expect(a.cpl).toBe(50) // 100/2
    expect(a.booked).toBe(1)
    expect(a.costPerBooking).toBe(100) // 100/1
  })

  it('criativo com leads mas sem gasto casado → cpl null', () => {
    const rows = buildCreativeCostTable({ leads, bookedContactIds: new Set(), attendedContactIds: new Set(), spend: [] })
    const a = rows.find((r) => r.creative === 'criativo-A')!
    expect(a.spend).toBe(0)
    expect(a.cpl).toBeNull()
  })

  it('gasto sem lead casado vira linha visível com 0 leads (flagra má-config)', () => {
    const rows = buildCreativeCostTable({ leads, bookedContactIds: new Set(), attendedContactIds: new Set(), spend })
    const fantasma = rows.find((r) => r.creative === 'criativo-fantasma')!
    expect(fantasma.leads).toBe(0)
    expect(fantasma.spend).toBe(50)
    expect(fantasma.cpl).toBeNull()
  })

  it('linha Sem atribuição aparece (lead sem utm_content)', () => {
    const rows = buildCreativeCostTable({ leads, bookedContactIds: new Set(), attendedContactIds: new Set(), spend })
    expect(rows.some((r) => r.creative === 'Sem atribuição' && r.leads === 1)).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ~/Projects/wacrm && npx vitest run src/lib/dashboard/ads-metrics.test.ts`
Expected: FAIL — `buildCreativeCostTable` não existe.

- [ ] **Step 3: Implementar `buildCreativeCostTable`**

```typescript
// adicionar em src/lib/dashboard/ads-metrics.ts
import type { CreativeCostRow, CreativeLead, SpendByAd } from './ads-types'

export function buildCreativeCostTable(args: {
  leads: CreativeLead[]
  bookedContactIds: Set<string>
  attendedContactIds: Set<string>
  spend: SpendByAd[]
}): CreativeCostRow[] {
  interface Agg {
    creative: string
    campaign: string | null
    leadIds: Set<string>
    booked: Set<string>
    attended: Set<string>
  }
  const byCreative = new Map<string, Agg>()
  for (const l of args.leads) {
    let agg = byCreative.get(l.creative)
    if (!agg) {
      agg = { creative: l.creative, campaign: l.campaign, leadIds: new Set(), booked: new Set(), attended: new Set() }
      byCreative.set(l.creative, agg)
    }
    agg.leadIds.add(l.contactId)
    if (args.bookedContactIds.has(l.contactId)) agg.booked.add(l.contactId)
    if (args.attendedContactIds.has(l.contactId)) agg.attended.add(l.contactId)
  }

  // Gasto somado por ad_name.
  const spendByAd = new Map<string, { spend: number; campaign: string | null }>()
  for (const s of args.spend) {
    const cur = spendByAd.get(s.adName) ?? { spend: 0, campaign: s.campaignName }
    cur.spend += s.spend
    spendByAd.set(s.adName, cur)
  }

  const rows: CreativeCostRow[] = []
  const div = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) / 100 : null)

  // 1) Linhas a partir dos leads (com ou sem gasto casado).
  for (const agg of byCreative.values()) {
    const spend = spendByAd.get(agg.creative)?.spend ?? 0
    const leads = agg.leadIds.size
    const booked = agg.booked.size
    const attended = agg.attended.size
    rows.push({
      creative: agg.creative,
      campaign: agg.campaign,
      spend,
      leads,
      cpl: div(spend, leads),
      booked,
      costPerBooking: div(spend, booked),
      attended,
      costPerAttended: div(spend, attended),
    })
  }

  // 2) Gasto sem nenhum lead casado → linha visível (flagra rename/typo de UTM).
  for (const [adName, info] of spendByAd) {
    if (byCreative.has(adName)) continue
    rows.push({
      creative: adName,
      campaign: info.campaign,
      spend: info.spend,
      leads: 0,
      cpl: null,
      booked: 0,
      costPerBooking: null,
      attended: 0,
      costPerAttended: null,
    })
  }

  // Ordena por gasto desc (determinístico pros testes e útil pro operador).
  return rows.sort((a, b) => b.spend - a.spend || b.leads - a.leads)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd ~/Projects/wacrm && npx vitest run src/lib/dashboard/ads-metrics.test.ts`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/wacrm && git add src/lib/dashboard/ads-metrics.ts src/lib/dashboard/ads-metrics.test.ts && \
git commit -m "feat(ads): buildCreativeCostTable (join gasto×lead, CPL, custo/agendamento, linhas honestas)" -- src/lib/dashboard/ads-metrics.ts src/lib/dashboard/ads-metrics.test.ts
```

---

### Task 5: Kernels da operação ao vivo (`pairFirstResponses`, `awaitingResponseContactIds`, `computeLiveOps`)

**Files:**
- Modify: `src/lib/dashboard/ads-metrics.ts`
- Modify: `src/lib/dashboard/ads-metrics.test.ts`

**Interfaces:**
- Consumes: `AdsLiveOps` de `ads-types.ts`.
- Produces:
  - `pairFirstResponses(rows: { conversationId: string; senderType: string; createdAt: string }[]): number[]` — minutos entre 1ª inbound `customer` e a 1ª outbound seguinte, por conversa.
  - `awaitingResponseContactIds(args: { openLeadContactIds: string[]; inboundContactIds: Set<string>; outboundContactIds: Set<string> }): string[]` — leads com outbound nosso e 0 inbound.
  - `computeLiveOps(args: { leadsTodayContactIds: string[]; leadsYesterdayContactIds: string[]; respondedTodayContactIds: Iterable<string>; bookingsTodayCount: number; awaitingNowCount: number; firstResponseMinutesToday: number[] }): AdsLiveOps`.

- [ ] **Step 1: Escrever os testes (falhando)**

```typescript
// adicionar em src/lib/dashboard/ads-metrics.test.ts
import { pairFirstResponses, awaitingResponseContactIds, computeLiveOps } from './ads-metrics'

describe('pairFirstResponses', () => {
  it('pareia 1ª inbound com a 1ª outbound seguinte, por conversa', () => {
    const rows = [
      { conversationId: 'c1', senderType: 'customer', createdAt: '2026-06-29T12:00:00Z' },
      { conversationId: 'c1', senderType: 'customer', createdAt: '2026-06-29T12:01:00Z' }, // 2ª inbound ignorada
      { conversationId: 'c1', senderType: 'agent', createdAt: '2026-06-29T12:10:00Z' }, // +10min
      { conversationId: 'c2', senderType: 'agent', createdAt: '2026-06-29T09:00:00Z' }, // outbound sem inbound antes → ignora
    ]
    expect(pairFirstResponses(rows)).toEqual([10])
  })
})

describe('awaitingResponseContactIds', () => {
  it('lead com outbound e sem inbound = aguardando', () => {
    const r = awaitingResponseContactIds({
      openLeadContactIds: ['a', 'b', 'c'],
      inboundContactIds: new Set(['b']),
      outboundContactIds: new Set(['a', 'b']),
    })
    expect(r).toEqual(['a']) // a: outbound sim, inbound não. b: respondeu. c: nem abordado ainda.
  })
})

describe('computeLiveOps', () => {
  it('monta o bloco com leads hoje×ontem, % respondeu e média de 1ª resposta', () => {
    const lo = computeLiveOps({
      leadsTodayContactIds: ['a', 'b', 'c', 'd'],
      leadsYesterdayContactIds: ['x', 'y'],
      respondedTodayContactIds: ['a', 'b'],
      bookingsTodayCount: 1,
      awaitingNowCount: 2,
      firstResponseMinutesToday: [10, 20],
    })
    expect(lo.leadsToday).toEqual({ current: 4, previous: 2 })
    expect(lo.responded).toEqual({ count: 2, pct: 50 })
    expect(lo.bookingsToday).toBe(1)
    expect(lo.awaitingResponseNow).toBe(2)
    expect(lo.avgFirstResponseMinToday).toBe(15)
  })

  it('zero leads → pct 0 e média null', () => {
    const lo = computeLiveOps({
      leadsTodayContactIds: [],
      leadsYesterdayContactIds: [],
      respondedTodayContactIds: [],
      bookingsTodayCount: 0,
      awaitingNowCount: 0,
      firstResponseMinutesToday: [],
    })
    expect(lo.responded).toEqual({ count: 0, pct: 0 })
    expect(lo.avgFirstResponseMinToday).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ~/Projects/wacrm && npx vitest run src/lib/dashboard/ads-metrics.test.ts`
Expected: FAIL — funções não existem.

- [ ] **Step 3: Implementar os kernels**

```typescript
// adicionar em src/lib/dashboard/ads-metrics.ts
import type { AdsLiveOps } from './ads-types'

/** Minutos da 1ª inbound (customer) até a 1ª outbound seguinte, por conversa.
 *  Espera linhas ordenadas por (conversationId, createdAt asc). Mesma lógica
 *  do loadResponseTime existente, isolada e testável. */
export function pairFirstResponses(
  rows: { conversationId: string; senderType: string; createdAt: string }[],
): number[] {
  const out: number[] = []
  let currentConv = ''
  let pendingCustomer: number | null = null
  for (const row of rows) {
    if (row.conversationId !== currentConv) {
      currentConv = row.conversationId
      pendingCustomer = null
    }
    const ts = new Date(row.createdAt).getTime()
    if (row.senderType === 'customer') {
      if (pendingCustomer === null) pendingCustomer = ts
    } else if (pendingCustomer !== null) {
      const diffMin = (ts - pendingCustomer) / 60_000
      if (diffMin >= 0) out.push(Math.round(diffMin * 100) / 100)
      pendingCustomer = null
    }
  }
  return out
}

export function awaitingResponseContactIds(args: {
  openLeadContactIds: string[]
  inboundContactIds: Set<string>
  outboundContactIds: Set<string>
}): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of args.openLeadContactIds) {
    if (seen.has(id)) continue
    seen.add(id)
    if (args.outboundContactIds.has(id) && !args.inboundContactIds.has(id)) out.push(id)
  }
  return out
}

export function computeLiveOps(args: {
  leadsTodayContactIds: string[]
  leadsYesterdayContactIds: string[]
  respondedTodayContactIds: Iterable<string>
  bookingsTodayCount: number
  awaitingNowCount: number
  firstResponseMinutesToday: number[]
}): AdsLiveOps {
  const leadsToday = new Set(args.leadsTodayContactIds)
  const respondedSet = new Set(args.respondedTodayContactIds)
  let respondedCount = 0
  for (const id of leadsToday) if (respondedSet.has(id)) respondedCount++
  const pct = leadsToday.size > 0 ? Math.round((respondedCount / leadsToday.size) * 100) : 0
  const mins = args.firstResponseMinutesToday
  const avg = mins.length > 0 ? Math.round((mins.reduce((a, b) => a + b, 0) / mins.length) * 10) / 10 : null
  return {
    leadsToday: { current: leadsToday.size, previous: new Set(args.leadsYesterdayContactIds).size },
    responded: { count: respondedCount, pct },
    bookingsToday: args.bookingsTodayCount,
    awaitingResponseNow: args.awaitingNowCount,
    avgFirstResponseMinToday: avg,
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd ~/Projects/wacrm && npx vitest run src/lib/dashboard/ads-metrics.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/wacrm && git add src/lib/dashboard/ads-metrics.ts src/lib/dashboard/ads-metrics.test.ts && \
git commit -m "feat(ads): kernels de operação ao vivo (1ª resposta, aguardando, computeLiveOps)" -- src/lib/dashboard/ads-metrics.ts src/lib/dashboard/ads-metrics.test.ts
```

---

### Task 6: Loaders finos (`ads-queries.ts`)

**Files:**
- Create: `src/lib/dashboard/ads-queries.ts`

**Interfaces:**
- Consumes: tudo de `ads-metrics.ts` + `ads-attribution.ts` + `ad_spend` (tabela) + `date-utils.ts`.
- Produces (consumidos pela página na Task 7):
  - `loadAdsLiveOps(db): Promise<AdsLiveOps>`
  - `loadAdsFunnel(db, rangeDays): Promise<AdsFunnel>`
  - `loadCreativeCostTable(db, rangeDays): Promise<{ rows: CreativeCostRow[]; spendSyncedAt: string | null }>`

Padrão idêntico ao `queries.ts` existente: client-side, RLS escopa por conta, agregação via as funções puras. Sem unit test (segue o padrão dos loaders atuais, que não têm test — a lógica testável já está nas puras). Verificação = typecheck + teste manual na Task 9.

- [ ] **Step 1: Identificar os ids de pipeline/estágio uma vez**

Helper interno que resolve os estágios por nome (os nomes são estáveis; os ids variam por ambiente):

```typescript
// src/lib/dashboard/ads-queries.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { startOfLocalDay, daysAgoStart } from './date-utils'
import { resolveCreative, type AttributionBlob } from './ads-attribution'
import {
  computeFunnel,
  buildCreativeCostTable,
  computeLiveOps,
  pairFirstResponses,
  awaitingResponseContactIds,
} from './ads-metrics'
import type { AdsLiveOps, AdsFunnel, CreativeCostRow, CreativeLead, SpendByAd } from './ads-types'

type DB = SupabaseClient

const SDR_PIPELINE = 'Pré-Vendas (SDR)'
const CLOSER_PIPELINE = 'Closer'
const STAGE_AGENDAMENTO = 'Agendamento Realizado'
const STAGE_COMPARECIMENTO = 'Comparecimento Realizado'
const STAGE_VENDA = 'Venda Fechada'

interface StageRef { id: string; name: string; pipeline: string }

async function loadStageRefs(db: DB): Promise<StageRef[]> {
  const { data, error } = await db
    .from('pipeline_stages')
    .select('id, name, pipelines(name)')
  if (error) throw error
  return ((data ?? []) as unknown as Array<{ id: string; name: string; pipelines: { name: string }[] | { name: string } | null }>).map((s) => {
    const p = Array.isArray(s.pipelines) ? s.pipelines[0] : s.pipelines
    return { id: s.id, name: s.name, pipeline: p?.name ?? '' }
  })
}

function stageIdsFor(refs: StageRef[], pipeline: string, stageName?: string): string[] {
  return refs.filter((r) => r.pipeline === pipeline && (!stageName || r.name === stageName)).map((r) => r.id)
}
```

- [ ] **Step 2: `loadAdsFunnel`**

```typescript
export async function loadAdsFunnel(db: DB, rangeDays: number): Promise<AdsFunnel> {
  const since = daysAgoStart(rangeDays - 1).toISOString()
  const refs = await loadStageRefs(db)
  const sdrStageIds = stageIdsFor(refs, SDR_PIPELINE)
  const agendamentoIds = stageIdsFor(refs, SDR_PIPELINE, STAGE_AGENDAMENTO)
  const comparecimentoIds = stageIdsFor(refs, CLOSER_PIPELINE, STAGE_COMPARECIMENTO)
  const vendaIds = stageIdsFor(refs, CLOSER_PIPELINE, STAGE_VENDA)

  const [leadRows, apptRows, attendedRows, soldRows, inboundRows] = await Promise.all([
    db.from('deals').select('contact_id, created_at').in('stage_id', sdrStageIds).gte('created_at', since),
    db.from('appointments').select('contact_id, created_at').gte('created_at', since),
    db.from('deals').select('contact_id').in('stage_id', comparecimentoIds),
    db.from('deals').select('contact_id').in('stage_id', vendaIds),
    db.from('messages').select('conversation_id, created_at, conversations(contact_id)').eq('sender_type', 'customer').gte('created_at', since),
  ])

  const leadContactIds = (leadRows.data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)
  const bookedContactIds = [
    ...(apptRows.data ?? []).map((a: { contact_id: string }) => a.contact_id),
    ...(await dealContactIdsInStages(db, agendamentoIds)),
  ].filter(Boolean)
  const attendedContactIds = (attendedRows.data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)
  const soldContactIds = (soldRows.data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)
  const respondedContactIds = inboundContactIdsFromMessages(inboundRows.data ?? [])

  return computeFunnel({ leadContactIds, respondedContactIds, bookedContactIds, attendedContactIds, soldContactIds })
}

async function dealContactIdsInStages(db: DB, stageIds: string[]): Promise<string[]> {
  if (stageIds.length === 0) return []
  const { data } = await db.from('deals').select('contact_id').in('stage_id', stageIds)
  return (data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)
}

function inboundContactIdsFromMessages(
  rows: unknown[],
): string[] {
  const out: string[] = []
  for (const r of rows as Array<{ conversations: { contact_id: string }[] | { contact_id: string } | null }>) {
    const conv = Array.isArray(r.conversations) ? r.conversations[0] : r.conversations
    if (conv?.contact_id) out.push(conv.contact_id)
  }
  return out
}
```

- [ ] **Step 3: `loadCreativeCostTable`**

```typescript
export async function loadCreativeCostTable(
  db: DB,
  rangeDays: number,
): Promise<{ rows: CreativeCostRow[]; spendSyncedAt: string | null }> {
  const since = daysAgoStart(rangeDays - 1).toISOString()
  const sinceDate = daysAgoStart(rangeDays - 1).toISOString().slice(0, 10)
  const refs = await loadStageRefs(db)
  const sdrStageIds = stageIdsFor(refs, SDR_PIPELINE)
  const agendamentoIds = stageIdsFor(refs, SDR_PIPELINE, STAGE_AGENDAMENTO)
  const comparecimentoIds = stageIdsFor(refs, CLOSER_PIPELINE, STAGE_COMPARECIMENTO)

  const [leadRows, apptRows, attendedRows, spendRows] = await Promise.all([
    db.from('deals').select('contact_id, contacts(fap01_data)').in('stage_id', sdrStageIds).gte('created_at', since),
    db.from('appointments').select('contact_id, created_at').gte('created_at', since),
    db.from('deals').select('contact_id').in('stage_id', comparecimentoIds),
    db.from('ad_spend').select('ad_name, campaign_name, spend, synced_at').gte('date', sinceDate),
  ])

  // 1 lead por contato distinto, com criativo resolvido do fap01_data.
  const seen = new Set<string>()
  const leads: CreativeLead[] = []
  for (const d of (leadRows.data ?? []) as unknown as Array<{ contact_id: string; contacts: { fap01_data: AttributionBlob | null }[] | { fap01_data: AttributionBlob | null } | null }>) {
    if (!d.contact_id || seen.has(d.contact_id)) continue
    seen.add(d.contact_id)
    const c = Array.isArray(d.contacts) ? d.contacts[0] : d.contacts
    const { creative, campaign } = resolveCreative(c?.fap01_data ?? null)
    leads.push({ contactId: d.contact_id, creative, campaign })
  }

  const bookedContactIds = new Set<string>([
    ...(apptRows.data ?? []).map((a: { contact_id: string }) => a.contact_id),
    ...(await dealContactIdsInStages(db, agendamentoIds)),
  ])
  const attendedContactIds = new Set<string>((attendedRows.data ?? []).map((d: { contact_id: string }) => d.contact_id))

  const spendRowsData = (spendRows.data ?? []) as Array<{ ad_name: string | null; campaign_name: string | null; spend: number; synced_at: string }>
  const spend: SpendByAd[] = spendRowsData
    .filter((s) => s.ad_name)
    .map((s) => ({ adName: s.ad_name as string, campaignName: s.campaign_name, spend: Number(s.spend) || 0 }))
  const spendSyncedAt = spendRowsData.reduce<string | null>((latest, s) => (!latest || s.synced_at > latest ? s.synced_at : latest), null)

  const rows = buildCreativeCostTable({ leads, bookedContactIds, attendedContactIds, spend })
  return { rows, spendSyncedAt }
}
```

- [ ] **Step 4: `loadAdsLiveOps`**

```typescript
export async function loadAdsLiveOps(db: DB): Promise<AdsLiveOps> {
  const todayStart = startOfLocalDay().toISOString()
  const yesterdayStart = daysAgoStart(1).toISOString()
  const refs = await loadStageRefs(db)
  const sdrStageIds = stageIdsFor(refs, SDR_PIPELINE)

  const [leadsToday, leadsYesterday, apptToday, inboundToday, openDeals, msgsToday] = await Promise.all([
    db.from('deals').select('contact_id').in('stage_id', sdrStageIds).gte('created_at', todayStart),
    db.from('deals').select('contact_id').in('stage_id', sdrStageIds).gte('created_at', yesterdayStart).lt('created_at', todayStart),
    db.from('appointments').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('messages').select('conversation_id, conversations(contact_id)').eq('sender_type', 'customer').gte('created_at', todayStart),
    db.from('deals').select('contact_id').in('stage_id', sdrStageIds).eq('status', 'open'),
    db.from('messages').select('conversation_id, sender_type, created_at, conversations(contact_id)').gte('created_at', todayStart).order('conversation_id', { ascending: true }).order('created_at', { ascending: true }),
  ])

  const leadsTodayIds = (leadsToday.data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)
  const leadsYesterdayIds = (leadsYesterday.data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)
  const respondedTodayIds = inboundContactIdsFromMessages(inboundToday.data ?? [])
  const openLeadContactIds = (openDeals.data ?? []).map((d: { contact_id: string }) => d.contact_id).filter(Boolean)

  // Para "aguardando agora": mapeia contato → tem inbound / tem outbound (qualquer tempo deste lead em aberto).
  // Usamos as mensagens de hoje como proxy de atividade recente (suficiente pro lançamento; sem histórico pesado).
  const msgRows = (msgsToday.data ?? []) as unknown as Array<{ conversation_id: string; sender_type: string; created_at: string; conversations: { contact_id: string }[] | { contact_id: string } | null }>
  const inboundContactIds = new Set<string>()
  const outboundContactIds = new Set<string>()
  for (const m of msgRows) {
    const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
    if (!conv?.contact_id) continue
    if (m.sender_type === 'customer') inboundContactIds.add(conv.contact_id)
    else outboundContactIds.add(conv.contact_id)
  }
  const awaitingNow = awaitingResponseContactIds({ openLeadContactIds, inboundContactIds, outboundContactIds }).length

  const firstResponseMinutesToday = pairFirstResponses(
    msgRows.map((m) => ({ conversationId: m.conversation_id, senderType: m.sender_type, createdAt: m.created_at })),
  )

  return computeLiveOps({
    leadsTodayContactIds: leadsTodayIds,
    leadsYesterdayContactIds: leadsYesterdayIds,
    respondedTodayContactIds: respondedTodayIds,
    bookingsTodayCount: apptToday.count ?? 0,
    awaitingNowCount: awaitingNow,
    firstResponseMinutesToday,
  })
}
```

- [ ] **Step 5: Typecheck**

Run: `cd ~/Projects/wacrm && npx tsc --noEmit`
Expected: sem erro nos arquivos novos (`ads-queries.ts`, `ads-*.ts`).

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/wacrm && git add src/lib/dashboard/ads-queries.ts && \
git commit -m "feat(ads): loaders finos do painel de anúncios (live ops, funil, custo por criativo)" -- src/lib/dashboard/ads-queries.ts
```

---

### Task 7: UI — rota `/dashboard/anuncios` + componentes + link no menu

**Files:**
- Create: `src/app/(dashboard)/dashboard/anuncios/page.tsx`
- Create: `src/components/dashboard/ads/live-ops-cards.tsx`
- Create: `src/components/dashboard/ads/funnel-bars.tsx`
- Create: `src/components/dashboard/ads/creative-cost-table.tsx`
- Modify: `src/app/(dashboard)/dashboard-shell.tsx` (adicionar item de menu "Anúncios")

**Interfaces:**
- Consumes: `loadAdsLiveOps`, `loadAdsFunnel`, `loadCreativeCostTable` de `ads-queries.ts`; `formatCurrency` de `@/lib/currency`; `MetricCard`/`SkeletonCard` existentes.

- [ ] **Step 1: Componentes de apresentação (finos, PT-BR)**

`live-ops-cards.tsx` — recebe `AdsLiveOps`, renderiza 5 `MetricCard` (Leads hoje c/ delta vs ontem · Responderam `count` + `pct%` · Agendamentos hoje · Sem resposta agora · Tempo médio 1ª resposta — em min, "—" se null).

`funnel-bars.tsx` — recebe `AdsFunnel`, renderiza barras horizontais (largura ∝ count/maxCount) com label, count e `convFromPrevPct` quando não-null. Reusa Recharts ou divs simples (YAGNI: divs com largura % bastam).

`creative-cost-table.tsx` — recebe `{ rows: CreativeCostRow[]; spendSyncedAt: string | null }`. Tabela PT-BR: colunas `Criativo · Gasto · Leads · CPL · Agendou · Custo/agend. · Compareceu · Custo/compar.`. Valores monetários via `formatCurrency`; `null` vira "—". Cabeçalho com selo "gasto atualizado há Xh" derivado de `spendSyncedAt` (se null → "sem gasto sincronizado"). Linha "Sem atribuição" e linhas de gasto-sem-lead renderizam normalmente (sem esconder); destaque visual leve (texto muted) pra `creative === 'Sem atribuição'`.

Cada componente segue o estilo dos componentes em `src/components/dashboard/` (mesmas classes Tailwind, `TerminalWindow` se os outros painéis usam). Mostrar skeleton enquanto `null`.

- [ ] **Step 2: Página `/dashboard/anuncios`**

Espelha o padrão de `src/app/(dashboard)/dashboard/page.tsx`: client component, `createClient()`, estado por widget com loading independente, seletor de janela (hoje=1 / 7d=7 / desde início=365). `loadAdsLiveOps` ignora a janela (é sempre hoje); `loadAdsFunnel`/`loadCreativeCostTable` recebem `rangeDays`.

```tsx
"use client"
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadAdsLiveOps, loadAdsFunnel, loadCreativeCostTable } from '@/lib/dashboard/ads-queries'
import type { AdsLiveOps, AdsFunnel, CreativeCostRow } from '@/lib/dashboard/ads-types'
import { LiveOpsCards } from '@/components/dashboard/ads/live-ops-cards'
import { FunnelBars } from '@/components/dashboard/ads/funnel-bars'
import { CreativeCostTable } from '@/components/dashboard/ads/creative-cost-table'

type RangeDays = 1 | 7 | 365

export default function AnunciosPage() {
  const [liveOps, setLiveOps] = useState<AdsLiveOps | null>(null)
  const [funnel, setFunnel] = useState<AdsFunnel | null>(null)
  const [cost, setCost] = useState<{ rows: CreativeCostRow[]; spendSyncedAt: string | null } | null>(null)
  const [range, setRange] = useState<RangeDays>(7)

  const load = useCallback((r: RangeDays) => {
    const db = createClient()
    void loadAdsLiveOps(db).then(setLiveOps).catch((e) => console.error('[anuncios] liveops', e))
    void loadAdsFunnel(db, r).then(setFunnel).catch((e) => console.error('[anuncios] funnel', e))
    void loadCreativeCostTable(db, r).then(setCost).catch((e) => console.error('[anuncios] cost', e))
  }, [])

  useEffect(() => { load(range) }, [load, range])

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-mono">anúncios/painel</h1>
        <div className="flex gap-1">
          {([['Hoje',1],['7 dias',7],['Desde o início',365]] as [string,RangeDays][]).map(([lbl,v]) => (
            <button key={v} onClick={() => setRange(v)} className={range===v ? 'font-semibold underline' : 'text-muted-foreground'}>{lbl}</button>
          ))}
        </div>
      </div>
      <LiveOpsCards data={liveOps} />
      <FunnelBars data={funnel} />
      <CreativeCostTable data={cost} />
    </div>
  )
}
```

- [ ] **Step 3: Link no menu**

Ler o array de navegação em `src/app/(dashboard)/dashboard-shell.tsx` e adicionar uma entrada seguindo o shape das existentes (label PT-BR "Anúncios", href `/dashboard/anuncios`, ícone lucide ex. `Megaphone` ou `BarChart3`). Não inventar shape — copiar o de um item existente (ex. o do "Painel") e trocar label/href/ícone.

- [ ] **Step 4: Build local**

Run: `cd ~/Projects/wacrm && npm run build`
Expected: build passa, rota `/dashboard/anuncios` compila.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/wacrm && git add src/app/'(dashboard)'/dashboard/anuncios src/components/dashboard/ads src/app/'(dashboard)'/dashboard-shell.tsx && \
git commit -m "feat(ads): rota /dashboard/anuncios (live ops + funil + custo por criativo) + menu"
```

---

### Task 8: Workflow n8n `WF-NS-AD-SPEND-SYNC` + popular `ad_spend`

> **Depende das dependências do Arthur (spec §9):** token Meta com `ads_read` + `act_<id>` no cofre/n8n; UTM dos anúncios (`utm_content={{ad.name}}`, `utm_campaign={{campaign.name}}`). Sem o token, este task fica bloqueado — mas as Tasks 1–7 (op ao vivo + funil) já sobem sem ele.

**Files:** (n8n — não versiona no repo; usar n8n MCP / UI)

- [ ] **Step 1: Confirmar credencial Meta com `ads_read`**

Verificar com o Arthur que existe (no cofre/n8n) um token de System User com escopo `ads_read` + o ad account id (`act_<id>`). Se o token de CAPI atual não tiver `ads_read`, pedir pro Arthur gerar/ampliar (ação dele no Meta Business — nunca pedir o valor no chat; vai pro cofre).

- [ ] **Step 2: Criar o workflow**

`WF-NS-AD-SPEND-SYNC` (consultar a skill `n8n-mcp-tools-expert` e `n8n-workflow-patterns` antes):
1. **Schedule Trigger** — de hora em hora.
2. **HTTP Request** (GET) → `https://graph.facebook.com/v21.0/act_<id>/insights` com query `level=ad`, `fields=spend,impressions,inline_link_clicks,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name`, `time_increment=1`, `date_preset=last_7d`, `access_token=<cofre>`. Paginar via `paging.next`.
3. **Function/Set** — mapear cada linha pro shape de `ad_spend` (incl. `account_id` da conta NS, `date` = o dia do insight, `link_clicks` = `inline_link_clicks`).
4. **Supabase (Postgres) upsert** em `ad_spend` on conflict `(account_id, date, ad_id)` → update `spend, impressions, link_clicks, campaign_name, adset_name, ad_name, synced_at=now()`. Escrita via service_role (bypassa RLS).

- [ ] **Step 3: Rodar manual + verificar `ad_spend`**

Disparar o workflow uma vez. Conferir:
```bash
cd ~/Projects/orchestrator && source .env && \
psql "$SUPABASE_NS_DB_URL" -P pager=off -c "select date, ad_name, spend, impressions, synced_at from ad_spend order by date desc, spend desc limit 20;"
```
Expected: linhas batendo com o Gerenciador do Meta (1 dia, 1 criativo conferido na mão). Se não houver campanha ativa ainda (pré-lançamento), validar com 1 linha de teste inserida pelo n8n e depois apagada.

- [ ] **Step 4: Ativar o schedule** (depois da campanha no ar segunda).

---

### Task 9: Verificação end-to-end + QA visual + deploy

**Files:** (verificação — sem código novo)

- [ ] **Step 1: Rodar a suíte de testes**

Run: `cd ~/Projects/wacrm && npm test`
Expected: todos os `ads-*.test.ts` verdes + suíte existente intacta.

- [ ] **Step 2: Conferir métricas CRM contra o banco (técnica do FU1)**

Pegar o access_token real de um usuário NS (login via `/auth/v1/token`) e bater os números do funil/live-ops contra queries diretas no `SUPABASE_NS_DB_URL` (contagem de leads distintos no SDR na janela, inbound `customer`, appointments). Ver memória `learning_inbox_vazio_provar_client_side`.

- [ ] **Step 3: Provar o join de custo**

Inserir (psql) 1 linha de `ad_spend` com `ad_name='criativo-teste'` + criar/forçar 1 lead de teste com `attribution.last_touch.utm.utm_content='criativo-teste'` → abrir o painel → conferir: linha do criativo com gasto+lead+CPL; lead sem utm cai em "Sem atribuição"; `ad_name` sem lead vira linha 0-leads. Limpar os dados de teste no fim.

- [ ] **Step 4: QA visual headless**

Chrome headless (`--remote-debugging-port=9222 --headless=new`, nohup+disown) + MCP chrome-devtools → screenshot de `/dashboard/anuncios` → conferir os 3 blocos renderizando + degradação (esvaziar `ad_spend` → colunas de custo "—", blocos 1/2 de pé). QA user temporário se precisar; **deletar no fim** (apagar conta órfã antes do user — ver memória `learning_wacrm_verificacao_visual_qa_user`).

- [ ] **Step 5: Deploy**

Run (confirmar com Arthur antes — é produção):
```bash
rsync -az --exclude node_modules --exclude .next ~/Projects/wacrm/ <vps>:/opt/wacrm/ && \
ssh <vps> 'cd /opt/wacrm && docker compose build wacrm && docker compose up -d wacrm'
```
Expected: container sobe, `/dashboard/anuncios` acessível em prod.

- [ ] **Step 6: Atualizar STATE + worklog + memória**

Registrar a Fatia 1 no ar no `negocio-simples/STATE.md` (frente wacrm) + worklog do dia + memória `project_*` (ex. `project_wacrm_dashboard_anuncios_fatia1`).

---

## Self-Review (preenchido pelo autor do plano)

**Cobertura do spec:** §2 escopo → Tasks 1–9. Bloco 1 (live ops) → Task 5+6+7. Bloco 2 (funil) → Task 3+6+7. Bloco 3 (custo) → Task 4+6+7. `ad_spend` → Task 1. n8n sync → Task 8. Métricas §5 → Tasks 3/4/5 (ancoradas nos estágios reais). Erros §8 → embutidos (cpl null, linha gasto-sem-lead, "Sem atribuição", degradação). Verificação §10 → Task 9. Faseamento §3 → Tasks 1–7 sobem sem Meta; Task 8 acende custo.

**Fora de escopo (não vira task, por design):** faturamento/ROAS/CAC, Camada 1, agente, tendência.

**Consistência de tipos:** `CreativeAttribution/AdsLiveOps/AdsFunnel/CreativeCostRow/CreativeLead/SpendByAd` definidos na Task 2, consumidos idênticos nas Tasks 3–7. `resolveCreative` (Task 2) usado na Task 6. Kernels da Task 5 consumidos na Task 6 com as mesmas assinaturas.
