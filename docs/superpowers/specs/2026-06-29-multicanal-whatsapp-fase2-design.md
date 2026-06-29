# Multi-canal WhatsApp — Fase 2 (controle + UI + gate de janela) — Design

- **Data:** 2026-06-29
- **Status:** Aprovado (brainstorm) · pronto pra plano de implementação
- **Autor:** Arthur + Claude
- **Worktree:** `feat/multicanal-whatsapp-fase2`
- **Continua:** `2026-06-28-multicanal-whatsapp-fap01-meta-design.md` (Fase 1, já em `main` `a83a763`, deployado)

## Contexto / problema

A Fase 1 deixou os **dois canais recebendo** (Meta + UazAPI por requisição) e o envio **respeitando o canal do contato** (`resolveReplyProvider` lê `contacts.provider`). Mas o controle disso ainda é implícito e hardcoded:

- O **1º contato FAP01** é fixo: se a conta tem `whatsapp_config` → template Meta; senão → bubbles UazAPI. O operador **não escolhe** a fonte.
- Não há como **trocar a origem de uma conversa** pela UI, nem **badge** mostrando por qual canal a conversa está.
- O **composer do humano** bloqueia template/mídia por UazAPI, mas **não conhece a janela de 24h da Meta**: mandar texto livre no Meta fora da janela é rejeitado pela Meta sem tratamento.

A decisão de canal hoje está **duplicada e divergente** em três lugares (`send/route.ts` humano, `send.ts` `resolveReplyProvider`/`resolveAccountProvider`, `touches-processor.ts`), cada um com regras um pouco diferentes — risco de drift e da classe de bug "rejected — uazapi_token_missing" da Fase 1.

## Objetivo (Fase 2)

1. **Cap 1** — escolher pela UI a **origem principal** (a usada pra captação e 1ª abordagem do FAP01): Meta oficial vs UazAPI, com **fallback automático** pro outro canal se a escolhida estiver indisponível.
2. **Cap 2** — **trocar a origem por conversa** entre as **2 origens** (Oficial = Meta · Não Oficial = conexão UazAPI), de forma **persistente no contato**, com **badge de origem visível** na lista e no cabeçalho.
3. **Cap 3** — o **uso de template** muda conforme a origem e a janela: **Meta fora da janela de 24h = template obrigatório**; **janela aberta ou UazAPI = texto livre**. Cobre **humano + IA + toques automatizados**.
4. **Cap 4** — os **follow-ups seguem a origem ATUAL da conversa** (não a origem principal), e a régua de follow-up ganha a **automação 24h / pós-24h** (dentro da janela = texto livre; fora da janela no Meta = template), espelhando o 1º contato.
5. **Cap 5** — **corrigir os bubbles que não aparecem** na tela da conversa (mensagens enviadas/recebidas têm que renderizar no thread).
6. **Cap 6** — a tela da conversa **expõe as features certas por canal**: Oficial (Meta) habilita template/mídia/etc; Não Oficial (UazAPI) habilita só o que o canal suporta (texto). Sem affordance que dá erro garantido.

## Decisões (do brainstorm)

- **Troca de origem = persistente no contato** (grava `contacts.provider`/`connection_id`). A partir dela, todo envio da conversa — IA (Ian) e humano — sai pelo canal escolhido. A IA já segue isso via `resolveReplyProvider` (sem regra nova).
- **Fonte FAP01 com fallback automático**: escolhe a prioritária; se indisponível, cai pro outro canal. (Não é pick rígido.)
- **Gate de janela 24h = escopo completo**: vale pra composer humano, resposta da IA e toques automatizados (lembretes 24h/2h, FU1) no canal Meta.
- **Follow-ups seguem a origem ATUAL da conversa** (lêem `contact.provider` via `resolveSendPlan`), não a origem principal. A régua passa a ramificar 24h (texto livre) / pós-24h no Meta (template), como o 1º contato já faz.
- **A automação (código) do 24h/pós-24h é desta fase**; o que fica de follow-up é só escrever a copy dos templates de lembrete/FU e submeter à Meta. Sem template aprovado → rede de segurança (adia + alerta).
- **Bug dos bubbles** entra no escopo: investigar (systematic-debugging) e corrigir o render de mensagens no thread.
- **Features por canal** na UI da conversa: o composer/affordances se adaptam à origem atual.
- **Shipar agora + rede de segurança**: se um toque automatizado precisar de template no Meta e não houver um pronto/aprovado, **adia o toque + loga/alerta** — nunca quebra, nunca manda errado. Escrever a copy dos templates de lembrete/FU + submeter à Meta é **tarefa separada** (follow-up).
- **Abordagem A** — centralizar a decisão num único helper `resolveSendPlan` consumido por todos os pontos de envio.

