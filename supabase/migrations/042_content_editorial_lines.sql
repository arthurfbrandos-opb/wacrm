-- 042_content_editorial_lines.sql
-- Linha editorial como frente de produção (Arthur 02/07): o cliente cria uma
-- linha (período + mix + temas), a squad gera a pauta (job gerar_semana) e as
-- peças nascem em "Pauta" ancoradas no calendário. Salva histórico; "Nova
-- linha editorial" abre o próximo ciclo. Mesmo padrão 036–040: leitura por
-- membro (RLS) · escrita via API/worker (service_role).

create table if not exists public.content_editorial_lines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  -- mix de formatos: {"carrossel": 2, "estatico": 1, "video": 0}
  mix jsonb not null default '{}'::jsonb,
  themes text,
  -- gerando → ativa (pauta criada) · falhou (worker reporta) · encerrada (ciclo fechado)
  status text not null default 'gerando'
    check (status in ('gerando','ativa','falhou','encerrada')),
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists content_editorial_lines_account_idx
  on public.content_editorial_lines (account_id, created_at desc);

alter table public.content_editorial_lines enable row level security;
drop policy if exists "content_editorial_lines read" on public.content_editorial_lines;
create policy "content_editorial_lines read" on public.content_editorial_lines
  for select using (public.is_account_member(account_id));
