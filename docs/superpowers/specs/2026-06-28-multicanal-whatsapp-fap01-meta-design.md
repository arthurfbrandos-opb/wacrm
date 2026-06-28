# Multi-canal WhatsApp (Meta + UazAPI) · 1º contato FAP01 pela Meta — Design

- **Data:** 2026-06-28
- **Status:** Aprovado (brainstorm) · pronto pra plano de implementação
- **Autor:** Arthur + Claude
- **Escopo deste doc:** Fase 1 (lançamento 29/06). Fase 2 esboçada no fim.

## Contexto / problema

O wacrm é hoje **canal único**, controlado pela env global `WA_PROVIDER` (`uazapi` no VPS). Consequência: o webhook só aceita um provider por vez — mensagens da **Meta Cloud API** chegam mas são **rejeitadas** (`[webhook] rejected request — auth failed: uazapi_token_missing`), porque o handler espera o token do UazAPI.

Ao mesmo tempo:
- O cold outbound via **UazAPI está travado** (erro 463 `reachout_timelock` até **2026-07-01 15:55 SP** — número não aquecido).
- O canal oficial **Meta** já está conectado e registrado no wacrm (`whatsapp_config`: `status=connected`, `registered_at`, `subscribed_apps_at`, webhook ativo e inscrito em `messages`). App da Meta novo dedicado, número novo exclusivo pra API.

O lançamento da máquina de aquisição é **segunda 29/06**: leads do FAP01 precisam ser abordados pelo SDR (Ian). Como o UazAPI não abre conversa nova, o 1º contato **tem que sair pela Meta** — e na Meta o 1º disparo (fora da janela de 24h) **exige template aprovado**.

## Objetivo (Fase 1)

1. Os **dois canais recebendo ao mesmo tempo** (Meta + UazAPI) — nenhuma conversa existente fica muda.
2. Lead novo do **FAP01 abordado pela Meta** via **template aprovado**, **3 minutos** após o cadastro.
3. **2 templates** de 1º contato, escolhidos conforme o lead **já agendou ou não** (cruzando Calendly + Google Calendar).
4. Quando o lead **responde**, a **IA do Ian assume** a conversa em texto livre (comportamento atual, dentro da janela de 24h).

## Decisões (do brainstorm)

- Rodar os 2 canais juntos (não fazer cutover brusco). A virada brusca deixaria conversas UazAPI mudas.
- Fase 1 = mínimo pro lançamento; UI completa de multi-canal = Fase 2.
- 1º contato = template fixo (não a IA escrevendo o 1º disparo). IA assume na resposta.
- 2 templates: "agendou" vs "não agendou".
- Disparo do template **3 min após o cadastro** (dá tempo do lead agendar antes do toque).
- Sinal de "agendou" = Calendly (token do cofre, cruza por **e-mail ou telefone**) + Google Calendar.

## Arquitetura — Fase 1

### A. Webhook aceita Meta + UazAPI por requisição

Arquivo: `src/app/api/whatsapp/webhook/route.ts` + `src/lib/whatsapp/webhook-signature.ts`.

Hoje o `POST` ramifica por `process.env.WA_PROVIDER` (linhas ~180-206) e o `verifyWebhookAuth` escolhe Meta-HMAC vs token-UazAPI pela mesma env (webhook-signature.ts ~58-87). Isso é o gate global a remover.

**Mudança:** detectar o provider **por requisição**, não por env:
- Requisição com header `x-hub-signature-256` → **Meta**: validar HMAC com `META_APP_SECRET`, processar payload no shape Meta (passthrough, como hoje no ramo meta).
- Requisição com `?token=` na query → **UazAPI**: resolver a conexão por token (`resolveUazapiRoute`) e normalizar o shape (`normalizeUazAPIPayload`), como hoje.
- Nenhum dos dois casar → 401.

`WA_PROVIDER` deixa de ser gate; no máximo vira default de fallback. O resto do pipeline (`processWebhook` → `processMessage`) já é provider-agnóstico (normaliza UazAPI pro shape Meta antes).

**Resultado:** conversas UazAPI existentes continuam recebendo **e** o número Meta passa a receber.

### B. FAP01 → 1º toque pela Meta (3 min) + seleção de template

Arquivos: `src/app/api/webhooks/fap01/route.ts` (intake), o agendador de toque (`scheduleFirstTouchIfAbsent` / SDR touch), `src/lib/sdr/send.ts`.

- Lead do FAP01 já nasce `contacts.provider='meta'` (já é assim — fap01/route.ts ~147). Manter.
- **Agendar o 1º toque pra `now + 3 min`** (hoje pode ser imediato/outro valor — ajustar pra 3 min).
- **Na execução do toque**, decidir o template:
  1. Checar se o lead **agendou**: consultar **Calendly** (API, token do cofre) cruzando por **e-mail ou telefone** do lead; e/ou **Google Calendar** (mesma checagem que o SDR já usa na idempotência do AGENDAR — ver `learning_sdr_inbound_latest_wins_idempotencia`).
  2. Agendou → template `fap01_1contato_agendou`. Não agendou → `fap01_1contato_nao_agendou`.
