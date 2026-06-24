# FU1 — Capacidades do Motor de Automação (Fatia 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao motor de Automação do wacrm 3 capacidades genéricas que a régua de follow-up exige: mover um deal de estágio/pipeline (`move_deal`), enviar uma mensagem redigida pela IA via WhatsApp não-oficial (`send_ai`), e cancelar a sequência pendente de um contato quando ele responde (`cancel_on_reply`).

**Architecture:** Cada capacidade é um passo (ou flag) novo no motor existente (`src/lib/automations/`), seguindo o padrão dos passos atuais (`create_deal`, `close_conversation`). `send_ai` reusa o brain (`pedroFromEnv().reply`), a voz do Agente (`sdr_config.system_prompt`) e o sender provider-aware (`src/lib/sdr/send.ts`). `cancel_on_reply` é uma flag na automação + uma função de cancelamento chamada no caminho de inbound do webhook. Nada de Meta oficial nesta fatia (só UazAPI/não-oficial).

**Tech Stack:** TypeScript, Next.js (App Router), Supabase (service-role admin client), Vitest, UazAPI (envio não-oficial).

## Global Constraints

- **Canal:** apenas WhatsApp não-oficial (UazAPI). Sem template/janela Meta nesta fatia.
- **Tenancy:** todo acesso via `supabaseAdmin()` (RLS bypass) DEVE ser escopado por `account_id`. Replicar o padrão dos passos existentes em `engine.ts`.
- **Idioma de runtime/UI:** rótulos voltados ao Arthur em PT-BR (ver `STEP_META`, `TRIGGER_OPTIONS`).
- **Test runner:** `npx vitest run <arquivo>`. Mock do `./admin-client` via `vi.hoisted` + `vi.mock` (ver `engine.test.ts`).
- **Migrations:** `supabase/migrations/NNN_snake_case.sql`, próximo número após `029_contacts_fap01_data.sql` → começa em `030`. Idempotente (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
- **Sem novo migration para step_type:** `automation_steps.step_type` é TEXT sem CHECK; validação é só em código (`engine.ts` + `validate.ts`).

---

### Task 1: Passo `move_deal` — tipo + handler no motor

**Files:**
- Modify: `src/types/index.ts` (AutomationStepType ~417; novo `MoveDealStepConfig`; AutomationStepConfig ~519)
- Modify: `src/lib/automations/engine.ts` (novo `case 'move_deal'` no `runStep`, perto de `close_conversation` ~540)
- Test: `src/lib/automations/engine.test.ts` (novo bloco + branch `deals` no mock)

**Interfaces:**
- Produces: `MoveDealStepConfig { pipeline_id: string; stage_id: string }`; step_type `'move_deal'`. Move o deal aberto do contato (`status='open'`) escopado por `account_id` + `contact_id`.

- [ ] **Step 1: Escrever o teste que falha**

Em `src/lib/automations/engine.test.ts`, primeiro estenda o mock `resolve()` (após o bloco `automation_steps`, antes do `return` final na linha 52-53) para tratar a tabela `deals`:

```typescript
    if (table === "deals") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
```

Depois adicione o bloco de teste no fim do arquivo (antes das funções helper na linha 227):

```typescript
describe("move_deal", () => {
  it("moves the contact's open deal scoped to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [{
      id: "a1", account_id: ACCOUNT, user_id: "u1",
      trigger_type: "tag_added", trigger_config: {}, is_active: true,
    }];
    h.state.steps = [{
      id: "s1", automation_id: "a1", step_type: "move_deal",
      position: 0, parent_step_id: null,
      step_config: { pipeline_id: "pl-followup", stage_id: "st-fu1" },
    }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "tag_added",
      contactId: "c1",
      context: { tag_id: "fu1" },
    });

    const dealUpdates = h.state.updateCalls.filter((u) => u.table === "deals");
    expect(dealUpdates).toHaveLength(1);
    expect(dealUpdates[0].filters).toContainEqual(["eq", "account_id", ACCOUNT]);
    expect(dealUpdates[0].filters).toContainEqual(["eq", "contact_id", "c1"]);
    expect(dealUpdates[0].filters).toContainEqual(["eq", "status", "open"]);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/automations/engine.test.ts -t "move_deal"`
Expected: FAIL — o handler ainda não existe; nenhum update em `deals` acontece (`dealUpdates` vazio), ou o motor cai no `default` (`unknown step`).

- [ ] **Step 3: Adicionar o tipo + config em `src/types/index.ts`**

No union `AutomationStepType` (linha 417-428), adicione `move_deal`:

```typescript
  | 'close_conversation'
  | 'move_deal';
```

Adicione a interface de config (perto de `CreateDealStepConfig`, ~487):

```typescript
export interface MoveDealStepConfig {
  pipeline_id: string;
  stage_id: string;
}
```

No union `AutomationStepConfig` (linha 519-530), adicione `MoveDealStepConfig`:

```typescript
  | CreateDealStepConfig
  | MoveDealStepConfig
```

- [ ] **Step 4: Implementar o handler em `src/lib/automations/engine.ts`**

Adicione o `case` antes do `default:` (linha ~550), espelhando `close_conversation`. Importe o tipo no topo do arquivo (junto dos outros configs):

```typescript
  CreateDealStepConfig,
  MoveDealStepConfig,
```

Handler:

```typescript
    case 'move_deal': {
      const cfg = step.step_config as MoveDealStepConfig
      if (!cfg.pipeline_id || !cfg.stage_id) throw new Error('move_deal needs pipeline + stage')
      if (!args.contactId) throw new Error('move_deal needs a contact')
      await db
        .from('deals')
        .update({
          pipeline_id: cfg.pipeline_id,
          stage_id: cfg.stage_id,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId)
        .eq('status', 'open')
      return `deal moved to ${cfg.stage_id}`
    }
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/automations/engine.test.ts -t "move_deal"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/automations/engine.ts src/lib/automations/engine.test.ts
git commit -m "feat(automations): move_deal step — move contact's open deal across pipeline/stage"
```

---

### Task 2: Validação do `move_deal`

**Files:**
- Modify: `src/lib/automations/validate.ts` (novo `case 'move_deal'` em `validateOne`, ~98)
- Test: `src/lib/automations/validate.test.ts`

**Interfaces:**
- Consumes: step_type `'move_deal'` + `MoveDealStepConfig` (Task 1).
- Produces: issues `move_deal.pipeline_id` / `.stage_id` quando vazios. Sem isso, ativar a automação cai no `default` ("unknown step type").

- [ ] **Step 1: Escrever o teste que falha**

Em `src/lib/automations/validate.test.ts`, adicione:

```typescript
import { validateStepsForActivation } from "./validate";

describe("validate move_deal", () => {
  it("requires pipeline_id and stage_id", () => {
    const issues = validateStepsForActivation([
      { step_type: "move_deal", step_config: { pipeline_id: "", stage_id: "" } },
    ]);
    expect(issues).toContainEqual({ path: "steps[0].pipeline_id", message: "pipeline is required" });
    expect(issues).toContainEqual({ path: "steps[0].stage_id", message: "stage is required" });
  });

  it("accepts a fully configured move_deal", () => {
    const issues = validateStepsForActivation([
      { step_type: "move_deal", step_config: { pipeline_id: "pl1", stage_id: "st1" } },
    ]);
    expect(issues).toHaveLength(0);
  });
});
```

(Se o `import`/`describe` já existir no arquivo, adicione só os dois `it`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/automations/validate.test.ts -t "move_deal"`
Expected: FAIL — hoje cai no `default` (`unknown step type: move_deal`), então o `accepts` falha (tem 1 issue) e o `requires` não bate os paths certos.

- [ ] **Step 3: Implementar a validação**

Em `validateOne` (`src/lib/automations/validate.ts`), adicione antes do `case 'close_conversation'` (~135):

```typescript
    case 'move_deal':
      if (!nonEmpty(c.pipeline_id)) {
        issues.push({ path: `${path}.pipeline_id`, message: 'pipeline is required' })
      }
      if (!nonEmpty(c.stage_id)) {
        issues.push({ path: `${path}.stage_id`, message: 'stage is required' })
      }
      break
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/automations/validate.test.ts -t "move_deal"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/automations/validate.ts src/lib/automations/validate.test.ts
git commit -m "feat(automations): validate move_deal step (pipeline + stage required)"
```

---

### Task 3: UI do `move_deal` no builder

**Files:**
- Modify: `src/components/automations/automation-builder.tsx` (STEP_META ~90; ADDABLE_STEPS ~108; blankConfig ~141; StepEditor ~1041)

**Interfaces:**
- Consumes: step_type `'move_deal'`, `MoveDealStepConfig` (Task 1). Reusa o mesmo padrão de seleção de pipeline/stage do `create_deal`.

- [ ] **Step 1: Registrar o passo (metadata + addable + blank)**

Em `STEP_META` (~90), adicione (use o ícone já importado `Briefcase`, ou `ArrowRightLeft` se já importado — senão `Briefcase`):

```typescript
  move_deal: { label: "Mover Negócio", icon: Briefcase, border: "border-l-primary" },
```

Em `ADDABLE_STEPS` (~108), adicione `"move_deal"` ao array.

Em `blankConfig()` (~141), adicione o case:

```typescript
    case 'move_deal':
      return { pipeline_id: "", stage_id: "" }
```

- [ ] **Step 2: Adicionar o formulário no `StepEditor`**

No `StepEditor()` (~1041), copie a estrutura de campos do `case 'create_deal'` (campos de pipeline e stage), sem os campos `title`/`value`:

```typescript
    case 'move_deal':
      return (
        <>
          <FieldBlock label="Pipeline de destino">
            <Input
              value={(cfg.pipeline_id as string) ?? ""}
              onChange={(e) => set({ pipeline_id: e.target.value })}
              placeholder="ID do pipeline"
            />
          </FieldBlock>
          <FieldBlock label="Coluna (estágio) de destino">
            <Input
              value={(cfg.stage_id as string) ?? ""}
              onChange={(e) => set({ stage_id: e.target.value })}
              placeholder="ID da coluna"
            />
          </FieldBlock>
        </>
      )
```

(Nota: o `create_deal` atual usa `Input` de IDs crus. Manter consistência agora; trocar por dropdowns de pipeline/coluna é melhoria separada — fora de escopo desta task.)

- [ ] **Step 3: Verificar typecheck + build da página**

Run: `npx tsc --noEmit`
Expected: sem erros novos. Se o projeto tiver `npm run lint`, rode também.

- [ ] **Step 4: Verificação manual (descrita)**

Subir o app (`npm run dev`), abrir Automações → nova automação → adicionar passo: "Mover Negócio" aparece na lista; o formulário mostra os dois campos; salvar persiste `step_config`. Confirmar que não quebrou os outros passos.

- [ ] **Step 5: Commit**

```bash
git add src/components/automations/automation-builder.tsx
git commit -m "feat(automations): builder UI for move_deal step"
```

---

### Task 4: Passo `send_ai` — gera texto pela IA (voz do Agente + diretriz) e envia via UazAPI

**Files:**
- Modify: `src/types/index.ts` (AutomationStepType; `SendAiStepConfig`; AutomationStepConfig)
- Modify: `src/lib/automations/engine.ts` (novo `case 'send_ai'`; imports do brain + sender)
- Test: `src/lib/automations/engine.test.ts` (mocks de pedro client + sdr/send; novo bloco)

**Interfaces:**
- Consumes: `pedroFromEnv().reply(systemPrompt, messages)` de `@/lib/pkg/pedro/client`; `resolveAccountProvider(admin, accountId)` e `sendText(admin, accountId, {provider, phone}, text)` de `@/lib/sdr/send`; `sdr_config.system_prompt`.
- Produces: `SendAiStepConfig { guidance: string }`; step_type `'send_ai'`. Gera o texto do toque a partir da voz do Agente + a diretriz daquele toque e envia via UazAPI.

- [ ] **Step 1: Escrever o teste que falha**

Em `src/lib/automations/engine.test.ts`, adicione os mocks (junto do `vi.mock("./meta-send", ...)` na linha 93):

```typescript
const sendTextMock = vi.fn(async () => ({ messageId: "uaz-1" }));
vi.mock("@/lib/sdr/send", () => ({
  resolveAccountProvider: vi.fn(async () => "uazapi"),
  sendText: (...args: unknown[]) => sendTextMock(...args),
}));
vi.mock("@/lib/pkg/pedro/client", () => ({
  pedroFromEnv: () => ({
    reply: vi.fn(async (system: string) => ({ text: `GEN:${system.includes("corrido")}` })),
  }),
}));
```

Estenda o mock `resolve()` para `sdr_config`, `contacts` (com phone) e `messages`:

```typescript
    if (table === "sdr_config") {
      return { data: { system_prompt: "Você é o Ian.", variables: [] }, error: null };
    }
    if (table === "messages") {
      if (type === "insert") return { data: { id: "msg1" }, error: null };
      return { data: [], error: null };
    }
```

(O branch `contacts` já existe; para o teste do `send_ai`, setar `h.state.owned = { id: "c1", phone: "5511999" }` — o select de phone reusa esse retorno.)

Adicione `import { beforeEach } ...` já existe. No `beforeEach`, adicione `sendTextMock.mockClear();`.

Bloco de teste:

```typescript
describe("send_ai", () => {
  it("generates text with the agent voice + guidance and sends via UazAPI", async () => {
    h.state.owned = { id: "c1", phone: "5511999" } as { id: string };
    h.state.automations = [{
      id: "a1", account_id: ACCOUNT, user_id: "u1",
      trigger_type: "tag_added", trigger_config: {}, is_active: true,
    }];
    h.state.steps = [{
      id: "s1", automation_id: "a1", step_type: "send_ai",
      position: 0, parent_step_id: null,
      step_config: { guidance: "corrido — leve, sem cobrar." },
    }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "tag_added",
      contactId: "c1",
      context: { conversation_id: "conv1", tag_id: "fu1" },
    });

    expect(sendTextMock).toHaveBeenCalledTimes(1);
    const callArgs = sendTextMock.mock.calls[0] as unknown[];
    // sendText(admin, accountId, {provider, phone}, text)
    expect(callArgs[1]).toBe(ACCOUNT);
    expect((callArgs[2] as { provider: string }).provider).toBe("uazapi");
    expect((callArgs[2] as { phone: string }).phone).toBe("5511999");
    expect(typeof callArgs[3]).toBe("string");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/automations/engine.test.ts -t "send_ai"`
Expected: FAIL — handler inexistente; `sendTextMock` não é chamado.

- [ ] **Step 3: Tipo + config em `src/types/index.ts`**

`AutomationStepType`: adicione `| 'send_ai'`. Adicione:

```typescript
export interface SendAiStepConfig {
  /** Diretriz/ângulo deste toque, injetada na voz do Agente. */
  guidance: string;
}
```

`AutomationStepConfig`: adicione `| SendAiStepConfig`.

- [ ] **Step 4: Implementar o handler em `src/lib/automations/engine.ts`**

Imports no topo:

```typescript
import { resolveAccountProvider, sendText } from '@/lib/sdr/send'
import { pedroFromEnv } from '@/lib/pkg/pedro/client'
```

E o tipo `SendAiStepConfig` no bloco de imports de `@/types`.

Handler (antes do `default:`):

```typescript
    case 'send_ai': {
      const cfg = step.step_config as SendAiStepConfig
      if (!args.contactId) throw new Error('send_ai needs a contact')
      if (!cfg.guidance?.trim()) throw new Error('send_ai needs guidance')

      const { data: contact } = await db
        .from('contacts')
        .select('phone')
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id)
        .maybeSingle()
      const phone = (contact as { phone?: string } | null)?.phone
      if (!phone) throw new Error('send_ai: contact has no phone')

      const { data: sdrCfg } = await db
        .from('sdr_config')
        .select('system_prompt')
        .eq('account_id', args.automation.account_id)
        .maybeSingle()
      const basePrompt = (sdrCfg as { system_prompt?: string } | null)?.system_prompt ?? ''

      // Histórico recente (opcional — toque proativo funciona mesmo sem).
      let messages: { role: 'user' | 'assistant'; content: string }[] = []
      const convId = args.context.conversation_id
      if (convId) {
        const { data: rows } = await db
          .from('messages')
          .select('sender_type, content_text, created_at')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: false })
          .limit(20)
        messages = (((rows ?? []) as { sender_type: string; content_text: string | null }[])
          .reverse())
          .filter((m) => m.content_text)
          .map((m) => ({
            role: m.sender_type === 'customer' ? 'user' as const : 'assistant' as const,
            content: m.content_text as string,
          }))
      }
      if (messages.length === 0) {
        messages = [{ role: 'user', content: '(follow-up proativo)' }]
      }

      const system = `${basePrompt}\n\n[Diretriz deste toque]\n${cfg.guidance}`
      const { text } = await pedroFromEnv().reply(system, messages)
      if (!text?.trim()) throw new Error('send_ai: brain returned empty text')

      const provider = await resolveAccountProvider(db, args.automation.account_id)
      const { messageId } = await sendText(db, args.automation.account_id, { provider, phone }, text)

      // Persistir a mensagem do bot (mesma tabela/forma dos outros envios).
      if (convId) {
        await db.from('messages').insert({
          conversation_id: convId,
          account_id: args.automation.account_id,
          sender_type: 'bot',
          content_text: text,
          message_id: messageId,
        })
      }
      return `send_ai sent via ${provider} (${messageId ?? 'no-id'})`
    }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/automations/engine.test.ts -t "send_ai"`
Expected: PASS. Rode o arquivo inteiro pra garantir que nada quebrou: `npx vitest run src/lib/automations/engine.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/automations/engine.ts src/lib/automations/engine.test.ts
git commit -m "feat(automations): send_ai step — agent voice + guidance via brain, send over UazAPI"
```

---

### Task 5: Validação + UI do `send_ai`

**Files:**
- Modify: `src/lib/automations/validate.ts` (case `send_ai`)
- Test: `src/lib/automations/validate.test.ts`
- Modify: `src/components/automations/automation-builder.tsx` (STEP_META, ADDABLE_STEPS, blankConfig, StepEditor)

**Interfaces:**
- Consumes: step_type `'send_ai'`, `SendAiStepConfig` (Task 4).

- [ ] **Step 1: Teste de validação que falha**

Em `validate.test.ts`:

```typescript
describe("validate send_ai", () => {
  it("requires guidance", () => {
    const issues = validateStepsForActivation([
      { step_type: "send_ai", step_config: { guidance: "" } },
    ]);
    expect(issues).toContainEqual({ path: "steps[0].guidance", message: "guidance is required" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/automations/validate.test.ts -t "send_ai"`
Expected: FAIL (cai no default).

- [ ] **Step 3: Implementar validação**

Em `validateOne`, antes do `case 'close_conversation'`:

```typescript
    case 'send_ai':
      if (!nonEmpty(c.guidance)) {
        issues.push({ path: `${path}.guidance`, message: 'guidance is required' })
      }
      break
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/automations/validate.test.ts -t "send_ai"`
Expected: PASS.

- [ ] **Step 5: UI no builder**

`STEP_META`: `send_ai: { label: "Enviar (IA)", icon: Sparkles, border: "border-l-primary" }` (importar `Sparkles` de `lucide-react` se ainda não importado; senão reusar `MessageSquare`).
`ADDABLE_STEPS`: adicionar `"send_ai"`.
`blankConfig()`: `case 'send_ai': return { guidance: "" }`.
`StepEditor()`:

```typescript
    case 'send_ai':
      return (
        <FieldBlock label="Diretriz do toque (ângulo)">
          <Textarea
            value={(cfg.guidance as string) ?? ""}
            onChange={(e) => set({ guidance: e.target.value })}
            placeholder="Ex.: corrido — leve, dá um gancho: 'sei que corre, só não quero te deixar na mão'."
            rows={3}
          />
        </FieldBlock>
      )
```

(`Textarea` já é usado por outros passos no arquivo — confirmar o import existente.)

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` (sem erros novos).

```bash
git add src/lib/automations/validate.ts src/lib/automations/validate.test.ts src/components/automations/automation-builder.tsx
git commit -m "feat(automations): validate + builder UI for send_ai step"
```

---

### Task 6: `cancel_on_reply` — flag na automação + função de cancelamento

**Files:**
- Create: `supabase/migrations/030_automations_cancel_on_reply.sql`
- Modify: `src/lib/automations/engine.ts` (export `cancelPendingForContact`)
- Test: `src/lib/automations/engine.test.ts` (mock branches `automations` lista + `automation_pending_executions` delete)

**Interfaces:**
- Produces: `export async function cancelPendingForContact(accountId: string, contactId: string): Promise<number>` — deleta `automation_pending_executions` (status `pending`) do contato, restritas às automações da conta com `cancel_on_reply = true`. Retorna a contagem cancelada (best-effort).

- [ ] **Step 1: Migration**

Criar `supabase/migrations/030_automations_cancel_on_reply.sql`:

```sql
-- 030_automations_cancel_on_reply.sql — flag: encerrar a sequência quando o lead responde.
ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS cancel_on_reply boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Teste que falha**

Em `engine.test.ts`, estenda o mock `resolve()` para o delete de pendentes e a leitura de automações canceláveis:

```typescript
    if (table === "automation_pending_executions") {
      if (type === "delete") {
        state.deleteCalls.push({ table, filters: ops.filters });
        return { data: [{ id: "p1" }], error: null };
      }
      return { data: [], error: null };
    }
```

Adicione `deleteCalls: [] as { table: string; filters: [string, string, unknown][] }[],` ao `state` (linha ~13) e `h.state.deleteCalls = [];` no `beforeEach`. Também faça o branch `automations` honrar um filtro de cancel: para este teste basta retornar `state.automations`.

Teste:

```typescript
import { cancelPendingForContact } from "./engine";

describe("cancel_on_reply", () => {
  it("deletes pending executions for the contact scoped to the account", async () => {
    h.state.automations = [{ id: "a1", account_id: ACCOUNT, cancel_on_reply: true }];
    await cancelPendingForContact(ACCOUNT, "c1");
    const del = h.state.deleteCalls.filter((d) => d.table === "automation_pending_executions");
    expect(del).toHaveLength(1);
    expect(del[0].filters).toContainEqual(["eq", "account_id", ACCOUNT]);
    expect(del[0].filters).toContainEqual(["eq", "contact_id", "c1"]);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/lib/automations/engine.test.ts -t "cancel_on_reply"`
Expected: FAIL — `cancelPendingForContact` não existe.

- [ ] **Step 4: Implementar em `engine.ts`**

```typescript
/**
 * Cancela toques pendentes de um contato quando ele responde. Restrito às
 * automações da conta marcadas com cancel_on_reply=true. Best-effort: nunca
 * lança (chamado fire-and-forget do webhook de inbound).
 */
export async function cancelPendingForContact(
  accountId: string,
  contactId: string,
): Promise<number> {
  try {
    const db = supabaseAdmin()
    const { data: autos } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('cancel_on_reply', true)
    const ids = ((autos ?? []) as { id: string }[]).map((a) => a.id)
    if (ids.length === 0) return 0
    const { data: deleted } = await db
      .from('automation_pending_executions')
      .delete()
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'pending')
      .in('automation_id', ids)
      .select('id')
    return Array.isArray(deleted) ? deleted.length : 0
  } catch (err) {
    console.error('[automations] cancelPendingForContact failed:', err)
    return 0
  }
}
```

(Adicione `.in()` ao mock builder em `engine.test.ts`: `in: () => b,` junto de `gte/is/order/limit` na linha ~70-73.)

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/automations/engine.test.ts -t "cancel_on_reply"`
Expected: PASS.

- [ ] **Step 6: Aplicar a migration + commit**

Aplicar no banco NS (cofre): `psql "$SUPABASE_NS_DB_URL" -f supabase/migrations/030_automations_cancel_on_reply.sql` (confirmar com Arthur antes de rodar em prod).

```bash
git add supabase/migrations/030_automations_cancel_on_reply.sql src/lib/automations/engine.ts src/lib/automations/engine.test.ts
git commit -m "feat(automations): cancel_on_reply flag + cancelPendingForContact"
```

---

### Task 7: Acionar o cancelamento no caminho de inbound do webhook

**Files:**
- Modify: `src/app/api/whatsapp/webhook/route.ts` (caminho de inbound do cliente, ~755-790)

**Interfaces:**
- Consumes: `cancelPendingForContact(accountId, contactId)` (Task 6).

- [ ] **Step 1: Importar e chamar**

No `src/app/api/whatsapp/webhook/route.ts`, junto do import existente de `runAutomationsForTrigger` (linha 10):

```typescript
import { runAutomationsForTrigger, cancelPendingForContact } from '@/lib/automations/engine'
```

No bloco que processa o inbound do cliente (após resolver `contactRecord`, perto da linha 760, antes do loop de `automationTriggers`), adicione fire-and-forget:

```typescript
  // Uma resposta do lead encerra qualquer sequência (régua) em voo para ele.
  cancelPendingForContact(accountId, contactRecord.id).catch((err) =>
    console.error('[automations] cancel-on-reply failed:', err),
  )
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Verificação (descrita)**

Não há teste de integração do webhook nesta fatia. Verificação manual fica para a Fatia 2 (e2e da régua): ao responder, os `automation_pending_executions` daquele contato com `cancel_on_reply=true` somem na próxima inspeção.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/whatsapp/webhook/route.ts
git commit -m "feat(automations): fire cancel-on-reply when a lead replies (inbound webhook)"
```

---

## Self-Review

**Spec coverage (Fatia 1):**
- Parede 5 `mover_deal` → Tasks 1-3. ✓
- Parede 2 `send_ai` (voz do Agente + diretriz) → Tasks 4-5. ✓
- Parede 1 envio UazAPI → embutido no `send_ai` (resolveAccountProvider + sendText). ✓
- Parede 3 cancelar-ao-responder → Tasks 6-7. ✓
- Parede 4 (engate do chase) + montagem da régua FU1 + "responder → Em Conversa" → **Fatia 2** (plano separado), depois de validar esta fatia.

**Placeholders:** nenhum "TBD/TODO"; todo passo tem código/comando/expected.

**Type consistency:** `MoveDealStepConfig {pipeline_id, stage_id}` e `SendAiStepConfig {guidance}` usados igual em types/engine/validate/builder. `cancelPendingForContact(accountId, contactId)` idêntico em Task 6 e 7. `sendText(admin, accountId, {provider, phone}, text)` conforme `src/lib/sdr/send.ts`.

**Riscos conhecidos a confirmar na execução:**
- Coluna `messages` exata para persistir o envio do bot (`sender_type`, `content_text`, `message_id`) — conferir contra o insert do `meta-send.ts` ao implementar a Task 4 (ajustar nomes se divergir).
- `sendText` assinatura/`connectionId` opcional — conferir em `src/lib/sdr/send.ts` ao implementar.
- O mock do `engine.test.ts` precisa dos métodos `.in()` (Task 6) — adicionar ao builder.

---

## Fatia 2 (próximo plano — não nesta fatia)

1. **Engate de entrada**: tag `fu1` + `runAutomationsForTrigger('tag_added')` no `touches-processor.ts` ao resolver o chase (após `moveDealToStage('primeiro_contato')`, ~linha 174). Garantir que a tag `fu1` exista (seed).
2. **Montar a automação FU1**: trigger `tag_added`(fu1) · `cancel_on_reply=true` · move_deal→Follow-up/Follow-up 1 · 5× (wait + send_ai com o ângulo) · wait 24h · move_deal→Lead Vencido.
3. **"Responder → Em Conversa"**: decidir onde mora (no cancelamento, ou no processor de inbound do SDR) — move o deal para "Em Conversa" quando o lead responde durante a régua.
4. **e2e**: lead fantasma → vê os toques no inbox e o card andando no kanban → responde → para e vai pra Em Conversa.
