-- 040: no máximo UM deal aberto por contato por funil (backstop anti-duplicado).
-- A entrada FAP01 agora reaproveita o deal aberto no reenvio do formulário
-- (upsertSdrDeal); este índice garante que inserts em corrida não passem um
-- duplicado pelo check da aplicação. Dados existentes foram unificados à mão
-- em 01/07/2026 (zero linhas em conflito na hora da migration).
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_one_open_per_contact_pipeline
  ON deals (account_id, contact_id, pipeline_id)
  WHERE status = 'open';
