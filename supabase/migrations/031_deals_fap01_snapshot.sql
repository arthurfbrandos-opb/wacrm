-- ============================================================
-- 031_deals_fap01_snapshot.sql — snapshot do cadastro que criou o deal.
--
-- O webhook FAP01 sobrescreve contacts.fap01_data com o cadastro mais novo;
-- guardando o payload por-deal a gente preserva cada versão (antigo vs novo)
-- pra tela de unificação de duplicados. Idempotente.
-- ============================================================
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS fap01_snapshot jsonb;
