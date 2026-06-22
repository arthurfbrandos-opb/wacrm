import { createHash } from 'crypto'

/** Mirror Postgres `md5(text)::uuid` — the deterministic ids the FAP01
 *  migration/webhook used for the SDR pipeline and its stages. */
export function detUuid(seed: string): string {
  const h = createHash('md5').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const SDR_PIPELINE = 'pipeline-pre-vendas-sdr'
export const SDR_PIPELINE_ID = detUuid(`pl:${SDR_PIPELINE}`)

/** Stage ids by slug — the same md5→uuid the FAP01 migration seeded.
 *  Verified against the DB: primeiro-contato → "Primeiro Contato",
 *  agendamento-realizado → "Agendamento Realizado". */
export const SDR_STAGE_PRIMEIRO_CONTATO = detUuid(`st:${SDR_PIPELINE}:primeiro-contato`)
export const SDR_STAGE_AGENDAMENTO_REALIZADO = detUuid(`st:${SDR_PIPELINE}:agendamento-realizado`)
