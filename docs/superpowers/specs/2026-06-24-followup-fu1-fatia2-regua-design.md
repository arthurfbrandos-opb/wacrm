# Follow-up FU1 — Fatia 2 (régua montada + fiação) — design

> Data: 2026-06-24 · Repo: wacrm · Status: design (aguardando revisão do Arthur)
> Continua: `2026-06-24-followup-fu1-automacao-design.md` (Fatia 1 mergeada, `main @ 38c6ae1`).
> Régua-fonte: SHADOW-AGENT-SPEC §5.1 + `angles.py` (brain do Pedro) — blueprint, com 2 adaptações de voz NS.

## 1. O que a Fatia 2 entrega

A Fatia 1 deu os blocos (`move_deal`, `send_ai`, `cancel_on_reply`). A Fatia 2 **monta a régua FU1 e a liga ao fluxo vivo**:
1. **Engate de entrada** — quando o chase (1º contato) sai sem resposta, marca o contato com a tag `fu1` e dispara o gatilho `tag_added` (passando `conversation_id` no contexto, pros toques aparecerem no inbox).
2. **Régua FU1 semeada** — a automação FU1 (gatilho `tag_added`(fu1), `cancel_on_reply=true`, 5 toques `send_ai` com os ângulos + esperas + `move_deal`), criada via script; Arthur afina na UI.
3. **Responder → Em Conversa** — no `runSdrReply`, quando o lead responde e o deal está na pipeline "Follow-up", move o deal pra "Pré-Vendas (SDR) / Em Conversa".
4. **Resolver de estágio por nome** — helper novo (não existe no código) pra resolver `pipeline_id`/`stage_id` por nome em runtime.

## 2. ⚠️ Pré-requisito duro: migration 030

A régua **não se comporta certo** sem a migration `030` (`cancel_on_reply`) aplicada no banco NS. Sem ela, `cancelPendingForContact` lê uma coluna inexistente → retorna 0 → **os toques agendados continuam saindo mesmo depois do lead responder**. O "responder → Em Conversa" (§1.3) é só visual; quem **segura os envios** é o `cancel_on_reply`. → **Aplicar 030 antes de ativar a régua.**

## 3. Decisões travadas

- "Responder → Em Conversa" mora no **`runSdrReply`** (caminho vivo do SDR), não no cancelamento genérico nem numa 2ª automação.
- A régua FU1 **nasce semeada** (script one-off, espelhando `insertSteps`), e Arthur afina os ângulos/tempos na UI do builder.
- Engate via tag `fu1` + gatilho `tag_added` (reusa o gatilho existente; o disparo é criado no `touches-processor`).

## 4. Estado atual (verificado — código + banco vivo)

