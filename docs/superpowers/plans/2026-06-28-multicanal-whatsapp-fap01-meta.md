# Multi-canal WhatsApp (Meta + UazAPI) · 1º contato FAP01 pela Meta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o wacrm receber Meta e UazAPI ao mesmo tempo e abordar o lead novo do FAP01 pela Meta via template aprovado (1 de 2, conforme já agendou ou não), com a IA assumindo quando o lead responde.

**Architecture:** O webhook passa a detectar o provider **por requisição** (assinatura Meta vs `?token=` UazAPI) em vez da env global `WA_PROVIDER`. O `first_touch` do SDR (que já checa o Calendly e bifurca agendou/não) passa a **enviar template Meta** quando a conta tem config Meta, mantendo todo o resto da orquestração (move de etapa, appointment, reminders, tag FU1). Sem Meta config, cai no comportamento atual (bubbles via UazAPI).

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Supabase (service-role admin client) · vitest · WhatsApp Cloud API (Meta) + UazAPI.

## Global Constraints

- **Testes:** `npm test` (vitest run). Rodar um arquivo: `npx vitest run <path>`.
- **Copy de produção em PT-BR correto** (com acentos) — os textos dos templates são literais de produção; nunca trocar acento por ASCII.
- **Banco NS compartilhado** (Supabase `sglsw…`): nenhuma migration nova neste plano. Se algo exigir DDL, auditar colunas contra o banco real antes (`learning_create_table_if_not_exists_colisao_banco_compartilhado`).
- **Worktree:** trabalhar em `~/Projects/_wacrm-worktrees/multicanal-whatsapp` (branch `feat/multicanal-whatsapp`). Nunca commitar em `main`.
- **Deploy (só após aprovação do Arthur):** `rsync → srv1571722.hstgr.cloud:/opt/wacrm` + `docker compose up -d --build wacrm`. SSH por IPv4 já funciona (sem WARP).
- **Nomes dos templates Meta** usados no código DEVEM bater com os aprovados na Meta: `fap01_1contato_agendou` e `fap01_1contato_nao_agendou`, idioma `pt_BR`.
- **WA_PROVIDER** deixa de ser gate de roteamento; pode permanecer na env sem efeito sobre a detecção.

## File Structure

- **Modify** `src/lib/whatsapp/webhook-signature.ts` — `verifyWebhookAuth` detecta provider por requisição (assinatura vs token), retorna `{ ok, provider?, reason? }`.
- **Modify** `src/app/api/whatsapp/webhook/route.ts` (POST ~167-214) — rotear auth + normalização pela detecção por requisição, não por `WA_PROVIDER`.
- **Create** `src/lib/sdr/meta-templates.ts` — nomes dos templates, idioma, e funções que renderizam o texto exato (fonte única da copy).
- **Modify** `src/lib/sdr/send.ts` — novo `sendTemplate()` (envia template Meta via `whatsapp_config`).
- **Modify** `src/lib/sdr/touches-processor.ts` — `first_touch` envia template Meta quando há config Meta; fallback bubbles quando não há. Helper `sendFirstContact()`.
- **Modify** `src/app/api/webhooks/fap01/route.ts` — `FIRST_TOUCH_DELAY_MS` = 3 min.
- **Tests:** `src/lib/whatsapp/webhook-signature.test.ts` (novo), `src/lib/sdr/send.test.ts` (novo ou estendido), `src/lib/sdr/touches-processor.test.ts` (estender).
- **External (Arthur):** criar e aprovar os 2 templates na Meta (Task 5).

---

### Task 1: Webhook detecta provider por requisição

**Files:**
- Modify: `src/lib/whatsapp/webhook-signature.ts:58-87` (`verifyWebhookAuth`)
- Modify: `src/app/api/whatsapp/webhook/route.ts:167-214` (POST handler)
- Test: `src/lib/whatsapp/webhook-signature.test.ts` (create)

