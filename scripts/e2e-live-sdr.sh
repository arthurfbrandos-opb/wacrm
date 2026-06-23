#!/usr/bin/env bash
# E2E live do SDR (Ian) com um número REAL.
#
# Injeta um lead FAP01 qualificado, expedita o first_touch e dispara o cron →
# o Ian ABORDA o número na hora. confirm vs chase é automático:
#   - se houver evento na agenda Google com esse email (booking Calendly) → CONFIRMA
#   - senão → CHASE (puxa pra agendar)
# Depois que o lead RESPONDER no WhatsApp, o cérebro C1 entra sozinho (webhook já no ar).
#
# Uso:  ./scripts/e2e-live-sdr.sh <numero_e164> [nome] [email]
#   ex: ./scripts/e2e-live-sdr.sh 5511999998888 "Fulano Teste" fulano@exemplo.com
#   (pra testar o caminho CONFIRM: marque um slot real no Calendly com esse email ANTES)
#
# Requisitos: ssh srv1571722.hstgr.cloud (secrets em /opt/wacrm/.env) +
#             SUPABASE_NS_DB_URL no cofre ~/Projects/orchestrator/.env.
# NÃO limpa nada (pode ser lead real). Pra descartar, rode o bloco CLEANUP impresso no fim.
set -euo pipefail

VPS=srv1571722.hstgr.cloud
NUM="${1:?uso: e2e-live-sdr.sh <numero_e164> [nome] [email]}"
NAME="${2:-Lead Teste}"
EMAIL="${3:-}"
NUM="$(printf '%s' "$NUM" | tr -cd '0-9')"

set +u; source ~/Projects/orchestrator/.env; set -u
PSQL() { psql "$SUPABASE_NS_DB_URL" -At -P pager=off "$@"; }

echo "▸ 1/4 FAP01 lead_created ($NUM)"
RESP=$(ssh "$VPS" "S=\$(grep '^FAP01_WEBHOOK_SECRET=' /opt/wacrm/.env | cut -d= -f2- | tr -d '\"'); \
  curl -s -X POST 'https://crm.negocio-simples.com/api/webhooks/fap01' -H \"x-webhook-secret: \$S\" -H 'content-type: application/json' \
  -d '{\"event_type\":\"lead_created\",\"source\":\"e2e-live\",\"lead\":{\"contact_name\":\"$NAME\",\"contact_email\":\"$EMAIL\",\"contact_whatsapp\":\"$NUM\",\"faturamento_range\":\"50k-100k\",\"tem_socio\":false,\"nicho\":\"varejo\",\"processo_foco\":\"vendas\",\"urgencia\":4,\"passed_lowtier_gate\":true}}'")
echo "  $RESP"
CID=$(printf '%s' "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("contact_id",""))')
[ -n "$CID" ] || { echo "✗ sem contact_id — abortando"; exit 1; }

echo "▸ 2/4 expedita first_touch (due_at=now)"
PSQL -c "update sdr_touches set due_at=now() where contact_id='$CID' and type='first_touch' and status='pending';" >/dev/null
echo "  ok"

echo "▸ 3/4 dispara cron sdr-touches"
ssh "$VPS" "CS=\$(grep '^SDR_CRON_SECRET=' /opt/wacrm/.env | cut -d= -f2- | tr -d '\"'); \
  curl -s -X POST 'https://crm.negocio-simples.com/api/cron/sdr-touches' -H \"x-cron-secret: \$CS\""
echo

echo "▸ 4/4 resultado"
echo "-- mensagem(ns) do Ian --"
PSQL -c "select content_text from messages where conversation_id=(select id from conversations where contact_id='$CID') and sender_type='agent' order by created_at;"
echo "-- estágio do deal --"
PSQL -c "select s.name from deals d join pipeline_stages s on s.id=d.stage_id where d.contact_id='$CID';"
echo "-- touches --"
PSQL -c "select type,status,resolution from sdr_touches where contact_id='$CID' order by due_at;"

cat <<CLEAN

# CLEANUP (rode só se for lead descartável) — contact_id=$CID:
# source ~/Projects/orchestrator/.env; psql "\$SUPABASE_NS_DB_URL" -c "begin;
#   delete from appointments where contact_id='$CID';
#   delete from sdr_touches where contact_id='$CID';
#   delete from messages where conversation_id in (select id from conversations where contact_id='$CID');
#   delete from conversations where contact_id='$CID';
#   delete from deals where contact_id='$CID';
#   delete from contact_notes where contact_id='$CID';
#   delete from contacts where id='$CID';
# commit;"
CLEAN
