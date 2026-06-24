# FU1 Fatia 2 — Régua montada + fiação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Montar a régua FU1 e ligá-la ao fluxo vivo: engate no chase (tag `fu1` + `tag_added`), helper de resolução de stage por nome, "responder → Em Conversa" no `runSdrReply`, e o script de seed da régua.

**Architecture:** Helpers SDR puros recebem `admin` (service-role) por parâmetro e são testados com um admin falso (padrão de `src/lib/sdr/touches.ts`). A régua nasce de um script de seed committed (rodado manualmente no VPS). Nada de Meta; UazAPI only. As tasks de CÓDIGO são executáveis com vitest sem banco vivo; a ATIVAÇÃO (migration 030, deploy, rodar o seed, e2e) é gated no Arthur e fora deste plano.

**Tech Stack:** TypeScript, Next.js, Supabase service-role REST, Vitest.

## Global Constraints

- **Canal:** UazAPI (não-oficial) apenas.
- **Tenancy:** todo acesso admin escopado por `account_id`.
- **Ids por NOME em runtime:** a pipeline "Follow-up" existe no banco vivo mas NÃO em código — resolver `pipeline_id`/`stage_id` por nome, nunca hardcodar. Tabela de estágios: `pipeline_stages`; pipelines: `pipelines`.
- **Voz NS:** agente é **Ian** (não Pedro); **banir "sem compromisso"**.
- **Migration 030** é pré-requisito de ATIVAÇÃO (cancel só funciona com ela) — não é tocada por este plano.
- Test runner: `npx vitest run <arquivo>`. Helpers recebem `admin` por param → testar com admin falso (sem `vi.mock`).
- **NÃO rodar o seed contra banco nenhum** nesta execução — só criar/commitar o arquivo.

---

### Task 1: Helper `stage-lookup` (resolver pipeline/stage por nome)

**Files:**
- Create: `src/lib/sdr/stage-lookup.ts`
- Test: `src/lib/sdr/stage-lookup.test.ts`

**Interfaces:**
- Produces: `resolvePipelineId(admin, accountId, pipelineName): Promise<string|null>` e `resolveStageId(admin, accountId, pipelineName, stageName): Promise<string|null>`.

