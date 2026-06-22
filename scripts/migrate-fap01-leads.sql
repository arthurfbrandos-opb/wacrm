-- Migração FAP01 (ns-crm crm_kv) -> wacrm (tabelas reais). One-time, aditiva.
-- APLICADA em 2026-06-22 no projeto NS (sglswwhfthqpdybxixal): 24 contatos +
-- 24 deals + 2 pipelines (Pré-Vendas SDR, Closer) + 19 stages + 11 notas.
--
-- Conta única "Hermes Smoke". IDs determinísticos (md5->uuid) p/ pipelines/
-- stages; contatos/deals reusam o uuid do ns-crm. ON CONFLICT (id) DO NOTHING
-- = idempotente/re-rodável. Termina em ROLLBACK (dry-run): troque por COMMIT
-- para aplicar. Rodar via psql conectado ao Supabase do NS.
\set ACC '7eb23b90-ce66-40bc-8e23-1d2ac6458300'
\set USR 'd888c89f-85fb-4938-99e9-81cc637350c9'

BEGIN;

INSERT INTO pipelines (id, user_id, account_id, name)
SELECT md5('pl:'||(p->>'id'))::uuid, :'USR', :'ACC', p->>'name'
FROM crm_kv, jsonb_array_elements(data) p
WHERE key='crm_pipelines'
ON CONFLICT (id) DO NOTHING;

INSERT INTO pipeline_stages (id, pipeline_id, name, position, color)
SELECT md5('st:'||(p->>'id')||':'||(s->>'id'))::uuid,
       md5('pl:'||(p->>'id'))::uuid,
       s->>'name',
       COALESCE((s->>'position')::int, 0),
       COALESCE(NULLIF(s->>'color',''), '#9CA3AF')
FROM crm_kv, jsonb_array_elements(data) p, jsonb_array_elements(p->'stages') s
WHERE key='crm_pipelines'
ON CONFLICT (id) DO NOTHING;

INSERT INTO pipeline_stages (id, pipeline_id, name, position, color)
SELECT DISTINCT
       md5('st:'||(d->>'pipelineId')||':'||(d->>'stage'))::uuid,
       md5('pl:'||(d->>'pipelineId'))::uuid,
       initcap(replace(d->>'stage','-',' ')),
       99, '#9CA3AF'
FROM crm_kv, jsonb_array_elements(data) d
WHERE key='crm_deals' AND (d->>'stage') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pipelines pp WHERE pp.id = md5('pl:'||(d->>'pipelineId'))::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO contacts (id, user_id, account_id, phone, name, email, company, provider, created_at, updated_at)
SELECT DISTINCT ON (regexp_replace(c->>'phone','\D','','g'))
       (c->>'id')::uuid, :'USR', :'ACC',
       c->>'phone',
       NULLIF(c->>'name',''), NULLIF(c->>'email',''), NULLIF(c->>'company',''),
       'meta',
       COALESCE((c->>'createdAt')::timestamptz, now()),
       COALESCE((c->>'updatedAt')::timestamptz, now())
FROM crm_kv, jsonb_array_elements(data) c
WHERE key='crm_contacts' AND COALESCE(c->>'phone','') <> ''
ORDER BY regexp_replace(c->>'phone','\D','','g'), (c->>'updatedAt')
ON CONFLICT (id) DO NOTHING;

INSERT INTO deals (id, user_id, account_id, pipeline_id, stage_id, contact_id, title, value, status, created_at, updated_at)
SELECT (d->>'id')::uuid, :'USR', :'ACC',
       md5('pl:'||(d->>'pipelineId'))::uuid,
       md5('st:'||(d->>'pipelineId')||':'||(d->>'stage'))::uuid,
       (d->>'customerId')::uuid,
       COALESCE(NULLIF(d->>'title',''), 'Deal'),
       COALESCE((d->>'value')::numeric, 0), 'open',
       COALESCE((d->>'createdAt')::timestamptz, now()),
       COALESCE((d->>'updatedAt')::timestamptz, now())
FROM crm_kv, jsonb_array_elements(data) d
WHERE key='crm_deals'
  AND EXISTS (SELECT 1 FROM contacts ct WHERE ct.id = (d->>'customerId')::uuid)
  AND EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.id = md5('st:'||(d->>'pipelineId')||':'||(d->>'stage'))::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO contact_notes (contact_id, account_id, user_id, note_text)
SELECT (c->>'id')::uuid, :'ACC', :'USR',
  'Qualificação FAP01 (migrado): ' || concat_ws(' · ',
    CASE WHEN c ? 'monthlyRevenue' THEN 'Faturamento: '||(c->>'monthlyRevenue') END,
    CASE WHEN c ? 'niche'          THEN 'Nicho: '||(c->>'niche') END,
    CASE WHEN c ? 'hasPartners'    THEN 'Sócio: '||(c->>'hasPartners') END,
    CASE WHEN c ? 'focusProcess'   THEN 'Processo: '||(c->>'focusProcess') END,
    CASE WHEN c ? 'urgency'        THEN 'Urgência: '||(c->>'urgency') END)
FROM crm_kv, jsonb_array_elements(data) c
WHERE key='crm_contacts'
  AND (c ? 'monthlyRevenue' OR c ? 'niche' OR c ? 'hasPartners' OR c ? 'focusProcess' OR c ? 'urgency')
  AND EXISTS (SELECT 1 FROM contacts ct WHERE ct.id = (c->>'id')::uuid);

ROLLBACK; -- troque para COMMIT para aplicar