## Arquitetura — Fase 2

### Espinha dorsal: `resolveSendPlan` (Abordagem A)

Novo helper (provável `src/lib/sdr/send-plan.ts`):

```
resolveSendPlan(admin, accountId, contact, conversation) → {
  provider: 'meta' | 'uazapi',
  connectionId: string | null,   // conexão UazAPI quando provider='uazapi'
  windowOpen: boolean,           // Meta: agora - last_inbound_at < 24h; UazAPI: sempre true
  mode: 'text' | 'template_required',
}
```

Regras:
- `provider`/`connectionId` derivam de `contact.provider`/`connection_id`, com o fallback de disponibilidade (mesma lógica do `resolveReplyProvider`/`resolveAccountProvider`, agora unificada).
- `windowOpen = provider === 'meta' ? (Date.now() - last_inbound_at < 24h) : true`.
- `mode = (provider === 'meta' && !windowOpen) ? 'template_required' : 'text'`.

Consumido por: `send/route.ts` (humano), `send.ts` (resposta da IA), `touches-processor.ts` (1º toque FAP01, lembretes, FU1). `resolveReplyProvider`/`resolveAccountProvider` viram detalhes internos de `resolveSendPlan` (ou são chamados por ele) — sem duplicar a regra.

### A. Modelo de dados (aditivo, pequeno)

1. `sdr_config.fap01_source TEXT NOT NULL DEFAULT 'meta' CHECK (fap01_source IN ('meta','uazapi'))` — a fonte prioritária da cap 1.
2. `conversations.last_inbound_at TIMESTAMPTZ` — gravado pelo webhook a cada mensagem `sender_type='customer'`. Sinal da janela de 24h (mais barato/correto que varrer `messages` a cada envio). Backfill inicial opcional a partir do último inbound conhecido.
3. **Sem coluna nova em `contacts`** — `provider`/`connection_id` já existem (Fase 1); a cap 2 só os escreve.

> Banco Supabase **compartilhado** (sglsw…): toda migration confere colunas contra o banco vivo antes (`learning_create_table_if_not_exists_colisao_banco_compartilhado`). DDL via `psql "$SUPABASE_NS_DB_URL"` do cofre (`reference_ddl_banco_ns_cofre`), não pelo container.

### B. Cap 1 — fonte prioritária FAP01 + fallback

Arquivos: `touches-processor.ts` (`sendFirstContact`), `sdr/touches.ts` (helpers de disponibilidade), nova UI em Configurações → SDR.

- `sendFirstContact` lê `sdr_config.fap01_source` em vez do hardcode atual.
- **Disponibilidade (pré-envio):** Meta disponível = existe `whatsapp_config`; UazAPI disponível = existe `wa_connection` com `is_active_for_crm`.
- Fonte escolhida disponível → usa. Indisponível → **cai pro outro canal**. Os dois indisponíveis → toque fica pendente (gate `accountHasChannel` atual).
- **Falha dura no envio** (ex: 463 do UazAPI lançado pelo `sendUazapiText`): captura **uma vez**, cai pro outro canal no mesmo tick, loga o fallback. (Senão o 463 retenta pra sempre.)
- `mode` do 1º contato: Meta → template (`fap01_1contato_agendou/nao_agendou`, já prontos); UazAPI → bubbles (`confirmBubbles`/`chaseBubbles`, já prontos).
- **Carimba o contato** (`provider` + `connection_id`) com o canal de fato usado, pra que IA e humano sigam por ele depois.
- UI: toggle em **Configurações → SDR** — "1º contato FAP01 sai por: Oficial (Meta) / Não Oficial (UazAPI)". Persiste em `sdr_config.fap01_source`.

