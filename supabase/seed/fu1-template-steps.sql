-- Seed: templates Meta dos toques da régua "Follow-up 1" (Meta-only, 02/07/2026).
-- Toques com template = posições 4 (+1h) e 10 (+24h); os demais send_ai pulam
-- fora da janela (rede de segurança do engine). RODAR SÓ DEPOIS dos templates
-- fu1_toque_1h e fu1_toque_24h estarem APPROVED na Meta — senão o envio falha.
-- body = texto EXATO aprovado ({{1}} = primeiro nome), usado pra persistir no inbox.

UPDATE automation_steps s
SET step_config = s.step_config || jsonb_build_object(
  'template', jsonb_build_object(
    'name', 'fu1_toque_1h',
    'lang', 'pt_BR',
    'body', E'Oi, {{1}}! Ian aqui de novo, da Negócio Simples.\n\nImagino que teu dia deve estar corrido, então vou direto: são só 2 perguntas rápidas antes de agendar teu diagnóstico com o Arthur. Consegue me responder por aqui?'
  )
)
FROM automations a
WHERE a.id = s.automation_id
  AND a.name = 'Follow-up 1'
  AND s.step_type = 'send_ai'
  AND s.position = 4;

UPDATE automation_steps s
SET step_config = s.step_config || jsonb_build_object(
  'template', jsonb_build_object(
    'name', 'fu1_toque_24h',
    'lang', 'pt_BR',
    'body', E'Oi, {{1}}, Ian de novo. Prometo que essa é minha última mensagem, não quero te encher.\n\nTeu diagnóstico com o Arthur segue de pé. Quando quiser destravar a automação e IA na tua empresa, é só me responder aqui que a gente agenda. Porta aberta!'
  )
)
FROM automations a
WHERE a.id = s.automation_id
  AND a.name = 'Follow-up 1'
  AND s.step_type = 'send_ai'
  AND s.position = 10;

-- Conferência: as duas linhas devem voltar com template preenchido.
SELECT s.position, s.step_config->'template'->>'name' AS template
FROM automation_steps s JOIN automations a ON a.id = s.automation_id
WHERE a.name = 'Follow-up 1' AND s.step_type = 'send_ai'
ORDER BY s.position;
