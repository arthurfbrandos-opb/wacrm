// Seed da régua FU1 (rodar UMA vez no container: docker compose exec -T wacrm node < scripts/seed-fu1-regua.mjs)
// Resolve account/user/tag/stages por nome em runtime; cria a automação INATIVA.
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const db = createClient(url, key)

// ⚠️ confirmar como identificar a conta NS — ajustar este seletor antes de rodar.
const ACCOUNT_NAME = process.env.NS_ACCOUNT_NAME || 'Negócio Simples'

async function stageId(accountId, pipelineName, stageName) {
  const { data: pl } = await db.from('pipelines').select('id').eq('account_id', accountId).eq('name', pipelineName).maybeSingle()
  if (!pl) throw new Error(`pipeline não achada: ${pipelineName}`)
  const { data: st } = await db.from('pipeline_stages').select('id').eq('pipeline_id', pl.id).eq('name', stageName).maybeSingle()
  if (!st) throw new Error(`stage não achado: ${pipelineName}/${stageName}`)
  return st.id
}

async function main() {
  const { data: acct } = await db.from('accounts').select('id, owner_user_id').eq('name', ACCOUNT_NAME).maybeSingle()
  if (!acct) throw new Error(`conta não achada: ${ACCOUNT_NAME}`)
  const accountId = acct.id
  const userId = acct.owner_user_id

  const { data: dup } = await db.from('automations').select('id').eq('account_id', accountId).eq('name', 'Follow-up 1').maybeSingle()
  if (dup) { console.log('automação "Follow-up 1" já existe — abortando (idempotente)'); return }

  // tag fu1 (find-or-create)
  let { data: tag } = await db.from('tags').select('id').eq('account_id', accountId).eq('name', 'fu1').maybeSingle()
  if (!tag) ({ data: tag } = await db.from('tags').insert({ account_id: accountId, user_id: userId, name: 'fu1' }).select('id').single())

  const fu1Stage = await stageId(accountId, 'Follow-up', 'Follow-up 1')
  const lostStage = await stageId(accountId, 'Pré-Vendas (SDR)', 'Lead Vencido')
  const followupPipeline = (await db.from('pipelines').select('id').eq('account_id', accountId).eq('name', 'Follow-up').maybeSingle()).data.id
  const sdrPipeline = (await db.from('pipelines').select('id').eq('account_id', accountId).eq('name', 'Pré-Vendas (SDR)').maybeSingle()).data.id

  const { data: auto } = await db.from('automations').insert({
    account_id: accountId, user_id: userId, name: 'Follow-up 1',
    trigger_type: 'tag_added', trigger_config: { tag_id: tag.id },
    is_active: false, cancel_on_reply: true,
  }).select('id').single()

  const ai = (guidance) => ({ step_type: 'send_ai', step_config: { guidance } })
  const wait = (amount, unit) => ({ step_type: 'wait', step_config: { amount, unit } })
  const move = (pipeline_id, stage_id) => ({ step_type: 'move_deal', step_config: { pipeline_id, stage_id } })

  const steps = [
    move(followupPipeline, fu1Stage),
    wait(30, 'minutes'), ai("Leve, dá um gancho: 'sei que corre, só não quero te deixar na mão'."),
    wait(30, 'minutes'), ai('Reforça que é rápido: o diagnóstico toma poucos minutos e ele já sai com clareza do gargalo.'),
    wait(2, 'hours'),    ai('Curiosidade: tem um ponto do cadastro dele que vale a pena olhar junto.'),
    wait(9, 'hours'),    ai("Reaparece humano: 'sou eu de novo, o Ian' — sem cobrança pesada."),
    wait(12, 'hours'),   ai("Fecha com respeito: 'vou parar de te incomodar, mas a porta fica aberta'."),
    wait(24, 'hours'),   move(sdrPipeline, lostStage),
  ].map((s, i) => ({ ...s, automation_id: auto.id, position: i, parent_step_id: null, branch: null }))

  const { error } = await db.from('automation_steps').insert(steps)
  if (error) throw error
  console.log(`OK — automação Follow-up 1 (${auto.id}) criada INATIVA com ${steps.length} passos.`)
}
main().catch((e) => { console.error(e); process.exit(1) })
