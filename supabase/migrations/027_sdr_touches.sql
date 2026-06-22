-- ============================================================
-- 027_sdr_touches.sql — SDR follow-up queue (Phase C2).
--
-- The inbound brain loop (C1) answers when a lead writes first.
-- C2 is the OUTBOUND-FIRST side: when a FAP01 lead lands, Pedro
-- reaches out (confirm a booked diagnosis, or chase to book one),
-- then fires 24h / 2h reminders before the call.
--
-- ns-crm stored these touches in a `crm_kv` blob (`crm_sdr_touches`)
-- with read-modify-write of the whole array. wacrm uses a real
-- table — per-row writes, no lost-update race, and a partial unique
-- index gives `scheduleFirstTouchIfAbsent` idempotency for free.
--
-- A touch is account-scoped and points at the contact/deal/conversation
-- it acts on. `due_at` drives the cron; `status` is the lifecycle.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
CREATE TABLE IF NOT EXISTS sdr_touches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  type TEXT NOT NULL
    CHECK (type IN ('first_touch', 'reminder_24h', 'reminder_2h')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'skipped')),

  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- Normalised digits-only BR number (55DDDNUMBER).
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',

  due_at TIMESTAMPTZ NOT NULL,

  -- Reminders only: the call time they reference (ISO with SP offset)
  -- and the Meet/Calendly link, if any.
  event_start_iso TEXT,
  meet_link TEXT,

  -- "confirm" | "chase" | "sent" | "event_gone" | "already_talking" | "ai_off"
  resolution TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sdr_touches_due
  ON sdr_touches(account_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_sdr_touches_contact
  ON sdr_touches(contact_id);

-- At most one PENDING first_touch per contact — the DB-level guarantee
-- behind scheduleFirstTouchIfAbsent (cold→warm re-posts don't duplicate).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdr_touches_one_pending_first
  ON sdr_touches(contact_id)
  WHERE type = 'first_touch' AND status = 'pending';

ALTER TABLE sdr_touches ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON sdr_touches;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sdr_touches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS — internal/ops data. Members can read; writes happen server-side
-- via the service role (which bypasses RLS), so no INSERT/UPDATE policy
-- is granted to end users.
DROP POLICY IF EXISTS sdr_touches_select ON sdr_touches;
CREATE POLICY sdr_touches_select ON sdr_touches
  FOR SELECT USING (is_account_member(account_id));
