# Deploy — Workspace Rodolfo + Squad Content (fatias ①–⑥)

> Branch: `feat/workspace-rodolfo` (5 commits sobre main `830acda`) · construído 01–02/07/2026
> Prod viva: `crm.negocio-simples.com` (Ian/CRM) — tudo aqui é ADITIVO; nada toca o caminho do Ian.
> Executar COM o Arthur olhando (regra: DDL/deploy em prod = confirmado ao vivo).

## 0 · Pré-flight

- [ ] QA visual da Fatia 1B (seletor/cockpit) que já estava pendente — aproveitar a mesma sessão.
- [ ] Conferir que nenhuma outra sessão está com deploy em andamento no wacrm.

## 1 · Banco (psql via cofre · ~15 min)

```bash
source <(grep -E "^SUPABASE_NS_DB_URL=" ~/Projects/orchestrator/.env | sed 's/^/export /')
cd ~/Projects/_wacrm-worktrees/workspace-rodolfo
psql "$SUPABASE_NS_DB_URL" -f supabase/migrations/036_command_center_workspace.sql
psql "$SUPABASE_NS_DB_URL" -f supabase/migrations/037_content_pieces.sql
psql "$SUPABASE_NS_DB_URL" -f supabase/migrations/038_content_jobs_chat.sql
psql "$SUPABASE_NS_DB_URL" -f supabase/migrations/039_approvals_integrations.sql
```

- [ ] **Bucket Storage:** criar `content-previews` (público p/ leitura) no painel do Supabase.

## 2 · App (merge + deploy)

```bash
cd ~/Projects/wacrm && git merge --ff-only feat/workspace-rodolfo   # (ou merge normal se main andou)
rsync -rltz --exclude node_modules --exclude .next --exclude .git --exclude '.env*' \
  ./ srv1571722.hstgr.cloud:/opt/wacrm/
ssh srv1571722.hstgr.cloud 'cd /opt/wacrm && docker compose build && docker compose up -d'
```

⚠️ NUNCA `rsync --delete` (leva o `.env.runtime` junto — lição registrada).
Verificar: `/login` 200 · `/dashboard/os` 307 (gate auth) · CRM continua ok.

## 3 · Tenant Rodolfo

1. Supabase Auth → convidar o e-mail do Dr. Rodolfo (trigger 017 cria profile+account).
2. `select account_id from profiles where email='<email-dele>';`
3. Preencher os 2 ids no `supabase/seeds/2026-07-01-workspace-rodolfo.sql` (Rodolfo + NS) e rodar:
   `psql "$SUPABASE_NS_DB_URL" -f supabase/seeds/2026-07-01-workspace-rodolfo.sql`
4. QA: logar como NS → seletor → Workspace Cliente. Logar como Rodolfo → cai direto no `/w`.

## 4 · Worker no VPS (Squad Content)

No host do VPS (V1 = systemd no host; container fica como evolução):

1. **Dependências:** Node ≥18 · `claude` CLI · Python ≥3.10 + `pip install -r requirements.txt`
   do repo-cérebro (renderizadores usam Playwright — rodar `python -m playwright install chromium`).
2. **Repo-cérebro:** clonar `conteudo-rodolfo` (ex.: `/opt/conteudo-rodolfo`).
3. **Env** (arquivo `/opt/wacrm-worker.env`, perm 600 · valores copiados do cofre **scp file→file**):
   `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `ENCRYPTION_KEY` (mesma do app) ·
   `CONTEUDO_REPO_DIR=/opt/conteudo-rodolfo` · `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` (hudapi) ·
   `METRICOOL_MCP_TEMPLATE=/opt/metricool-mcp-template.json` · `GOOGLE_API_KEY` (Drive).
   - ⚠️ **ROTACIONAR a chave HUDAPI antes** (caiu em chat 21/06 — skill `llm-provider-rotate`).
   - Metricool: criar o template do MCP com o formato real de auth do `ai.metricool.com/mcp`
     (confirmar na doc oficial na hora — placeholder `{{METRICOOL_TOKEN}}`).
   - GOOGLE_API_KEY: criar no GCP (restrita à Drive API) — LEITURA da pasta de fotos.
     **É UMA chave da NS pra TODOS os clientes** (identifica a plataforma; o acesso vem do
     link-compartilhamento que cada cliente faz). Uma vez: projeto `ns-command-center` →
     ativar Drive API → Credenciais → Chave de API → restringir à Drive API → cofre
     orchestrator + /opt/wacrm-worker.env. Por cliente: pasta de fotos compartilhada
     "qualquer pessoa com o link · Leitor" → link em Configurações → Google Drive.
   - Service account do Google (pendente · pedido Arthur 02/07): criar no GCP + Rodolfo
     compartilha a pasta de CONTEÚDOS com o e-mail dela (Editor) → liga o salvamento
     automático dos conteúdos prontos em `Ano/Mês/<linha-editorial>` (avulso: `Ano/Mês/<dia>`).
     O link da pasta já entra na UI (Configurações → Drive · pasta de conteúdos ·
     provider `google_drive_conteudos`); a escrita não funciona com API key.
4. **Serviço:** systemd unit rodando `node /opt/wacrm/worker/content-worker.mjs` com
   `EnvironmentFile=/opt/wacrm-worker.env` + `Restart=always`.

## 5 · Smokes (na ordem)

1. **FAKE (sem custo):** `WORKER_FAKE=1` + mensagem no chat → peça fake cai no kanban em segundos.
2. **Real (1 peça):** "gera um estático sobre bloqueio de conta" → peça com arte+legenda em
   "Pra aprovar" · custo aparece no `os_cost_ledger` da conta do Rodolfo.
3. **Aprovação:** Aprovar no detalhe → status Aprovada · linha no `os_approvals`.
4. **Ajuste:** Pedir ajuste → volta Produzindo → worker refaz → volta "Pra aprovar".
5. **Metricool:** conectar token nas Configurações → Agendar → Publisher confirma → Agendada
   (conferir no painel do Metricool!).
6. **Drive:** conectar pasta por link → job novo usa fundo do cliente.

## 5b · Fatia ⑦ (delta 02/07 — identidade + Marca editável)

1. Migration extra: `psql "$SUPABASE_NS_DB_URL" -f supabase/migrations/040_content_brand_profile.sql`
2. Seed da fundação (POR CONTA · conteúdo real de `~/Projects/conteudo-rodolfo` — gerar o SQL
   na hora com dollar-quote a partir dos arquivos; NÃO versionar o conteúdo do cliente):
   - `tom-de-voz` ← `marca/tom-de-voz.md` · `icp` ← `marca/icp.md`
   - `base-conhecimento` ← `marca/base-conhecimento.md` · `linha-editorial` ← `linha-editorial/calendario.md`
3. Rebuild do app (rsync + docker) e **restart do worker** (`systemctl restart wacrm-content-worker`)
   — worker novo injeta `referencia/fundacao-workspace/` a cada produção.
4. Smoke: editar uma seção em `/w/marca` → salvar → próxima peça produzida deve seguir a edição.

## 6 · Rollback

- App: `git revert` do merge + rsync+build de novo (rotas novas são isoladas — risco baixo).
- Banco: tabelas novas podem ficar (inertes) — não dropar com pressa.
- Worker: `systemctl stop` mata a produção sem afetar o app.
