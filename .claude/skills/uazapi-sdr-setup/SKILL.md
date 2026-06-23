---
name: uazapi-sdr-setup
description: >
  Use quando for conectar um número de WhatsApp via UazAPI (canal não-oficial)
  ao SDR do wacrm (o agente "Ian"), ou quando o inbound não chega / o Ian não
  responde às mensagens do lead. Cobre cadastro da conexão, webhook, contrato do
  normalizer e verificação E2E. NÃO use para o canal Meta Cloud API (oficial) nem
  para o backend do Ian (`/v6/llm/reply`) — aqui é só a camada UazAPI ↔ wacrm.
---

# UazAPI → SDR do wacrm (Ian)

Conecta um número WhatsApp via **UazAPI** (Baileys, não-oficial) ao wacrm para o **Ian** (SDR) abordar e responder leads. O caminho Meta Cloud API é independente. Deploy do wacrm = `rsync ~/Projects/wacrm → /opt/wacrm` + `docker compose build/up` no VPS `srv1571722`.

## Quando usar

- Conectar um número novo (instância UazAPI) ao wacrm para o Ian operar nele.
- O lead respondeu mas **o Ian não avança** / a mensagem não aparece no CRM (inbound não chega ou é descartado).
- Trocar o token da instância (ex.: o demo `free.uazapi.com` expirou — morre em **1h** → `401`).
- **NÃO use quando:** o canal é Meta oficial (`whatsapp_config`), ou o problema é no cérebro do Ian (prompt/booking no backend `/v6/llm/reply`), ou é a esteira FAP01→CRM (use o webhook `/api/webhooks/fap01`).

## Contexto fixo

- Conta NS no wacrm: `account_id = 7eb23b90-ce66-40bc-8e23-1d2ac6458300`. Pipeline SDR: `97565e48-f12b-3c95-bcf2-f5707237d9cd` (= `md5('pl:pipeline-pre-vendas-sdr')::uuid`).
- Banco NS: `psql "$SUPABASE_NS_DB_URL"` (cofre orchestrator `.env`). Encrypt/decrypt de token: `docker exec wacrm node -e ...` usando a env `ENCRYPTION_KEY` (AES-256-GCM, formato `iv:ct:tag`).
- Webhook global: `UAZAPI_WEBHOOK_TOKEN` em `/opt/wacrm/.env`. Inbound roteia por: token na query `?token=` casa um `wa_connections.webhook_token_enc`, OU (fallback) o token global + **1 conexão ativa única**.

## Shape REAL do webhook da free.uazapi (decorar)

O normalizer (`src/lib/whatsapp/payload-normalizer.ts`) TEM que tratar este shape — não o estilo Evolution:

```json
{ "EventType": "messages",                       // discriminador é EventType, NÃO "event"
  "chat": { "...": "objetão com lead_field01..20, wa_*" },
  "message": {
    "chatid": "5511976986356@s.whatsapp.net",    // telefone vem do chatid (NÃO existe "from")
    "content": "Pode", "text": "Pode",           // text é STRING
    "fromMe": false, "isGroup": false,
    "owner": "5519958714237",                    // STRING = nº da instância (NÃO é flag de outbound)
    "messageType": "Conversation",
    "messageid": "3A6D…", "id": "<owner>:3A6D…",
    "messageTimestamp": 1782220653000            // MILISSEGUNDOS (13 díg.)
  },
  "owner": "…", "token": "<instance token>" }
```

Também chegam **mensagens de grupo** (`@g.us`, `isGroup:true`) e **`messages_update`/ReadReceipt** (Delivered) → ambos = ruído, pular.

## Processo

### Passo 1 — cadastrar a conexão (`wa_connections`)
1. Pegue da UazAPI: **Server URL** (`https://free.uazapi.com`) + **Instance Token** (UUID). Confirme vivo: `GET {base}/instance/status` header `token:` → `"status":"connected"`.
2. Encripte o token dentro do container (a `ENCRYPTION_KEY` mora lá):
   ```bash
   ssh srv1571722.hstgr.cloud 'docker exec wacrm node -e "const c=require(\"crypto\");const k=process.env.ENCRYPTION_KEY;const iv=c.randomBytes(12);const ci=c.createCipheriv(\"aes-256-gcm\",Buffer.from(k,\"hex\"),iv);let e=ci.update(\"<INSTANCE_TOKEN>\",\"utf8\",\"hex\");e+=ci.final(\"hex\");console.log(iv.toString(\"hex\")+\":\"+e+\":\"+ci.getAuthTag().toString(\"hex\"))"'
   ```
3. INSERT (número novo) ou UPDATE (troca de token) em `wa_connections` com `account_id`, `provider='uazapi'`, `base_url`, `access_token_enc=<blob>`, `status='connected'`, `is_active_for_crm=true`. **Só 1 ativa por conta** (o roteamento por token global depende disso).

