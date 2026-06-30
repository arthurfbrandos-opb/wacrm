# Cockpit de Crescimento + Shell Minha Empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evoluir `/dashboard/os` (console da espinha) para o **Cockpit de Crescimento** (hero narrativo + métricas de negócio reais + Central de Ações read-first) dentro de um shell com seletor de contexto, na identidade visual do wacrm.

**Architecture:** Estende a camada `src/lib/dashboard/os-queries.ts` (funções puras testáveis + loaders async, padrão do `buildOsOverview` existente) com métricas comerciais (deals abertos do pipeline `Closer`), follow-ups vencidos (`sdr_touches`) e prova viva (`os_events`/mês). Componentes novos reusam `MetricCard`/`TerminalWindow` (identidade wacrm). A página `dashboard/os/page.tsx` recompõe tudo e mantém a seção "Espinha & Governança" já construída. O seletor de contexto entra no topo da `Sidebar`.

**Tech Stack:** Next.js (App Router, client components) · TypeScript · Supabase JS (browser client, RLS) · Tailwind · vitest · lucide-react.

## Global Constraints

- **Read-only.** Só `SELECT`. Zero migration, zero `INSERT/UPDATE/DELETE`, zero RPC nova.
- **Zero toque no caminho do Ian** — não editar `src/lib/sdr/processor.ts`, `touches.ts`, nem o send path.
- **Identidade visual = a do wacrm.** Reusar `MetricCard`, `TerminalWindow`, tokens existentes (`text-primary`, `bg-card`, `border-border`, `font-mono`, `▸`). NÃO importar a paleta verde-tintada do HTML de referência.
- **Receita potencial = `SUM(deals.value)` de deals `status='open'` no pipeline `'Closer'`** (decisão Arthur 2026-06-30). Nome do pipeline literal: `'Closer'`.
- **Deep-links reais:** follow-up vencido → `/inbox?c=<conversation_id>` (param `c` suportado); deal parado → `/pipelines` (nível seção — não há URL por-deal).
- **PT-BR** em todo texto de UI. Sem inventar números — todo dado vem de query real; bloco sem fonte = card "em breve" explícito.
- **RLS:** `deals`/`pipelines` são escopados por `user_id` (dono); `sdr_touches`/`os_events` por `account_id` (`is_account_member`). Para Minha Empresa / tenant zero (Arthur logado) o resultado é correto.
- Worktree: `~/Projects/_wacrm-worktrees/os-cockpit` (branch `feat/os-cockpit`). Comandos: `npm test` (vitest) · `npm run typecheck` (tsc --noEmit) · `npm run lint` (eslint).

---

### Task 1: `startOfLocalMonth` helper (date-utils)

**Files:**
- Modify: `src/lib/dashboard/date-utils.ts` (adiciona função no fim)
- Test: `src/lib/dashboard/date-utils.test.ts` (criar)

**Interfaces:**
- Consumes: nada.
- Produces: `startOfLocalMonth(d?: Date): Date` — 1º dia do mês corrente às 00:00 local.

- [ ] **Step 1: Write the failing test**

Criar `src/lib/dashboard/date-utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { startOfLocalMonth } from './date-utils'

describe('startOfLocalMonth', () => {
  it('zera para o 1º dia do mês às 00:00 local', () => {
    const d = new Date(2026, 5, 30, 14, 35, 12) // 30/jun/2026 14:35 local
    const m = startOfLocalMonth(d)
    expect(m.getFullYear()).toBe(2026)
    expect(m.getMonth()).toBe(5) // junho (0-based)
    expect(m.getDate()).toBe(1)
    expect(m.getHours()).toBe(0)
    expect(m.getMinutes()).toBe(0)
    expect(m.getSeconds()).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/dashboard/date-utils.test.ts`
