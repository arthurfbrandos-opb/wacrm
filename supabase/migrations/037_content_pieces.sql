-- 037_content_pieces.sql
-- Squad Content — a peça de conteúdo (unidade do Kanban/Calendário do módulo).
-- Mesmo padrão da espinha (034/036): account-scoped · leitura por membro (RLS) ·
-- escrita via service_role (worker de produção · fatia ④ · aprovação na ⑤).
-- Aditivo: nada no caminho do Ian/CRM.

create table if not exists public.content_pieces (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('carrossel','estatico','video')),
  -- colunas do kanban aprovado: pauta → produzindo → pra aprovar → aprovada → agendada → publicada
  status text not null default 'pauta'
    check (status in ('pauta','producao','aprovacao','aprovada','agendada','publicada')),
  caption text,
  preview_url text,
  channel text,
  scheduled_at timestamptz,
  published_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists content_pieces_account_status_idx on public.content_pieces (account_id, status);
create index if not exists content_pieces_account_sched_idx on public.content_pieces (account_id, scheduled_at);

alter table public.content_pieces enable row level security;
drop policy if exists "content_pieces read" on public.content_pieces;
create policy "content_pieces read" on public.content_pieces
  for select using (public.is_account_member(account_id));