### C. Cap 2 — troca de origem por conversa + badge

Arquivos: nova rota `PATCH /api/contacts/[id]/channel`, cabeçalho do thread, linha da conversa na lista.

- **Seletor** no cabeçalho do thread: dropdown listando **Oficial (Meta)** (se existe `whatsapp_config`) + cada **`wa_connection` conectada** pelo `label`. Selecionar chama a rota, que grava `contacts.provider` (+ `connection_id` no caso UazAPI). Validação: account-scoped, só canais que a conta realmente tem.
- Como o modelo é **persistente**, IA (`resolveReplyProvider` → `resolveSendPlan`) e humano seguem na hora — sem regra separada pra IA.
- **Badge** de origem em dois lugares:
  - linha da conversa na lista (`conversation-list`),
  - cabeçalho do thread.
  - Rótulo: "Oficial" (Meta) ou o `label` da conexão UazAPI.
- Trocar pra Meta com janela fechada → o próximo envio bate no gate da cap 3 (template). Trocar pra UazAPI → texto livre. Consistente por construção.

### D. Cap 3 — gate de janela 24h / template (escopo completo)

Arquivos: `send/route.ts` (humano), `send.ts` (IA), `touches-processor.ts` (automáticos), composer da UI.

- **Composer do humano:** ao abrir/atualizar a conversa, a UI conhece `mode` (via `resolveSendPlan`, exposto pela API da conversa). `mode='template_required'` → **desabilita texto livre e força o seletor de template** (caminho de template já existe). `send/route.ts` valida no servidor também: texto livre no Meta fora da janela → 400 com mensagem clara (defesa em profundidade; a UI não é a única trava).
- **Resposta da IA** (`send.ts`): `mode='template_required'` → **não manda texto livre** (loga e não envia). Na prática a IA responde logo após o lead escrever (janela quase sempre aberta); isso só torna a borda segura.
- **Toques automatizados** (lembretes 24h/2h, FU1) — roteiam pela **origem atual da conversa** (`resolveSendPlan` lê `contact.provider`), não pela origem principal:
  - **Dentro da janela** (ou UazAPI) → texto livre/bubbles como hoje.
  - **Janela fechada + Meta** → usa template aprovado **mapeado** pro tipo de toque (mapa `touch_type → template_name`, espelhando a seleção agendou/não-agendou do 1º contato). **A automação dessa ramificação 24h/pós-24h é código desta fase.**
  - **Sem template mapeado/aprovado** → **adia o toque (fica pendente) + loga/alerta**; nunca quebra, nunca manda texto livre que a Meta rejeitaria. Quando os templates existirem, o mesmo toque dispara via template sem mudança de código.

### E. Cap 5 — corrigir os bubbles que não aparecem no thread

Arquivos prováveis: `src/components/inbox/message-thread.tsx` (fetch + realtime), `message-bubble.tsx` (render), RLS de `messages`, e o caminho de inserção server-side (`send.ts`/`touches-processor.ts`).

- **Diagnóstico já feito:** `message-bubble.tsx` renderiza todos os tipos (texto/template/mídia/interactive) e o fetch (`message-thread.tsx:311`) puxa todas as mensagens da conversa **sem filtro de tipo**. Logo, o bug **não é o componente** — é dado/realtime.
- **Suspeitos a investigar (systematic-debugging):** (a) mensagens inseridas server-side pelo SDR/touches não disparam realtime pro cliente inscrito (RLS na subscription) e/ou (b) ficam ligadas a uma conversa que o inbox não exibe / linkagem de `conversation_id`.
- **Critério de pronto:** toda mensagem enviada (humano, IA, toque) e recebida aparece como bubble no thread — **ao vivo e no refresh** — nos dois canais (Meta e UazAPI).

### F. Cap 6 — features por canal na tela da conversa

O composer e as affordances se adaptam à **origem atual** do contato:

