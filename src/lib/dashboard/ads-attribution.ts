import type { CreativeAttribution } from './ads-types'

export const UNATTRIBUTED = 'Sem atribuição'

/** Subconjunto de contacts.fap01_data que importa pra atribuição. */
export interface AttributionBlob {
  attribution?: {
    last_touch?: { utm?: { utm_content?: string; utm_campaign?: string } }
    first_touch?: { utm?: { utm_content?: string; utm_campaign?: string } }
  }
  source_utm_campaign?: string
}

export function resolveCreative(
  fap01: AttributionBlob | null | undefined,
): CreativeAttribution {
  const lt = fap01?.attribution?.last_touch?.utm
  const ft = fap01?.attribution?.first_touch?.utm
  const creative = lt?.utm_content || ft?.utm_content || UNATTRIBUTED
  const campaign = lt?.utm_campaign || ft?.utm_campaign || fap01?.source_utm_campaign || null
  return { creative, campaign }
}
