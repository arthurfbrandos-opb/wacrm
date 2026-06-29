# Multi-canal WhatsApp Fase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar controle multi-canal ao wacrm — escolher a origem principal do FAP01 (com fallback), trocar a origem por conversa (persistente + badge), e aplicar o gate de janela 24h/template no Meta (humano + IA + toques), corrigindo o render de bubbles e as features por canal.

**Architecture:** Uma decisão de envio única (`resolveSendPlan`) consumida por todos os pontos (humano, IA, toques). Modelo persistente no contato (`contacts.provider`/`connection_id`, já existentes). Janela de 24h derivada de `conversations.last_inbound_at` (novo). Origem principal do FAP01 em `sdr_config.fap01_source` (novo).

**Tech Stack:** Next.js (App Router) · TypeScript · Supabase (Postgres + RLS) · vitest · Meta Cloud API + UazAPI.

## Desvios do spec (decididos no plano, sinalizados a Arthur)

- **Sem rota `PATCH /api/contacts/[id]/channel`.** Descoberta: o switcher de canal já existe em `contact-sidebar.tsx` (Fase 1) escrevendo direto via Supabase/RLS, e a lib `src/lib/whatsapp/channel-options.ts` já dá opções/label. Reaproveitar isso (YAGNI) em vez de duplicar numa rota nova. Caps 2 (Seção C do spec) = adicionar o switcher no **header** + **badge** na lista e no header, reusando essa lib.

## Global Constraints

- **PT-BR** em todo literal de produção (UI, mensagens, templates). Banco/banco compartilhado Supabase `sglsw…`.
- **`npm test` verde antes de QUALQUER commit** (inclui o teste do catálogo). Rodar `npx vitest run <arquivo>` por tarefa e `npm test` antes do commit.
- **Banco Supabase compartilhado** — toda migration confere colunas contra o banco vivo antes; DDL via `psql "$SUPABASE_NS_DB_URL"` (cofre orchestrator), não pelo container.
- **Worktree** `feat/multicanal-whatsapp-fase2` (já criada). Não trabalhar no `main` direto.
- **Não inventar política da Meta** — janela de 24h e exigência de template são comportamento conhecido; nomes de template têm que bater com o painel da Meta.
- **Janela fechada conservadora:** `conversations.last_inbound_at IS NULL` num contato Meta ⇒ tratar como **janela fechada** (exige template). O próximo inbound abre.
- **Provider union** em todo lugar: `'meta' | 'uazapi'`.

---

### Task 1: Migrations — `fap01_source` + `last_inbound_at`

**Files:**
- Create: `supabase/migrations/034_multicanal_fase2.sql`

**Interfaces:**
- Produces: coluna `sdr_config.fap01_source TEXT NOT NULL DEFAULT 'meta' CHECK (in ('meta','uazapi'))`; coluna `conversations.last_inbound_at TIMESTAMPTZ` (nullable).

- [ ] **Step 1: Conferir colunas contra o banco vivo (não inventar)**

Run:
```bash
source ~/Projects/orchestrator/.env 2>/dev/null || true
psql "$SUPABASE_NS_DB_URL" -c "\d sdr_config" -c "\d conversations" | grep -Ei "fap01_source|last_inbound_at" || echo "AUSENTES (esperado) — seguir"
```
Expected: nenhuma das duas colunas existe ainda.

- [ ] **Step 2: Escrever a migration (idempotente)**

```sql
-- ============================================================
-- 034_multicanal_fase2.sql — Fase 2 multi-canal WhatsApp.
--   1. sdr_config.fap01_source: origem principal do 1º contato FAP01.
--   2. conversations.last_inbound_at: timestamp do último inbound
--      (sender_type='customer'), sinal da janela de 24h da Meta.
-- Banco Supabase COMPARTILHADO — colunas conferidas contra o banco vivo.
-- Idempotente.
-- ============================================================
ALTER TABLE sdr_config
  ADD COLUMN IF NOT EXISTS fap01_source TEXT NOT NULL DEFAULT 'meta'
  CHECK (fap01_source IN ('meta', 'uazapi'));

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
```

- [ ] **Step 3: Aplicar no banco vivo**

Run:
```bash
psql "$SUPABASE_NS_DB_URL" -f supabase/migrations/034_multicanal_fase2.sql
psql "$SUPABASE_NS_DB_URL" -c "\d sdr_config" -c "\d conversations" | grep -Ei "fap01_source|last_inbound_at"
```
Expected: as duas colunas aparecem.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/034_multicanal_fase2.sql
git commit -m "feat(db): fap01_source + conversations.last_inbound_at (multicanal fase 2)"
```

---

### Task 2: `resolveSendPlan` — a espinha dorsal (Abordagem A)

**Files:**
- Create: `src/lib/sdr/send-plan.ts`
- Test: `src/lib/sdr/send-plan.test.ts`

**Interfaces:**
- Consumes: `wa_connections`/`whatsapp_config` (disponibilidade), `contacts.provider`/`connection_id`, `conversations.last_inbound_at`.
- Produces:
  - `type SendPlan = { provider: 'meta' | 'uazapi'; connectionId: string | null; windowOpen: boolean; mode: 'text' | 'template_required' }`
  - `function isWindowOpen(provider, lastInboundAt: string | null, nowMs: number): boolean` (puro)
  - `function computeMode(provider, windowOpen: boolean): 'text' | 'template_required'` (puro)
  - `async function resolveSendPlan(admin, accountId, contact: { provider?: 'meta'|'uazapi'|null; connection_id?: string|null }, conversation: { last_inbound_at?: string|null }): Promise<SendPlan>`

- [ ] **Step 1: Escrever os testes que falham (lógica pura)**

```ts
// src/lib/sdr/send-plan.test.ts
import { describe, it, expect } from 'vitest'
import { isWindowOpen, computeMode } from './send-plan'