- **Disparar via Meta** com `sendTemplateMessage` (meta-api.ts), passando o **primeiro nome** como variável `{{1}}`.
- O toque antigo via UazAPI (que falha no 463) **deixa de ser usado pra lead novo** do FAP01.

### C. Templates de 1º contato (texto de produção, PT-BR)

Categoria **Marketing**, idioma PT-BR, variável `{{1}}` = primeiro nome. Sem botões na v1 (aprova mais rápido). Submetidos na Meta por Arthur; o status de aprovação chega sozinho (webhook já inscrito em `message_template_status_update`).

**`fap01_1contato_nao_agendou`:**
> Oi, {{1}}! Aqui é o Ian, da Negócio Simples. Recebi o seu cadastro e queria te parabenizar pela tomada de decisão.
>
> Antes de agendarmos a reunião com Arthur, queria alinhar 2 perguntas com você, pode ser?

**`fap01_1contato_agendou`:**
> Oi, {{1}}! Aqui é o Ian, da Negócio Simples. Parabéns pela decisão de transformar o seu negócio com automação e IA.
>
> Vi que você agendou um diagnóstico com Arthur, posso confirmar 2 informações com você?

### D. Envio respeita o canal do contato

Arquivos: `src/lib/sdr/send.ts`, `src/app/api/whatsapp/send/route.ts`.

- Contato `meta` → envia pela Meta (template no 1º contato; texto livre dentro da janela de 24h depois que o lead responde).
- Contato `uazapi` (conversas atuais) → continua UazAPI (como hoje).
- Ajustar o roteamento do **toque do FAP01** pra respeitar `contact.provider='meta'` e **não** cair no UazAPI por `resolveAccountProvider` (que hoje prefere conexão UazAPI ativa). Para FAP01 o provider é explícito (Meta).
- Quando o lead responde, o webhook entra como `provider=meta`, a conversa já existe, e a IA (`runSdrReply`) assume normal — sem mudança no cérebro do SDR.

## Fora de escopo (Fase 2)

A infra de dados já suporta; falta a camada visual/config:
- **Badge de origem** na lista de conversas e no cabeçalho do thread (qual canal/número).
- **Trocar o canal de envio por conversa** (mandar pela Meta ou por uma conexão UazAPI específica) — `send/route.ts` passar a aceitar `provider`/`connection_id` no body.
- **Seletores na UI**: marcar a **conexão principal** e **qual conexão atende o FAP01** (hoje fixo = Meta).
- **Múltiplos números Meta** por conta (hoje `whatsapp_config` é 1 linha por conta).

## Testes / verificação

- **Webhook dual:** mandar "oi" do WhatsApp pessoal pro número Meta → entra no inbox como `provider=meta` (verificar via banco / inbox). Numa conversa UazAPI existente, mandar mensagem → continua entrando. Conferir nos logs que não há mais `rejected — uazapi_token_missing` pra payload Meta.
- **FAP01 não agendou:** submeter lead de teste sem agendar → ~3 min depois sai o template `fap01_1contato_nao_agendou` pela Meta → responder → IA assume.
- **FAP01 agendou:** submeter lead e agendar no Calendly dentro da janela de 3 min → sai o template `fap01_1contato_agendou`.
- Conferir aprovação dos 2 templates na Meta antes do teste real (status via webhook).

## Riscos / observações

- **Aprovação dos templates** leva de minutos a ~1 dia. É pré-requisito do teste real e do lançamento — submeter cedo.
- **Categoria Marketing** é a aposta segura (outreach de venda). Se a Meta reprovar/reclassificar, reavaliar Utility. (Não inventar política da Meta — confirmar na submissão.)
- **Token do Calendly** mora no cofre do orchestrator (`~/Projects/orchestrator/.env`). A checagem precisa cruzar por e-mail **ou** telefone (telefone do FAP01 pode vir sem o 55 — normalizar antes de cruzar).
- **Race dos 3 min:** se o lead agendar logo após o toque, ele recebe o template "não agendou" — aceitável; a IA reconcilia na conversa. 3 min é o equilíbrio escolhido.
- **Deploy:** wacrm = `rsync → srv1571722.hstgr.cloud:/opt/wacrm` + `docker compose build/up`. SSH já consertado (IPv4 ok, sem WARP). Banco NS compartilhado — qualquer migration nova checar colunas contra o banco real (ver `learning_create_table_if_not_exists_colisao_banco_compartilhado`).
- Implementação numa **worktree** dedicada (`feat/multicanal-whatsapp`), não no checkout main direto.
