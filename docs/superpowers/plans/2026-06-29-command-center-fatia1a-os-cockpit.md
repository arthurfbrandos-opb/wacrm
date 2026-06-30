# Command Center — Fatia 1A · Cockpit OS (Minha Empresa) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma seção só-leitura "Cockpit OS" ao wacrm (rota `/dashboard/os`) que mostra a espinha `os_*` ao vivo — Visão Geral (stats), Atividade (`os_events`) e Agentes (`os_agent_registry`) — na estética terminal da NS, sem encostar no caminho vivo do Ian/CRM.

**Architecture:** Página cliente (`"use client"`) que usa o cliente Supabase do browser (anon → RLS escopa por conta), chamando funções `load*(db)` puras de `src/lib/dashboard/os-queries.ts` (mesmo padrão de `ads-queries.ts`). A lógica testável (`buildOsOverview`) é extraída e coberta por unit test; as queries são glue fino; os componentes são apresentacionais (TerminalWindow/MetricCard). Aditivo: 1 rota nova + 1 item de sidebar. Sem migration (034 já deployada), sem service_role, sem mexer em middleware/RLS/membership.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 (CSS-first, tokens em `globals.css`) · Supabase JS (`@supabase/supabase-js`) · vitest · lucide-react.

## Global Constraints

- **Aditivo, nunca destrutivo.** Não tocar no caminho do Ian SDR (`src/lib/sdr/*`, `src/app/api/whatsapp/webhook/*`), nem em RLS, middleware de auth, ou no modelo single-account (`profiles.account_id`).
- **Só-leitura via cliente do browser** (`createClient()` de `@/lib/supabase/client`) — RLS escopa pela conta do usuário logado. **NUNCA** usar `supabaseAdmin()`/service_role numa página.
- **Sem migration nesta fatia.** As tabelas `os_*` já existem (migration `034_os_spine.sql`, deployada). Não criar tabelas.
- **Convenções wacrm:** funções de query recebem `db: SupabaseClient` como 1º arg e nunca importam o cliente; lógica pura extraída + unit-testada; componentes usam `TerminalWindow`/`MetricCard`/`Skeleton`; UI 100% PT-BR; estética `font-mono` com prefixo `▸` e cor `text-primary` (verde NS).
- **Tipos DB são hand-written** (não há `Database` gerado) — definir interfaces próprias.
- **Colunas reais (migration 034, verbatim):** `os_events(id, account_id, agent, kind, summary, ref, created_at)` · `os_agent_registry(id, account_id, key, name, model, status['active'|'paused'|'retired'], owner, created_at, updated_at)` · `os_kill_switches(id, account_id, key, enabled, reason, updated_by, updated_at)`.
- **Deploy NÃO faz parte deste plano.** O plano é build local + testes verdes. O deploy pra prod (`rsync → /opt/wacrm` + rebuild) é passo gated separado, fora do horário de pico, como na Fase 1 do NS OS.
- **Commits frequentes**, conventional commits, `git add` com caminhos explícitos (sessões paralelas).

---

### Task 1: Camada de dados do Cockpit OS (tipos + compute + queries)

**Files:**
- Create: `src/lib/dashboard/os-types.ts`
- Create: `src/lib/dashboard/os-queries.ts`
- Test: `src/lib/dashboard/os-queries.test.ts`

**Interfaces:**
- Consumes: `startOfLocalDay()` de `@/lib/dashboard/date-utils` (já existe; retorna `Date` no início do dia local).
- Produces:
  - `OsEventRow { id: string; agent: string | null; kind: string; summary: string | null; created_at: string }`
  - `OsAgentRow { id: string; key: string; name: string; model: string | null; status: string; owner: string | null }`
  - `OsOverview { agentsActive: number; agentsTotal: number; eventsToday: number; switchesOn: number; switchesTotal: number }`
  - `buildOsOverview(input: { agentStatuses: { status: string }[]; eventsTodayCount: number | null; switchEnabled: { enabled: boolean }[] }): OsOverview`
  - `loadOsActivity(db: SupabaseClient, limit?: number): Promise<OsEventRow[]>`
  - `loadOsAgents(db: SupabaseClient): Promise<OsAgentRow[]>`
  - `loadOsOverview(db: SupabaseClient): Promise<OsOverview>`

