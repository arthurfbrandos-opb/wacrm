-- ============================================================
-- 026_wa_connections.sql — Resolve the whatsapp_connections name
-- collision with the legacy ns-crm CRM that shares this Supabase.
--
-- Background
--   * wacrm and the legacy ns-crm both live in the SAME Supabase
--     (project sglswwhfthqpdybxixal). ns-crm stores almost everything
--     in `crm_kv` blobs, so there were no table-name collisions —
--     EXCEPT `whatsapp_connections`, which ns-crm created as a real
--     table (id/instance_name/phone/status/agent_id) on 2026-06-10 to
--     hold its Evolution instance config.
--   * Migration 024 tried to `CREATE TABLE IF NOT EXISTS
--     whatsapp_connections (...)` with the wacrm schema. Because the
--     ns-crm table already owned the name, the IF NOT EXISTS made the
--     create a NO-OP: wacrm's UazAPI persistence layer was never
--     created. 024's ALTERs on contacts/messages DID apply, so the
--     collision was invisible to a "does the table exist / did the
--     columns land" audit.
--   * ns-crm reads `whatsapp_connections` at runtime (sdr/repository.ts
--     resolves SDR_INSTANCE_NAME against it; it still serves FAP01
--     live), so we cannot rename or drop the ns-crm table. Instead,
--     wacrm gets its own table: `wa_connections`. Decision 2026-06-22
--     (Arthur: ns-crm will be decommissioned; rename the dev fork's
--     table, zero blast radius on the live FAP01 path).
--
-- What this migration does
--   1. Creates `wa_connections` with the schema 024 intended for
--      `whatsapp_connections` (UazAPI-only). Same columns, indexes,
--      RLS, trigger — only the object names are namespaced wa_*.
--   2. Re-points the `contacts.connection_id` FK from the ns-crm
--      `whatsapp_connections` table to `wa_connections`. The column
--      and its data (currently all NULL — no UazAPI contacts yet)
--      are untouched.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- WA_CONNECTIONS (UazAPI-only — Meta stays in whatsapp_config)
-- Token columns are AES-256-GCM ciphertext (Node crypto, shared
-- ENCRYPTION_KEY) stored as TEXT (`<iv>:<ct>:<tag>` hex). Same
-- rationale as 024.
-- ============================================================
CREATE TABLE IF NOT EXISTS wa_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  provider TEXT NOT NULL DEFAULT 'uazapi'
    CHECK (provider IN ('meta', 'uazapi')),

  label TEXT NOT NULL,
  base_url TEXT NOT NULL,

  access_token_enc TEXT NOT NULL,
  webhook_token_enc TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'failed')),
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,

  is_active_for_crm BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_connections_account
  ON wa_connections(account_id);
CREATE INDEX IF NOT EXISTS idx_wa_connections_status
  ON wa_connections(account_id, status);

-- At most one CRM-active connection per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_connections_one_active
  ON wa_connections(account_id)
  WHERE is_active_for_crm = true;

ALTER TABLE wa_connections ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON wa_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON wa_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- RLS — settings-class (admin+ write, viewer+ read). Service role
-- bypasses for server-side API.
-- ============================================================
DROP POLICY IF EXISTS wa_connections_select ON wa_connections;
DROP POLICY IF EXISTS wa_connections_insert ON wa_connections;
DROP POLICY IF EXISTS wa_connections_update ON wa_connections;
DROP POLICY IF EXISTS wa_connections_delete ON wa_connections;

CREATE POLICY wa_connections_select ON wa_connections
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY wa_connections_insert ON wa_connections
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY wa_connections_update ON wa_connections
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY wa_connections_delete ON wa_connections
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- CONTACTS — re-point connection_id FK to wa_connections.
-- 024 created `contacts.connection_id UUID REFERENCES
-- whatsapp_connections(id)`, which bound the FK to the ns-crm table.
-- Drop and recreate it against wa_connections. The column data is
-- all NULL today (no UazAPI contacts yet), so no rows are affected.
-- ============================================================
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_connection_id_fkey;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_connection_id_fkey
  FOREIGN KEY (connection_id) REFERENCES wa_connections(id) ON DELETE SET NULL;
