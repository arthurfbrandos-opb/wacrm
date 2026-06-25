# Camada 6 · Dashboard — Fatia 1 (lançamento) — design

> **Data:** 2026-06-25 (SP) · **Status:** design aprovado (brainstorm) → próximo passo: writing-plans
> **Pai:** `negocio-simples/docs/superpowers/specs/2026-06-25-maquina-aquisicao-design.md` **§9 (Camada 6 · Dashboard)** e **§8 (convenção UTM)**. Este doc é o **contrato da Fatia 1**, não um design novo — só fixa o recorte, o faseamento e a semântica exata que o §9 (visão completa) não detalha.
> **Repo de build:** `wacrm` (o §9 manda o dashboard morar dentro do wacrm).

---

## 1 · Por que esta fatia existe

Segunda 29/06 o gasto de mídia começa a rodar (máquina de aquisição §8). O dashboard é a Camada 6, que o §11 sequencia por último. Esta fatia **puxa pra frente o mínimo pra ter visibilidade no dia 1 de gasto**, escopada **só no funil pago** — que já tem fundação de dado (fap01/fap01-adv já gravam UTM+origem, §4 "já escreve ✓"), sem depender da padronização inteira da Camada 1.

**Objetivo do Arthur (escolhido nesta sessão):** *operação ao vivo* + *custo por resultado*. Não o funil-por-criativo isolado — o custo já carrega a atribuição.

## 2 · Escopo

**Dentro:**
- Rota nova isolada `/dashboard/anuncios` no wacrm (não incha a página atual do dashboard).
- **Bloco 1 · Operação ao vivo** (puro CRM, zero dependência de Meta).
- **Bloco 2 · Funil do lançamento** (puro CRM).
- **Bloco 3 · Custo por resultado por criativo** (CRM × `ad_spend` do Meta).
- Tabela `ad_spend` + workflow n8n `WF-NS-AD-SPEND-SYNC` que a alimenta.

**Fora (fatias seguintes do §9 — explícito pra não vazar escopo):**
- Faturamento / ROAS / CAC / ticket médio (precisam dos 3 gateways Asaas/Dom/Infinity — §9 Visão 3).
- Portas orgânico / webinário / e-mail e a padronização de origem (Camada 1).
- Visão 2 (card por estratégia/origem) completa, KLT HSR/AVCR, flag escalar/observar.
- Gráfico de tendência gasto×agendamento (marco-2).
- Agente Gestor (Camada 7).

## 3 · Faseamento de risco (o que sobe segunda vs o que acende depois)

| Sobe segunda (independe do Meta) | Acende quando token Meta + UTM entrarem |
|---|---|
| Bloco 1 (op ao vivo) + Bloco 2 (funil) | Bloco 3 colunas de custo (CPL, custo/agendamento) |

Se o token Meta atrasar, op-ao-vivo + funil já entregam "ver os leads entrando em tempo real"; as colunas de custo aparecem "—" até o `ad_spend` encher.

## 4 · Modelo de dados

### Tabela nova `ad_spend` (gasto por anúncio por dia)

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | |
| `account_id` | uuid | escopo NS · RLS |
| `date` | date | dia em SP |
| `campaign_id` / `campaign_name` | text | |
| `adset_id` / `adset_name` | text | |
| `ad_id` / `ad_name` | text | **chave de join** (`ad_name == utm_content`) |
| `spend` | numeric | BRL |
| `impressions` / `link_clicks` | int | contexto (CTR), sem inventar métrica |
| `synced_at` | timestamptz | drive do "atualizado há Xh" |

- `UNIQUE (account_id, date, ad_id)` → upsert idempotente (o n8n re-puxa `last_7d` toda hora; conflito atualiza o dia).
- RLS: `SELECT` por `is_account_member(account_id)` (browser lê via supabase client, igual ao resto do dashboard). n8n escreve via service_role (bypass).
- Migration nova numerada na sequência do wacrm (próximo número livre após 032).

### Fontes já existentes (só leitura)
- `deals` (`contact_id`, `pipeline_id`, `stage_id`, `created_at`, `value`, `currency`, `account_id`)
- `pipeline_stages` / `pipelines` (estágios reais — ver §5)
- `messages` (`sender_type`, `conversation_id`, `created_at`)
- `conversations` (`contact_id`)
- `appointments` (`contact_id`, `deal_id`, `scheduled_at`, `created_at`)
- `contacts.fap01_data` → `attribution.last_touch.utm` / `first_touch` / `source_utm_*` flat

## 5 · Definições exatas de métrica (ancoradas nos estágios reais — zero invenção)

Pipelines reais (verificados no banco 25/06):
- **Pré-Vendas (SDR):** Reentrada → Funil de Aplicação → Funil de Social Selling → Primeiro Contato → **Em Conversa** → **Agendamento Realizado** → Lead Vencido
- **Closer:** **Comparecimento Realizado** → Segunda Call → … → **Venda Fechada** → Venda Perdida → No-show/Desqualificado

| Métrica | Definição factual | Janela |
|---|---|---|
| **Lead** | contato distinto com deal no pipeline *Pré-Vendas (SDR)*, por `deals.created_at` (dia SP). Conta **contatos distintos**, não deals (dedup faz 1 contato ter vários deals). | dia / janela |
| **Respondeu** | contato com **≥1 mensagem `sender_type='customer'`** (inbound). Sinal limpo, não depende de histórico de estágio. | janela |
| **Agendou** | contato com **≥1 `appointment`** OU deal em estágio *Agendamento Realizado*. | janela |
| **Compareceu** | deal em *Comparecimento Realizado* (Closer). | janela |
| **Venda** | deal em *Venda Fechada* (Closer). | janela |
| **Sem resposta agora** (Bloco 1) | contato com deal aberto em Pré-Vendas SDR, **com ≥1 outbound nosso e 0 inbound `customer`** (aguardando 1ª resposta). | tempo real |
| **Tempo médio 1ª resposta** | média do delta entre 1ª inbound `customer` e 1ª outbound nossa subsequente, no dia. | dia |

