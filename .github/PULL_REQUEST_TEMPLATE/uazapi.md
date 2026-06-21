# feat: UazAPI provider support (env-switched, opt-in)

## Resumo

Adiciona suporte ao **UazAPI** como provider WhatsApp alternativo ao Meta Cloud API. Habilitação 100% via env vars — zero impacto no comportamento default (Meta).

## Por que

Decisão 2026-06-21: para o **piloto Ery** (instituto) usar UazAPI self-hosted que o NS já opera, sem precisar de chip Meta + Business verification (demora 1-2 semanas). Para clientes pagantes → Meta Cloud API + chip novo continua sendo o caminho recomendado.

## O que muda

- `META_API_BASE` e `META_API_VERSION` agora são env-overridable
- `WA_PROVIDER=meta|uazapi` escolhe o caminho de auth do webhook
- `UAZAPI_WEBHOOK_TOKEN` (env) → token em `?token=<value>` quando UazAPI
- Novo normalizer traduz UazAPI → shape Meta
- `.env.local.example` documenta as 4 vars novas
- `.gitignore` adicionado (supabase/.temp/)

## Testes

- 6/6 unit tests (text inbound, status update, fromMe skip, malformed batch, ignore events, non-object)
- typecheck 0 erros · lint 0 errors

## Comportamento default

100% inalterado. Sem migração Supabase, sem mudança de schema, sem quebra de compatibilidade.

## 5 commits

1. `feat(wacrm): make META_API_BASE configurable via env`
2. `feat(wacrm): provider-aware webhook auth (meta|uazapi)`
3. `feat(wacrm): UazAPI→Meta payload normalizer`
4. `docs(wacrm): document WA_PROVIDER, UAZAPI_WEBHOOK_TOKEN, META_API_BASE`
5. `chore: ignore supabase/.temp (cli local)`

Plan ref: `docs/superpowers/plans/2026-06-21-wacrm-phase1-setup.md` Tasks 5-9.
