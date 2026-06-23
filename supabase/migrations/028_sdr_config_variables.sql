-- ============================================================
-- 028_sdr_config_variables.sql — custom prompt variables for the SDR agent.
--
-- Built-in variables (nome_cliente, valor_negocio, nome_agente, data_atual, …)
-- are code-defined and always available. Operator-defined custom variables —
-- each mapping a {{token}} to a custom_fields id — live here as a JSON array:
--   [{ "name": "plano_atual", "custom_field_id": "<uuid>", "fallback": "" }, …]
--
-- Idempotent.
-- ============================================================
ALTER TABLE sdr_config
  ADD COLUMN IF NOT EXISTS variables jsonb NOT NULL DEFAULT '[]'::jsonb;