**Interfaces:**
- Produces: `verifyWebhookAuth(rawBody: string, signatureHeader: string|null, queryToken: string|null): { ok: boolean; provider?: 'meta'|'uazapi'; reason?: string }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/whatsapp/webhook-signature.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { verifyWebhookAuth } from './webhook-signature'

const SECRET = 'test_app_secret'
const sign = (body: string) =>
  'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex')

beforeEach(() => {
  process.env.META_APP_SECRET = SECRET
  process.env.UAZAPI_WEBHOOK_TOKEN = 'uaz_tok'
  delete process.env.WA_PROVIDER // detection must not depend on it
})

describe('verifyWebhookAuth (per-request detection)', () => {
  it('accepts a valid Meta signature regardless of WA_PROVIDER', () => {
    process.env.WA_PROVIDER = 'uazapi' // the bug we are fixing
    const body = '{"x":1}'
    const r = verifyWebhookAuth(body, sign(body), null)
    expect(r).toEqual({ ok: true, provider: 'meta' })
  })

  it('rejects a bad Meta signature', () => {
    const r = verifyWebhookAuth('{"x":1}', 'sha256=deadbeef', null)
    expect(r.ok).toBe(false)
  })

  it('accepts a matching UazAPI token when there is no signature header', () => {
    const r = verifyWebhookAuth('{}', null, 'uaz_tok')
    expect(r).toEqual({ ok: true, provider: 'uazapi' })
  })

  it('rejects when neither credential is present', () => {
    const r = verifyWebhookAuth('{}', null, null)
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/whatsapp/webhook-signature.test.ts`
Expected: FAIL (current `verifyWebhookAuth` branches on `WA_PROVIDER`, so the first test returns the uazapi path and the return has no `provider` field).

- [ ] **Step 3: Rewrite `verifyWebhookAuth` to detect per request**

```ts
// src/lib/whatsapp/webhook-signature.ts — replace verifyWebhookAuth (keep verifyMetaWebhookSignature as-is)
/**
 * Per-request webhook auth. Meta POSTs carry an `x-hub-signature-256`
 * header; UazAPI POSTs carry a `?token=` query param. We pick the
 * provider from what's present on THIS request, so both channels can
 * hit the same endpoint at once (no global WA_PROVIDER gate).
 */
export function verifyWebhookAuth(
  rawBody: string,
  signatureHeader: string | null,
  queryToken: string | null,
): { ok: boolean; provider?: 'meta' | 'uazapi'; reason?: string } {
  if (signatureHeader) {
    return verifyMetaWebhookSignature(rawBody, signatureHeader)
      ? { ok: true, provider: 'meta' }
      : { ok: false, reason: 'meta_hmac_failed' }
  }
  if (queryToken) {
    const expected = process.env.UAZAPI_WEBHOOK_TOKEN
    if (!expected) return { ok: false, reason: 'uazapi_token_not_configured' }
    return queryToken === expected
      ? { ok: true, provider: 'uazapi' }
      : { ok: false, reason: 'uazapi_token_mismatch' }
  }
  return { ok: false, reason: 'no_credentials' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/whatsapp/webhook-signature.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the route to per-request detection**

In `src/app/api/whatsapp/webhook/route.ts` POST handler, replace the WA_PROVIDER-gated blocks. The detection: a request is UazAPI when it carries `?token=` (and no Meta signature).

```ts
// route.ts — inside POST(), after reading rawBody/signature/queryToken
const isUazapi = !signature && !!queryToken

