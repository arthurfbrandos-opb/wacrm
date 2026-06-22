import { createHash } from 'crypto'

/** Mirror Postgres `md5(text)::uuid` — the deterministic ids the FAP01
 *  migration/webhook used for the SDR pipeline and its stages. */
export function detUuid(seed: string): string {
  const h = createHash('md5').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const SDR_PIPELINE = 'pipeline-pre-vendas-sdr'
export const SDR_PIPELINE_ID = detUuid(`pl:${SDR_PIPELINE}`)
