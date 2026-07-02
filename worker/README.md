# Worker da Squad Content

Processo que roda **no VPS** drenando a fila `content_jobs`: pega o pedido do cliente
(chat da ferramenta), roda o Claude headless dentro do **repo-cérebro** (`conteudo-rodolfo`)
e devolve a peça no kanban "Pra aprovar" + resposta no chat + custo no `os_cost_ledger`.

Zero dependência npm — Node ≥18 puro (`fetch` nativo), mesmo espírito do painel do validador.

## Rodar

```bash
node worker/content-worker.mjs
```

### Env obrigatório

| Var | O quê |
|---|---|
| `SUPABASE_URL` | URL do Supabase NS |
| `SUPABASE_SERVICE_ROLE_KEY` | service role (escrita nas tabelas content_* / ledger) |
| `CONTEUDO_REPO_DIR` | caminho do repo-cérebro (clone do `conteudo-rodolfo`) |

### Env opcional

| Var | O quê |
|---|---|
| `WORKER_FAKE=1` | modo plumbing: fila→peça→chat→job sem chamar o Claude (sem custo) |
| `GERADOR_MODEL` | modelo do claude CLI (vazio = padrão da conta) |
| `POLL_MS` | intervalo do poll (default 5000) |
| `STORAGE_BUCKET` | bucket das prévias (default `content-previews`) |
| `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` | **hudapi** — o claude CLI herda do ambiente |
| `ENCRYPTION_KEY` | mesma do app (hex) — decripta a credencial do Metricool (fatia ⑤) |
| `METRICOOL_MCP_TEMPLATE` | caminho do template JSON do MCP do Metricool com `{{METRICOOL_TOKEN}}` — o formato exato de auth do MCP oficial (`ai.metricool.com/mcp`) é confirmado no setup com o token real, não inventado aqui |
| `GOOGLE_API_KEY` | API key da NS (GCP · restrita à Drive API) — lista/baixa as imagens da **pasta por link** do cliente pra `referencia/fundos-cliente/` antes de produzir. Sem a key, o sync é pulado (agente usa `referencia/` padrão) |

## Setup no VPS (uma vez)

1. **Pré-requisitos no host/container:** Node ≥18 · `claude` CLI · Python ≥3.10 +
   `requirements.txt` do repo-cérebro (os renderizadores de arte usam Python) ·
   clone do `conteudo-rodolfo` em `CONTEUDO_REPO_DIR`.
2. **Bucket:** criar `content-previews` no Supabase Storage (**público para leitura**) —
   as prévias das peças são servidas por URL pública.
3. **Migrations:** 037 e 038 aplicadas (psql via cofre).
4. **Credencial LLM (hudapi):** copiar do cofre `~/Projects/orchestrator/.env` (seção
   HUDAPI) direto pro env do serviço **arquivo→arquivo (scp), nunca pelo chat**.
   ⚠️ **A chave HUDAPI caiu em chat em 21/06 — ROTACIONAR no painel hudapi.cloud
   antes de colocar em produção** (ver skill `llm-provider-rotate`).
   Fallback (se o hudapi travar demais): plano OAuth — `claude login` no ambiente do
   worker com a conta do Arthur; aí NÃO setar `ANTHROPIC_*`.
5. **Serviço:** rodar como serviço supervisionado (docker compose service ou systemd)
   com restart automático. Log em stdout.

## Smoke (antes de apontar cliente)

```bash
# 1. plumbing sem custo:
WORKER_FAKE=1 SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node worker/content-worker.mjs
# → manda mensagem no chat da ferramenta → em segundos a peça FAKE cai no kanban.

# 2. real (1 peça):
# env completo + mandar "gera um estático sobre <tema>" no chat → conferir peça,
# prévia, legenda, custo no os_cost_ledger e resposta no chat.
```

## Contrato com o agente (o que o Claude devolve)

Última mensagem = SOMENTE JSON:

```json
{"reply": "resposta pro chat", "peca": {"slug": "…", "titulo": "…", "tipo": "carrossel|estatico", "legenda": "…", "arquivo_preview": "producao/<slug>/slide-01.png"}}
```

`peca: null` quando a mensagem não pede produção. Parser tolera texto em volta do JSON;
resposta fora do contrato → job `failed` + resposta honesta de erro no chat (cliente
nunca fica no vácuo).

## Aprendizados HARD embutidos (não remover)

- `--setting-sources project,local` no spawn do claude — sem isso hooks globais do
  usuário matam o headless (lição 21/06 do painel do validador).
- Claim otimista do job (`PATCH … status=eq.pending`) — só vira `running` se ainda
  estiver `pending`.
- Custo por job vai pro `os_cost_ledger` do tenant → Cost Center/fair use (C8).
