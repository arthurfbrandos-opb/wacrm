-- ============================================================
-- 032_unify_duplicate_deals.sql — merge atômico de deals duplicados.
--
-- Aplica o cadastro escolhido no contato e apaga os deals não-primários,
-- numa transação só. Tudo escopado por account_id; só service_role chama.
-- ============================================================
CREATE OR REPLACE FUNCTION unify_duplicate_deals(
  p_account_id uuid,
  p_contact_id uuid,
  p_primary_deal_id uuid,
  p_delete_deal_ids uuid[],
  p_name text,
  p_email text,
  p_company text,
  p_fap01_data jsonb
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  -- O primário tem que existir, ser do contato e da conta, e estar aberto.
  IF NOT EXISTS (
    SELECT 1 FROM deals
    WHERE id = p_primary_deal_id AND account_id = p_account_id
      AND contact_id = p_contact_id AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'primary deal inválido';
  END IF;

  UPDATE contacts
  SET name = p_name, email = p_email, company = p_company,
      fap01_data = p_fap01_data, updated_at = now()
  WHERE id = p_contact_id AND account_id = p_account_id;

  -- Só apaga deals abertos, da conta, do contato, e que NÃO são o primário.
  DELETE FROM deals
  WHERE id = ANY(p_delete_deal_ids)
    AND account_id = p_account_id
    AND contact_id = p_contact_id
    AND status = 'open'
    AND id <> p_primary_deal_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION unify_duplicate_deals(uuid,uuid,uuid,uuid[],text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION unify_duplicate_deals(uuid,uuid,uuid,uuid[],text,text,text,jsonb) FROM anon;
REVOKE ALL ON FUNCTION unify_duplicate_deals(uuid,uuid,uuid,uuid[],text,text,text,jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION unify_duplicate_deals(uuid,uuid,uuid,uuid[],text,text,text,jsonb) TO service_role;
