-- 039_approvals_integrations.sql
-- Aprovação (os_approvals — o "1º produtor = conteúdo" do roadmap do Command Center)
-- + conexões de integração por tenant (credencial criptografada em repouso).
-- Aditivo · RLS · escrita via service_role.

-- Trilha de decisão do cliente sobre um artefato produzido (peça, e futuros).
create table if not exists public.os_approvals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null check (kind in ('content_piece')),
  ref_id uuid not null,
  action text not null check (action in ('approved','changes_requested')),
  note text,
  decided_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists os_approvals_account_created_idx on public.os_approvals (account_id, created_at desc);
create index if not exists os_approvals_ref_idx on public.os_approvals (ref_id);

alter table public.os_approvals enable row level security;
drop policy if exists "os_approvals read" on public.os_approvals;
create policy "os_approvals read" on public.os_approvals
  for select using (public.is_account_member(account_id));

-- Conexões de integração do tenant (Metricool · Google Drive · …).
-- credentials_enc = AES-256-GCM (util encryption.ts · ENCRYPTION_KEY) — e mesmo
-- cifrado NÃO é exposto ao navegador: SEM policy de select (deny-all) — o front
-- lê status/config por rota de API (service_role), nunca a linha crua.
create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null check (provider in ('metricool','google_drive')),
  status text not null default 'connected' check (status in ('connected','disconnected')),
  credentials_enc text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider)
);
create index if not exists integration_connections_account_idx on public.integration_connections (account_id);

alter table public.integration_connections enable row level security;
-- (sem policies de propósito: deny-all pra anon/authenticated; service_role bypassa)