- [ ] **Step 1: Escrever o teste que falha (`buildOsOverview`)**

Create `src/lib/dashboard/os-queries.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildOsOverview } from './os-queries'

describe('buildOsOverview', () => {
  it('conta agentes ativos/total, eventos do dia e switches ligados/total', () => {
    const o = buildOsOverview({
      agentStatuses: [{ status: 'active' }, { status: 'active' }, { status: 'paused' }],
      eventsTodayCount: 3,
      switchEnabled: [{ enabled: true }, { enabled: false }],
    })
    expect(o).toEqual({ agentsActive: 2, agentsTotal: 3, eventsToday: 3, switchesOn: 1, switchesTotal: 2 })
  })

  it('espinha vazia → tudo 0', () => {
    const o = buildOsOverview({ agentStatuses: [], eventsTodayCount: 0, switchEnabled: [] })
    expect(o).toEqual({ agentsActive: 0, agentsTotal: 0, eventsToday: 0, switchesOn: 0, switchesTotal: 0 })
  })

  it('eventsTodayCount null (head count ausente) vira 0', () => {
    const o = buildOsOverview({ agentStatuses: [{ status: 'active' }], eventsTodayCount: null, switchEnabled: [] })
    expect(o.eventsToday).toBe(0)
    expect(o.agentsActive).toBe(1)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- os-queries`
Expected: FAIL — `buildOsOverview` não existe / módulo não encontrado.

- [ ] **Step 3: Criar os tipos**

Create `src/lib/dashboard/os-types.ts`:

```ts
// src/lib/dashboard/os-types.ts
// Tipos das telas do Cockpit OS (lê a espinha os_* — migration 034).

export interface OsEventRow {
  id: string
  agent: string | null
  kind: string
  summary: string | null
  created_at: string
}

export interface OsAgentRow {
  id: string
  key: string
  name: string
  model: string | null
  status: string
  owner: string | null
}

export interface OsOverview {
  agentsActive: number
  agentsTotal: number
  eventsToday: number
  switchesOn: number
  switchesTotal: number
}
```

- [ ] **Step 4: Implementar compute + queries**

Create `src/lib/dashboard/os-queries.ts`:

```ts
// src/lib/dashboard/os-queries.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { startOfLocalDay } from './date-utils'
import type { OsEventRow, OsAgentRow, OsOverview } from './os-types'

type DB = SupabaseClient

/** Pure: monta os números da Visão Geral a partir das linhas cruas das os_*. */
export function buildOsOverview(input: {
  agentStatuses: { status: string }[]
  eventsTodayCount: number | null
  switchEnabled: { enabled: boolean }[]
}): OsOverview {
  return {
    agentsActive: input.agentStatuses.filter((a) => a.status === 'active').length,
    agentsTotal: input.agentStatuses.length,
    eventsToday: input.eventsTodayCount ?? 0,
    switchesOn: input.switchEnabled.filter((s) => s.enabled).length,
    switchesTotal: input.switchEnabled.length,
  }
}

/** Feed de atividade (os_events) — mais recente primeiro. RLS escopa por conta. */
export async function loadOsActivity(db: DB, limit = 20): Promise<OsEventRow[]> {
  const { data, error } = await db
    .from('os_events')
    .select('id, agent, kind, summary, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as OsEventRow[]
}

/** Registro de agentes (os_agent_registry). RLS escopa por conta. */
export async function loadOsAgents(db: DB): Promise<OsAgentRow[]> {
  const { data, error } = await db
    .from('os_agent_registry')
    .select('id, key, name, model, status, owner')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as OsAgentRow[]
}

/** Números da Visão Geral. RLS escopa por conta. */
export async function loadOsOverview(db: DB): Promise<OsOverview> {
  const todayStart = startOfLocalDay().toISOString()
  const [agents, eventsToday, switches] = await Promise.all([
    db.from('os_agent_registry').select('status'),
    db.from('os_events').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('os_kill_switches').select('enabled'),
  ])
  if (agents.error) throw agents.error
  if (eventsToday.error) throw eventsToday.error
  if (switches.error) throw switches.error
  return buildOsOverview({
    agentStatuses: (agents.data ?? []) as { status: string }[],
    eventsTodayCount: eventsToday.count ?? 0,
    switchEnabled: (switches.data ?? []) as { enabled: boolean }[],
  })
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npm test -- os-queries`
Expected: PASS (3 testes).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/lib/dashboard/os-types.ts src/lib/dashboard/os-queries.ts src/lib/dashboard/os-queries.test.ts
git commit -m "feat(os-cockpit): camada de dados (os_* queries + buildOsOverview)"
```

---

### Task 2: Componentes apresentacionais do Cockpit OS

**Files:**
- Create: `src/components/dashboard/os/overview-cards.tsx`
- Create: `src/components/dashboard/os/activity-feed.tsx`
- Create: `src/components/dashboard/os/agents-table.tsx`

**Interfaces:**
- Consumes: `OsOverview`, `OsEventRow[]`, `OsAgentRow[]` (Task 1) · `MetricCard` (`@/components/dashboard/metric-card`) · `SkeletonCard`/`Skeleton` (`@/components/dashboard/skeleton`) · `TerminalWindow` (`@/components/ui/terminal-window`).
- Produces: `<OsOverviewCards data={OsOverview|null} />` · `<OsActivityFeed data={OsEventRow[]|null} />` · `<OsAgentsTable data={OsAgentRow[]|null} />`. Convenção: `null` = carregando (skeleton); `[]` = vazio (empty-state honesto).

> Componentes apresentacionais não têm unit test neste codebase (padrão logic-first) — a verificação é typecheck + QA visual na Task 4.

- [ ] **Step 1: Cards da Visão Geral**

Create `src/components/dashboard/os/overview-cards.tsx`:

```tsx
import { Bot, Activity, DollarSign, Power } from 'lucide-react'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import type { OsOverview } from '@/lib/dashboard/os-types'

interface OsOverviewCardsProps {
  data: OsOverview | null
}

export function OsOverviewCards({ data }: OsOverviewCardsProps) {
  if (!data) {
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
      <MetricCard title="Agentes ativos" value={`${data.agentsActive}`} icon={Bot} subtitle={`${data.agentsTotal} no registro`} />
      <MetricCard title="Eventos hoje" value={data.eventsToday.toLocaleString('pt-BR')} icon={Activity} />
      <MetricCard title="Custo hoje" value="—" icon={DollarSign} subtitle="em breve · via LiteLLM" />
      <MetricCard title="Kill switches" value={`${data.switchesOn}/${data.switchesTotal}`} icon={Power} subtitle="ligados / total" />
    </div>
  )
}
```

- [ ] **Step 2: Feed de atividade (os_events)**

Create `src/components/dashboard/os/activity-feed.tsx`:

```tsx
import { TerminalWindow } from '@/components/ui/terminal-window'
import { Skeleton } from '@/components/dashboard/skeleton'
import type { OsEventRow } from '@/lib/dashboard/os-types'