// UazAPI multi-tenant routing by per-connection token (when applicable).
let uazapiRoute: UazapiRoute | null = null
if (isUazapi) {
  uazapiRoute = await resolveUazapiRoute(supabaseAdmin(), queryToken)
}
if (!uazapiRoute) {
  const auth = verifyWebhookAuth(rawBody, signature, queryToken)
  if (!auth.ok) {
    console.warn('[webhook] rejected request — auth failed:', auth.reason)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
```

And the normalization block (was `if (process.env.WA_PROVIDER === 'uazapi')`):

```ts
// Only UazAPI payloads need shape-normalization; Meta payloads pass through.
if (uazapiRoute || isUazapi) {
  const normalized = normalizeUazAPIPayload(body)
  if (!normalized) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }
  body = { entry: normalized.entry }
}
```

- [ ] **Step 6: Typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS (no type errors; existing suite green).

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp/webhook-signature.ts src/lib/whatsapp/webhook-signature.test.ts src/app/api/whatsapp/webhook/route.ts
git commit -m "feat(webhook): detectar provider Meta/UazAPI por requisição (aceita os 2 juntos)"
```

---

### Task 2: Templates Meta (copy + helper de envio)

**Files:**
- Create: `src/lib/sdr/meta-templates.ts`
- Modify: `src/lib/sdr/send.ts` (add `sendTemplate`)
- Test: `src/lib/sdr/send.test.ts` (create)

**Interfaces:**
- Produces: `FAP01_TEMPLATES = { agendou, naoAgendou }`, `FAP01_TEMPLATE_LANG = 'pt_BR'`, `renderAgendou(firstName): string`, `renderNaoAgendou(firstName): string`
- Produces: `sendTemplate(admin, accountId, opts: { phone: string; templateName: string; languageCode: string; bodyParams: string[] }): Promise<{ messageId: string | null }>`

- [ ] **Step 1: Create the templates module (copy = fonte única)**

```ts
// src/lib/sdr/meta-templates.ts
/**
 * Templates Meta aprovados do 1º contato FAP01. Os NOMES têm que bater
 * com os templates aprovados no painel da Meta. As funções render*
 * reproduzem o texto exato (variável {{1}} = primeiro nome) para
 * persistir no inbox o que de fato foi enviado.
 */
export const FAP01_TEMPLATES = {
  agendou: 'fap01_1contato_agendou',
  naoAgendou: 'fap01_1contato_nao_agendou',
} as const

export const FAP01_TEMPLATE_LANG = 'pt_BR'

export function renderNaoAgendou(firstName: string): string {
  return (
    `Oi, ${firstName}! Aqui é o Ian, da Negócio Simples. Recebi o seu cadastro e queria te parabenizar pela tomada de decisão.\n\n` +
    `Antes de agendarmos a reunião com Arthur, queria alinhar 2 perguntas com você, pode ser?`
  )
}

export function renderAgendou(firstName: string): string {
  return (
    `Oi, ${firstName}! Aqui é o Ian, da Negócio Simples. Parabéns pela decisão de transformar o seu negócio com automação e IA.\n\n` +
    `Vi que você agendou um diagnóstico com Arthur, posso confirmar 2 informações com você?`
  )
}
```

- [ ] **Step 2: Write the failing test for `sendTemplate`**

```ts
// src/lib/sdr/send.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendTemplateMessage = vi.fn(async () => ({ messageId: 'tpl-1' }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'm1' })),
  sendTemplateMessage,
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => `dec(${s})` }))
vi.mock('@/lib/whatsapp/uazapi-send', () => ({
  sendUazapiText: vi.fn(), sendUazapiComposing: vi.fn(), setUazapiPresence: vi.fn(),
}))

import { sendTemplate } from './send'

function adminWithMeta() {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({
        data: { phone_number_id: 'PNID', access_token: 'enc_tok' },
      }) }) }),
    }),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('sendTemplate', () => {
  it('envia template Meta com phone_number_id, token decifrado e params do body', async () => {
    const r = await sendTemplate(adminWithMeta(), 'acc-1', {
      phone: '5531999999999',
      templateName: 'fap01_1contato_nao_agendou',
      languageCode: 'pt_BR',
      bodyParams: ['João'],
    })
    expect(r.messageId).toBe('tpl-1')
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'PNID',
        accessToken: 'dec(enc_tok)',
        templateName: 'fap01_1contato_nao_agendou',
        language: 'pt_BR',
        params: ['João'],
      }),
    )
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/sdr/send.test.ts`
Expected: FAIL ("sendTemplate is not a function").

- [ ] **Step 4: Implement `sendTemplate` in send.ts**

```ts
// src/lib/sdr/send.ts — add import + function
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'

/**
 * Send a pre-approved Meta template (required outside the 24h window /
 * for first contact). Uses the account's whatsapp_config. Body variables
 * go in bodyParams (the {{1}}, {{2}}… of the template).
 */
export async function sendTemplate(
  admin: Admin,
  accountId: string,
  opts: { phone: string; templateName: string; languageCode: string; bodyParams: string[] },
): Promise<{ messageId: string | null }> {
  const number = sanitizePhoneForMeta(opts.phone)
  const { data: config } = await admin
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (!config) throw new Error('no whatsapp_config for account')
  const result = await sendTemplateMessage({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    to: number,
    templateName: opts.templateName,
    language: opts.languageCode,
    params: opts.bodyParams,
  })
  return { messageId: result.messageId }
}
```

(Update the existing `import { sendTextMessage } from '@/lib/whatsapp/meta-api'` line to also import `sendTemplateMessage`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/sdr/send.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sdr/meta-templates.ts src/lib/sdr/send.ts src/lib/sdr/send.test.ts
git commit -m "feat(sdr): templates Meta do 1º contato FAP01 + helper sendTemplate"
```

---

### Task 3: `first_touch` envia template Meta (fallback bubbles)

**Files:**
- Modify: `src/lib/sdr/touches-processor.ts:106-202` (`processOne`, first_touch branch) + add helpers
- Test: `src/lib/sdr/touches-processor.test.ts` (extend)

**Interfaces:**
- Consumes: `sendTemplate` (Task 2), `FAP01_TEMPLATES`, `FAP01_TEMPLATE_LANG`, `renderAgendou`, `renderNaoAgendou` (Task 2), existing `confirmBubbles`/`chaseBubbles`, `resolveAccountProvider`, `sendAndPersist`.
- Produces: `sendFirstContact(admin, accountId, opts: { conversationId, phone, name, agendou, eventStartIso? }): Promise<void>`

- [ ] **Step 1: Write failing tests (Meta path + fallback)**

Extend `touches-processor.test.ts`. First, teach the admin double about `whatsapp_config` and add `sendTemplate` to the `./send` mock:

```ts
// In the vi.mock('./send', …) object, add:
sendTemplate: vi.fn(async () => ({ messageId: 'tpl-1' })),

// Extend makeAdmin to optionally report a Meta config:
function makeAdmin(opts: { aiStatus?: string; name?: string; metaConfig?: boolean } = {}) {
  const inserts: Array<{ table: string; row: unknown }> = []
  const admin = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'conversations') return { data: { ai_status: opts.aiStatus ?? 'on' } }
            if (table === 'contacts') return { data: { name: opts.name ?? 'João Silva' } }
            if (table === 'accounts') return { data: { owner_user_id: 'u1' } }
            return { data: null }
          },
          single: async () => {
            if (table === 'whatsapp_config') {
              return opts.metaConfig
                ? { data: { phone_number_id: 'PNID', access_token: 'enc' } }
                : { data: null }
            }
            return { data: null }
          },
          limit: () => ({ maybeSingle: async () => {
            if (table === 'whatsapp_config') return { data: opts.metaConfig ? { account_id: 'acc-1' } : null }
            if (table === 'wa_connections') return { data: null }
            return { data: null }
          } }),
        }),
      }),
      insert: async (row: unknown) => { inserts.push({ table, row }); return { error: null } },
      update: () => ({ eq: async () => ({ error: null }) }),
      upsert: async () => ({ error: null }),
    }),
    inserts,
  }
  return admin
}
```

```ts
it('first_touch sem evento + conta Meta → template não_agendou (não usa bubbles)', async () => {
  touches.listDueTouches.mockResolvedValue([makeTouch()])
  calendarFind.mockResolvedValue({ events: [] })
  const admin = makeAdmin({ metaConfig: true, name: 'João Silva' })

  await processDueTouches(admin, ACCOUNT)

  expect(send.sendTemplate).toHaveBeenCalledWith(admin, ACCOUNT, expect.objectContaining({
    templateName: 'fap01_1contato_nao_agendou', languageCode: 'pt_BR', bodyParams: ['João'],
  }))
  expect(send.sendText).not.toHaveBeenCalled()
  expect(touches.moveDealToStage).toHaveBeenCalledWith(admin, 'd1', 'primeiro_contato')
  expect(admin.inserts.some((i) => i.table === 'messages' && (i.row as any).provider === 'meta')).toBe(true)
})

