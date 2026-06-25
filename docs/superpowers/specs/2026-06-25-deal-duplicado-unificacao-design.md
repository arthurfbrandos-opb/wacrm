# Deal duplicado — detecção + unificação (FAP01)

> Design fechado com Arthur em 2026-06-25. Repo wacrm. Abordagem 1 (detecção computada + snapshot no deal).

## Problema

O webhook FAP01 (`src/app/api/webhooks/fap01/route.ts`) deduplica **contato** por telefone (um contato só, comportamento mantido), mas **cria um deal novo a cada POST** — sem dedup. Quando um lead se cadastra 2× (mesmo telefone), o contato fica um só porém com **2 deals abertos**, e o `fap01_data` do contato é **sobrescrito pelo cadastro mais novo** (o dado do 1º cadastro some silenciosamente).

Resultado: pipeline com cards duplicados e perda invisível de dado do cadastro anterior.

## Objetivo

1. Marcar visualmente os deals duplicados no funil (badge "duplicado").
2. Dar ao Arthur um botão **Unificar** no card que confronta os dados dos dois cadastros (antigo vs novo) e o deixa escolher, campo a campo, qual valor fica — consolidando em **1 deal só**.
3. Não perder o dado do cadastro anterior (preservar snapshot por deal).

**Fora de escopo:** mexer na dedup de contato (fica como está) · merge de contatos separados (telefones diferentes) · filtro/lista "todos os duplicados" (badge no funil resolve).

## Abordagem (escolhida: 1 — computada)

"Duplicado" é **computado** (contato com ≥2 deals abertos que têm `fap01_snapshot`), não um flag/tag persistido. O badge **se limpa sozinho** quando o merge deixa 1 deal — nada de estado pra dessincronizar.

## Componentes

### 1. Schema
- Nova coluna **`deals.fap01_snapshot jsonb`** (nullable). Guarda o payload do cadastro (`lead`) que criou aquele deal. Migration aditiva (`ADD COLUMN IF NOT EXISTS`).

### 2. Webhook (`fap01/route.ts`)
- No insert do deal, gravar `fap01_snapshot: lead`.
- **Nada mais muda:** 2º deal continua sendo criado; contato segue deduplicado por telefone; `fap01_data` do contato segue pegando o cadastro mais novo (UTM/atribuição inclusos = sempre o atual); `first_touch` segue deduplicado (1 só, amarrado ao 1º deal).

### 3. Detecção (computada)
- Um deal é "duplicado" quando **o contato dele tem ≥2 deals abertos (`status='open'`) com `fap01_snapshot IS NOT NULL`** na mesma conta. Deal criado manualmente (sem snapshot) não conta → sem falso-positivo.
- O endpoint que lista os deals do funil (board do kanban) devolve, por card, um sinal `duplicate_group_size` (nº de deals-de-funil abertos do contato). `>1` ⇒ duplicado.

### 4. Badge no funil (kanban)
- Card com `duplicate_group_size > 1` mostra o badge **"duplicado"** (estilo consistente com o IDV terminal/PT-BR já existente).
- Some sozinho quando vira 1.

### 5. Botão "Unificar" (popup do deal)
- No popup do deal (abas Negócio/Cadastro/UTMs/Notas), quando o deal é duplicado, mostrar um aviso + botão **"Unificar"**.
- Abre o modal de unificação.

### 6. Modal de unificação
- Carrega os deals abertos (com snapshot) do contato + seus `fap01_snapshot`, ordenados por `created_at`.
- **Primário** = o mais **antigo** (carrega `first_touch`/régua). "Antigo" = snapshot do primário; "Novo" = snapshot do mais recente.
- Confronta campo a campo os campos do **cadastro** (do `Fap01Lead`):
  `contact_name`, `contact_email`, `company_name`, `faturamento_range`, `nicho`, `processo_foco`, `urgencia`, `tem_socio`.
  - Campo **igual** nos dois → mostra o valor, sem escolha.
  - Campo **divergente** → rádio **Antigo / Novo** (default = **Novo**, que é o atual do contato).
- **UTM/atribuição não entra na escolha** — fica sempre o mais novo (já é o que está no contato).

### 7. Ação de merge (endpoint, transacional)
Entrada: `dealId` (o card de onde veio) + as escolhas por campo.
1. Resolve os deals abertos-com-snapshot do contato; define **primário** = mais antigo.
2. Monta o `fap01_data` final do contato = (mais novo) com os campos divergentes sobrescritos pelas escolhas "Antigo"; aplica também nos campos nativos (`name`/`email`/`company`).
3. `UPDATE contacts` com o resultado.
4. `DELETE` dos deals não-primários do grupo.
5. Tudo escopado por `account_id`. Atômico (transação / RPC): se o delete falhar, não aplica o update do contato.
- Pós-merge sobra 1 deal ⇒ badge some. Régua/toques seguem (amarrados ao contato e ao deal primário que sobreviveu).

### 8. Casos de borda
- **Snapshots idênticos** (mesmo cadastro 2×) → modal mostra "sem divergência"; Unificar = só apagar o(s) duplicado(s).
- **>2 duplicados** → primário = mais antigo; compara contra o mais recente (MVP foca em 2; os do meio são absorvidos mantendo o primário). Documentar essa simplificação na UI ("unifica mantendo o cadastro mais antigo como base").
- **Corrida** (alguém já unificou) → se ao confirmar só houver 1 deal aberto, no-op + refresh.
- Deal manual (sem snapshot) nunca entra no grupo de duplicados.

## Fluxo de dados

```
Lead cadastra → webhook: cria deal (fap01_snapshot=lead) + sobrescreve contact.fap01_data (mais novo)
Lead cadastra DE NOVO → webhook: cria 2º deal (fap01_snapshot=lead novo) + sobrescreve contact.fap01_data; first_touch já existe
Kanban lista deals → server computa duplicate_group_size por contato → card mostra badge "duplicado"
Arthur abre card duplicado → botão Unificar → modal diffa snapshots (cadastro) → escolhe campo a campo
Confirma → merge: aplica escolhas no contato + apaga deals não-primários → badge some
```

## Error handling
- Merge atômico (RPC/transação); falha no delete ⇒ rollback do update do contato.
- Tenant scoping (`account_id`) em toda leitura/escrita (service-role bypassa RLS).
- Idempotente sob corrida (re-checa o grupo no confirm).

## Testes (TDD)
- Webhook grava `fap01_snapshot` no deal.
- Detecção: contato com 2 deals-funil abertos ⇒ duplicado; com 1 ⇒ não; deal manual (sem snapshot) ⇒ não conta.
- Merge: escolhas aplicadas no contato (nativos + fap01_data) · deals não-primários apagados · primário (régua) sobrevive · UTM = mais novo · idempotente sob 1-deal.
- Borda: snapshots idênticos ⇒ sem divergência, merge só apaga.

## Arquivos prováveis (a fixar no plano)
- Migration: `supabase/migrations/0XX_deals_fap01_snapshot.sql`.
- Webhook: `src/app/api/webhooks/fap01/route.ts` (insert do deal).
- Listagem do board (sinal de duplicado) + componente do card do kanban (badge).
- Popup do deal (aviso + botão Unificar) + novo modal de unificação.
- Endpoint de merge (`src/app/api/.../unify` ou server action) + RPC/transação.
