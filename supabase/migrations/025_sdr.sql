-- ============================================================
-- 025 · SDR (Pedro) inside wacrm — Fase C1 (inbound brain loop)
-- ============================================================
-- Ports the ns-crm SDR machinery onto wacrm's real tables:
--   * conversations.ai_status — the autopilot gate (on | off | human)
--   * sdr_config             — the standalone SDR system prompt per account
--   * appointments           — diagnoses booked by the SDR via the brain loop
-- The Pedro backend (/v6/llm/reply + /v6/calendar/*) stays external; this
-- migration only adds the state the loop reads/writes.

-- ── ai_status gate ─────────────────────────────────────────
-- 'off'   = no autopilot (default; protects the human Meta inbox)
-- 'on'    = Pedro answers inbound messages on this conversation
-- 'human' = Pedro handed off to a human ([HUMANO] marker / manual)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_status TEXT NOT NULL DEFAULT 'off'
  CHECK (ai_status IN ('on', 'off', 'human'));

CREATE INDEX IF NOT EXISTS idx_conversations_ai_status ON conversations(ai_status);

-- ── SDR system prompt (standalone, per account) ────────────
-- One row per account. Seeded from the tuned Pedro prompt; editable
-- via SQL/UI later without a redeploy. Decoupled from ns-crm's crm_kv.
CREATE TABLE IF NOT EXISTS sdr_config (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  system_prompt TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sdr_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Account members can read sdr_config" ON sdr_config;
CREATE POLICY "Account members can read sdr_config" ON sdr_config FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.account_id = sdr_config.account_id AND profiles.user_id = auth.uid()));
-- Writes are service-role only (seed / future settings endpoint).

-- ── appointments (diagnoses booked by the SDR) ─────────────
-- Mirrors ns-crm's createAppointment. The Google event + Meet link live
-- in Pedro's calendar; this row is the CRM-side record tied to the deal.
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_account ON appointments(account_id);
CREATE INDEX IF NOT EXISTS idx_appointments_contact ON appointments(contact_id);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Account members can manage appointments" ON appointments;
CREATE POLICY "Account members can manage appointments" ON appointments FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.account_id = appointments.account_id AND profiles.user_id = auth.uid()));