**Atribuição (crédito do lead/agendamento a um criativo):**
`attribution.last_touch.utm.utm_content` → fallback `attribution.first_touch.utm.utm_content` → fallback `fap01_data.source_utm_campaign`/flat → senão **"Sem atribuição"**. (last_touch = clique imediatamente antes do cadastro = padrão pago.)

**Custo (Bloco 3):** `ad_spend` somado na janela agrupado por `ad_name`, juntado a leads/agendamentos por `ad_name == utm_content`.
- **CPL** = gasto / leads do criativo
- **Custo por agendamento** = gasto / agendou do criativo  ← métrica-mãe pra pilotar (§8: KPI = custo-por-agendamento, não CPL)
- **Custo por comparecimento** = gasto / compareceu (quando houver)
- Rollup por campanha via `utm_campaign` (linha agrupável).

## 6 · Telas / componentes

Rota `/dashboard/anuncios` (client component, lê via supabase browser client + realtime onde fizer sentido). Filtro de janela: **hoje / 7d / desde o início**.

- **Bloco 1 · Operação ao vivo (hoje):** cards — Leads hoje (Δ vs ontem) · Responderam (nº e %) · Agendamentos hoje · **Sem resposta agora** (acionável) · Tempo médio 1ª resposta.
- **Bloco 2 · Funil do lançamento:** funil visual **Leads → Respondeu → Agendou → Compareceu → Venda** com contagem + % de conversão entre etapas.
- **Bloco 3 · Custo por resultado por criativo:** tabela ordenável (default por custo/agendamento): `Criativo (ad_name) | Gasto | Leads | CPL | Agendou | Custo/agend. | Compareceu | Custo/compar.` · agrupável por campanha · linha **"Sem atribuição"** pros leads sem `utm_content` · selo *"gasto atualizado há Xh"* (de `synced_at`).

Código: `src/lib/dashboard/ads-queries.ts` (loaders) + `src/lib/dashboard/ads-types.ts` (shapes) + `src/components/dashboard/ads/` (componentes finos, um por bloco). Segue o padrão do dashboard atual (loader por widget + skeleton independente).

## 7 · Sync do Meta (n8n)

`WF-NS-AD-SPEND-SYNC` (nomenclatura WF-NS-*):
- **Schedule trigger** de hora em hora.
- **HTTP GET** Meta Marketing API Insights: `act_<id>/insights?level=ad&fields=spend,impressions,inline_link_clicks,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name&time_increment=1&date_preset=last_7d`. Paginar.
- **Upsert** em `ad_spend` on conflict `(account_id, date, ad_id)`.
- Credencial = token Meta com `ads_read` (somar escopo ao que o CAPI já usa, ou System User token novo). Mora no n8n / cofre — **nunca no env do wacrm**.

## 8 · Tratamento de erro / casos de borda (honestidade > esconder)

- Sync Meta falha → `ad_spend` velho: painel mostra *"gasto atualizado há Xh"*, colunas de custo viram "—"; **Blocos 1 e 2 intactos**.
- Criativo gastou mas `ad_name` não casa com nenhum `utm_content` (rename/typo) → linha com gasto e **0 leads** → flagra a má-config, não some.
- Lead sem `utm_content` → linha **"Sem atribuição"** (não escondido).
- Tudo bucketizado em **SP (UTC-3)**, igual ao resto do wacrm.
- Contagem de leads = **contatos distintos** (a dedup faz 1 contato ter vários deals) → não dobra.
- Guardrail §9: `value` de deal em BRL — irrelevante na Fatia 1 (só contagens; ROAS/faturamento ficam fora), mas o build não deve assumir moeda da conta como padrão.

## 9 · Dependências do Arthur (travam o custo, não o op-ao-vivo)

1. **Token Meta com `ads_read`** + `act_<id>` → cofre orchestrator.
2. **UTM nos anúncios** (ao montar a campanha Meta segunda): `utm_content={{ad.name}}` · `utm_campaign={{campaign.name}}` · `utm_medium`=origem (§8). Sem isso o join gasto↔lead não fecha.

## 10 · Verificação (como provo que funciona)

- **Métricas CRM:** seed/uso de deals/mensagens/appointments de teste → conferir cada número do Bloco 1/2 contra query direta no banco (mesma técnica do FU1: provar client-side com token real).
- **Sync Meta:** rodar o n8n manualmente → conferir linhas em `ad_spend` batendo com o Gerenciador do Meta (1 dia, 1 criativo).
- **Join:** criar lead de teste com `utm_content` = um `ad_name` real → custo/agendamento aparece na linha certa; lead sem utm cai em "Sem atribuição"; gasto sem lead vira linha com 0 leads.
- **QA visual** da rota nova (Chrome headless + chrome-devtools, igual à feature de dedup), com throwaway, limpando no fim.
- **Degradação:** desligar o sync (ou esvaziar `ad_spend`) → Blocos 1/2 de pé, custo "—".

## 11 · Ordem de implementação (vira o writing-plans)

1. Migration `ad_spend` + RLS.
2. `WF-NS-AD-SPEND-SYNC` no n8n + popular `ad_spend` (depende da dependência #1/#2 do Arthur).
3. `ads-queries.ts` + `ads-types.ts` (Blocos 1/2 primeiro — CRM puro; Bloco 3 depois).
4. Rota `/dashboard/anuncios` + componentes por bloco.
5. Verificação (CRM → join → QA visual → degradação).
6. Deploy (rsync + docker build, padrão wacrm).
