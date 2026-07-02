-- 038_content_jobs_chat.sql
-- Squad Content — fila de produção (jobs) + chat do squad.
-- Fluxo: cliente pede no chat (API insere mensagem+job via service_role) →
-- worker no VPS drena a fila (padrão do automation_pending_executions) →
-- produz a peça → responde no chat + peça cai no kanban "Pra aprovar".
-- Leitura por membro (RLS) · escrita via service_role. Aditivo.

create table if not exists public.content_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null check (kind in ('chat','gerar_peca','gerar_semana','ajustar_peca')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  piece_id uuid references public.content_pieces(id) on delete set null,
  error text,
  cost_usd numeric,
  model text,
  created_by uuid,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists content_jobs_account_created_idx on public.content_jobs (account_id, created_at desc);
-- índice parcial pro worker achar o próximo pending barato
create index if not exists content_jobs_pending_idx on public.content_jobs (created_at) where status = 'pending';

create table if not exists public.content_chat_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  author text not null check (author in ('cliente','squad')),
  body text not null,
  job_id uuid references public.content_jobs(id) on delete set null,
  piece_id uuid references public.content_pieces(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists content_chat_account_created_idx on public.content_chat_messages (account_id, created_at);

alter table public.content_jobs enable row level security;
alter table public.content_chat_messages enable row level security;

drop policy if exists "content_jobs read" on public.content_jobs;
create policy "content_jobs read" on public.content_jobs
  for select using (public.is_account_member(account_id));
drop policy if exists "content_chat_messages read" on public.content_chat_messages;
create policy "content_chat_messages read" on public.content_chat_messages
  for select using (public.is_account_member(account_id));