const NOW = Date.parse('2026-06-29T12:00:00Z')

describe('isWindowOpen', () => {
  it('UazAPI sempre aberta (sem conceito de janela)', () => {
    expect(isWindowOpen('uazapi', null, NOW)).toBe(true)
  })
  it('Meta: NULL last_inbound = fechada (conservador)', () => {
    expect(isWindowOpen('meta', null, NOW)).toBe(false)
  })
  it('Meta: inbound < 24h = aberta', () => {
    const t = new Date(NOW - 23 * 3600_000).toISOString()
    expect(isWindowOpen('meta', t, NOW)).toBe(true)
  })
  it('Meta: inbound > 24h = fechada', () => {
    const t = new Date(NOW - 25 * 3600_000).toISOString()
    expect(isWindowOpen('meta', t, NOW)).toBe(false)
  })
})

describe('computeMode', () => {
  it('Meta + fechada = template_required', () => {
    expect(computeMode('meta', false)).toBe('template_required')
  })
  it('Meta + aberta = text', () => {
    expect(computeMode('meta', true)).toBe('text')
  })
  it('UazAPI sempre text', () => {
    expect(computeMode('uazapi', false)).toBe('text')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/sdr/send-plan.test.ts`
Expected: FAIL ("isWindowOpen is not a function" / módulo não encontrado).

- [ ] **Step 3: Implementar `send-plan.ts`**

```ts
// src/lib/sdr/send-plan.ts
/**
 * Decisão de envio única (Fase 2 multi-canal). Todo ponto de envio
 * (humano, IA, toques) deriva canal + modo daqui — fonte única da verdade.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export type Provider = 'meta' | 'uazapi'
export type SendMode = 'text' | 'template_required'
export interface SendPlan {
  provider: Provider
  connectionId: string | null
  windowOpen: boolean
  mode: SendMode
}

const WINDOW_MS = 24 * 3600_000

/** Janela de 24h da Meta. UazAPI não tem janela (sempre aberta).
 *  Meta sem last_inbound conhecido = conservador (fechada). */
export function isWindowOpen(
  provider: Provider,
  lastInboundAt: string | null,
  nowMs: number,
): boolean {
  if (provider !== 'meta') return true
  if (!lastInboundAt) return false
  return nowMs - Date.parse(lastInboundAt) < WINDOW_MS
}

export function computeMode(provider: Provider, windowOpen: boolean): SendMode {
  return provider === 'meta' && !windowOpen ? 'template_required' : 'text'
}

async function accountHasMetaConfig(admin: Admin, accountId: string): Promise<boolean> {
  const { data } = await admin
    .from('whatsapp_config').select('account_id').eq('account_id', accountId).limit(1).maybeSingle()
  return !!data
}

async function activeUazConnectionId(admin: Admin, accountId: string): Promise<string | null> {
  const { data } = await admin
    .from('wa_connections').select('id')
    .eq('account_id', accountId).eq('is_active_for_crm', true).maybeSingle()
  return data?.id ?? null
}

/** Resolve canal a partir do contato (com fallback p/ canal ativo da conta),
 *  computa janela a partir de conversations.last_inbound_at, e deriva o modo. */
export async function resolveSendPlan(
  admin: Admin,
  accountId: string,
  contact: { provider?: Provider | null; connection_id?: string | null },
  conversation: { last_inbound_at?: string | null },
): Promise<SendPlan> {
  let provider: Provider
  let connectionId: string | null = null

  if (contact.provider === 'uazapi') {
    provider = 'uazapi'
    connectionId = contact.connection_id ?? (await activeUazConnectionId(admin, accountId))
  } else if (contact.provider === 'meta' && (await accountHasMetaConfig(admin, accountId))) {
    provider = 'meta'
  } else {
    // Sem provider explícito (ou Meta sem config): roteia pelo canal real da conta.
    const uazId = await activeUazConnectionId(admin, accountId)
    if (uazId) { provider = 'uazapi'; connectionId = uazId }
    else { provider = 'meta' }
  }

  const windowOpen = isWindowOpen(provider, conversation.last_inbound_at ?? null, Date.now())
  return { provider, connectionId, windowOpen, mode: computeMode(provider, windowOpen) }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/sdr/send-plan.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sdr/send-plan.ts src/lib/sdr/send-plan.test.ts
git commit -m "feat(sdr): resolveSendPlan — decisão única de canal + janela 24h"
```

---

### Task 3: Webhook grava `last_inbound_at` no inbound

**Files:**
- Modify: `src/app/api/whatsapp/webhook/route.ts:674-682` (o update central de inbound em `processMessage`)

**Interfaces:**
- Consumes: nada novo.
- Produces: `conversations.last_inbound_at` preenchido a cada mensagem `sender_type='customer'` (Meta e UazAPI convergem aqui).

- [ ] **Step 1: Adicionar `last_inbound_at` ao update existente**

No `.update({...})` de `conversations` em `processMessage` (linhas ~674-682), adicionar o campo:

```ts
const { error: convError } = await supabaseAdmin()
  .from('conversations')
  .update({
    last_message_text: contentText || `[${message.type}]`,
    last_message_at: new Date().toISOString(),
    last_inbound_at: new Date().toISOString(), // janela de 24h (Fase 2)
    unread_count: (conversation.unread_count || 0) + 1,
    updated_at: new Date().toISOString(),
  })
  .eq('id', conversation.id)
```

(Este é o único ponto de update inbound; reações já dão short-circuit antes — correto, reação não reabre janela.)

- [ ] **Step 2: Verificar build/lint do arquivo**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep webhook/route || echo "OK sem erro de tipo no arquivo"`
Expected: sem erro de tipo novo.

- [ ] **Step 3: Verificação manual (smoke, pós-deploy ou local)**

Mandar uma mensagem inbound de teste (Meta e/ou UazAPI) e conferir:
```bash
psql "$SUPABASE_NS_DB_URL" -c "select id, last_message_at, last_inbound_at from conversations order by updated_at desc limit 3;"
```
Expected: `last_inbound_at` ≈ `last_message_at` na conversa que recebeu.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/whatsapp/webhook/route.ts
git commit -m "feat(webhook): grava last_inbound_at no inbound (janela 24h)"
```

---

### Task 4: FAP01 — origem principal + fallback em `sendFirstContact`

**Files:**
- Modify: `src/lib/sdr/touches-processor.ts` (`sendFirstContact`, ~L93-110; `processOne` para carimbar o contato)
- Create: `src/lib/sdr/fap01-source.ts`
- Test: `src/lib/sdr/fap01-source.test.ts`

**Interfaces:**
- Consumes: `sdr_config.fap01_source` (Task 1), `accountHasMetaConfig`/disponibilidade UazAPI.
- Produces:
  - `function pickFap01Provider(source: 'meta'|'uazapi', avail: { meta: boolean; uaz: boolean }): 'meta' | 'uazapi' | null` (puro — escolhe a fonte; cai pro outro; null se nenhuma)
  - `sendFirstContact` passa a respeitar `fap01_source` + fallback + carimbar `contacts.provider`/`connection_id`.

- [ ] **Step 1: Teste puro da escolha de fonte (falha)**

```ts
// src/lib/sdr/fap01-source.test.ts
import { describe, it, expect } from 'vitest'
import { pickFap01Provider } from './fap01-source'

describe('pickFap01Provider', () => {
  it('fonte disponível: usa ela', () => {
    expect(pickFap01Provider('uazapi', { meta: true, uaz: true })).toBe('uazapi')
    expect(pickFap01Provider('meta', { meta: true, uaz: true })).toBe('meta')
  })
  it('fonte indisponível: cai pro outro', () => {
    expect(pickFap01Provider('uazapi', { meta: true, uaz: false })).toBe('meta')
    expect(pickFap01Provider('meta', { meta: false, uaz: true })).toBe('uazapi')
  })
  it('nenhuma disponível: null', () => {
    expect(pickFap01Provider('meta', { meta: false, uaz: false })).toBe(null)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/sdr/fap01-source.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `fap01-source.ts`**

```ts
// src/lib/sdr/fap01-source.ts
/** Escolhe o canal do 1º contato FAP01 a partir da origem principal,
 *  caindo pro outro canal se a escolhida estiver indisponível. */
import type { Provider } from './send-plan'

export function pickFap01Provider(
  source: Provider,
  avail: { meta: boolean; uaz: boolean },
): Provider | null {
  const ok = (p: Provider) => (p === 'meta' ? avail.meta : avail.uaz)
  if (ok(source)) return source
  const other: Provider = source === 'meta' ? 'uazapi' : 'meta'
  if (ok(other)) return other
  return null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/sdr/fap01-source.test.ts`
Expected: PASS.

- [ ] **Step 5: Religar `sendFirstContact` ao `fap01_source` + fallback + carimbo**

Em `touches-processor.ts`, reescrever `sendFirstContact` para: ler `sdr_config.fap01_source`, medir disponibilidade, escolher via `pickFap01Provider`, enviar pelo canal escolhido (Meta=template, UazAPI=bubbles), e **carimbar o contato** com o canal usado. Adicionar `contactId` ao `opts`.

```ts
import { pickFap01Provider } from './fap01-source'
// (mantém imports existentes: sendTemplate, sendText/ sendAndPersist, FAP01_TEMPLATES, etc.)

async function sendFirstContact(
  admin: Admin, accountId: string,
  opts: { contactId: string; conversationId: string; phone: string; name: string; agendou: boolean; eventStartIso?: string },
): Promise<void> {
  // Origem principal + disponibilidade
  const { data: cfg } = await admin
    .from('sdr_config').select('fap01_source').eq('account_id', accountId).maybeSingle()
  const source = (cfg?.fap01_source ?? 'meta') as 'meta' | 'uazapi'

  const metaAvail = await accountHasMetaConfig(admin, accountId)
  const { data: uaz } = await admin
    .from('wa_connections').select('id').eq('account_id', accountId).eq('is_active_for_crm', true).maybeSingle()
  const uazAvail = !!uaz

  const chosen = pickFap01Provider(source, { meta: metaAvail, uaz: uazAvail })
  if (!chosen) throw new Error('FAP01: nenhum canal disponível') // fica pending, retry no próximo tick

  if (chosen !== source) {
    console.warn('[sdr] FAP01 fallback de canal', { accountId, source, chosen })
  }

  if (chosen === 'meta') {
    const firstName = (opts.name || '').trim().split(/\s+/)[0] || opts.name || ''
    const templateName = opts.agendou ? FAP01_TEMPLATES.agendou : FAP01_TEMPLATES.naoAgendou
    await sendTemplate(admin, accountId, {
      phone: opts.phone, templateName, languageCode: FAP01_TEMPLATE_LANG, bodyParams: [firstName],
    })
    const text = opts.agendou ? renderAgendou(firstName) : renderNaoAgendou(firstName)
    await persistAgentMessage(admin, opts.conversationId, text, 'meta', 'template')
    await stampContactChannel(admin, opts.contactId, 'meta', null)
    return
  }

  // UazAPI: bubbles de texto livre (sem template)
  const bubbles = opts.agendou ? confirmBubbles(opts.name, opts.eventStartIso!) : chaseBubbles(opts.name)
  await sendAndPersist(admin, accountId, 'uazapi', opts.conversationId, opts.phone, bubbles)
  await stampContactChannel(admin, opts.contactId, 'uazapi', uaz!.id)
}

/** Carimba o canal de fato usado no contato, p/ IA e humano seguirem depois. */
async function stampContactChannel(
  admin: Admin, contactId: string, provider: 'meta' | 'uazapi', connectionId: string | null,
): Promise<void> {
  await admin.from('contacts')
    .update({ provider, connection_id: connectionId, updated_at: new Date().toISOString() })
    .eq('id', contactId)
}
```

Atualizar as **duas** chamadas de `sendFirstContact` em `processOne` (ramos `agendou`/`não agendou`) para passar `contactId: t.contact_id`.

- [ ] **Step 6: Fallback no erro duro do UazAPI (463)**

Em `sendFirstContact`, no ramo UazAPI, envolver o envio para cair pro Meta no mesmo tick quando o UazAPI falhar duro (ex: 463) e o Meta estiver disponível:

```ts
  // UazAPI: bubbles; se falhar duro (ex: 463) e Meta disponível, cai pro Meta no mesmo tick.
  try {
    const bubbles = opts.agendou ? confirmBubbles(opts.name, opts.eventStartIso!) : chaseBubbles(opts.name)
    await sendAndPersist(admin, accountId, 'uazapi', opts.conversationId, opts.phone, bubbles)
    await stampContactChannel(admin, opts.contactId, 'uazapi', uaz!.id)
  } catch (err) {
    if (!metaAvail) throw err
    console.warn('[sdr] FAP01 UazAPI falhou, fallback Meta no mesmo tick', { accountId }, err)
    const firstName = (opts.name || '').trim().split(/\s+/)[0] || opts.name || ''
    const templateName = opts.agendou ? FAP01_TEMPLATES.agendou : FAP01_TEMPLATES.naoAgendou
    await sendTemplate(admin, accountId, {
      phone: opts.phone, templateName, languageCode: FAP01_TEMPLATE_LANG, bodyParams: [firstName],
    })
    await persistAgentMessage(admin, opts.conversationId,
      opts.agendou ? renderAgendou(firstName) : renderNaoAgendou(firstName), 'meta', 'template')
    await stampContactChannel(admin, opts.contactId, 'meta', null)
  }
```

(Substitui o bloco UazAPI simples do Step 5.)

- [ ] **Step 7: Suíte + tipos**

Run: `npx vitest run src/lib/sdr/ && npx tsc --noEmit 2>&1 | grep touches-processor || echo "tipos OK"`
Expected: testes passam; sem erro de tipo novo.

- [ ] **Step 8: Commit**

```bash
git add src/lib/sdr/fap01-source.ts src/lib/sdr/fap01-source.test.ts src/lib/sdr/touches-processor.ts
git commit -m "feat(sdr): FAP01 respeita fap01_source + fallback de canal + carimba contato"
```

---

### Task 5: Toggle de origem principal em Configurações → Agente SDR

**Files:**
- Modify: `src/app/api/sdr/config/route.ts` (GET select + PUT patch)
- Modify: `src/components/settings/agent-panel.tsx` (estado + bloco de UI + save)

**Interfaces:**
- Consumes: `sdr_config.fap01_source` (Task 1).
- Produces: GET `/api/sdr/config` retorna `fap01_source`; PUT aceita `{ fap01_source: 'meta'|'uazapi' }`; UI salva.

- [ ] **Step 1: GET — incluir `fap01_source`**

No `route.ts` GET (~L70-90), adicionar `fap01_source` ao `.select(...)` e à resposta JSON:

```ts
// .select('system_prompt, updated_at, variables, fap01_source')
// ...
return NextResponse.json({
  // ...campos existentes...
  fap01_source: (data?.fap01_source ?? 'meta') as 'meta' | 'uazapi',
})
```

- [ ] **Step 2: PUT — aceitar `fap01_source` validado**

No PUT (~L136-161), adicionar bloco junto aos outros campos parciais:

```ts
if (body.fap01_source !== undefined) {
  if (body.fap01_source !== 'meta' && body.fap01_source !== 'uazapi') {
    return NextResponse.json({ error: "fap01_source deve ser 'meta' ou 'uazapi'" }, { status: 400 })
  }
  patch.fap01_source = body.fap01_source
}
```

- [ ] **Step 3: UI — estado + load + bloco + save em `agent-panel.tsx`**

Adicionar estado e carregar do fetch existente:

```tsx
const [fap01Source, setFap01Source] = useState<'meta' | 'uazapi'>('meta')
// no .then(data => { ... }) do fetch de /api/sdr/config:
setFap01Source((data.fap01_source ?? 'meta'))
```

Adicionar um `<TerminalWindow title="settings/agent/origem-fap01">` com um select PT-BR e um save (espelhando `handleSaveVars`):

```tsx
async function handleSaveFap01Source(next: 'meta' | 'uazapi') {
  setFap01Source(next)
  await fetch('/api/sdr/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fap01_source: next }),
  })
  toast.success('Origem do 1º contato atualizada')
}
// UI (gated por canEditSettings):
// <label>Origem do 1º contato (captação/abordagem)</label>
// <select value={fap01Source} disabled={readOnly} onChange={e => handleSaveFap01Source(e.target.value as 'meta'|'uazapi')}>
//   <option value="meta">Oficial (Meta)</option>
//   <option value="uazapi">Não Oficial (UazAPI)</option>
// </select>
```

- [ ] **Step 4: Verificar tipos + smoke manual**

Run: `npx tsc --noEmit 2>&1 | grep -E "sdr/config|agent-panel" || echo "tipos OK"`
Expected: sem erro novo. Manual: abrir Configurações → Agente SDR, trocar a origem, recarregar → persistiu (`select fap01_source from sdr_config`).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sdr/config/route.ts src/components/settings/agent-panel.tsx
git commit -m "feat(settings): toggle da origem principal do FAP01 (fap01_source)"
```

---

### Task 6: Switcher de origem no header + badge (lista + header)

**Files:**
- Modify: `src/components/inbox/message-thread.tsx` (header ~L928-945 badge; ~L1038-1060 cluster de ações → dropdown; fetch de `wa_connections`)
- Modify: `src/components/inbox/conversation-list.tsx` (`ConversationItem` ~L301-326 badge; `ConversationList` fetch de connections + prop)
- Reuse: `src/lib/whatsapp/channel-options.ts` (`buildChannelOptions`, `currentChannelId`, `ChannelOption`), padrão de escrita de `contact-sidebar.tsx:151-176`

**Interfaces:**
- Consumes: `contact.provider`/`connection_id` (já nos dados), `channel-options.ts`.
- Produces: badge de origem em lista + header; dropdown no header que grava `contacts.provider`/`connection_id` (mesmo padrão direto-Supabase do sidebar).

- [ ] **Step 1: Helper de rótulo curto reutilizável (teste primeiro)**

Adicionar um rótulo de badge a `channel-options.ts` e testar:

```ts
// src/lib/whatsapp/channel-options.test.ts
import { describe, it, expect } from 'vitest'
import { channelBadgeLabel } from './channel-options'

describe('channelBadgeLabel', () => {
  it('meta = Oficial', () => {
    expect(channelBadgeLabel({ provider: 'meta', connection_id: null }, [])).toBe('Oficial')
  })
  it('uazapi usa label da conexão', () => {
    expect(channelBadgeLabel(
      { provider: 'uazapi', connection_id: 'c1' },
      [{ id: 'c1', label: 'Ian', is_active_for_crm: true }],
    )).toBe('Ian')
  })
  it('uazapi sem label conhecido = Não Oficial', () => {
    expect(channelBadgeLabel({ provider: 'uazapi', connection_id: 'x' }, [])).toBe('Não Oficial')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/channel-options.test.ts`
Expected: FAIL (`channelBadgeLabel` não existe).

- [ ] **Step 3: Implementar `channelBadgeLabel` em `channel-options.ts`**

```ts
export function channelBadgeLabel(
  contact: { provider?: 'meta' | 'uazapi' | null; connection_id?: string | null },
  connections: Array<{ id: string; label: string; is_active_for_crm?: boolean }>,
): string {
  if (contact.provider !== 'uazapi') return 'Oficial'
  const conn = connections.find((c) => c.id === contact.connection_id)
  return conn?.label ?? 'Não Oficial'
}
```

Run: `npx vitest run src/lib/whatsapp/channel-options.test.ts` → PASS.

- [ ] **Step 4: Badge na lista (`conversation-list.tsx`)**

Em `ConversationList`, buscar `wa_connections` uma vez (espelhar `contact-sidebar.tsx:120-124`: `select('id, label, is_active_for_crm').eq('account_id', accountId)`) e passar `connections` como prop a `ConversationItem`. No `ConversationItem`, na meta-row (~L312), renderizar:

```tsx
{contact?.provider && (
  <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
    {channelBadgeLabel(contact, connections)}
  </span>
)}
```

- [ ] **Step 5: Badge + dropdown no header (`message-thread.tsx`)**

Buscar `wa_connections` no componente (espelhar `contact-sidebar.tsx:109-139`). Adicionar o badge perto do nome (~L934) com `channelBadgeLabel(contact, connections)`. Adicionar um `DropdownMenu` no cluster de ações (~L1038), com opções de `buildChannelOptions({ metaConfigured: hasMetaConfig, connections })`, selecionado via `currentChannelId(contact, options, connections)`, e o handler escrevendo direto (igual `contact-sidebar.tsx:158-166`):

```tsx
async function handleChannelChange(opt: ChannelOption) {
  await supabase.from('contacts')
    .update({ provider: opt.provider, connection_id: opt.connectionId, updated_at: new Date().toISOString() })
    .eq('id', contact.id)
  // realtime/refresh do inbox reflete; badge re-renderiza
}
```

- [ ] **Step 6: Verificar tipos + manual**

Run: `npx tsc --noEmit 2>&1 | grep -E "conversation-list|message-thread|channel-options" || echo "tipos OK"`
Expected: sem erro novo. Manual: abrir uma conversa → badge aparece na lista e no header; trocar origem no header → badge muda nos dois lugares; `select provider, connection_id from contacts where id=...` confirma.

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp/channel-options.ts src/lib/whatsapp/channel-options.test.ts src/components/inbox/conversation-list.tsx src/components/inbox/message-thread.tsx
git commit -m "feat(inbox): badge de origem (lista+header) + switcher de canal no header"
```

---

### Task 7: Gate de janela no composer humano (`send/route.ts` + UI)

**Files:**
- Modify: `src/app/api/whatsapp/send/route.ts` (validação server-side da janela no caminho Meta)
- Modify: `src/components/inbox/message-thread.tsx` (composer conhece `mode` e força template)

**Interfaces:**
- Consumes: `resolveSendPlan` (Task 2), `conversations.last_inbound_at`.
- Produces: envio de texto livre no Meta fora da janela → 400; UI força o picker de template nesse estado.

- [ ] **Step 1: Validação server-side no `send/route.ts`**

No caminho Meta (após resolver `conversation` + `contact`, antes do `attempt`), bloquear texto livre fora da janela. A conversa já é buscada (`select('*, contact:contacts(*)')`) — incluir `last_inbound_at` está no `*`. Adicionar:

```ts
import { isWindowOpen } from '@/lib/sdr/send-plan'
// ... no caminho Meta (não-UazAPI), quando message_type !== 'template':
if (message_type !== 'template' &&
    !isWindowOpen('meta', conversation.last_inbound_at ?? null, Date.now())) {
  return NextResponse.json(
    { error: 'Janela de 24h fechada — no canal oficial use um template aprovado.', code: 'template_required' },
    { status: 400 },
  )
}
```

(UazAPI não passa por aqui; segue texto livre.)

- [ ] **Step 2: UI conhece `mode` e força template**

Em `message-thread.tsx`, computar o estado da janela no cliente a partir de `contact.provider` + `conversation.last_inbound_at` (reusar `isWindowOpen`). Quando `provider==='meta' && !windowOpen`: desabilitar o input de texto livre e abrir/forçar o seletor de template (o caminho de template já existe no composer):

```tsx
import { isWindowOpen } from '@/lib/sdr/send-plan'
const metaWindowClosed =
  contact?.provider !== 'uazapi' && !isWindowOpen('meta', conversation.last_inbound_at ?? null, Date.now())
// quando metaWindowClosed: textarea disabled + aviso "Janela fechada — escolha um template" + abre o template picker
```

- [ ] **Step 3: Verificar tipos + manual (teste do bug → ok)**

Run: `npx tsc --noEmit 2>&1 | grep -E "whatsapp/send|message-thread" || echo "tipos OK"`
Manual: semear janela fechada num contato Meta:
```bash
psql "$SUPABASE_NS_DB_URL" -c "update conversations set last_inbound_at = now() - interval '25 hours' where id='<conv>';"
```
→ no inbox, texto livre desabilitado + picker forçado; tentar POST de texto livre direto → 400 `template_required`. Depois `last_inbound_at = now()` → texto livre volta.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/whatsapp/send/route.ts src/components/inbox/message-thread.tsx
git commit -m "feat(inbox): gate de janela 24h no composer humano (Meta fora da janela = template)"
```

---

### Task 8: Gate de janela na resposta da IA (`processor.ts`)

**Files:**
- Modify: `src/lib/sdr/processor.ts:295-321` (bloco compose-and-send do `runSdrReply`)

**Interfaces:**
- Consumes: `resolveSendPlan` (Task 2). A IA precisa do `conversation.last_inbound_at` no escopo (buscar se ainda não tiver).
- Produces: IA não manda texto livre quando `mode==='template_required'` (loga e sai).

- [ ] **Step 1: Trocar `resolveReplyProvider` por `resolveSendPlan` no loop da IA**

Substituir (`processor.ts:305`):

```ts
// antes: const provider = await resolveReplyProvider(admin, accountId, { provider: contact.provider })
const { data: conv } = await admin
  .from('conversations').select('last_inbound_at').eq('id', conversationId).maybeSingle()
const plan = await resolveSendPlan(admin, accountId,
  { provider: contact.provider, connection_id: contact.connection_id }, conv ?? {})

if (plan.mode === 'template_required') {
  // Janela Meta fechada: a IA não pode mandar texto livre. Em geral não acontece
  // (a IA responde logo após o lead escrever). Loga e não envia.
  console.warn('[sdr] resposta da IA bloqueada: janela Meta fechada', { accountId, conversationId })
  return
}
const provider = plan.provider
// loop existente: sendText(admin, accountId, { provider, phone: contact.phone, connectionId: plan.connectionId }, bubbles[i])
```

Ajustar o import: `import { sendText, setAccountPresence } from './send'` + `import { resolveSendPlan } from './send-plan'` (remover `resolveReplyProvider` se ficar sem uso aqui).

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit 2>&1 | grep processor || echo "tipos OK"`
Expected: sem erro novo.

- [ ] **Step 3: Verificação (smoke)**

Conversa Meta com janela aberta (`last_inbound_at=now()`) → IA responde em texto (comportamento atual). Com `last_inbound_at` >24h → IA não envia, loga o warn. UazAPI → sempre responde em texto.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sdr/processor.ts
git commit -m "feat(sdr): resposta da IA usa resolveSendPlan (não manda livre fora da janela Meta)"
```

---

### Task 9: Toques automatizados — origem atual + template map + rede de segurança

**Files:**
- Modify: `src/lib/sdr/touches-processor.ts` (`processOne` reminders ~L238-253; `sendAndPersist`)
- Create: `src/lib/sdr/touch-templates.ts` (mapa `touch_type → template`)
- Test: `src/lib/sdr/touch-templates.test.ts`

**Interfaces:**
- Consumes: `resolveSendPlan` (Task 2), `SdrTouchRow`/`SdrTouchType` (touches.ts).
- Produces:
  - `const TOUCH_TEMPLATES: Partial<Record<SdrTouchType, { name: string; lang: string }>>` (hoje vazio p/ reminders — sem template aprovado ainda)
  - `function templateForTouch(type: SdrTouchType): { name: string; lang: string } | null`
  - reminders roteiam pela origem atual; Meta fora da janela sem template → **adia (deixa pending) + alerta**.

- [ ] **Step 1: Teste do mapa de template (falha)**

```ts
// src/lib/sdr/touch-templates.test.ts
import { describe, it, expect } from 'vitest'
import { templateForTouch } from './touch-templates'

describe('templateForTouch', () => {
  it('reminders ainda não têm template aprovado → null (rede de segurança)', () => {
    expect(templateForTouch('reminder_24h')).toBe(null)
    expect(templateForTouch('reminder_2h')).toBe(null)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/sdr/touch-templates.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `touch-templates.ts`**

```ts
// src/lib/sdr/touch-templates.ts
/** Mapa toque → template Meta aprovado. Vazio p/ reminders até a copy ser
 *  escrita e aprovada na Meta (follow-up). Sem entrada = rede de segurança
 *  (adia o toque fora da janela em vez de mandar texto livre rejeitado). */
import type { SdrTouchType } from './touches'

export const TOUCH_TEMPLATES: Partial<Record<SdrTouchType, { name: string; lang: string }>> = {
  // reminder_24h: { name: 'lembrete_24h', lang: 'pt_BR' },  // quando aprovado
  // reminder_2h:  { name: 'lembrete_2h',  lang: 'pt_BR' },  // quando aprovado
}

export function templateForTouch(type: SdrTouchType): { name: string; lang: string } | null {
  return TOUCH_TEMPLATES[type] ?? null
}
```

Run: `npx vitest run src/lib/sdr/touch-templates.test.ts` → PASS.

- [ ] **Step 4: Reminders roteiam pela origem atual + rede de segurança**

No `processOne`, no ramo de reminders (~L238-253), trocar o `provider = await resolveAccountProvider(...)` (L161) por `resolveSendPlan` lendo a conversa, e tratar `template_required`:

```ts
import { resolveSendPlan } from './send-plan'
import { templateForTouch } from './touch-templates'
// ... no ramo reminder, após confirmar que o evento ainda existe:
const { data: contactRow } = await admin
  .from('contacts').select('provider, connection_id').eq('id', t.contact_id).maybeSingle()
const { data: convRow } = await admin
  .from('conversations').select('last_inbound_at').eq('id', t.conversation_id).maybeSingle()
const plan = await resolveSendPlan(admin, accountId, contactRow ?? {}, convRow ?? {})

if (plan.mode === 'template_required') {
  const tpl = templateForTouch(t.type)
  if (!tpl) {
    // Rede de segurança: sem template aprovado → adia (deixa pending) + alerta.
    console.warn('[sdr] toque adiado: janela Meta fechada e sem template', { id: t.id, type: t.type })
    return 'deferred_no_template' // NÃO resolve o toque → retry natural no próximo tick
  }
  await sendTemplate(admin, accountId, {
    phone: t.phone, templateName: tpl.name, languageCode: tpl.lang, bodyParams: [name],
  })
  await persistAgentMessage(admin, t.conversation_id, `[${t.type}]`, 'meta', 'template')
  await resolveTouch(admin, t.id, 'done', 'sent_template')
  return 'sent_template'
}

// Janela aberta / UazAPI: bubbles de texto livre, pelo canal atual.
const bubbles = t.type === 'reminder_24h'
  ? reminder24hBubbles(name, t.event_start_iso!)
  : reminder2hBubbles(name, t.event_start_iso!, t.meet_link ?? '')
await resolveTouch(admin, t.id, 'done', 'sent')
await sendAndPersist(admin, accountId, plan.provider, t.conversation_id, t.phone, bubbles)
return 'sent'
```

(Remove o uso do `provider` global da L161 no ramo de reminders.)

- [ ] **Step 5: Suíte + tipos**

Run: `npx vitest run src/lib/sdr/ && npx tsc --noEmit 2>&1 | grep touches-processor || echo "tipos OK"`
Expected: testes passam; sem erro novo.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sdr/touch-templates.ts src/lib/sdr/touch-templates.test.ts src/lib/sdr/touches-processor.ts
git commit -m "feat(sdr): toques seguem origem atual + template map + rede de segurança (adia s/ template)"
```

---

### Task 10: Features por canal no composer

**Files:**
- Modify: `src/components/inbox/message-thread.tsx` (composer: botões de template/mídia condicionais à origem)

**Interfaces:**
- Consumes: `contact.provider`, estado de janela (Task 7).
- Produces: UazAPI → só texto (template/mídia ocultos); Meta → template/mídia disponíveis; Meta janela fechada → picker forçado (Task 7).

- [ ] **Step 1: Esconder template/mídia quando UazAPI**

No composer, derivar `isUazapi = contact?.provider === 'uazapi'` e condicionar os botões de **template** e **mídia/anexo** a `!isUazapi` (esconder, não só desabilitar — o `send/route.ts` já rejeita template/mídia por UazAPI, mas a UI não deve oferecer):

```tsx
const isUazapi = contact?.provider === 'uazapi'
// {!isUazapi && <TemplateButton .../>}
// {!isUazapi && <MediaAttachButton .../>}
```

- [ ] **Step 2: Coerência com o gate (Task 7)**

Garantir que `metaWindowClosed` (Task 7) só vale quando `!isUazapi`. UazAPI: texto sempre livre, sem picker.

- [ ] **Step 3: Verificar tipos + manual**

Run: `npx tsc --noEmit 2>&1 | grep message-thread || echo "tipos OK"`
Manual: conversa UazAPI → sem botão de template/mídia, só texto. Conversa Meta janela aberta → template+mídia presentes. Meta janela fechada → texto desabilitado + picker (Task 7).

- [ ] **Step 4: Commit**

```bash
git add src/components/inbox/message-thread.tsx
git commit -m "feat(inbox): composer mostra features por canal (UazAPI só texto)"
```

---

### Task 11: Fix dos bubbles que não aparecem no thread

**Files:**
- Investigate: `src/components/inbox/message-thread.tsx` (fetch L311 + realtime L381), RLS de `messages`, inserts server-side (`send.ts`/`touches-processor.ts`/webhook)
- Modify: o que o diagnóstico apontar

> **SUB-SKILL obrigatória:** `superpowers:systematic-debugging`. Não chutar o fix — reproduzir primeiro.

**Interfaces:**
- Produces: toda mensagem (humano, IA, toque, inbound) aparece como bubble no thread — ao vivo e no refresh — nos 2 canais.

- [ ] **Step 1: Reproduzir o bug (escrever a observação que falha)**

Numa conversa real, disparar um envio server-side (toque/IA) e um inbound, e checar:
```bash
psql "$SUPABASE_NS_DB_URL" -c "select id, sender_type, content_type, provider, created_at from messages where conversation_id='<conv>' order by created_at desc limit 10;"
```
Comparar com o que o thread mostra na tela. Anotar: a mensagem está no banco mas não na tela? (→ fetch/RLS/realtime) Ou nem no banco? (→ insert/linkagem).

- [ ] **Step 2: Hipótese 1 — RLS bloqueia a subscription realtime**

O fetch inicial (`message-thread.tsx:311`, client do usuário) e o realtime (`:381`) usam o client do usuário (RLS). Inserts server-side usam service-role. Se a mensagem aparece no **refresh** mas não **ao vivo** → realtime/Publication. Conferir se `messages` está na publication `supabase_realtime` e se a policy de SELECT cobre o usuário:
```bash
psql "$SUPABASE_NS_DB_URL" -c "select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='messages';"
```

- [ ] **Step 3: Hipótese 2 — não aparece nem no refresh**

Se nem no refresh → ou o `conversation_id` do insert não bate com a conversa aberta (linkagem), ou a policy de SELECT de `messages` exclui o usuário pra mensagens server-side. Conferir a policy:
```bash
psql "$SUPABASE_NS_DB_URL" -c "select polname, qual from pg_policies where tablename='messages';"
```

- [ ] **Step 4: Aplicar o fix mínimo que o diagnóstico indicar**

Exemplos possíveis (escolher o que o diagnóstico provar — não aplicar às cegas):
- realtime: adicionar `messages` à publication (migration) e/ou ajustar a subscription;
- RLS: corrigir a policy de SELECT pra cobrir membros da conta;
- linkagem: corrigir o `conversation_id` no insert do ponto culpado.

Documentar a causa-raiz no commit.

- [ ] **Step 5: Verificar (a observação do Step 1 agora passa)**

Repetir o Step 1: a mensagem enviada/recebida aparece no thread **ao vivo e no refresh**, nos 2 canais (Meta e UazAPI).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(inbox): bubbles aparecem no thread (causa-raiz: <preencher>)"
```

---

## Self-Review (preenchido)

**Cobertura do spec:**
- Cap 1 (origem principal + fallback) → Task 1 (coluna), Task 4 (lógica+fallback+463), Task 5 (UI). ✓
- Cap 2 (troca por conversa + badge) → Task 6 (badge lista+header, switcher header, reuso channel-options). ✓ (rota PATCH dispensada — ver Desvios.)
- Cap 3 (gate 24h) → Task 2 (resolveSendPlan), Task 3 (last_inbound_at), Task 7 (humano), Task 8 (IA), Task 9 (toques). ✓
- Cap 4 (follow-ups origem atual + 24h/pós-24h) → Task 9 (origem atual + template map + rede de segurança). ✓
- Cap 5 (bubbles) → Task 11. ✓
- Cap 6 (features por canal) → Task 10. ✓

**Placeholders:** o único `<preencher>` é a causa-raiz do Task 11 (descoberta só no debug) e os templates comentados no Task 9 (dependência nomeada de follow-up — copy+aprovação Meta). Ambos intencionais.

**Consistência de tipos:** `Provider='meta'|'uazapi'` e `SendMode` definidos no Task 2 e reusados em 4/7/8/9. `SdrTouchType` vem de `touches.ts`. `channelBadgeLabel`/`buildChannelOptions`/`currentChannelId` de `channel-options.ts`. `resolveSendPlan(admin, accountId, contact, conversation)` com a mesma assinatura em todos os consumidores.

## Dependência de follow-up (fora deste plano)

Escrever a copy e submeter à Meta os templates `lembrete_24h`, `lembrete_2h` (e FU1), depois descomentar `TOUCH_TEMPLATES` no `touch-templates.ts`. Até lá, a rede de segurança (Task 9) adia esses toques no Meta fora da janela.

## Deploy (após todas as tasks + `npm test` verde)

`rsync → srv1571722.hstgr.cloud:/opt/wacrm` + `docker compose build/up` (SSH IPv4 ok, sem WARP). Migration 034 já aplicada no banco vivo (Task 1).
