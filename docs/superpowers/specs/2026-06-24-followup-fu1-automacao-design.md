# Follow-up 1 (FU1) como Automação no CRM — design

> Data: 2026-06-24 · Repo: wacrm · Status: design (aguardando revisão do Arthur)
> Régua-fonte: SHADOW-AGENT-SPEC V1.2 §5.1 + POPs HSE (cadência e ângulos do FU1 já provados no brain do Pedro — aqui são blueprint, não invenção).

## 1. Problema

Hoje, quando um lead cai pelo FAP01 e **não responde ao 1º contato** (o `first_touch`/chase), o fluxo vivo (wacrm + UazAPI) **para**: o lead recebe um único resgate e depois silêncio. A régua de recuperação FU1–FU5 existe inteira no brain do Pedro (Python: `cadence.py`, `angles.py`, `engine.py`, arming no `orchestrator.py`), mas está **órfã do fluxo vivo** — o wacrm substituiu o orquestrador do Pedro pela própria máquina de estado e chama o brain só como gerador de texto (`/v6/llm/reply`) e agenda (`/v6/calendar/*`). O `_arm_followup` (que arma o FU1) nunca roda em produção.

## 2. Decisão de abordagem

Construir o FU1 **dentro da feature de Automação do CRM**, não portando pro `sdr_touches` nem revivendo o orquestrador do brain. Motivo: tornar o **motor de Automação** capaz de rodar réguas de follow-up — assim FU2–FU5 e futuros clientes reusam os mesmos blocos, configuráveis na UI sem código (alinhado à meta multitenant).

- Canal: **WhatsApp não-oficial (UazAPI)**. Texto livre, sem janela/template. A camada Meta oficial (template fora da janela de 24h) fica para fase posterior — o motor já tem `send_template`.
- Gatilho de entrada: **engata no envio do 1º contato** (chase enviado sem resposta), não num sweep agendado.
- Movimentação de pipeline: o deal **cruza de pipeline** (Pré-Vendas (SDR) → Follow-up → volta), exigindo um passo novo de mover deal.

## 3. Estado atual (verificado no código/banco)

- **Motor de Automação** (`src/lib/automations/engine.ts`): triggers em `src/types/index.ts:408`; steps em `:417`. Envio via `src/lib/automations/meta-send.ts` → **Meta-only**. `wait` enfileira `automation_pending_executions`, drenado pelo cron `GET /api/automations/cron`. `runAutomationsForTrigger` é disparado pelo webhook do WhatsApp e por um POST manual.
- **Sem cancelamento**: nada remove `pending_executions` quando o lead responde.
- **Sender provider-aware já existe**: `src/lib/sdr/send.ts` (usado por `touches-processor`) roteia UazAPI vs Meta.
- **Voz do Ian**: `sdr_config.system_prompt` (+ variáveis), editado em Configurações → Agente (`AgentPanel` → `/api/sdr/config`). O reply usa `pedroFromEnv().reply(systemPrompt, messages)`.
- **Chase**: `src/lib/sdr/touches-processor.ts`, ao mandar o resgate, move o deal para "Primeiro Contato" e resolve o touch com `resolution='chase'`.
- **Pipelines (banco vivo)**:
  - Pré-Vendas (SDR) `97565e48…`: Reentrada · Funil de Aplicação · Funil de Social Selling · Primeiro Contato · **Em Conversa** · Agendamento Realizado · **Lead Vencido**.
  - Follow-up `cda81cf2…`: **Follow-up 1 · Follow-up 2 · Follow-up 3 · Follow-up 4 · Follow-up 5** (uma coluna por estágio FU).
  - (Duplicado "Em conversa" já excluído pelo Arthur.)
- **Cadência FU1** (blueprint): toques cumulativos **T+30m / +1h / +3h / +12h / +24h** (deltas 30m, 30m, 2h, 9h, 12h), 5 toques; depois 24h de silêncio (GRACE) → Lead Vencido. Ângulos por toque: `corrido` → `cinco_min` → `olhos` → `pedro_denovo` → `ultimato` (break-up).

## 4. As 5 paredes a construir no motor (genéricas/reusáveis)

| # | Capacidade | Onde | Reuso |
|---|---|---|---|
| 1 | **Envio provider-aware (UazAPI)** no passo de envio (deixa de ser Meta-only) | novo caminho de envio no motor, reusando `src/lib/sdr/send.ts` | toda automação passa a enviar não-oficial |
| 2 | **Passo `send_ai`**: gera o texto via brain (`reply`) com `sdr_config.system_prompt` + uma **guidance/ângulo editável**, e envia | novo step type + UI | qualquer régua que rotacione abordagem |
| 3 | **Cancelar ao responder**: inbound do lead encerra a sequência em voo | cancela `pending_executions` do contato; flag por automação "encerrar se responder" | "uma resposta encerra a régua" |
| 4 | **Engate de entrada**: chase enviado → arma a automação | `touches-processor` marca tag e dispara `runAutomationsForTrigger` | usa `tag_added` existente |
| 5 | **Passo `mover_deal`**: seta `pipeline_id` + `stage_id` do deal | novo step type + UI (dropdowns pipeline/coluna) | toda automação de pipeline |

`wait` (esperas) e a movimentação final já são compostos com primitivos existentes/novos.