- [ ] **Step 1: Teste que falha** — `src/lib/sdr/stage-lookup.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { resolvePipelineId, resolveStageId } from './stage-lookup'

// Admin falso: from(table) encadeável; maybeSingle devolve o canned data por tabela.
function fakeAdmin(data: Record<string, unknown>) {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: (data as Record<string, unknown>)[table] ?? null, error: null }),
      }
      return b
    },
  }
}

describe('stage-lookup', () => {
  it('resolves a pipeline id by name', async () => {
    const admin = fakeAdmin({ pipelines: { id: 'pl-fu' } })
    expect(await resolvePipelineId(admin, 'acc-1', 'Follow-up')).toBe('pl-fu')
  })

  it('returns null when the pipeline is missing', async () => {
    const admin = fakeAdmin({})
    expect(await resolvePipelineId(admin, 'acc-1', 'Nope')).toBeNull()
  })

  it('resolves a stage id by pipeline + stage name', async () => {
    const admin = fakeAdmin({ pipelines: { id: 'pl-fu' }, pipeline_stages: { id: 'st-fu1' } })
    expect(await resolveStageId(admin, 'acc-1', 'Follow-up', 'Follow-up 1')).toBe('st-fu1')
  })

  it('returns null when the stage pipeline is missing', async () => {
    const admin = fakeAdmin({})
    expect(await resolveStageId(admin, 'acc-1', 'Follow-up', 'Follow-up 1')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/lib/sdr/stage-lookup.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar** — `src/lib/sdr/stage-lookup.ts`:

```typescript
/** Resolve pipeline/stage ids by name at runtime (the "Follow-up" pipeline
 *  lives in the live DB, not in code). Service-role admin passed in. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export async function resolvePipelineId(
  admin: Admin,
  accountId: string,
  pipelineName: string,
): Promise<string | null> {
  const { data } = await admin
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', pipelineName)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export async function resolveStageId(
  admin: Admin,
  accountId: string,
  pipelineName: string,
  stageName: string,
): Promise<string | null> {
  const pipelineId = await resolvePipelineId(admin, accountId, pipelineName)
  if (!pipelineId) return null
  const { data } = await admin
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipelineId)
    .eq('name', stageName)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run src/lib/sdr/stage-lookup.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sdr/stage-lookup.ts src/lib/sdr/stage-lookup.test.ts
git commit -m "feat(sdr): resolve pipeline/stage id by name (stage-lookup helper)"
```

---

### Task 2: Helper `ensureTag` (find-or-create de tag por nome)

**Files:**
- Create: `src/lib/sdr/ensure-tag.ts`
- Test: `src/lib/sdr/ensure-tag.test.ts`

**Interfaces:**
- Produces: `ensureTag(admin, accountId, userId, name): Promise<string>` — retorna o id da tag (existente ou recém-criada). `tags` não tem UNIQUE(account_id,name) → SELECT-by-name, INSERT se faltar.

- [ ] **Step 1: Teste que falha** — `src/lib/sdr/ensure-tag.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ensureTag } from './ensure-tag'

function fakeAdmin(existing: { id: string } | null, insertId = 'tag-new') {
  const insert = vi.fn(() => ({
    select: () => ({ single: async () => ({ data: { id: insertId }, error: null }) }),
  }))
  const admin = {
    insert,
    from() {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: existing, error: null }),
        insert,
      }
      return b
    },
  }
  return admin
}

describe('ensureTag', () => {
  it('returns the existing tag id without inserting', async () => {
    const admin = fakeAdmin({ id: 'tag-1' })
    expect(await ensureTag(admin, 'acc-1', 'u1', 'fu1')).toBe('tag-1')
    expect(admin.insert).not.toHaveBeenCalled()
  })

  it('creates the tag when absent and returns the new id', async () => {
    const admin = fakeAdmin(null, 'tag-new')
    expect(await ensureTag(admin, 'acc-1', 'u1', 'fu1')).toBe('tag-new')
    expect(admin.insert).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/lib/sdr/ensure-tag.test.ts` → FAIL.

- [ ] **Step 3: Implementar** — `src/lib/sdr/ensure-tag.ts`:

```typescript
/** Find-or-create a tag by name for an account (tags has no UNIQUE on
 *  (account_id, name), so we SELECT then INSERT). Returns the tag id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export async function ensureTag(
  admin: Admin,
  accountId: string,
  userId: string,
  name: string,
): Promise<string> {
  const { data: existing } = await admin
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', name)
    .maybeSingle()
  if ((existing as { id: string } | null)?.id) return (existing as { id: string }).id

  const { data: created, error } = await admin
    .from('tags')
    .insert({ account_id: accountId, user_id: userId, name })
    .select('id')
    .single()
  if (error || !created) throw new Error(`ensureTag failed: ${error?.message ?? 'no row'}`)
  return (created as { id: string }).id
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run src/lib/sdr/ensure-tag.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sdr/ensure-tag.ts src/lib/sdr/ensure-tag.test.ts
git commit -m "feat(sdr): ensureTag find-or-create helper"
```

---

### Task 3: Helper `moveDealFollowupToEmConversa` + wire no `runSdrReply`

**Files:**
- Create: `src/lib/sdr/regua-exit.ts`
- Test: `src/lib/sdr/regua-exit.test.ts`
- Modify: `src/lib/sdr/processor.ts` (`runSdrReply`, após o gate+debounce ~L95)

**Interfaces:**
- Consumes: `resolvePipelineId`, `resolveStageId` (Task 1).
- Produces: `moveDealFollowupToEmConversa(admin, accountId, contactId): Promise<boolean>` — se o deal aberto do contato está na pipeline "Follow-up", move pra "Pré-Vendas (SDR)"/"Em Conversa" e retorna true; senão false. Best-effort: lança? Não — captura e retorna false.

- [ ] **Step 1: Teste que falha** — `src/lib/sdr/regua-exit.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { moveDealFollowupToEmConversa } from './regua-exit'

// Admin falso parametrizável por tabela+operação.
function fakeAdmin(opts: {
  followupPipelineId?: string
  emConversaStageId?: string
  sdrPipelineId?: string
  deal?: { id: string; pipeline_id: string } | null
  onUpdate?: (filters: [string, unknown][]) => void
}) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = []
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => (filters.push([k, v]), b),
        order: () => b,
        limit: () => b,
        maybeSingle: async () => {
          if (table === 'pipelines') {
            // resolve by name: the name filter is the 2nd eq
            const name = filters.find(([k]) => k === 'name')?.[1]
            if (name === 'Follow-up') return { data: opts.followupPipelineId ? { id: opts.followupPipelineId } : null, error: null }
            if (name === 'Pré-Vendas (SDR)') return { data: opts.sdrPipelineId ? { id: opts.sdrPipelineId } : null, error: null }
            return { data: null, error: null }
          }
          if (table === 'pipeline_stages') return { data: opts.emConversaStageId ? { id: opts.emConversaStageId } : null, error: null }
          if (table === 'deals') return { data: opts.deal ?? null, error: null }
          return { data: null, error: null }
        },
        update: () => ({ eq: (k: string, v: unknown) => { filters.push([k, v]); opts.onUpdate?.(filters); return { eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) } } }),
      }
      return b
    },
  }
}

describe('moveDealFollowupToEmConversa', () => {
  it('moves the deal when it is in the Follow-up pipeline', async () => {
    let updated = false
    const admin = fakeAdmin({
      followupPipelineId: 'pl-fu', sdrPipelineId: 'pl-sdr', emConversaStageId: 'st-emconv',
      deal: { id: 'd1', pipeline_id: 'pl-fu' },
      onUpdate: () => { updated = true },
    })
    expect(await moveDealFollowupToEmConversa(admin, 'acc-1', 'c1')).toBe(true)
    expect(updated).toBe(true)
  })

  it('does nothing when the deal is not in the Follow-up pipeline', async () => {
    const admin = fakeAdmin({
      followupPipelineId: 'pl-fu', sdrPipelineId: 'pl-sdr', emConversaStageId: 'st-emconv',
      deal: { id: 'd1', pipeline_id: 'pl-other' },
    })
    expect(await moveDealFollowupToEmConversa(admin, 'acc-1', 'c1')).toBe(false)
  })

  it('returns false when there is no open deal', async () => {
    const admin = fakeAdmin({ followupPipelineId: 'pl-fu', deal: null })
    expect(await moveDealFollowupToEmConversa(admin, 'acc-1', 'c1')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/lib/sdr/regua-exit.test.ts` → FAIL.

- [ ] **Step 3: Implementar** — `src/lib/sdr/regua-exit.ts`:

```typescript
import { resolvePipelineId, resolveStageId } from './stage-lookup'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

/** When a lead replies mid-régua, move their open deal out of the "Follow-up"
 *  pipeline back into "Pré-Vendas (SDR)" / "Em Conversa". No-op if the deal
 *  isn't in Follow-up. Best-effort: never throws. */
