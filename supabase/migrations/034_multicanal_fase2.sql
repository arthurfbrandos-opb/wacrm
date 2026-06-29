-- ============================================================
-- 034_multicanal_fase2.sql — Fase 2 multi-canal WhatsApp.
--   1. sdr_config.fap01_source: origem principal do 1º contato FAP01.
--   2. conversations.last_inbound_at: timestamp do último inbound
--      (sender_type='customer'), sinal da janela de 24h da Meta.
-- Banco Supabase COMPARTILHADO — colunas conferidas contra o banco vivo.
-- Idempotente.
-- ============================================================
ALTER TABLE sdr_config
  ADD COLUMN IF NOT EXISTS fap01_source TEXT NOT NULL DEFAULT 'meta'
  CHECK (fap01_source IN ('meta', 'uazapi'));

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
