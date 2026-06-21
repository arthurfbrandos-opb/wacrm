-- ============================================================
-- 024_whatsapp_connections.sql — Per-account WhatsApp provider
-- model with selectable CRM-active connection.
--
-- Pre-state
--   * Meta Cloud API config lives in `whatsapp_config` (one row
--     per `account_id`, added in 017_account_sharing.sql).
--   * UazAPI was wired in code (Phase 1) but had no persistence
--     layer at all — the active provider was a runtime env var.
--   * `contacts` / `messages` carried no provider information.
--
-- What this migration does
--   1. Adds a UazAPI-only `whatsapp_connections` table. One account
--      may register N UazAPI instances (e.g. several WhatsApp
--      numbers driven by separate Evolution/UazAPI containers).
--   2. Enforces "at most ONE connection is the CRM-active one per
--      account" via a partial unique index on `(account_id) WHERE
--      is_active_for_crm = true`. The webhook send pipeline picks
--      the active connection at runtime.
--   3. Adds `provider` ('meta' | 'uazapi') and `connection_id` on
--      `contacts` so a contact can be tied to the provider it
--      currently uses. `provider` defaults to 'meta' for back-compat
--      with existing rows. `connection_id` is nullable because Meta
--      rows don't point at a `whatsapp_connections` row.
--   4. Adds `provider` on `messages` for traceability / future
--      filtering (Kanban badge, ops debugging). It mirrors the
--      contact's provider at insert time.
--   5. Tokens / secrets stored ciphertext via pgcrypto
--      (PGP_SYM_ENCRYPT), keyed off `current_setting('app.token_key')`
--      so the master key never touches SQL. Application code calls
--      `set_config('app.token_key', <key>, true)` in the same
--      transaction it reads/writes the secret.
--
-- What this migration does NOT do
--   * Does not migrate data out of `whatsapp_config` — that table
--     stays the canonical Meta store (decision recorded 2026-06-21).
--   * Does not change RLS for `whatsapp_config`.
--   * Does not wire the webhook to choose connection by account_id
--     — that lands in the next PR (API + webhook rewire).
--
-- Idempotent — safe to run multiple times. New columns / tables /
-- indexes use IF NOT EXISTS; constraints are dropped before recreate.
-- ============================================================

-- ============================================================
-- EXTENSION
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- WHATSAPP_CONNECTIONS (UazAPI-only — Meta stays in whatsapp_config)
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- 'meta' is reserved for future use; today only 'uazapi' is allowed.
  -- Keeping the column in place means the UI can branch on provider
  -- uniformly even though Meta records live in whatsapp_config.
  provider TEXT NOT NULL DEFAULT 'uazapi'
    CHECK (provider IN ('meta', 'uazapi')),

  -- Display name shown in the Workspace UI ("Comercial SP",
  -- "Pessoal", "Loja 2", etc.). Free-form.
  label TEXT NOT NULL,

  -- UazAPI base URL (e.g. https://uazapi.example.com).
  base_url TEXT NOT NULL,

  -- Cifrado simétrico (pgcrypto PGP_SYM_ENCRYPT). The plaintext token
  -- never lands on disk. Reads require set_config('app.token_key', ...).
  access_token_enc BYTEA NOT NULL,

  -- Cifrado também — usado pra validar X-Webhook-Token no inbound.
  -- Separate do access_token pra permitir rotação independente.
  webhook_token_enc BYTEA,

  -- Status do handshake inicial (HTTP probe na base_url). O test de
  -- conexão é disparado pelo app na hora de salvar e atualiza esse
  -- campo. NUNCA bloqueia gravação — se falhou, ainda assim
  -- persistimos (usuário corrige depois).
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'failed')),
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,

  -- "At most one connection drives the CRM/agent at any time".
  -- Marcado true na única conexão que o bot de fluxo / agente IA
  -- usa pra ENVIAR mensagens hoje. Webhooks continuam entrando
  -- em qualquer conexão (cada UazAPI instance posta no nosso
  -- /api/whatsapp/webhook com seu próprio token).
  is_active_for_crm BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_account
  ON whatsapp_connections(account_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_status
  ON whatsapp_connections(account_id, status);

-- Partial unique: só pode existir uma conexão ativa por conta.
-- É o que garante a invariante "1 provedor ativo por vez".
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_connections_one_active
  ON whatsapp_connections(account_id)
  WHERE is_active_for_crm = true;

ALTER TABLE whatsapp_connections ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- RLS — connections são settings-class (admin+ pra escrita,
-- viewer+ pra leitura). Service role bypassa pra API server-side.
-- ============================================================
DROP POLICY IF EXISTS whatsapp_connections_select ON whatsapp_connections;
DROP POLICY IF EXISTS whatsapp_connections_insert ON whatsapp_connections;
DROP POLICY IF EXISTS whatsapp_connections_update ON whatsapp_connections;
DROP POLICY IF EXISTS whatsapp_connections_delete ON whatsapp_connections;

CREATE POLICY whatsapp_connections_select ON whatsapp_connections
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY whatsapp_connections_insert ON whatsapp_connections
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_connections_update ON whatsapp_connections
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_connections_delete ON whatsapp_connections
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- CONTACTS — adiciona provider + connection_id
--
-- * provider = 'meta' defaulta pra todas as linhas existentes.
--   (Back-compat: não faz sentido 'meta' e 'uazapi' coexistirem
--   na mesma conta antes desse PR, e se coexistirem, default em
--   'meta' casa com a config antiga.)
-- * connection_id é NULLABLE — Meta não aponta pra
--   whatsapp_connections, só UazAPI.
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'uazapi')),
  ADD COLUMN IF NOT EXISTS connection_id UUID
    REFERENCES whatsapp_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_provider
  ON contacts(account_id, provider);
CREATE INDEX IF NOT EXISTS idx_contacts_connection
  ON contacts(account_id, connection_id)
  WHERE connection_id IS NOT NULL;

-- ============================================================
-- MESSAGES — adiciona provider (read-only na prática; inserido
-- pelo webhook / send pipeline de acordo com o provider que
-- originou / entregou).
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'uazapi'));

CREATE INDEX IF NOT EXISTS idx_messages_provider
  ON messages(conversation_id, provider);

-- ============================================================
-- BACKFILL NOTE
-- ============================================================
-- Nenhum backfill de dados necessário: as colunas novas têm
-- DEFAULT 'meta' e whatsapp_connections começa vazia. Migração
-- só estrutura — quem decide o provider pra contatos existentes
-- é a UI / send pipeline daqui pra frente.
--
-- Webhook UazAPI que entrar a partir daqui:
--   * INSERT em whatsapp_connections (account_id vem do payload)
--   * INSERT/UPDATE em contacts com provider='uazapi' + connection_id
--   * INSERT em messages com provider='uazapi'