### Passo 2 — webhook na UazAPI (do VPS, token global server-side)
```bash
ssh srv1571722.hstgr.cloud 'WT=$(grep "^UAZAPI_WEBHOOK_TOKEN=" /opt/wacrm/.env | cut -d= -f2- | tr -d "\"");
curl -s -X POST https://free.uazapi.com/webhook -H "token: <INSTANCE_TOKEN>" -H "content-type: application/json" \
  -d "{\"url\":\"https://crm.negocio-simples.com/api/whatsapp/webhook?token=${WT}\",\"enabled\":true,\"events\":[\"messages\",\"messages_update\"]}"'
```
- **NÃO** mande `excludeMessages` (deixe `[]`) — o normalizer já pula `fromMe`/grupo. Confirme com `GET {base}/webhook`.

### Passo 3 — contrato do normalizer (já implementado · não regredir)
O normalizer deve: ler `EventType||event`; pegar a mensagem de `evt.message`; resolver telefone via `chatidToPhone(chatid)` (split `@`, pular `@g.us`); pular **só** `fromMe===true` (NUNCA por `owner`, que é string); pular `isGroup`; ler `content` string; e **converter `messageTimestamp` de ms→s** (`if (ts>1e12) ts/=1000`, senão o INSERT estoura `time zone displacement out of range`). O reply do Ian sai por `resolveAccountProvider(accountId)` (conexão ativa), **não** por `contact.provider`.

### Passo 4 — verificar E2E
1. Cadastro FAP01 qualificado (`passed_lowtier_gate:true`) → cria deal SDR + first_touch. (Lead novo nasce com 55 — o nó "Normalize NS" do n8n já faz prepend.)
2. Expedir o touch + disparar o cron → o **Ian aborda** o lead:
   ```bash
   psql "$SUPABASE_NS_DB_URL" -c "update sdr_touches set due_at=now() where contact_id=(select id from contacts where phone='<NUM>') and status='pending';"
   ssh srv1571722.hstgr.cloud 'SECRET=$(grep "^SDR_CRON_SECRET=" /opt/wacrm/.env|cut -d= -f2-); curl -s -X POST https://crm.negocio-simples.com/api/cron/sdr-touches -H "x-cron-secret: $SECRET"'
   ```
3. Responder do número do lead → conferir no banco que entrou `customer` + o Ian respondeu (`sender_type='agent'`, `provider='uazapi'`).

**Atalho engatilhado:** `scripts/e2e-live-sdr.sh <numero> [nome] [email]` faz os passos 1-2 + lê de volta o que o Ian mandou (confirm se houver booking Calendly com o email; senão chase). As respostas do lead (C1) entram sozinhas pelo webhook. Não limpa — imprime o bloco CLEANUP.

## Checklist de armadilhas

- ⏳ **free.uazapi é DEMO**: instância morre em ~1h → `401` em tudo. Produção precisa instância persistente.
- 🕐 **Timestamp em ms**: free.uazapi manda 13 dígitos; converter pra segundos (o downstream multiplica por 1000).
- 👤 **`owner` é string** (nº da instância), em TODA mensagem — nunca usar pra detectar outbound; use `fromMe`.
- 👥 **Grupo/ReadReceipt** = ruído: pular `isGroup` e `messages_update`.
- 📡 **Provider pela conexão ativa**: o reply usa `resolveAccountProvider`, não `contact.provider` (leads migrados têm `provider='meta'` → daria `no whatsapp_config`).
- 📱 **55 no n8n**: lead FAP01 grava número sem 55 se o nó "Normalize NS" não fizer prepend → outbound vai pra número quebrado.
- 🔔 **`notifyArthur`** manda pra `ARTHUR_WHATSAPP`. Se você testar COMO o lead nesse mesmo número, o aviso interno cai no mesmo chat — **não é vazamento de produção** (lead ≠ ARTHUR_WHATSAPP).
- 🐛 **Debug do inbound**: Caddy NÃO loga acesso. Pra ver se chegou, logue o corpo cru no topo do `POST` do route (temporário, REMOVER depois — loga PII). Fallback sem depender da UazAPI: POST sintético direto no webhook com o token global e o shape real.

## Typing "Digitando…"

`POST {base}/send/text` aceita `delay` (ms) → mostra presença composing antes de enviar. Já wirado em `uazapi-send.ts`/`send.ts` proporcional ao texto (≈35ms/char, piso 900ms, teto 4s), vale C1 (reply) e C2 (touch).

## Deploy

```bash
cd ~/Projects/wacrm
rsync -az --exclude node_modules --exclude .next --exclude .git ./ srv1571722.hstgr.cloud:/opt/wacrm/
ssh srv1571722.hstgr.cloud 'cd /opt/wacrm && docker compose build wacrm && docker compose up -d wacrm'
```
Verificar por efeito (homepage 307 · POST sintético → `customer` no banco), não por log de sucesso (route só loga em rejeição).

## Referências

- Memória: `project_wacrm_ian_uazapi_live_2026_06_23` (shape + 3 bugs + processo) · `project_wacrm_vps_producao_2026_06_22` (infra) · `reference_ddl_banco_ns_cofre`.
- Código: `src/lib/whatsapp/{payload-normalizer,uazapi-send,uazapi-routing}.ts` · `src/lib/sdr/{processor,send,touches-processor,templates}.ts` · `src/app/api/whatsapp/webhook/route.ts`.