- **Oficial (Meta):** texto + **template** + **mídia** + reply/quote (conforme já suportado). Quando `mode='template_required'` (janela fechada) → texto livre desabilitado, **seletor de template forçado** (cap 3).
- **Não Oficial (UazAPI):** **só texto** hoje (template/mídia por UazAPI estão fora de escopo — ver abaixo). Esconder/desabilitar os botões de template e mídia em vez de deixar o operador clicar e tomar erro (o `send/route.ts` já rejeita, mas a UI não deve oferecer).
- A origem que rege isso é a mesma do badge/seletor (cap 2). Trocar a origem re-renderiza as features disponíveis.

## Dependência nomeada (follow-up, fora do código desta fase)

Pra cobertura total dos toques automatizados no Meta fora da janela, criar e submeter à Meta os templates:
- `lembrete_24h` (variáveis: nome, data/hora do evento),
- `lembrete_2h` (variáveis: nome, data/hora, link do Meet),
- template(s) de `FU1`.

Até aprovados, a rede de segurança (adiar + alertar) cobre. Escrever a copy + submeter é tarefa separada.

## Fora de escopo (explícito)

- **Múltiplos números Meta** por conta (`whatsapp_config` continua 1 linha).
- **Mídia/template por UazAPI** (UazAPI segue só texto, como hoje).
- **Escrever a copy** dos templates de lembrete/FU (nomeado acima como follow-up).

## Testes / verificação

- **`resolveSendPlan` (unit):** matriz provider × janela × disponibilidade → `{provider, connectionId, mode}` esperado. Inclui: Meta + janela fechada → `template_required`; UazAPI sempre `text`; contato sem provider → fallback pro canal ativo.
- **Fallback FAP01:** source=uazapi sem conexão ativa → cai pro template Meta; source=meta sem `whatsapp_config` → cai pras bubbles UazAPI; 463 no envio UazAPI → cai pro Meta no mesmo tick.
- **Gate de janela (humano):** semear `last_inbound_at` >24h num contato Meta → texto livre dá 400 e a UI força o picker; <24h → texto passa.
- **Toque automatizado fora da janela sem template:** lembrete num contato Meta com janela fechada e sem template mapeado → toque adiado + alerta, lead não recebe nada errado.
- **Troca por conversa:** `PATCH` no canal → badge atualiza na lista e no header; próxima resposta da IA roteia pro novo canal (verificar `provider` na mensagem gravada).
- **Follow-up segue origem atual (cap 4):** contato trocado pra UazAPI → FU1/lembrete sai por UazAPI (texto); contato Meta janela fechada → FU1/lembrete usa template mapeado (ou adia se não houver).
- **Bubbles (cap 5):** enviar pelo SDR/touch e pelo composer → mensagem aparece no thread ao vivo e após refresh, nos 2 canais. Reproduzir o cenário do bug antes do fix (teste que falha → passa).
- **Features por canal (cap 6):** conversa UazAPI → botões de template/mídia ocultos/desabilitados; conversa Meta janela fechada → texto livre desabilitado + picker forçado; Meta janela aberta → todas as features.
- **Suíte:** `npm test` verde antes de qualquer commit (inclui o teste do catálogo — `feedback_classifier_bash_suite_check_antes_deploy`).
- **Deploy:** rsync → `srv1571722.hstgr.cloud:/opt/wacrm` + `docker compose build/up` (SSH IPv4 ok, sem WARP). Migration nova checada contra o banco vivo.

## Riscos / observações

- **Backfill de `last_inbound_at`:** conversas antigas ficam com `NULL` → tratar `NULL` como **janela fechada** no Meta (conservador: exige template) ou backfill a partir do último inbound em `messages`. Decisão na implementação; default conservador.
- **Custo Meta:** o fallback automático pode disparar template Meta (custo) quando a fonte UazAPI cai. É o comportamento escolhido (lead sempre abordado); manter visível no log.
- **`resolveSendPlan` toca 3 pontos quentes** — fazer o refactor com a suíte verde a cada passo; não mudar comportamento observável além do gate.
- **Worktree dedicada** (`feat/multicanal-whatsapp-fase2`), não no `main` direto (há trabalho não-commitado de outra sessão no `main`).