- **Pipeline "Follow-up" EXISTE no banco vivo** (`id cda81cf2-…`, estágios "Follow-up 1".."Follow-up 5"), criada pela UI — **não** está em migrations/seed. Pré-Vendas (SDR) = `97565e48-…` (estágios … "Primeiro Contato", "Em Conversa", … "Lead Vencido"). → Todos os ids resolvidos **por nome em runtime** (não hardcodar).
- **`tag_added` nunca é disparado em produção** — definido em tipo/validação/UI, mas zero call-site de `runAutomationsForTrigger('tag_added')`. A Fatia 2 cria o disparo no engate.
- **Tags** (`001`+`017`): `tags(id, user_id NOT NULL, name NOT NULL, color, account_id NOT NULL)`, **sem UNIQUE(account_id,name)** → "garantir tag fu1" = SELECT-by-name → INSERT se vazio. `contact_tags(contact_id, tag_id, UNIQUE(contact_id,tag_id))` → upsert `onConflict: 'contact_id,tag_id'`. Não há helper find-or-create no banco (`src/lib/contacts/tags.ts` só normaliza nome em memória).
- **Chase point**: `src/lib/sdr/touches-processor.ts:172-176` (dentro de `processOne`, branch `first_touch` sem evento). Em escopo: `admin` (service-role), `accountId`, `t.contact_id`, `t.conversation_id`, `t.deal_id`, `name`, `provider`. **Não importa** `runAutomationsForTrigger` ainda.
- **`runSdrReply`** (`src/lib/sdr/processor.ts:63-272`): após o gate `ai_status='on'` (L75-80) + debounce (L84-95) já se sabe que é reply real do cliente; em escopo `accountId`, `contact.id`, `conversationId`. Já há padrão de buscar deal aberto (`deals.status='open'` order `created_at desc`) em `[AGENDAR]` (L178-222).
- **`moveDealToStage`** (`src/lib/sdr/touches.ts:258-269`) só atualiza `stage_id` com 2 stages SDR hardcoded — **não serve** pra cruzar pipeline. Mover entre pipelines = padrão do `move_deal` (update `pipeline_id`+`stage_id`).
- **`automation_steps`**: régua linear = linhas com `position` incremental, `parent_step_id=NULL`, `branch=NULL`. `automations` NOT NULL: `user_id, account_id, name, trigger_type, trigger_config, is_active, execution_count, cancel_on_reply`.
- **Seed**: não há seed-runner; padrão = one-off `docker compose exec -T wacrm node < script.js` no VPS (segredos do env do container), espelhando `insertSteps` (`src/lib/automations/steps-tree.ts`).
- **send_ai/brain**: `PEDRO_LLM_URL`+`PEDRO_LLM_HMAC_SECRET` no env do container. Exercitável em teste via o mock `vi.mock('@/lib/pkg/pedro/client')` (`engine.test.ts:126`); live precisa do brain + conexão UazAPI ativa.

## 5. Componentes

### 5.1 Resolver de estágio por nome (helper novo)
`src/lib/sdr/stage-lookup.ts` (novo). Funções, via admin REST client:
- `resolvePipelineId(admin, accountId, pipelineName): Promise<string|null>` — `pipelines` where `account_id` + `name`.
- `resolveStageId(admin, accountId, pipelineName, stageName): Promise<string|null>` — resolve pipeline, depois `pipeline_stages` where `pipeline_id` + `name`.
Cacheável por processo (opcional, YAGNI: sem cache no v1). Testável isolado com mock REST.

### 5.2 Engate no chase (`touches-processor.ts`)
Após `moveDealToStage(admin, t.deal_id, 'primeiro_contato')` (L174), antes de `resolveTouch`:
- garantir tag `fu1` (find-by-name → insert se faltar; helper `ensureTag(admin, accountId, userId, name)` novo, p.ex. em `src/lib/sdr/tags-ensure.ts` ou inline) → `tagId`;
- upsert `contact_tags {contact_id: t.contact_id, tag_id: tagId}` `onConflict: 'contact_id,tag_id'`;
- `runAutomationsForTrigger({ accountId, triggerType: 'tag_added', contactId: t.contact_id, context: { tag_id: tagId, conversation_id: t.conversation_id } })` (fire-and-forget; importar de `@/lib/automations/engine`).
`conversation_id` no contexto se propaga pelos `wait`/cron (o engine reenfileira `args.context`), então **todos os toques aparecem no inbox**.

### 5.3 Responder → Em Conversa (`runSdrReply`)
Logo após o gate+debounce confirmarem reply real (≈ após L95, antes de chamar o brain): fire-and-forget
- resolver `followupPipelineId = resolvePipelineId(admin, accountId, 'Follow-up')` e `emConversaStageId = resolveStageId(admin, accountId, 'Pré-Vendas (SDR)', 'Em Conversa')`;
- achar o deal aberto do contato (`deals` where `account_id`+`contact_id`+`status='open'`, mais recente);
- **se** `deal.pipeline_id === followupPipelineId`: `update deals set pipeline_id = sdrPipelineId, stage_id = emConversaStageId` (resolver `sdrPipelineId` por nome 'Pré-Vendas (SDR)').
Guarda: só move se está no Follow-up (não mexe em quem já saiu). Best-effort, não bloqueia a resposta.

