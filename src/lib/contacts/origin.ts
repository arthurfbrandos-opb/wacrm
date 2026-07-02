/**
 * Origem do lead derivada do payload FAP01 gravado no contato
 * (contacts.fap01_data). Alimenta a tag de origem no inbox/painel.
 *
 * As UTMs reais chegam DENTRO da query do source_referrer (a LP manda a URL
 * completa); os campos source_utm_* existem no payload mas vêm vazios hoje —
 * quando preenchidos, eles ganham.
 */
export interface LeadOrigin {
  kind: 'fap01' | 'fap01-adv' | 'inbound'
  /** Rótulo curto do badge, ex.: "FAP01 · bio", "orgânico". */
  label: string
  utm: { source?: string; medium?: string; campaign?: string }
  referrer?: string
}

interface Fap01Fields {
  source_referrer?: string
  source_utm_source?: string
  source_utm_medium?: string
  source_utm_campaign?: string
}

function parseReferrer(referrer: string | undefined): {
  url: URL | null
} {
  if (!referrer) return { url: null }
  try {
    return { url: new URL(referrer) }
  } catch {
    return { url: null }
  }
}

export function deriveLeadOrigin(fap01Data: unknown): LeadOrigin {
  if (!fap01Data || typeof fap01Data !== 'object') {
    return { kind: 'inbound', label: 'orgânico', utm: {} }
  }

  const data = fap01Data as Fap01Fields
  const { url } = parseReferrer(data.source_referrer)

  const utm: LeadOrigin['utm'] = {}
  const pick = (explicit: string | undefined, param: string) => {
    const fromField = (explicit ?? '').trim()
    if (fromField) return fromField
    const fromQuery = (url?.searchParams.get(param) ?? '').trim()
    return fromQuery || undefined
  }
  const source = pick(data.source_utm_source, 'utm_source')
  const medium = pick(data.source_utm_medium, 'utm_medium')
  const campaign = pick(data.source_utm_campaign, 'utm_campaign')
  if (source) utm.source = source
  if (medium) utm.medium = medium
  if (campaign) utm.campaign = campaign

  const kind: LeadOrigin['kind'] = url?.pathname.includes('fap01-adv')
    ? 'fap01-adv'
    : 'fap01'
  const base = kind === 'fap01-adv' ? 'FAP01-ADV' : 'FAP01'
  const suffix = campaign || source
  return {
    kind,
    label: suffix ? `${base} · ${suffix}` : base,
    utm,
    referrer: data.source_referrer,
  }
}
