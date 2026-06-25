-- 033_ad_spend.sql
-- Gasto de mídia por anúncio por dia, populado pelo n8n WF-NS-AD-SPEND-SYNC.
-- O wacrm só lê (browser, RLS). O n8n escreve via service_role (bypassa RLS).
create table if not exists public.ad_spend (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  date date not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text not null,
  ad_name text,
  spend numeric not null default 0,
  impressions integer not null default 0,
  link_clicks integer not null default 0,
  synced_at timestamptz not null default now(),
  unique (account_id, date, ad_id)
);

create index if not exists ad_spend_account_date_idx on public.ad_spend (account_id, date);
create index if not exists ad_spend_ad_name_idx on public.ad_spend (account_id, ad_name);

alter table public.ad_spend enable row level security;

-- Leitura: membros da conta (mesma função usada no resto do schema).
create policy "ad_spend read for account members"
  on public.ad_spend for select
  using (public.is_account_member(account_id));