### 5.4 Seed da régua FU1 (script one-off)
`scripts/seed-fu1-regua.mjs` (novo, committed, **rodado manualmente** via `docker compose exec -T wacrm node < scripts/seed-fu1-regua.mjs` no VPS). Resolve em runtime: `account_id` + `user_id` (conta NS), `fu1` tag id (find-or-create), `Follow-up / Follow-up 1` stage id, `Pré-Vendas (SDR) / Lead Vencido` stage id. Insere:
- `automations`: `{ name: 'Follow-up 1', trigger_type: 'tag_added', trigger_config: { tag_id }, is_active: false, cancel_on_reply: true, account_id, user_id }` (criar **inativa**; Arthur revisa e ativa na UI).
- `automation_steps` lineares (`position` 0..12, `parent_step_id=null`, `branch=null`) — ver §6.
Idempotente: se já existe automação `name='Follow-up 1'` na conta, não duplica (abortar com aviso).

## 6. A régua FU1 (passos semeados)

Gatilho: `tag_added`(fu1) · `cancel_on_reply=true`.

| pos | step_type | config |
|---|---|---|
| 0 | move_deal | Follow-up / "Follow-up 1" |
| 1 | wait | 30 minutes |
| 2 | send_ai | guidance "corrido" |
| 3 | wait | 30 minutes |
| 4 | send_ai | guidance "cinco_min" |
| 5 | wait | 2 hours |
| 6 | send_ai | guidance "olhos" |
| 7 | wait | 9 hours |
| 8 | send_ai | guidance "pedro_denovo" → **ian_denovo** |
| 9 | wait | 12 hours |
| 10 | send_ai | guidance "ultimato" |
| 11 | wait | 24 hours (GRACE) |
| 12 | move_deal | Pré-Vendas (SDR) / "Lead Vencido" |

Cumulativo: +30m/+1h/+3h/+12h/+24h, depois +24h → Lead Vencido. ✔ bate o blueprint.

**Guidances (com 2 adaptações de voz NS):**
- corrido: "Leve, dá um gancho: 'sei que corre, só não quero te deixar na mão'."
- cinco_min: "Reforça que é rápido: o diagnóstico toma poucos minutos e ele já sai com clareza do gargalo." *(adaptado — **banir "sem compromisso"** por regra de voz NS)*
- olhos: "Curiosidade: tem um ponto do cadastro dele que vale a pena olhar junto."
- ian_denovo: "Reaparece humano: 'sou eu de novo, o Ian' — sem cobrança pesada." *(adaptado — agente é **Ian**, não Pedro)*
- ultimato: "Fecha com respeito: 'vou parar de te incomodar, mas a porta fica aberta'."

## 7. Sequência de ativação (passos com ação do Arthur)

1. **Aplicar migration 030** no banco NS (a/b/c já passados). [bloqueante]
2. **Deploy do código** Fatia 1+2 no VPS (`rsync → /opt/wacrm` + build). [Arthur]
3. **Rodar o seed** `docker compose exec -T wacrm node < scripts/seed-fu1-regua.mjs`. [Arthur/eu com acesso]
4. **Revisar + ativar** a automação "Follow-up 1" na UI (afinar ângulos/tempos, toggle Ativa).
5. **e2e**: lead fantasma ignora 1º contato → vê toques no inbox + card em "Follow-up 1" → responde → para + vai pra "Em Conversa".

## 8. Fora de escopo

Meta oficial (template/janela). FU2–FU5 (reusam tudoisto). Resiliência "continue-on-failure" (hoje 1 `send_ai` falho aborta a régua — `break` no catch, comportamento existente do motor). Dropdowns de pipeline/stage no builder (Inputs de id por ora).

## 9. Riscos / abertos

- **Brain/UazAPI no e2e**: `send_ai` depende do brain vivo + conexão UazAPI ativa; testar com nº de teste, não em lead real, na 1ª rodada.
- **`break` no catch**: um `send_ai` que falha (brain fora, sem telefone) aborta o resto da régua. Aceito nesta fatia; resiliência é follow-up.
- **Conta NS no seed**: o script precisa resolver o `account_id`/`user_id` certos — confirmar como identificar a conta NS (única conta? por email do owner?) antes de rodar.
- **Tag `fu1` visível no CRM**: a tag aparece nos contatos. Definir cor/none. Cosmético.
