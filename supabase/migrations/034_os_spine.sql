-- 034_os_spine.sql
-- NS OS — espinha de governança (compartilhada no Supabase NS).
-- Account-scoped (accounts/is_account_member). Escrita via service_role; leitura por membro (RLS), como ad_spend.

create table if not exists public.os_agent_registry (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  key text not null,
  name text not null,
  model text,
  status text not null default 'active' check (status in ('active','paused','retired')),
  owner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, key)
);
create index if not exists os_agent_registry_account_idx on public.os_agent_registry (account_id);

create table if not exists public.os_kill_switches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  key text not null,
  enabled boolean not null default true,
  reason text,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (account_id, key)
);
create index if not exists os_kill_switches_account_idx on public.os_kill_switches (account_id);

create table if not exists public.os_audit (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  correlation_id uuid,
  agent text,
  action text not null,
  status text not null check (status in ('success','blocked','failure')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists os_audit_account_created_idx on public.os_audit (account_id, created_at desc);
create index if not exists os_audit_correlation_idx on public.os_audit (correlation_id);

create table if not exists public.os_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  agent text,
  kind text not null,
  summary text,
  ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists os_events_account_created_idx on public.os_events (account_id, created_at desc);

create table if not exists public.os_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  agent text,
  model text,
  date date not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists os_cost_ledger_account_date_idx on public.os_cost_ledger (account_id, date);

alter table public.os_agent_registry enable row level security;
alter table public.os_kill_switches  enable row level security;
alter table public.os_audit           enable row level security;
alter table public.os_events          enable row level security;
alter table public.os_cost_ledger     enable row level security;

drop policy if exists "os_agent_registry read" on public.os_agent_registry;
create policy "os_agent_registry read" on public.os_agent_registry for select using (public.is_account_member(account_id));
drop policy if exists "os_kill_switches read" on public.os_kill_switches;
create policy "os_kill_switches read" on public.os_kill_switches for select using (public.is_account_member(account_id));
drop policy if exists "os_audit read" on public.os_audit;
create policy "os_audit read" on public.os_audit for select using (public.is_account_member(account_id));
drop policy if exists "os_events read" on public.os_events;
create policy "os_events read" on public.os_events for select using (public.is_account_member(account_id));
drop policy if exists "os_cost_ledger read" on public.os_cost_ledger;
create policy "os_cost_ledger read" on public.os_cost_ledger for select using (public.is_account_member(account_id));