it('first_touch com evento + conta Meta → template agendou + appointment + reminders', async () => {
  touches.listDueTouches.mockResolvedValue([makeTouch()])
  calendarFind.mockResolvedValue({ events: [{ start_iso: '2099-01-01T10:00:00-03:00', meet_link: 'https://meet/x' }] })
  const admin = makeAdmin({ metaConfig: true })

  await processDueTouches(admin, ACCOUNT)

  expect(send.sendTemplate).toHaveBeenCalledWith(admin, ACCOUNT, expect.objectContaining({
    templateName: 'fap01_1contato_agendou',
  }))
  expect(touches.moveDealToStage).toHaveBeenCalledWith(admin, 'd1', 'agendamento_realizado')
  expect(touches.scheduleReminder).toHaveBeenCalledTimes(2)
})

it('first_touch sem conta Meta → fallback bubbles (UazAPI), sem template', async () => {
  touches.listDueTouches.mockResolvedValue([makeTouch()])
  calendarFind.mockResolvedValue({ events: [] })
  const admin = makeAdmin({ metaConfig: false })

  await processDueTouches(admin, ACCOUNT)

  expect(send.sendTemplate).not.toHaveBeenCalled()
  expect(send.sendText).toHaveBeenCalled() // bubbles
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/sdr/touches-processor.test.ts`
Expected: FAIL (sendFirstContact/template path not implemented; sendTemplate never called).

- [ ] **Step 3: Add helpers + rewrite the first_touch send**

Add imports and helpers in `touches-processor.ts`:

```ts
import { sendText, sendTemplate, resolveAccountProvider, setAccountPresence } from './send'
import { confirmBubbles, chaseBubbles, reminder24hBubbles, reminder2hBubbles } from './templates'
import { FAP01_TEMPLATES, FAP01_TEMPLATE_LANG, renderAgendou, renderNaoAgendou } from './meta-templates'

/** True when the account has a Meta whatsapp_config (FAP01 channel = Meta). */
async function hasMetaConfig(admin: Admin, accountId: string): Promise<boolean> {
  const { data } = await admin
    .from('whatsapp_config').select('account_id').eq('account_id', accountId).limit(1).maybeSingle()
  return !!data
}

async function persistAgentMessage(
  admin: Admin, conversationId: string, text: string, provider: 'meta' | 'uazapi', contentType: 'text' | 'template',
): Promise<void> {
  await admin.from('messages').insert({
    conversation_id: conversationId, sender_type: 'agent',
    content_type: contentType, content_text: text, status: 'sent', provider,
  })
  await admin.from('conversations').update({
    last_message_text: text, last_message_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', conversationId)
}

/**
 * 1º contato do FAP01. Conta com Meta → template aprovado (agendou/não).
 * Sem Meta → comportamento atual: bubbles via canal ativo (UazAPI).
 */
async function sendFirstContact(
  admin: Admin, accountId: string,
  opts: { conversationId: string; phone: string; name: string; agendou: boolean; eventStartIso?: string },
): Promise<void> {
  if (await hasMetaConfig(admin, accountId)) {
    const firstName = (opts.name || '').trim().split(/\s+/)[0] || opts.name || ''
    const templateName = opts.agendou ? FAP01_TEMPLATES.agendou : FAP01_TEMPLATES.naoAgendou
    await sendTemplate(admin, accountId, {
      phone: opts.phone, templateName, languageCode: FAP01_TEMPLATE_LANG, bodyParams: [firstName],
    })
    const text = opts.agendou ? renderAgendou(firstName) : renderNaoAgendou(firstName)
    await persistAgentMessage(admin, opts.conversationId, text, 'meta', 'template')
    return
  }
  const provider = await resolveAccountProvider(admin, accountId)
  const bubbles = opts.agendou ? confirmBubbles(opts.name, opts.eventStartIso!) : chaseBubbles(opts.name)
  await sendAndPersist(admin, accountId, provider, opts.conversationId, opts.phone, bubbles)
}
```

In `processOne`, first_touch branch, replace the two `sendAndPersist(...bubbles)` calls:

```ts
// confirm (agendou) branch — replace:
//   const bubbles = confirmBubbles(name, ev.start_iso)
//   await sendAndPersist(admin, accountId, provider, t.conversation_id, t.phone, bubbles)
await sendFirstContact(admin, accountId, {
  conversationId: t.conversation_id, phone: t.phone, name, agendou: true, eventStartIso: ev.start_iso,
})

// chase (não agendou) branch — replace:
//   const bubbles = chaseBubbles(name)
//   await sendAndPersist(admin, accountId, provider, t.conversation_id, t.phone, bubbles)
await sendFirstContact(admin, accountId, {
  conversationId: t.conversation_id, phone: t.phone, name, agendou: false,
})
```

The `const provider = await resolveAccountProvider(...)` at the top of `processOne` is still used by the reminder branch (keep it). The first_touch no longer depends on it directly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/sdr/touches-processor.test.ts`
Expected: PASS (new tests green; the original UazAPI-path tests still pass because `metaConfig` defaults to false in `makeAdmin`).

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sdr/touches-processor.ts src/lib/sdr/touches-processor.test.ts
git commit -m "feat(sdr): 1º contato FAP01 via template Meta (agendou/não), fallback bubbles"
```

---

### Task 4: Delay de 3 minutos no 1º toque do FAP01

**Files:**
- Modify: `src/app/api/webhooks/fap01/route.ts` (`FIRST_TOUCH_DELAY_MS`)

- [ ] **Step 1: Localizar a constante**

Run: `grep -n "FIRST_TOUCH_DELAY_MS" src/app/api/webhooks/fap01/route.ts`
Expected: a definição `const FIRST_TOUCH_DELAY_MS = …` e o uso em `dueAt` (linha ~234).

- [ ] **Step 2: Ajustar para 3 minutos**

```ts
// Dá ~3 min pro lead agendar no Calendly antes do 1º toque; se ele
// agendar antes, expediteFirstTouch antecipa (schedule_confirmed beacon).
const FIRST_TOUCH_DELAY_MS = 3 * 60 * 1000
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/fap01/route.ts
git commit -m "feat(fap01): 1º toque 3 min após o cadastro (dá tempo de agendar)"
```

---

### Task 5: Criar e aprovar os 2 templates na Meta (Arthur — pré-requisito externo)

**Não é código.** Gate de configuração; o teste e2e e o lançamento dependem disto.

- [ ] **Step 1:** No painel da Meta → WhatsApp → Modelos de mensagem → Criar modelo, criar **`fap01_1contato_nao_agendou`** (categoria Marketing, idioma Português (BR)), corpo com 1 variável `{{1}}`:

> Oi, {{1}}! Aqui é o Ian, da Negócio Simples. Recebi o seu cadastro e queria te parabenizar pela tomada de decisão.
>
> Antes de agendarmos a reunião com Arthur, queria alinhar 2 perguntas com você, pode ser?

- [ ] **Step 2:** Criar **`fap01_1contato_agendou`** (Marketing, Português BR), corpo com `{{1}}`:

> Oi, {{1}}! Aqui é o Ian, da Negócio Simples. Parabéns pela decisão de transformar o seu negócio com automação e IA.
>
> Vi que você agendou um diagnóstico com Arthur, posso confirmar 2 informações com você?

- [ ] **Step 3:** Aguardar status **APROVADO** dos dois (chega sozinho no webhook `message_template_status_update`; dá pra conferir no painel). Os nomes têm que bater exatamente com `FAP01_TEMPLATES` (Task 2).

---

## Verificação end-to-end (após deploy, com aprovação do Arthur)

Deploy: `rsync → /opt/wacrm` + `docker compose up -d --build wacrm`.

- [ ] **Dual webhook (Meta):** mandar "oi" do WhatsApp pessoal pro número Meta → conferir no banco que entrou (`messages` com `provider='meta'`); logs **sem** `rejected — uazapi_token_missing` pro payload Meta.
- [ ] **Dual webhook (UazAPI):** numa conversa UazAPI existente, mandar mensagem → continua entrando (`provider='uazapi'`).
- [ ] **FAP01 não agendou:** submeter lead de teste e NÃO agendar → ~3 min depois sai o template `fap01_1contato_nao_agendou` pela Meta (deal em `primeiro_contato`, tag FU1) → responder → IA assume.
- [ ] **FAP01 agendou:** submeter lead e agendar no Calendly em <3 min → sai o template `fap01_1contato_agendou` (deal em `agendamento_realizado`, appointment criado, 2 reminders agendados).

## Self-review (do autor do plano)

- **Cobertura do spec:** A (webhook dual) → Task 1. B (FAP01 3min + detecção agendou) → Tasks 3+4 (a detecção Calendly já existe no processor). C (2 templates) → Tasks 2+5. D (envio respeita canal) → Task 3 (Meta quando há config; bubbles/UazAPI caso contrário). Fase 2 fora de escopo (documentado no spec).
- **Placeholders:** nenhum — todo passo tem código/comando.
- **Consistência de tipos:** `sendTemplate(admin, accountId, {phone, templateName, languageCode, bodyParams})` é o mesmo em send.ts (Task 2), no teste e em `sendFirstContact` (Task 3). `verifyWebhookAuth` retorna `{ok, provider?, reason?}` consistente entre Task 1 e o uso no route. `FAP01_TEMPLATES.agendou/naoAgendou` e `renderAgendou/renderNaoAgendou` batem entre Tasks 2 e 3.
- **Risco residual:** os nomes dos templates no código (Task 2) dependem de Arthur criar com o mesmo nome na Meta (Task 5) — destacado como gate.
