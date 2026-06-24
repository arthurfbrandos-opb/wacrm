-- 030_automations_cancel_on_reply.sql — flag: encerrar a sequência quando o lead responde.
ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS cancel_on_reply boolean NOT NULL DEFAULT false;