interface OsActivityFeedProps {
  data: OsEventRow[] | null
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function OsActivityFeed({ data }: OsActivityFeedProps) {
  return (
    <TerminalWindow title="os/atividade">
      <div className="p-4">
        {data === null ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <p className="font-mono text-sm text-muted-foreground">
            sem eventos ainda — a espinha enche conforme os agentes agem.
          </p>
        ) : (
          <ul className="space-y-2 font-mono text-sm">
            {data.map((e) => (
              <li
                key={e.id}
                className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2 last:border-0"
              >
                <span className="truncate">
                  <span className="text-primary">› {e.agent ?? 'sistema'}</span>
                  <span className="text-muted-foreground"> · {e.summary ?? e.kind}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </TerminalWindow>
  )
}
```

- [ ] **Step 3: Tabela de agentes (os_agent_registry)**

Create `src/components/dashboard/os/agents-table.tsx`:

```tsx
import { TerminalWindow } from '@/components/ui/terminal-window'
import { Skeleton } from '@/components/dashboard/skeleton'
import type { OsAgentRow } from '@/lib/dashboard/os-types'

interface OsAgentsTableProps {
  data: OsAgentRow[] | null
}

const STATUS_TONE: Record<string, string> = {
  active: 'border-primary/40 bg-primary/10 text-primary',
  paused: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  retired: 'border-border bg-muted text-muted-foreground',
}

export function OsAgentsTable({ data }: OsAgentsTableProps) {
  return (
    <TerminalWindow title="os/agentes">
      <div className="p-4">
        {data === null ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <p className="font-mono text-sm text-muted-foreground">nenhum agente registrado.</p>
        ) : (
          <ul className="space-y-3 font-mono text-sm">
            {data.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="text-foreground">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.model ?? '—'}
                    {a.owner ? ` · ${a.owner}` : ''}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_TONE[a.status] ?? STATUS_TONE.retired}`}
                >
                  ● {a.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </TerminalWindow>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/os/overview-cards.tsx src/components/dashboard/os/activity-feed.tsx src/components/dashboard/os/agents-table.tsx
git commit -m "feat(os-cockpit): componentes (overview cards + atividade + agentes)"
```

---

### Task 3: Página `/dashboard/os` + item de sidebar

**Files:**
- Create: `src/app/(dashboard)/dashboard/os/page.tsx`
- Modify: `src/components/layout/sidebar.tsx` (import lucide `Cpu` no bloco de import de ícones, lines 9-29; novo item em `navItems`, lines 93-104)

**Interfaces:**
- Consumes: `loadOsOverview`/`loadOsActivity`/`loadOsAgents` (Task 1) · `OsOverviewCards`/`OsActivityFeed`/`OsAgentsTable` (Task 2) · `createClient` (`@/lib/supabase/client`).
- Produces: rota `/dashboard/os` (já protegida por `protectedPaths` `['/dashboard', ...]` via `startsWith` → **sem alteração no middleware**).

- [ ] **Step 1: Criar a página**

Create `src/app/(dashboard)/dashboard/os/page.tsx`:

```tsx
"use client"
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadOsOverview, loadOsActivity, loadOsAgents } from '@/lib/dashboard/os-queries'
import type { OsOverview, OsEventRow, OsAgentRow } from '@/lib/dashboard/os-types'
import { OsOverviewCards } from '@/components/dashboard/os/overview-cards'
import { OsActivityFeed } from '@/components/dashboard/os/activity-feed'
import { OsAgentsTable } from '@/components/dashboard/os/agents-table'

export default function OsCockpitPage() {
  const [overview, setOverview] = useState<OsOverview | null>(null)
  const [activity, setActivity] = useState<OsEventRow[] | null>(null)
  const [agents, setAgents] = useState<OsAgentRow[] | null>(null)

  useEffect(() => {
    const db = createClient()
    void loadOsOverview(db).then(setOverview).catch((e) => console.error('[os] overview', e))
    void loadOsActivity(db).then(setActivity).catch((e) => console.error('[os] activity', e))
    void loadOsAgents(db).then(setAgents).catch((e) => console.error('[os] agents', e))
  }, [])

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="font-mono text-2xl font-bold text-foreground">
          <span className="text-primary">▸</span> os/cockpit
        </h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          Minha Empresa · a espinha do NS OS ao vivo (atividade, agentes, governança).
        </p>
      </div>
      <OsOverviewCards data={overview} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OsActivityFeed data={activity} />
        <OsAgentsTable data={agents} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Adicionar o ícone `Cpu` ao import do lucide na sidebar**

In `src/components/layout/sidebar.tsx`, no bloco de import de ícones (lines 9-29), adicionar `Cpu,` (em ordem alfabética, logo após `CalendarDays,`):

```tsx
import {
  CalendarDays,
  Cpu,
  Crown,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquare,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  UserPlus,
  Users,
  UsersRound,
  Workflow,
  PanelLeftClose,
  X,
  Zap,
} from "lucide-react";
```

- [ ] **Step 3: Adicionar o item de nav "OS"**

In `src/components/layout/sidebar.tsx`, no array `navItems` (lines 93-104), inserir a linha do OS logo após "Painel":

```tsx
const navItems: NavItem[] = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { href: "/dashboard/os", label: "OS", icon: Cpu },
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

- [ ] **Step 4: Typecheck + suíte completa (sem regressão)**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck sem erros; suíte verde (os reds pré-existentes de `currency`/`date-utils` por locale/tz, se houver, continuam iguais — não introduzir novos).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/os/page.tsx" src/components/layout/sidebar.tsx
git commit -m "feat(os-cockpit): rota /dashboard/os + item de sidebar"
```

---

### Task 4: Verificação manual (local, sem deploy)

**Files:** nenhum (verificação).

- [ ] **Step 1: Subir o app local**

Run: `npm run dev`
Abrir `http://localhost:3000`, logar com a conta do Arthur (membro da conta NS).

- [ ] **Step 2: Conferir o Cockpit OS**

Navegar pra `/dashboard/os` (item "OS" na sidebar, com ícone Cpu, logo abaixo de "Painel").
Esperado:
- 4 cards: **Agentes ativos** = 1 (Ian), **Eventos hoje** = 1 se for o mesmo dia do reply de teste (senão 0 — ok), **Custo hoje** = "—" com "em breve · via LiteLLM", **Kill switches** = "1/1".
- **os/atividade:** mostra `› ian · Ian respondeu um lead · <data/hora SP>` (o `sdr.reply_sent` da Fase 1). Se vazio, mostra o empty-state honesto.
- **os/agentes:** mostra `Ian` · `claude-sonnet-4-6 · arthur` · chip verde `● active`.
- Sem erros no console do browser.

- [ ] **Step 3: QA visual**

Conferir que bate com a estética terminal/dark da NS (TerminalWindow, `▸` verde, `font-mono`) e que o ativo "OS" fica destacado na sidebar (`bg-primary/10 text-primary`). O caminho do Ian/inbox/CRM continua funcionando normalmente (abrir `/inbox` e `/dashboard` pra confirmar zero regressão visual).

---

## Self-Review (writing-plans)

- **Cobertura da Fatia 1A (spec §10):** shell mínimo + Minha Empresa OS panels = Tasks 1-3 (Visão Geral/Atividade/Agentes lendo `os_*`); "Custo em breve" = card placeholder honesto (Task 2 Step 1). ✓ O seletor de contexto (Minha Empresa/Meus Clientes/Workspace) e a Carteira GHL são Fatias 1B/1D (fora deste plano — por design).
- **Placeholders:** nenhum "TODO/TBD"; todo step tem código completo. ✓
- **Consistência de tipos:** `OsOverview`/`OsEventRow`/`OsAgentRow` definidos na Task 1 e consumidos verbatim nas Tasks 2-3; `buildOsOverview` assinatura idêntica entre `os-queries.ts` e o teste. ✓
- **Risco à prod viva:** zero escrita, zero service_role, zero alteração em middleware/RLS/SDR; rota nova já coberta pelo `protectedPaths`. ✓

## Out of scope (próximas fatias)
- 1B: seletor de contexto (Minha Empresa/Meus Clientes/Workspace) na sidebar.
- 1C: esquema comercial `plans/modules/account_modules` + gating.
- 1D: Carteira GHL (read-only, service-role cross-account, gated) — sem impersonation.
- Deploy pra prod (`rsync` + rebuild) — gated, separado.
