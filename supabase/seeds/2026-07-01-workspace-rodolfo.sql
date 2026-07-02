-- Seed do Workspace Rodolfo (rodar via psql "$SUPABASE_NS_DB_URL" — cofre orchestrator).
-- PRÉ-REQUISITO (manual, antes deste seed):
--   1. Criar o usuário do Dr. Rodolfo no Supabase Auth (painel · e-mail dele · convite).
--      O trigger da migration 017 cria o profile + a account dele automaticamente.
--   2. Preencher :rodolfo_account_id abaixo com o account_id resultante:
--      select account_id from public.profiles where email = '<email-do-rodolfo>';
-- Obs.: plan_id fica de fora até o Arthur reconciliar nomes/preços oficiais (spec-mãe §13).

-- ⚠️ SUBSTITUIR antes de rodar:
\set rodolfo_account_id '\'<ACCOUNT-ID-DO-RODOLFO>\''
\set ns_account_id '\'7eb23b90-0000-0000-0000-000000000000\''  -- conferir o id real da NS

-- ── Módulos da conta Rodolfo ──────────────────────────────────────────────
-- workspace = marcador de conta-cliente (login cai no /w) · squad_content ON ·
-- crm presente mas OFF (visível-desligado/upsell — regra D8).
insert into public.cc_account_modules (account_id, module_key, enabled) values
  (:rodolfo_account_id, 'workspace', true),
  (:rodolfo_account_id, 'squad_content', true),
  (:rodolfo_account_id, 'crm', false),
  (:rodolfo_account_id, 'squad_paid_traffic', true),   -- catálogo coming_soon domina → "em breve"
  (:rodolfo_account_id, 'automation_studio', false)
on conflict (account_id, module_key) do update set enabled = excluded.enabled;

-- ── Agentes e squads do Rodolfo (os_agent_registry) ───────────────────────
insert into public.os_agent_registry (account_id, key, name, status, kind, specialty, module_key, squad_key, owner) values
  (:rodolfo_account_id, 'gerador-carrossel', 'Gerador de Carrossel', 'active',      'agent', 'gerador',   'squad_content', 'squad-content', 'NS'),
  (:rodolfo_account_id, 'gerador-estatico',  'Gerador de Estático',  'active',      'agent', 'gerador',   'squad_content', 'squad-content', 'NS'),
  (:rodolfo_account_id, 'publisher',         'Publisher',            'active',      'agent', 'publisher', 'squad_content', 'squad-content', 'NS'),
  (:rodolfo_account_id, 'editor-video',      'Editor de Vídeo',      'coming_soon', 'agent', 'gerador',   'squad_content', 'squad-content', 'NS'),
  (:rodolfo_account_id, 'gestor-trafego',    'Gestor de Tráfego',    'coming_soon', 'agent', 'chat',      'squad_paid_traffic', 'squad-paid-traffic', 'NS'),
  (:rodolfo_account_id, 'squad-content',      'Squad Content',        'active',      'squad', null,        'squad_content', null, 'NS'),
  (:rodolfo_account_id, 'squad-paid-traffic', 'Squad Paid Traffic',   'coming_soon', 'squad', null,        'squad_paid_traffic', null, 'NS')
on conflict (account_id, key) do update
  set name = excluded.name, status = excluded.status, kind = excluded.kind,
      specialty = excluded.specialty, module_key = excluded.module_key, squad_key = excluded.squad_key;

-- ── NS (tenant zero) — preview do workspace SEM o marcador `workspace` ─────
-- (com o marcador a NS seria redirecionada pra fora do próprio CRM)
insert into public.cc_account_modules (account_id, module_key, enabled) values
  (:ns_account_id, 'squad_content', true)
on conflict (account_id, module_key) do update set enabled = excluded.enabled;

-- ── Peças iniciais da Squad Content (validar UX do kanban/calendário) ──────
-- As duas primeiras são REAIS (produzidas 25/06 no dry-run da fundação dele);
-- as demais são pauta/esteira derivadas da linha editorial real — marcar como
-- exemplo é desnecessário porque pauta é isso mesmo: tema planejado, sem arte.
insert into public.content_pieces (account_id, title, kind, status, caption, channel) values
  (:rodolfo_account_id, 'Assinei o contrato — sou obrigado a pagar?', 'carrossel', 'aprovacao',
   null, 'instagram'),
  (:rodolfo_account_id, 'Bloqueio SISBAJUD: o que fazer nas primeiras 48h', 'estatico', 'aprovacao',
   null, 'instagram'),
  (:rodolfo_account_id, 'Busca e apreensão: o banco pode levar meu carro sem aviso?', 'carrossel', 'producao', null, 'instagram'),
  (:rodolfo_account_id, 'Juros abusivos: como saber se a taxa do seu financiamento passou do limite', 'carrossel', 'pauta', null, 'instagram'),
  (:rodolfo_account_id, 'Tarifa embutida no financiamento: você paga sem saber', 'estatico', 'pauta', null, 'instagram');

-- ── Verificação (rodar depois) ─────────────────────────────────────────────
-- select module_key, enabled from public.cc_account_modules where account_id = :rodolfo_account_id;
-- select key, name, status, kind from public.os_agent_registry where account_id = :rodolfo_account_id order by kind, name;
-- select title, kind, status from public.content_pieces where account_id = :rodolfo_account_id;
