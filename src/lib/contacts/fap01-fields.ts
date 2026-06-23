import type { Fap01Data } from '@/types'

/**
 * Partition of a contact's `fap01_data` (migration 029) into what an agent may
 * edit from the inbox and what is origin/attribution data that must never
 * change. Locked outside this module — the merge below only ever writes the
 * editable keys, so a save can't clobber the UTMs/attribution even if the
 * client sent them.
 */

export type Fap01FieldType = 'text' | 'bool' | 'number'

export interface Fap01EditableField {
  key: string
  label: string
  type: Fap01FieldType
}

/** Lead-filled qualification + MQL — editable. Order = render order. */
export const FAP01_EDITABLE_FIELDS: Fap01EditableField[] = [
  { key: 'faturamento_range', label: 'Faturamento', type: 'text' },
  { key: 'nicho', label: 'Nicho', type: 'text' },
  { key: 'tem_socio', label: 'Tem sócio?', type: 'bool' },
  { key: 'processo_foco', label: 'Processo foco', type: 'text' },
  { key: 'urgencia', label: 'Urgência', type: 'number' },
  { key: 'num_funcionarios', label: 'Nº de funcionários', type: 'text' },
  { key: 'company_city', label: 'Cidade', type: 'text' },
  { key: 'company_state', label: 'Estado', type: 'text' },
  { key: 'mql', label: 'MQL', type: 'bool' },
]

/** Origin/attribution — read-only. Empty values are hidden in the UI. */
export const FAP01_LOCKED_FIELDS: { key: string; label: string }[] = [
  { key: 'source_utm_source', label: 'UTM source' },
  { key: 'source_utm_medium', label: 'UTM medium' },
  { key: 'source_utm_campaign', label: 'UTM campaign' },
  { key: 'source_referrer', label: 'Referrer' },
]

const EDITABLE_KEYS = new Set(FAP01_EDITABLE_FIELDS.map((f) => f.key))

/**
 * Merge edited editable-field values back into the existing fap01_data,
 * preserving every other key (locked attribution, unknown extras). Only keys in
 * {@link FAP01_EDITABLE_FIELDS} are taken from `edits`; anything else there is
 * ignored, so a tampered payload can't overwrite locked data.
 */
export function mergeFap01(
  existing: Fap01Data | null | undefined,
  edits: Record<string, unknown>,
): Fap01Data {
  const out: Fap01Data = { ...(existing ?? {}) }
  for (const key of Object.keys(edits)) {
    if (EDITABLE_KEYS.has(key)) out[key] = edits[key]
  }
  return out
}
