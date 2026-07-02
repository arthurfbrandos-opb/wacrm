-- 040_content_brand_profile.sql
-- Fundação da marca do cliente (tom de voz · ICP · base de conhecimento ·
-- linha editorial) editável no workspace (/w/marca). O worker de produção
-- injeta a versão mais recente em referencia/fundacao-workspace/ antes de
-- cada peça — o que o cliente edita aqui PREVALECE na produção.
-- Mesmo padrão 036–039: account-scoped · leitura por membro (RLS) ·
-- escrita via API com service_role. Aditivo: nada no caminho do Ian/CRM.

create table if not exists public.content_brand_profile (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  section_key text not null,
  title text not null,
  content text not null default '',
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (account_id, section_key)
);
create index if not exists content_brand_profile_account_idx
  on public.content_brand_profile (account_id, sort_order);

alter table public.content_brand_profile enable row level security;
drop policy if exists "content_brand_profile read" on public.content_brand_profile;
create policy "content_brand_profile read" on public.content_brand_profile
  for select using (public.is_account_member(account_id));