Expected: FAIL — `startOfLocalMonth is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

Adicionar no fim de `src/lib/dashboard/date-utils.ts`:

```ts
/** 1º dia do mês corrente às 00:00 no fuso LOCAL (espelha startOfLocalDay). */
export function startOfLocalMonth(d: Date = new Date()): Date {
  const out = new Date(d)
  out.setDate(1)
  out.setHours(0, 0, 0, 0)
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/dashboard/date-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/date-utils.ts src/lib/dashboard/date-utils.test.ts
git commit -m "feat(cockpit): startOfLocalMonth helper p/ prova viva mensal"
```

---

### Task 2: Tipos + métricas comerciais (deals abertos do Closer)

**Files:**
- Modify: `src/lib/dashboard/os-types.ts` (adiciona tipos)
- Modify: `src/lib/dashboard/os-queries.ts` (adiciona `formatBRL`, `buildCommercialMetrics`, `loadCloserOpenDeals`)
- Test: `src/lib/dashboard/os-queries.test.ts` (adiciona describes)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces:
  - `interface CloserDeal { id: string; title: string; value: number | string; updated_at: string }`
  - `interface CommercialMetrics { receitaPotencial: number; propostasAbertas: number }`
  - `formatBRL(n: number): string`
  - `buildCommercialMetrics(openCloserDeals: { value: number | string }[]): CommercialMetrics`
  - `loadCloserOpenDeals(db: SupabaseClient): Promise<CloserDeal[]>`

- [ ] **Step 1: Add the types**

Adicionar no fim de `src/lib/dashboard/os-types.ts`:

```ts
/** Deal aberto do pipeline Closer (Receita potencial + propostas paradas). */
export interface CloserDeal {
  id: string
  title: string
  value: number | string
  updated_at: string
}

export interface CommercialMetrics {
  /** SUM(value) dos deals 'open' no Closer. */
  receitaPotencial: number
  /** Contagem desses deals abertos. */
  propostasAbertas: number
}
```

- [ ] **Step 2: Write the failing test**

Adicionar em `src/lib/dashboard/os-queries.test.ts` (no topo, junto dos imports existentes, mesclar o import):

```ts
import { buildCommercialMetrics, formatBRL } from './os-queries'

describe('formatBRL', () => {
  it('formata em reais', () => {
    const s = formatBRL(42000)
    expect(s).toContain('R$')
    expect(s).toContain('42.000')
  })
})

describe('buildCommercialMetrics', () => {
  it('soma value (number|string) e conta propostas', () => {
    const m = buildCommercialMetrics([{ value: 5000 }, { value: '2000.5' }, { value: 0 }])
    expect(m.receitaPotencial).toBe(7000.5)
    expect(m.propostasAbertas).toBe(3)
  })
  it('lista vazia → zeros', () => {
    expect(buildCommercialMetrics([])).toEqual({ receitaPotencial: 0, propostasAbertas: 0 })
  })
  it('value inválido vira 0', () => {
    expect(buildCommercialMetrics([{ value: 'abc' }, { value: 1000 }]).receitaPotencial).toBe(1000)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/dashboard/os-queries.test.ts`
Expected: FAIL — `buildCommercialMetrics`/`formatBRL` não exportadas.

- [ ] **Step 4: Write minimal implementation**

Em `src/lib/dashboard/os-queries.ts`: (a) trocar o import de tipos para incluir os novos; (b) adicionar o constante + funções.

No topo, ajustar o import de tipos existente:

```ts
import type { OsEventRow, OsAgentRow, OsOverview, CloserDeal, CommercialMetrics } from './os-types'
```

Adicionar ao corpo do arquivo:

```ts
const CLOSER_PIPELINE = 'Closer'

/** Reais sem centavos, pt-BR. */
export function formatBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

/** Pura: receita potencial = soma dos values; propostas abertas = contagem. */
export function buildCommercialMetrics(openCloserDeals: { value: number | string }[]): CommercialMetrics {
  const receitaPotencial = openCloserDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0)
  return { receitaPotencial, propostasAbertas: openCloserDeals.length }
}

/** Deals 'open' no pipeline Closer (RLS escopa por dono). Vazio se não há Closer. */
export async function loadCloserOpenDeals(db: DB): Promise<CloserDeal[]> {
  const { data: pipelines, error: pErr } = await db.from('pipelines').select('id').eq('name', CLOSER_PIPELINE)
  if (pErr) throw pErr
  const closerIds = (pipelines ?? []).map((p: { id: string }) => p.id)
  if (closerIds.length === 0) return []
  const { data, error } = await db
    .from('deals')
    .select('id, title, value, updated_at')
    .eq('status', 'open')
    .in('pipeline_id', closerIds)
    .order('updated_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as CloserDeal[]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/dashboard/os-queries.test.ts`
Expected: PASS (todos os describes, incluindo os pré-existentes do `buildOsOverview`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard/os-types.ts src/lib/dashboard/os-queries.ts src/lib/dashboard/os-queries.test.ts
git commit -m "feat(cockpit): metricas comerciais (deals abertos do Closer) + formatBRL"
```

---

### Task 3: Follow-ups vencidos + deals parados → Central de Ações (lógica)

**Files:**
- Modify: `src/lib/dashboard/os-types.ts` (tipos)
- Modify: `src/lib/dashboard/os-queries.ts` (`selectStaleDeals`, `buildPendingDecisions`, `loadOverdueFollowups`)
- Test: `src/lib/dashboard/os-queries.test.ts`

**Interfaces:**
- Consumes: `CloserDeal` (Task 2), `formatBRL` (Task 2).
- Produces:
  - `interface OverdueFollowup { id: string; type: string; due_at: string; contact_id: string; conversation_id: string }`
  - `type DecisionUrgency = 'red' | 'warn' | 'normal'`
  - `interface PendingDecision { id: string; kind: 'followup' | 'deal'; urgency: DecisionUrgency; title: string; subtitle: string; href: string; cta: string }`
  - `selectStaleDeals(deals: CloserDeal[], staleDays: number, now: Date): CloserDeal[]`
  - `buildPendingDecisions(overdue: OverdueFollowup[], stale: CloserDeal[], now: Date): PendingDecision[]`
  - `loadOverdueFollowups(db: SupabaseClient, limit?: number): Promise<OverdueFollowup[]>`

- [ ] **Step 1: Add the types**

Adicionar em `src/lib/dashboard/os-types.ts`:

```ts
/** Follow-up vencido (sdr_touches pending + due_at no passado). */
export interface OverdueFollowup {
  id: string
  type: string
  due_at: string
  contact_id: string
  conversation_id: string
}

export type DecisionUrgency = 'red' | 'warn' | 'normal'

/** Item da Central de Ações (read-first: só leva ao lugar onde se age). */
export interface PendingDecision {
  id: string
  kind: 'followup' | 'deal'
  urgency: DecisionUrgency
  title: string
  subtitle: string
  href: string
  cta: string
}
```

- [ ] **Step 2: Write the failing test**

Adicionar em `src/lib/dashboard/os-queries.test.ts`:

```ts
import { selectStaleDeals, buildPendingDecisions } from './os-queries'

const NOW = new Date(2026, 5, 30, 12, 0, 0) // 30/jun/2026 12:00 local

describe('selectStaleDeals', () => {
  it('mantém só deals sem update há >= staleDays', () => {
    const deals = [
      { id: 'a', title: 'A', value: 1000, updated_at: new Date(2026, 5, 20).toISOString() }, // ~10d
      { id: 'b', title: 'B', value: 2000, updated_at: new Date(2026, 5, 29).toISOString() }, // ~1d
    ]
    expect(selectStaleDeals(deals, 7, NOW).map((d) => d.id)).toEqual(['a'])
  })
})

describe('buildPendingDecisions', () => {
  it('mapeia follow-ups e deals parados, ordena por urgência', () => {
    const overdue = [
      { id: 'f1', type: 'first_touch', due_at: new Date(2026, 5, 27).toISOString(), contact_id: 'c1', conversation_id: 'conv1' }, // ~3d → red
      { id: 'f2', type: 'reminder_2h', due_at: new Date(2026, 5, 30, 6).toISOString(), contact_id: 'c2', conversation_id: 'conv2' }, // <1d → warn
    ]
    const stale = [{ id: 'd1', title: 'Closer XPTO', value: 12000, updated_at: new Date(2026, 5, 1).toISOString() }]
    const items = buildPendingDecisions(overdue, stale, NOW)
    expect(items.map((i) => i.urgency)).toEqual(['red', 'warn', 'normal'])
    expect(items[0].href).toBe('/inbox?c=conv1')
    expect(items[0].cta).toBe('Ver')
    expect(items.find((i) => i.kind === 'deal')?.href).toBe('/pipelines')
  })
  it('nada pendente → lista vazia', () => {
    expect(buildPendingDecisions([], [], NOW)).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/dashboard/os-queries.test.ts`
Expected: FAIL — `selectStaleDeals`/`buildPendingDecisions` não exportadas.

- [ ] **Step 4: Write minimal implementation**

Ajustar o import de tipos em `os-queries.ts` para incluir os novos:

```ts
import type { OsEventRow, OsAgentRow, OsOverview, CloserDeal, CommercialMetrics, OverdueFollowup, PendingDecision, DecisionUrgency } from './os-types'
```

Adicionar ao corpo:

```ts
const TOUCH_LABEL: Record<string, string> = {
  first_touch: '1º contato',
  reminder_24h: 'lembrete 24h',
  reminder_2h: 'lembrete 2h',
}

const MS_DAY = 24 * 60 * 60 * 1000

/** Pura: deals abertos sem movimento há >= staleDays. */
export function selectStaleDeals(deals: CloserDeal[], staleDays: number, now: Date): CloserDeal[] {
  const cutoff = now.getTime() - staleDays * MS_DAY
  return deals.filter((d) => new Date(d.updated_at).getTime() < cutoff)
}

/** Pura: monta a fila da Central de Ações (read-first), ordenada por urgência. */
export function buildPendingDecisions(overdue: OverdueFollowup[], stale: CloserDeal[], now: Date): PendingDecision[] {
  const followups: PendingDecision[] = overdue.map((f) => {
    const days = Math.floor((now.getTime() - new Date(f.due_at).getTime()) / MS_DAY)
    return {
      id: `followup:${f.id}`,
      kind: 'followup',
      urgency: days >= 2 ? 'red' : 'warn',
      title: `Follow-up vencido · ${TOUCH_LABEL[f.type] ?? f.type}`,
      subtitle: days <= 0 ? 'venceu hoje' : `vencido há ${days} dia${days === 1 ? '' : 's'}`,
      href: `/inbox?c=${f.conversation_id}`,
      cta: 'Ver',
    }
  })
  const deals: PendingDecision[] = stale.map((d) => ({
    id: `deal:${d.id}`,
    kind: 'deal',
    urgency: 'normal',
    title: d.title,
    subtitle: `Proposta parada · ${formatBRL(Number(d.value) || 0)} · sem movimento`,
    href: '/pipelines',
    cta: 'Abrir',
  }))
  const rank: Record<DecisionUrgency, number> = { red: 0, warn: 1, normal: 2 }
  return [...followups, ...deals].sort((a, b) => rank[a.urgency] - rank[b.urgency])
}

/** Follow-ups vencidos: sdr_touches pending + due_at no passado (RLS por conta). */
export async function loadOverdueFollowups(db: DB, limit = 50): Promise<OverdueFollowup[]> {
  const nowIso = new Date().toISOString()
  const { data, error } = await db
    .from('sdr_touches')
    .select('id, type, due_at, contact_id, conversation_id')
    .eq('status', 'pending')
    .lt('due_at', nowIso)
    .order('due_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as OverdueFollowup[]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/dashboard/os-queries.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard/os-types.ts src/lib/dashboard/os-queries.ts src/lib/dashboard/os-queries.test.ts
git commit -m "feat(cockpit): Central de Acoes read-first (follow-ups vencidos + deals parados)"
```

---

### Task 4: Hero narrativo + prova viva (lógica)

**Files:**
- Modify: `src/lib/dashboard/os-types.ts` (tipo `GrowthHero`)
- Modify: `src/lib/dashboard/os-queries.ts` (`buildGrowthHero`, `loadProvaVivaCount`)
- Test: `src/lib/dashboard/os-queries.test.ts`

**Interfaces:**
- Consumes: `formatBRL` (Task 2), `startOfLocalMonth` (Task 1).
- Produces:
  - `interface GrowthHero { receitaPotencialFmt: string; overdueCount: number; decisionsCount: number }`
  - `buildGrowthHero(input: { receitaPotencial: number; overdueCount: number; decisionsCount: number }): GrowthHero`
  - `loadProvaVivaCount(db: SupabaseClient): Promise<number>`

- [ ] **Step 1: Add the type**

Adicionar em `src/lib/dashboard/os-types.ts`:

```ts
/** Dados do hero narrativo do cockpit. */
export interface GrowthHero {
  receitaPotencialFmt: string
  overdueCount: number
  decisionsCount: number
}
```

- [ ] **Step 2: Write the failing test**

Adicionar em `src/lib/dashboard/os-queries.test.ts`:

```ts
import { buildGrowthHero } from './os-queries'

describe('buildGrowthHero', () => {
  it('formata receita e repassa contagens', () => {
    const h = buildGrowthHero({ receitaPotencial: 42000, overdueCount: 9, decisionsCount: 7 })
    expect(h.receitaPotencialFmt).toContain('42.000')
    expect(h.overdueCount).toBe(9)
    expect(h.decisionsCount).toBe(7)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/dashboard/os-queries.test.ts`
Expected: FAIL — `buildGrowthHero` não exportada.

- [ ] **Step 4: Write minimal implementation**

Ajustar imports em `os-queries.ts`: incluir `startOfLocalMonth` e o tipo `GrowthHero`.

```ts
import { startOfLocalDay, startOfLocalMonth } from './date-utils'
// ...e no import de tipos, acrescentar GrowthHero
```

Adicionar ao corpo:

```ts
/** Pura: monta o hero a partir dos números já calculados. */
export function buildGrowthHero(input: { receitaPotencial: number; overdueCount: number; decisionsCount: number }): GrowthHero {
  return {
    receitaPotencialFmt: formatBRL(input.receitaPotencial),
    overdueCount: input.overdueCount,
    decisionsCount: input.decisionsCount,
  }
}

/** Prova viva = nº de os_events no mês corrente (RLS por conta). */
export async function loadProvaVivaCount(db: DB): Promise<number> {
  const monthStart = startOfLocalMonth().toISOString()
  const { count, error } = await db
    .from('os_events')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', monthStart)
  if (error) throw error
  return count ?? 0
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/dashboard/os-queries.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard/os-types.ts src/lib/dashboard/os-queries.ts src/lib/dashboard/os-queries.test.ts
git commit -m "feat(cockpit): hero narrativo + prova viva (os_events/mes)"
```

---

### Task 5: Componentes de UI (hero, métricas, Central de Ações)

**Files:**
- Create: `src/components/dashboard/os/growth-hero.tsx`
- Create: `src/components/dashboard/os/business-metrics.tsx`
- Create: `src/components/dashboard/os/central-de-acoes.tsx`

**Interfaces:**
- Consumes: `GrowthHero`, `CommercialMetrics`, `PendingDecision` (os-types); `formatBRL` (os-queries); `MetricCard`, `SkeletonCard`, `TerminalWindow` existentes.
- Produces: `GrowthHeroBanner`, `BusinessMetrics`, `CentralDeAcoes` (componentes React).

Sem teste unitário (segue o padrão do repo: componentes de apresentação não têm teste). Validação = `npm run typecheck` + `npm run lint` + visual no Task 7.

- [ ] **Step 1: Criar `growth-hero.tsx`**

```tsx
import type { GrowthHero } from '@/lib/dashboard/os-types'

export function GrowthHeroBanner({ data }: { data: GrowthHero | null }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-6">
      <p className="font-mono text-lg font-semibold leading-snug text-foreground sm:text-2xl">
        {data ? (
          <>
            Hoje: <span className="text-primary">{data.receitaPotencialFmt}</span> em propostas abertas ·{' '}
            <span className="text-primary">{data.overdueCount}</span> follow-ups vencidos ·{' '}
            <span className="text-primary">{data.decisionsCount}</span> decisões esperando você.
          </>
        ) : (
          'carregando…'
        )}
      </p>
      <p className="mt-2 font-mono text-sm text-muted-foreground">
        Não mostra IA pensando — mostra estado, risco, próxima ação, evidência, aprovação e resultado.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Criar `business-metrics.tsx`**

```tsx
import { TrendingUp, Clock, Users, Sparkles } from 'lucide-react'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { formatBRL } from '@/lib/dashboard/os-queries'
import type { CommercialMetrics } from '@/lib/dashboard/os-types'

interface BusinessMetricsProps {
  commercial: CommercialMetrics | null
  overdueCount: number | null
  provaViva: number | null
}

export function BusinessMetrics({ commercial, overdueCount, provaViva }: BusinessMetricsProps) {
  if (!commercial || overdueCount === null || provaViva === null) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="Receita potencial"
        value={formatBRL(commercial.receitaPotencial)}
        icon={TrendingUp}
        subtitle={`${commercial.propostasAbertas} propostas abertas`}
      />
      <MetricCard title="Follow-ups vencidos" value={`${overdueCount}`} icon={Clock} subtitle="precisam de atenção" />
      <MetricCard title="Clientes em implantação" value="—" icon={Users} subtitle="em breve · via Meus Clientes" />
      <MetricCard title="Prova viva" value={provaViva.toLocaleString('pt-BR')} icon={Sparkles} subtitle="ações de IA no mês" />
    </div>
  )
}
```

- [ ] **Step 3: Criar `central-de-acoes.tsx`**

```tsx
import Link from 'next/link'
import { TerminalWindow } from '@/components/ui/terminal-window'
import type { PendingDecision } from '@/lib/dashboard/os-types'

const DOT: Record<string, string> = {
  red: 'bg-red-400',
  warn: 'bg-amber-300',
  normal: 'bg-primary',
}

export function CentralDeAcoes({ data }: { data: PendingDecision[] | null }) {
  return (
    <TerminalWindow title="cockpit/central_de_acoes" className="h-full">
      <div className="space-y-2 p-4">
        {data === null ? (
          <p className="font-mono text-sm text-muted-foreground">carregando…</p>
        ) : data.length === 0 ? (
          <p className="font-mono text-sm text-muted-foreground">▸ nada pendente · tudo em dia.</p>
        ) : (
          data.map((d) => (
            <div
              key={d.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card/40 p-3"
            >
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[d.urgency]}`} aria-hidden />
                <div>
                  <p className="font-mono text-sm font-medium text-foreground">{d.title}</p>
                  <p className="font-mono text-xs text-muted-foreground">{d.subtitle}</p>
                </div>
              </div>
              <Link
                href={d.href}
                className="shrink-0 rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
              >
                {d.cta}
              </Link>
            </div>
          ))
        )}
        <p className="pt-1 font-mono text-[11px] text-muted-foreground">
          Aprovações de conteúdo entram aqui em breve.
        </p>
      </div>
    </TerminalWindow>
  )
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros novos nos 3 arquivos criados.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/os/growth-hero.tsx src/components/dashboard/os/business-metrics.tsx src/components/dashboard/os/central-de-acoes.tsx
git commit -m "feat(cockpit): componentes hero, metricas de negocio e Central de Acoes"
```

---

### Task 6: Recompor a página `dashboard/os/page.tsx`

**Files:**
- Modify: `src/app/(dashboard)/dashboard/os/page.tsx` (reescrever)

**Interfaces:**
- Consumes: todos os loaders/builders das Tasks 2–4 + componentes da Task 5 + `OsOverviewCards`/`OsActivityFeed`/`OsAgentsTable` existentes.
- Produces: a tela do Cockpit de Crescimento.

Sem teste unitário (página client). Validação = `npm run typecheck` + visual.

- [ ] **Step 1: Reescrever o arquivo**

Substituir todo o conteúdo de `src/app/(dashboard)/dashboard/os/page.tsx`:

```tsx
"use client"
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  loadOsOverview,
  loadOsActivity,
  loadOsAgents,
  loadCloserOpenDeals,
  loadOverdueFollowups,
  loadProvaVivaCount,
  buildCommercialMetrics,
  selectStaleDeals,
  buildPendingDecisions,
  buildGrowthHero,
} from '@/lib/dashboard/os-queries'
import type {
  OsOverview,
  OsEventRow,
  OsAgentRow,
  CommercialMetrics,
  PendingDecision,
  GrowthHero,
} from '@/lib/dashboard/os-types'
import { OsOverviewCards } from '@/components/dashboard/os/overview-cards'
import { OsActivityFeed } from '@/components/dashboard/os/activity-feed'
import { OsAgentsTable } from '@/components/dashboard/os/agents-table'
import { GrowthHeroBanner } from '@/components/dashboard/os/growth-hero'
import { BusinessMetrics } from '@/components/dashboard/os/business-metrics'
import { CentralDeAcoes } from '@/components/dashboard/os/central-de-acoes'

export default function OsCockpitPage() {
  const [overview, setOverview] = useState<OsOverview | null>(null)
  const [activity, setActivity] = useState<OsEventRow[] | null>(null)
  const [agents, setAgents] = useState<OsAgentRow[] | null>(null)
  const [commercial, setCommercial] = useState<CommercialMetrics | null>(null)
  const [overdueCount, setOverdueCount] = useState<number | null>(null)
  const [provaViva, setProvaViva] = useState<number | null>(null)
  const [decisions, setDecisions] = useState<PendingDecision[] | null>(null)
  const [hero, setHero] = useState<GrowthHero | null>(null)

  useEffect(() => {
    const db = createClient()
    void loadOsOverview(db).then(setOverview).catch((e) => console.error('[os] overview', e))
    void loadOsActivity(db).then(setActivity).catch((e) => console.error('[os] activity', e))
    void loadOsAgents(db).then(setAgents).catch((e) => console.error('[os] agents', e))

    void (async () => {
      try {
        const now = new Date()
        const [closerDeals, overdue, prova] = await Promise.all([
          loadCloserOpenDeals(db),
          loadOverdueFollowups(db),
          loadProvaVivaCount(db),
        ])
        const metrics = buildCommercialMetrics(closerDeals)
        const stale = selectStaleDeals(closerDeals, 7, now)
        const pend = buildPendingDecisions(overdue, stale, now)
        setCommercial(metrics)
        setOverdueCount(overdue.length)
        setProvaViva(prova)
        setDecisions(pend)
        setHero(
          buildGrowthHero({
            receitaPotencial: metrics.receitaPotencial,
            overdueCount: overdue.length,
            decisionsCount: pend.length,
          }),
        )
      } catch (e) {
        console.error('[os] cockpit business', e)
      }
    })()
  }, [])

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="font-mono text-2xl font-bold text-foreground">
          <span className="text-primary">▸</span> cockpit
        </h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          Minha Empresa · a Negócio Simples como prova viva do próprio Growth OS.
        </p>
      </div>

      <GrowthHeroBanner data={hero} />
      <BusinessMetrics commercial={commercial} overdueCount={overdueCount} provaViva={provaViva} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CentralDeAcoes data={decisions} />
        <OsActivityFeed data={activity} />
      </div>

      <div className="space-y-4 border-t border-border pt-6">
        <h2 className="font-mono text-sm uppercase tracking-wide text-muted-foreground">Espinha &amp; Governança</h2>
        <OsOverviewCards data={overview} />
        <OsAgentsTable data={agents} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Smoke visual local**

Run: `npm run dev` e abrir `http://localhost:3000/dashboard/os` (logado).
Expected: hero + 4 cards (3 com número real, "Clientes em implantação" = "em breve") + Central de Ações + Atividade da IA + seção Espinha & Governança. Nenhum erro no console além dos `[os] ...` se uma query falhar.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/dashboard/os/page.tsx"
git commit -m "feat(cockpit): recompoe /dashboard/os como Cockpit de Crescimento"
```

---

### Task 7: Seletor de contexto + relabel OS→Cockpit na Sidebar

**Files:**
- Create: `src/components/layout/context-selector.tsx`
- Modify: `src/components/layout/sidebar.tsx`

**Interfaces:**
- Consumes: nada (componente estático).
- Produces: `ContextSelector` (React).

Sem teste unitário. Validação = `npm run typecheck` + `npm run lint` + visual.

- [ ] **Step 1: Criar `context-selector.tsx`**

```tsx
"use client";

interface ContextOption {
  key: string;
  label: string;
  hint: string;
  active: boolean;
}

// Só "Minha Empresa" é funcional nesta fatia; os demais contextos
// (Meus Clientes / Workspace / Admin) entram em fatias futuras.
const CONTEXTS: ContextOption[] = [
  { key: "mine", label: "Minha Empresa", hint: "tenant zero", active: true },
  { key: "clients", label: "Meus Clientes", hint: "em breve", active: false },
  { key: "workspace", label: "Workspace Cliente", hint: "em breve", active: false },
  { key: "admin", label: "Admin", hint: "em breve", active: false },
];

export function ContextSelector() {
  return (
    <div className="mb-4">
      <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Contexto
      </p>
      <div className="flex flex-col gap-1">
        {CONTEXTS.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={!c.active}
            aria-current={c.active ? "true" : undefined}
            title={c.active ? undefined : "Em breve"}
            className={
              c.active
                ? "flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 font-mono text-sm font-medium text-primary"
                : "flex cursor-not-allowed items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 font-mono text-sm font-medium text-muted-foreground opacity-60"
            }
          >
            <span>{c.label}</span>
            <span
              className={
                c.active
                  ? "text-[9px] uppercase tracking-wider text-primary/70"
                  : "rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
              }
            >
              {c.hint}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Relabel + reorder navItems em `sidebar.tsx`**

Em `src/components/layout/sidebar.tsx`, no array `navItems`, mover o item OS pro topo e renomear pra "Cockpit", trocando o ícone `Cpu` por `Gauge`. Resultado:

```tsx
const navItems: NavItem[] = [
  { href: "/dashboard/os", label: "Cockpit", icon: Gauge },
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { href: "/dashboard/anuncios", label: "Anúncios", icon: Megaphone },
  { href: "/inbox", label: "Conversas", icon: MessageSquare },
  { href: "/contacts", label: "Contatos", icon: Users },
  { href: "/leads", label: "Leads", icon: UserPlus },
  { href: "/pipelines", label: "Funis", icon: GitBranch },
  { href: "/calendar", label: "Calendário", icon: CalendarDays },
  { href: "/broadcasts", label: "Disparos", icon: Radio },
  { href: "/automations", label: "Automações", icon: Zap },
  { href: "/flows", label: "Fluxos", icon: Workflow, beta: true },
];
```

- [ ] **Step 3: Importar `Gauge` e `ContextSelector`**

No bloco de import do lucide-react em `sidebar.tsx`, adicionar `Gauge` (remover `Cpu` se não for usado em outro ponto — conferir com busca; se ainda usado, manter). Adicionar abaixo dos imports de componentes:

```tsx
import { ContextSelector } from "@/components/layout/context-selector";
```

- [ ] **Step 4: Renderizar o seletor no topo da nav**

Em `sidebar.tsx`, dentro de `<nav className="flex-1 overflow-y-auto px-3 py-4">`, inserir `<ContextSelector />` imediatamente antes do primeiro `<ul className="flex flex-col gap-1">`:

```tsx
<nav className="flex-1 overflow-y-auto px-3 py-4">
  <ContextSelector />
  <ul className="flex flex-col gap-1">
    {navItems.map((item) => {
      {/* ...inalterado... */}
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros. Se `Cpu` ficou órfão, o lint de no-unused-vars acusa → remover o import `Cpu`.

- [ ] **Step 6: Smoke visual**

Run: `npm run dev` → abrir o app logado.
Expected: topo da sidebar mostra "Contexto" + 4 botões (Minha Empresa ativo/verde; 3 com badge "em breve" desabilitados). Nav abaixo começa com "cockpit" (▸ ativo em `/dashboard/os`). Nada do CRM quebrou.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/context-selector.tsx src/components/layout/sidebar.tsx
git commit -m "feat(shell): seletor de contexto no topo da sidebar + OS vira Cockpit"
```

---

## Self-Review

**Spec coverage** (spec `2026-06-30-cockpit-crescimento-shell-design.md`):
- §3 Shell / seletor de contexto → Task 7 ✓
- §4 Cockpit: hero → Task 4/5; 4 metric cards (Receita/Follow-ups/Clientes-em-breve/Prova viva) → Task 2/4/5; 2 colunas (Central + Atividade) → Task 5/6; Espinha & Governança → Task 6 ✓
- §5 Central de Ações read-first (follow-ups vencidos + deals parados + deep-link + rodapé "aprovação em breve") → Task 3/5 ✓
- §6 camada de dados (puras + loaders, nota RLS deals) → Tasks 1–4 + Global Constraints ✓
- §7 identidade visual = wacrm (MetricCard/TerminalWindow/tokens) → Global Constraints + Tasks 5–7 ✓
- §8 fora de escopo (os_approvals, Entrega/Financeiro reais, Cost Center) → não há tasks (correto) ✓

**Placeholder scan:** sem TBD/TODO; todo step de código mostra o código; todo comando tem expected output.

**Type consistency:** `CloserDeal`/`CommercialMetrics` (T2) consumidos em T3/T4/T5/T6 com os mesmos nomes; `OverdueFollowup`/`PendingDecision`/`DecisionUrgency` (T3) idem; `GrowthHero` (T4) idem; `formatBRL`/`startOfLocalMonth` exportados antes do uso. `buildPendingDecisions(overdue, stale, now)` mesma assinatura em teste e implementação e chamada na página.

## Execution Handoff

Plano salvo. Dois caminhos de execução — **Subagent-Driven** (recomendado: 1 subagente fresco por task + review entre tasks) ou **Inline** (executa nesta sessão com checkpoints).
