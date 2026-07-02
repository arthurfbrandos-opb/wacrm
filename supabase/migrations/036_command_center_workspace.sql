-- 036_command_center_workspace.sql
-- Command Center — esqueleto comercial (C9: workspace nasce de plano+módulos, nunca tela
-- hardcoded por cliente) + extensão do os_agent_registry pra Agentes/Squads do Workspace.
-- Prefixo cc_ de propósito: o Supabase NS é compartilhado (lição: colisão silenciosa de
-- CREATE TABLE IF NOT EXISTS) — nomes genéricos como "plans"/"modules" são risco.
-- 100% aditivo: nada no caminho do Ian/CRM muda.

-- Planos (catálogo global · thin — nomes/preços oficiais reconciliam na spec-mãe §13)
create table if not exists public.cc_plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

-- Módulos (catálogo global). status: ga = existe · coming_soon = ainda não construído
create table if not exists public.cc_modules (
  key text primary key,
  name text not null,
  description text,
  status text not null default 'ga' check (status in ('ga','coming_soon')),
  created_at timestamptz not null default now()
);

-- Módulos por conta — o gate real do workspace (enabled=false → visível-desligado/upsell)
create table if not exists public.cc_account_modules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  module_key text not null references public.cc_modules(key) on delete cascade,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, module_key)
);
create index if not exists cc_account_modules_account_idx on public.cc_account_modules (account_id);

-- Plano da conta (nullable — contas existentes não mudam)
alter table public.accounts add column if not exists plan_id uuid references public.cc_plans(id);

-- Registry vira a fonte da tela Agentes/Squads:
--   kind: agent (especialista individual) | squad (time/processo com ambiente próprio)
--   specialty: template da tela de uso (gerador · publisher · chat · analise)
--   module_key: módulo dono (ex.: squad_content) · squad_key: a squad a que o agente pertence
alter table public.os_agent_registry add column if not exists kind text not null default 'agent';
alter table public.os_agent_registry drop constraint if exists os_agent_registry_kind_check;
alter table public.os_agent_registry add constraint os_agent_registry_kind_check check (kind in ('agent','squad'));
alter table public.os_agent_registry add column if not exists specialty text;
alter table public.os_agent_registry add column if not exists module_key text;
alter table public.os_agent_registry add column if not exists squad_key text;
-- 'coming_soon' entra como status honesto de card ("em breve") — sem fingir prontidão
alter table public.os_agent_registry drop constraint if exists os_agent_registry_status_check;
alter table public.os_agent_registry add constraint os_agent_registry_status_check
  check (status in ('active','paused','retired','coming_soon'));

-- RLS (mesmo padrão da 034: leitura por membro; escrita via service_role)
alter table public.cc_plans enable row level security;
alter table public.cc_modules enable row level security;
alter table public.cc_account_modules enable row level security;

-- Catálogos globais: qualquer usuário logado pode ler (não têm dado de tenant)
drop policy if exists "cc_plans read" on public.cc_plans;
create policy "cc_plans read" on public.cc_plans for select to authenticated using (true);
drop policy if exists "cc_modules read" on public.cc_modules;
create policy "cc_modules read" on public.cc_modules for select to authenticated using (true);
drop policy if exists "cc_account_modules read" on public.cc_account_modules;
create policy "cc_account_modules read" on public.cc_account_modules
  for select using (public.is_account_member(account_id));

-- Seed do catálogo (global — habilitação por conta fica no seed de deploy)
insert into public.cc_modules (key, name, description, status) values
  ('workspace', 'Workspace Cliente', 'Conta opera como workspace de cliente (login cai no /w)', 'ga'),
  ('crm', 'Comercial / CRM', 'Pipeline, contatos e conversas', 'ga'),
  ('squad_content', 'Squad Content', 'Produção e gestão de conteúdo pras redes sociais', 'ga'),
  ('squad_paid_traffic', 'Squad Paid Traffic', 'Gestão de tráfego pago com IA', 'coming_soon'),
  ('automation_studio', 'Automation Studio', 'Desenho de automações com revisão NS', 'coming_soon')
on conflict (key) do nothing;

insert into public.cc_plans (key, name) values ('growth-os', 'Growth OS')
on conflict (key) do nothing;
