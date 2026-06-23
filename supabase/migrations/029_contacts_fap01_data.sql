-- ============================================================
-- 029_contacts_fap01_data.sql — keep the full FAP01 lead payload.
--
-- The FAP01 webhook receives a rich lead (qualification: faturamento, nicho,
-- sócio, processo, urgência, num_funcionarios; origin: utm_source/medium/
-- campaign, referrer, attribution; quiz answers) but only persisted a text
-- note + the native name/email/company. Store the whole object so the contact
-- page can show cadastro + quiz + UTMs.
--
-- Idempotent.
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS fap01_data jsonb;