export async function moveDealFollowupToEmConversa(
  admin: Admin,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  try {
    const followupPipelineId = await resolvePipelineId(admin, accountId, 'Follow-up')
    if (!followupPipelineId) return false

    const { data: deal } = await admin
      .from('deals')
      .select('id, pipeline_id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const d = deal as { id: string; pipeline_id: string } | null
    if (!d || d.pipeline_id !== followupPipelineId) return false

    const sdrPipelineId = await resolvePipelineId(admin, accountId, 'Pré-Vendas (SDR)')
    const emConversaStageId = await resolveStageId(admin, accountId, 'Pré-Vendas (SDR)', 'Em Conversa')
    if (!sdrPipelineId || !emConversaStageId) return false

    await admin
      .from('deals')
      .update({ pipeline_id: sdrPipelineId, stage_id: emConversaStageId, updated_at: new Date().toISOString() })
      .eq('id', d.id)
      .eq('account_id', accountId)
    return true
  } catch (err) {
    console.error('[sdr] moveDealFollowupToEmConversa failed:', err)
    return false
  }
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run src/lib/sdr/regua-exit.test.ts` → PASS.

- [ ] **Step 5: Wire no `runSdrReply`** — em `src/lib/sdr/processor.ts`, importar e chamar fire-and-forget logo após o debounce confirmar a msg mais recente (≈ após L95, com `accountId`, `contact`, `conversationId` em escopo):

```typescript
import { moveDealFollowupToEmConversa } from './regua-exit'
// ...dentro de runSdrReply, após o gate ai_status + debounce:
moveDealFollowupToEmConversa(admin, accountId, contact.id).catch((err) =>
  console.error('[sdr] follow-up exit move failed:', err),
)
```

(Confirmar os nomes reais em escopo: `admin`, `accountId`, `contact.id`. Ajustar se divergir.)

- [ ] **Step 6: tsc + commit** — `npx tsc --noEmit` zero erros novos.

```bash
git add src/lib/sdr/regua-exit.ts src/lib/sdr/regua-exit.test.ts src/lib/sdr/processor.ts
git commit -m "feat(sdr): move deal Follow-up→Em Conversa when lead replies mid-régua"
```

---

### Task 4: Engate no chase (`touches-processor.ts` dispara `tag_added`)

**Files:**
- Modify: `src/lib/sdr/touches-processor.ts` (bloco chase, ~L172-176)

**Interfaces:**
- Consumes: `ensureTag` (Task 2); `runAutomationsForTrigger` (`@/lib/automations/engine`).

- [ ] **Step 1: Implementar o engate** — em `src/lib/sdr/touches-processor.ts`, imports no topo:

```typescript
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { ensureTag } from './ensure-tag'
```

No bloco chase, entre `moveDealToStage(admin, t.deal_id, 'primeiro_contato')` (L174) e `resolveTouch` (L175):

```typescript
    // Engate FU1: marca o contato e dispara a régua (gatilho tag_added).
    // conversation_id no contexto se propaga pelos waits → toques no inbox.
    try {
      const { data: acct } = await admin
        .from('accounts')
        .select('owner_user_id')
        .eq('id', accountId)
        .maybeSingle()
      const userId = (acct as { owner_user_id?: string } | null)?.owner_user_id
      if (!userId) throw new Error('no owner_user_id for account')
      const fu1TagId = await ensureTag(admin, accountId, userId, 'fu1')
      await admin
        .from('contact_tags')
        .upsert({ contact_id: t.contact_id, tag_id: fu1TagId }, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true })
      runAutomationsForTrigger({
        accountId,
        triggerType: 'tag_added',
        contactId: t.contact_id,
        context: { tag_id: fu1TagId, conversation_id: t.conversation_id },
      }).catch((err) => console.error('[sdr] fu1 trigger failed:', err))
    } catch (err) {
      console.error('[sdr] fu1 engate failed:', err)
    }
```

O `user_id` da conta vem de `accounts.owner_user_id` (confirmado no schema — `tags.user_id` é NOT NULL, e `SdrTouchRow`/touches-processor não carregam user_id). `t.conversation_id`/`t.contact_id` já estão em escopo.

- [ ] **Step 2: tsc** — `npx tsc --noEmit` zero erros novos.

- [ ] **Step 3: Verificação (descrita)** — sem teste de integração nesta fatia; a verificação é tsc + a leitura: o engate só roda no caminho do chase (lead não agendou, sem resposta), tudo try/catch (não derruba o touch), trigger fire-and-forget. Documentar no report o user_id resolvido.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sdr/touches-processor.ts
git commit -m "feat(sdr): arm FU1 régua on chase (tag fu1 + tag_added trigger w/ conversation_id)"
```

---

### Task 5: Script de seed da régua FU1 (committed, NÃO rodado)

**Files:**
- Create: `scripts/seed-fu1-regua.mjs`

**Interfaces:**
- Standalone Node ESM, rodado manualmente via `docker compose exec -T wacrm node < scripts/seed-fu1-regua.mjs` no VPS. Usa o `@supabase/supabase-js` com `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL` do env do container.

- [ ] **Step 1: Escrever o script** — `scripts/seed-fu1-regua.mjs`:

```javascript
// Seed da régua FU1 (rodar UMA vez no container: docker compose exec -T wacrm node < scripts/seed-fu1-regua.mjs)
// Resolve account/user/tag/stages por nome em runtime; cria a automação INATIVA.
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const db = createClient(url, key)

// ⚠️ confirmar como identificar a conta NS — ajustar este seletor antes de rodar.
const ACCOUNT_NAME = process.env.NS_ACCOUNT_NAME || 'Negócio Simples'

async function stageId(accountId, pipelineName, stageName) {
  const { data: pl } = await db.from('pipelines').select('id').eq('account_id', accountId).eq('name', pipelineName).maybeSingle()
  if (!pl) throw new Error(`pipeline não achada: ${pipelineName}`)
  const { data: st } = await db.from('pipeline_stages').select('id').eq('pipeline_id', pl.id).eq('name', stageName).maybeSingle()
  if (!st) throw new Error(`stage não achado: ${pipelineName}/${stageName}`)
  return st.id
}

async function main() {
  const { data: acct } = await db.from('accounts').select('id, owner_user_id').eq('name', ACCOUNT_NAME).maybeSingle()
  if (!acct) throw new Error(`conta não achada: ${ACCOUNT_NAME}`)
  const accountId = acct.id
  const userId = acct.owner_user_id

  const { data: dup } = await db.from('automations').select('id').eq('account_id', accountId).eq('name', 'Follow-up 1').maybeSingle()
  if (dup) { console.log('automação "Follow-up 1" já existe — abortando (idempotente)'); return }

  // tag fu1 (find-or-create)
  let { data: tag } = await db.from('tags').select('id').eq('account_id', accountId).eq('name', 'fu1').maybeSingle()
  if (!tag) ({ data: tag } = await db.from('tags').insert({ account_id: accountId, user_id: userId, name: 'fu1' }).select('id').single())

  const fu1Stage = await stageId(accountId, 'Follow-up', 'Follow-up 1')
  const lostStage = await stageId(accountId, 'Pré-Vendas (SDR)', 'Lead Vencido')
  const followupPipeline = (await db.from('pipelines').select('id').eq('account_id', accountId).eq('name', 'Follow-up').maybeSingle()).data.id
  const sdrPipeline = (await db.from('pipelines').select('id').eq('account_id', accountId).eq('name', 'Pré-Vendas (SDR)').maybeSingle()).data.id

  const { data: auto } = await db.from('automations').insert({
    account_id: accountId, user_id: userId, name: 'Follow-up 1',
    trigger_type: 'tag_added', trigger_config: { tag_id: tag.id },
    is_active: false, cancel_on_reply: true,
  }).select('id').single()

  const ai = (guidance) => ({ step_type: 'send_ai', step_config: { guidance } })
  const wait = (amount, unit) => ({ step_type: 'wait', step_config: { amount, unit } })
  const move = (pipeline_id, stage_id) => ({ step_type: 'move_deal', step_config: { pipeline_id, stage_id } })

  const steps = [
    move(followupPipeline, fu1Stage),
    wait(30, 'minutes'), ai("Leve, dá um gancho: 'sei que corre, só não quero te deixar na mão'."),
    wait(30, 'minutes'), ai('Reforça que é rápido: o diagnóstico toma poucos minutos e ele já sai com clareza do gargalo.'),
    wait(2, 'hours'),    ai('Curiosidade: tem um ponto do cadastro dele que vale a pena olhar junto.'),
    wait(9, 'hours'),    ai("Reaparece humano: 'sou eu de novo, o Ian' — sem cobrança pesada."),
    wait(12, 'hours'),   ai("Fecha com respeito: 'vou parar de te incomodar, mas a porta fica aberta'."),
    wait(24, 'hours'),   move(sdrPipeline, lostStage),
  ].map((s, i) => ({ ...s, automation_id: auto.id, position: i, parent_step_id: null, branch: null }))

  const { error } = await db.from('automation_steps').insert(steps)
  if (error) throw error
  console.log(`OK — automação Follow-up 1 (${auto.id}) criada INATIVA com ${steps.length} passos.`)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Sanidade de sintaxe** — `node --check scripts/seed-fu1-regua.mjs` (só parse; NÃO executar o script).

- [ ] **Step 3: Commit** — (NÃO rodar o seed)

```bash
git add scripts/seed-fu1-regua.mjs
git commit -m "feat(sdr): seed script for FU1 régua (run manually on VPS, creates inactive automation)"
```

---

## Self-Review

- Engate (chase→tag_added) → Task 4. Resolver de stage → Task 1. Responder→Em Conversa → Task 3. Seed → Task 5. ensureTag → Task 2. ✔ cobre o spec.
- **Aberto a confirmar na execução:** (a) fonte real do `user_id` da conta (`accounts.user_id`? owner?) — Task 4 e o seed dependem disso; se ambíguo, parar e perguntar. (b) nomes reais em escopo no `runSdrReply` (Task 3 Step 5). (c) `accounts.name`/seletor da conta NS no seed (§9 do spec).
- **Ativação (fora deste plano, gated):** migration 030, deploy VPS, rodar o seed, e2e com nº de teste.

## Riscos
- O seed não é testável por unit — verificado por leitura + `node --check`; corretude real só no VPS.
- `runSdrReply` tem debounce 2500ms; o move é fire-and-forget (não bloqueia).
