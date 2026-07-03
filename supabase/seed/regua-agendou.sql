-- Seed: régua "Follow-up Agendou" (02/07/2026) — lead agendou no Calendly e
-- NÃO respondeu a confirmação/qualificação do Ian → 1 toque +3h por template
-- (fu_agendou_quali · cancel_on_reply mata se ele responder antes).
-- Idempotente. Depende do template fu_agendou_quali APPROVED na Meta —
-- antes disso o toque é pulado com log (rede de segurança do engine).
DO $$
DECLARE
  v_account uuid := '7eb23b90-ce66-40bc-8e23-1d2ac6458300'; -- conta NS
  v_user uuid;
  v_tag uuid;
  v_auto uuid;
BEGIN
  SELECT owner_user_id INTO v_user FROM accounts WHERE id = v_account;
  IF v_user IS NULL THEN RAISE EXCEPTION 'conta NS não encontrada'; END IF;

  SELECT id INTO v_tag FROM tags WHERE account_id = v_account AND name = 'fu-agendou';
  IF v_tag IS NULL THEN
    INSERT INTO tags (account_id, user_id, name) VALUES (v_account, v_user, 'fu-agendou')
    RETURNING id INTO v_tag;
  END IF;

  SELECT id INTO v_auto FROM automations WHERE account_id = v_account AND name = 'Follow-up Agendou';
  IF v_auto IS NULL THEN
    INSERT INTO automations (account_id, user_id, name, description, trigger_type, trigger_config, is_active, cancel_on_reply)
    VALUES (
      v_account, v_user, 'Follow-up Agendou',
      'Lead agendou e não respondeu a qualificação → 1 toque +3h por template.',
      'tag_added', jsonb_build_object('tag_id', v_tag), true, true
    ) RETURNING id INTO v_auto;

    INSERT INTO automation_steps (automation_id, step_type, position, step_config) VALUES
      (v_auto, 'wait', 0, '{"unit": "hours", "amount": 3}'::jsonb),
      (v_auto, 'send_ai', 1, jsonb_build_object(
        'guidance', 'Lembra o lead, leve e sem cobrança, de responder as 2 perguntas rápidas de qualificação antes da call com o Arthur — ajuda a preparar o diagnóstico pro caso dele.',
        'template', jsonb_build_object(
          'name', 'fu_agendou_quali',
          'lang', 'pt_BR',
          'body', E'Oi, {{1}}! Ian aqui. Tua call de diagnóstico com o Arthur tá agendada, tá tudo certo.\n\nAntes dela, me responde aquelas 2 perguntas rápidas? Me ajuda a preparar o diagnóstico pro teu caso e a call rende muito mais.'
        )
      ));
  END IF;
END $$;

-- Conferência
SELECT a.name, a.trigger_config->>'tag_id' tag_id, a.cancel_on_reply, count(s.id) passos
FROM automations a LEFT JOIN automation_steps s ON s.automation_id = a.id
WHERE a.name = 'Follow-up Agendou' GROUP BY a.id, a.name, a.trigger_config, a.cancel_on_reply;
