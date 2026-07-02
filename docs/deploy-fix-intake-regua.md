# Deploy — fix intake (duplicados) + régua Meta-only + UX conversas

> Branch `fix/intake-dup-e-regua-meta` (worktree `~/Projects/_wacrm-worktrees/fix-intake-regua`).
> Data: 02/07/2026. Rodar com Arthur. Tempo estimado: ~30min.

## Pré-requisito (só pro passo 5)

- [ ] Templates `fu1_toque_1h` e `fu1_toque_24h` **APPROVED** na Meta
      (submetidos 02/07 ~08:50 SP · conferir em Configurações → Modelos ou "Sincronizar da Meta").
      Os passos 1–4 podem rodar antes; sem approval a régua só **pula** os toques (rede de segurança), não quebra.

## Passos

1. **Merge → main** (medir divergência antes; main pode ter andado):
   ```bash
   cd ~/Projects/wacrm
   git fetch . # noop, repo local
   git log --oneline main..fix/intake-dup-e-regua-meta | cat   # o que entra
   git log --oneline fix/intake-dup-e-regua-meta..main | cat   # o que main tem a mais
   git merge-tree --write-tree main fix/intake-dup-e-regua-meta | head  # preview de conflito
   git checkout main && git merge fix/intake-dup-e-regua-meta
   ```

2. **Migration 040** no banco vivo (aditiva; pré-condição já validada: zero contato com 2+ deals abertos):
   ```bash
   source ~/Projects/orchestrator/.env
   psql "$SUPABASE_NS_DB_URL" -f supabase/migrations/040_deals_one_open_per_contact_pipeline.sql
   ```

3. **Desligar o UazAPI** (decisão Arthur 02/07 — estrutura só com API oficial):
   ```sql
   UPDATE wa_connections SET is_active_for_crm = false, status = 'disconnected'
   WHERE provider = 'uazapi';
   -- Opcional: repontar os 3 contatos uazapi antigos pro canal Meta
   -- UPDATE contacts SET provider = 'meta', connection_id = NULL WHERE provider = 'uazapi';
   ```
   Efeito imediato: `resolveSendPlan`/`resolveAccountProvider` passam a rotear tudo pra Meta.

4. **rsync + docker** (deploy padrão, sem tocar `.env`):
   ```bash
   rsync -az --delete --exclude '.env' ~/Projects/wacrm/ root@srv1571722.hstgr.cloud:/opt/wacrm/
   ssh root@srv1571722.hstgr.cloud 'cd /opt/wacrm && docker compose up -d --build'
   ```

5. **Seed dos templates na FU1** (SÓ depois do approval da Meta):
   ```bash
   psql "$SUPABASE_NS_DB_URL" -f supabase/seed/fu1-template-steps.sql
   # conferência embutida no arquivo: posições 2/6/8 sem template · 4=fu1_toque_1h · 10=fu1_toque_24h
   ```

6. **Smokes:**
   - [ ] FAP01 duplicado: re-POST do mesmo lead (shape real n8n `lead_created`) 2× →
         1 deal só + nota "reenviou o formulário" no contato.
   - [ ] Inbox: origem do lead aparece (chip na lista + painel) · header sem sobreposição ·
         celular: painel do contato abre como overlay.
   - [ ] Lembretes de agenda: criar agendamento de teste → toque `reminder_2h`/`24h` sai via Meta.
   - [ ] Régua: re-armar 1 lead perdido (abaixo) e acompanhar `automation_logs`.

7. **Re-armar a régua dos 5 leads perdidos** (Marco Milliotti · Kuka · Jao · Rodrigo Henrique · Murilo Kalif):
   re-disparar o trigger `tag_added` por contato (POST no engine `/api/automations/engine`,
   mesmo caminho do touches-processor) — roteiro exato a definir na hora com os contact_ids;
   janela fechada ⇒ toque +1h sai como template `fu1_toque_1h`.

## Pontos de atenção

- `notifyArthur` (ping de falha no teu WhatsApp) agora sai via Meta → só entrega se a TUA
  janela de 24h com o número oficial estiver aberta. A **nota no contato** é a garantia;
  manda um "ok" pro número oficial de vez em quando pra manter a janela viva.
- Toques da régua SEM template (posições +30m/+3h/+12h) em janela fechada = **pulados com log**
  (não é bug; decisão 2-toques 02/07).
- Deploy do workspace-rodolfo é SEPARADO (runbook próprio `docs/deploy-workspace-rodolfo.md`).