### Detalhe técnico por parede

1. **Envio UazAPI**: extrair a escolha de provider do `touches-processor`/`sdr/send.ts` para um envio compartilhado que o motor de Automação chame, em vez do `engineSendText` (Meta) hardcoded. O passo de envio ganha um seletor de canal (UazAPI | Meta).
2. **`send_ai`**: config do step = `{ guidance: string }`. Em runtime: lê `sdr_config.system_prompt` da account, monta `system = base + bloco de contexto do lead`, `messages = histórico recente`, injeta a `guidance` (o ângulo), chama `pedro.reply`, e envia o texto via parede 1. Sem markers de agendamento (é toque proativo, não conversa).
3. **Cancelar ao responder**: no caminho de inbound (`new_message_received`, mensagem `sender_type='customer'`), para automações com `cancel_on_reply=true`, deletar/expirar os `automation_pending_executions` daquele `contact_id` cujas automações estão em curso. Acompanha a ação de mover o deal para "Em Conversa" (parede 5).
4. **Engate**: ao resolver o chase (`resolution='chase'`), o `touches-processor` adiciona uma tag (ex.: `fu1`) ao contato e chama `runAutomationsForTrigger({ triggerType:'tag_added', ... })`. A automação FU1 tem trigger `tag_added` com config dessa tag. (Alternativa: novo trigger dedicado `chase_sent` — decidir no plano; tag é o menor caminho.)
5. **`mover_deal`**: config = `{ pipeline_id, stage_id }`. Update no deal setando ambos (deal pode trocar de pipeline). Escopo por account.

## 5. Fluxo do FU1

```
GATILHO: chase enviado e lead não respondeu  (tag fu1 → tag_added)
  → mover_deal: Pré-Vendas(SDR)/Primeiro Contato → Follow-up/Follow-up 1
  → wait 30m → send_ai · "corrido"
  → wait 30m → send_ai · "cinco_min"
  → wait 2h  → send_ai · "olhos"
  → wait 9h  → send_ai · "pedro_denovo"
  → wait 12h → send_ai · "ultimato" (break-up)
  → wait 24h → mover_deal → Pré-Vendas(SDR)/Lead Vencido

SAÍDA (lead responde a QUALQUER momento, cancel_on_reply):
  → cancela toques pendentes + mover_deal → Pré-Vendas(SDR)/Em Conversa  (Ian assume)
```

Âncora = momento do chase. Os 5 toques rodam enquanto o deal está em "Follow-up 1".

## 6. Usabilidade (operação 100% no CRM)

A régua (cadência, textos/ângulos, destinos de estágio, on/off) é configurada e acompanhada na UI; as 5 paredes são a fundação que aparece como **opções novas no builder**.

- **Configurações → Agente** (já existe): a voz-base do Ian. O `send_ai` usa essa voz + a guidance do passo — ajusta-se a personalidade num lugar só (conversa e follow-ups).
- **Automações → "Follow-up 1" (builder)**: gatilho no topo (`1º contato sem resposta`), checkbox **"Encerrar se o lead responder → mover para Em Conversa"**, e a árvore de passos (mover_deal · wait · send_ai com campo de **guidance editável** por toque · seletor de canal UazAPI). Toggle **Ativa/Inativa** liga/desliga a régua inteira.
- **Kanban (Pipelines)**: o deal anda sozinho — sai de "Primeiro Contato", aparece em "Follow-up 1"; ao responder pula pra "Em Conversa"; ao esgotar cai em "Lead Vencido". O estado da régua se lê no kanban.
- **Inbox**: os toques aparecem na thread como mensagens do bot/automação, com o texto gerado pela IA por ângulo. Ao responder, a régua para sozinha e o Ian entra.
- **Logs da automação**: aba de logs por lead — quais toques saíram, quando, e por que parou (respondeu / esgotou / humano assumiu).

## 7. Casos de borda

- **Lead responde no meio** → `cancel_on_reply` encerra a sequência e move pra Em Conversa.
- **Humano assumiu / IA desligada** (`conversations.ai_status != 'on'`) → gate antes de cada `send_ai` (igual o `touches-processor` já faz), pula o toque.
- **Idempotência de arming** → um arming por contato (a tag `fu1` só arma uma vez; re-disparo não duplica a régua).
- **Restart/robustez** → tudo dirigido pelo cron de drain existente; sem wait-chain frágil.
- **Conversa sem mensagens / contato sem telefone** → `send_ai` falha graciosamente e loga (não estoura a régua).

## 8. Fora de escopo (agora)

- Meta oficial (template + janela 24h).
- FU2–FU5 (vêm depois, reusando as 5 paredes).
- Sweep genérico por "deal parado no estágio X há N" (escolhido o engate no chase).
- Painel visual dedicado da régua (kanban + logs já cobrem).

## 9. Questões em aberto (resolver no plano)

- Trigger de entrada: tag `fu1` + `tag_added` (recomendado) vs novo trigger `chase_sent`.
- Escopo do `cancel_on_reply`: cancelar só as execuções da própria automação FU1 vs qualquer automação com a flag — definir granularidade.
- `send_ai` como step novo vs `send_message` com `mode='ai'` + guidance — definir no plano (preferência: step novo, mais legível no builder).
